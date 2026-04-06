import type { IModelSelector } from '../../../ports/driven/IModelSelector';
import type { SelectionCriteria } from '../../../domain/value-objects/SelectionCriteria';
import { SelectionResult } from '../../../domain/entities/SelectionResult';
import { ModelId } from '../../../domain/value-objects/ModelId';
import type { IHealthService } from '../../../ports/driven/IHealthService';
import type { IEventBus } from '../../../ports/driven/IEventBus';
import { ModelSelectedEvent } from '../../../events/ModelSelectedEvent';

interface CuratedModel {
  id: string;
  tier: 'S+' | 'S' | 'A+' | 'A' | 'A-' | 'B+' | 'B' | 'C';
  contextWindow: number;
  supportsFunctionCalling: boolean;
  supportsVision: boolean;
  swe_score: number;
  isThinking: boolean;
}

declare const CURATED_MODELS: CuratedModel[];

function getCuratedModel(modelId: string): CuratedModel | undefined {
  return CURATED_MODELS.find(m => m.id === modelId);
}

export class SmartModelSelector implements IModelSelector {
  private curatedModels: CuratedModel[] = [];

  constructor(
    private healthService: IHealthService,
    private eventBus: IEventBus,
    models?: CuratedModel[]
  ) {
    this.curatedModels = models || [];
  }

  async selectBest(criteria: SelectionCriteria): Promise<SelectionResult> {
    const allHealth = await this.healthService.getAllHealth();
    const candidates = this.filterCandidates(criteria, allHealth);
    
    if (candidates.length === 0) {
      return SelectionResult.createFailed('No models match criteria');
    }

    const scored = this.scoreCandidates(candidates, criteria, allHealth);
    const best = scored[0];

    this.eventBus.publish(new ModelSelectedEvent(
      ModelId.fromString(best.id),
      best.score,
      criteria
    ));

    return SelectionResult.createSuccess(
      ModelId.fromString(best.id),
      best.score,
      scored.slice(1, 4).map(s => s.id)
    );
  }

  async getFallbackChain(criteria: SelectionCriteria, exclude: string[]): Promise<string[]> {
    const allHealth = await this.healthService.getAllHealth();
    const candidates = this.filterCandidates(criteria, allHealth)
      .filter(c => !exclude.includes(c));

    return this.scoreCandidates(candidates, criteria, allHealth)
      .slice(0, 3)
      .map(c => c.id);
  }

  private getModel(id: string): CuratedModel | undefined {
    return this.curatedModels.find(m => m.id === id) || getCuratedModel(id);
  }

  private filterCandidates(
    criteria: SelectionCriteria,
    health: Map<string, { score: number; available: boolean }>
  ): string[] {
    let models: string[] = this.curatedModels.map((m: CuratedModel) => m.id);

    const minContext = criteria.minContextWindow;
    if (minContext !== undefined) {
      models = models.filter((id: string) => {
        const m = this.getModel(id);
        return m !== undefined && m.contextWindow >= minContext;
      });
    }

    if (criteria.requiresFunctionCalling) {
      models = models.filter((id: string) => {
        const m = this.getModel(id);
        return m !== undefined && m.supportsFunctionCalling;
      });
    }

    if (criteria.requiresVision) {
      models = models.filter((id: string) => {
        const m = this.getModel(id);
        return m !== undefined && m.supportsVision;
      });
    }

    const preferThinking = criteria.preferThinking;
    if (preferThinking !== undefined) {
      models = models.filter((id: string) => {
        const m = this.getModel(id);
        return m !== undefined && m.isThinking === preferThinking;
      });
    }

    const minTier = criteria.minTier;
    if (minTier) {
      const tierOrder = ['S+', 'S', 'A+', 'A', 'A-', 'B+', 'B', 'C'];
      const minIndex = tierOrder.indexOf(minTier);
      models = models.filter((id: string) => {
        const m = this.getModel(id);
        return m !== undefined && tierOrder.indexOf(m.tier) <= minIndex;
      });
    }

    return models.filter((id: string) => {
      const h = health.get(id);
      return h !== undefined && h.available && h.score >= criteria.minHealthScore;
    });
  }

  private scoreCandidates(
    candidates: string[],
    criteria: SelectionCriteria,
    health: Map<string, { score: number; available: boolean }>
  ): Array<{ id: string; score: number }> {
    return candidates
      .map((id: string) => {
        const model = this.getModel(id);
        const healthScore = health.get(id)?.score ?? 0;
        
        let score = 0;
        
        if (model !== undefined) {
          score += model.swe_score;
        }
        score += healthScore * 0.3;
        
        if (criteria.preferSpeed && model !== undefined && model.tier.includes('S')) {
          score += 10;
        }
        
        return { id, score };
      })
      .sort((a, b) => b.score - a.score);
  }
}
