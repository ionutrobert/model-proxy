import {
  ModelConfig,
  HealthCheckResult,
  RankedModel,
  UserPreferences,
  SelectionCriteria,
  ModelTier,
  defaultPreferences,
} from './types.js';
import { circuitBreaker } from './circuit-breaker.js';
import { CURATED_MODELS, supportsToolCalling, getCuratedModel } from './curated-models.js';

const TIER_WEIGHTS: Record<ModelTier, number> = {
  'S+': 100,
  'S': 90,
  'A+': 80,
  'A': 70,
  'A-': 60,
  'B+': 50,
  'B': 40,
  'C': 30,
};

export type SelectionMode = 'best' | 'fastest' | 'cheapest' | 'coding' | 'reasoning';

export interface ModelSelectionResult {
  model: RankedModel;
  alternatives: RankedModel[];
  mode: SelectionMode;
}

export class SmartModelSelector {
  rankModels(
    models: ModelConfig[],
    healthResults: HealthCheckResult[],
    preferences: UserPreferences = defaultPreferences
  ): RankedModel[] {
    const healthByModel = new Map<string, HealthCheckResult>();
    for (const result of healthResults) {
      if (result.status === 'healthy') {
        healthByModel.set(result.modelId, result);
      }
    }

    const healthyModels = models.filter(model => {
      if (preferences.disabledProviders.includes(model.provider)) {
        return false;
      }

      if (!circuitBreaker.isAvailable(model.provider)) {
        return false;
      }

      if (model.contextWindow < preferences.minContextWindow) {
        return false;
      }

      if (preferences.requireStreaming && !model.supportsStreaming) {
        return false;
      }

      if (preferences.requireFunctionCalling && !model.supportsFunctionCalling) {
        return false;
      }

      if (!preferences.preferredTiers.includes(model.tier)) {
        return false;
      }

      const health = healthByModel.get(model.id);
      if (!health) return false;

      if (health.latency > preferences.maxLatencyMs) {
        return false;
      }

      return true;
    });

    const ranked = healthyModels.map(model => {
      const health = healthByModel.get(model.id)!;
      
      // Use curated model info if available
      const curated = getCuratedModel(model.id);
      const tierWeight = TIER_WEIGHTS[curated?.tier || model.tier];

      const maxLatency = preferences.maxLatencyMs;
      const latencyScore = Math.max(0, 30 * (1 - health.latency / maxLatency));

      const contextWindow = curated?.contextWindow || model.contextWindow;
      const contextScore = Math.min(20, (contextWindow / 128000) * 20);

      const supportsFnCalling = curated?.supportsFunctionCalling ?? model.supportsFunctionCalling ?? false;
      const supportsVis = curated?.supportsVision ?? model.supportsVision ?? false;
      
      const capabilityScore =
        (model.supportsStreaming ? 5 : 0) +
        (supportsFnCalling ? 10 : 0) +
        (supportsVis ? 5 : 0);

      // Boost score for curated models
      const curatedBoost = curated ? 15 : 0;
      
      // Boost score for models known to work with tools
      const toolBoost = supportsToolCalling(model.id) ? 10 : 0;

      const stabilityScore = tierWeight + latencyScore + contextScore + capabilityScore + curatedBoost + toolBoost;

      return {
        model,
        health,
        stabilityScore,
        tier: curated?.tier || model.tier,
        providerPreference: 0,
      };
    });

    return ranked.sort((a, b) => b.stabilityScore - a.stabilityScore);
  }

  selectForMode(
    mode: SelectionMode,
    rankedModels: RankedModel[],
    preferences?: Partial<UserPreferences>
  ): ModelSelectionResult | null {
    if (rankedModels.length === 0) return null;

    let candidates = [...rankedModels];
    let alternatives: RankedModel[] = [];

    switch (mode) {
      case 'best':
        // Prefer models that work well with tools
        candidates = candidates.sort((a, b) => {
          const aToolCapable = supportsToolCalling(a.model.id) ? 1 : 0;
          const bToolCapable = supportsToolCalling(b.model.id) ? 1 : 0;
          if (aToolCapable !== bToolCapable) return bToolCapable - aToolCapable;
          return b.stabilityScore - a.stabilityScore;
        });
        break;

      case 'fastest':
        candidates = candidates.sort((a, b) => a.health.latency - b.health.latency);
        break;

      case 'cheapest':
        candidates = candidates.sort((a, b) => {
          const costA = a.model.costPer1kTokens
            ? (a.model.costPer1kTokens.input + a.model.costPer1kTokens.output) / 2
            : 0;
          const costB = b.model.costPer1kTokens
            ? (b.model.costPer1kTokens.input + b.model.costPer1kTokens.output) / 2
            : 0;
          return costA - costB;
        });
        break;

      case 'coding':
        // For coding, prioritize models known to work with tools
        candidates = candidates.sort((a, b) => {
          const aToolCapable = supportsToolCalling(a.model.id) ? 1 : 0;
          const bToolCapable = supportsToolCalling(b.model.id) ? 1 : 0;
          if (aToolCapable !== bToolCapable) return bToolCapable - aToolCapable;
          
          const aCurated = getCuratedModel(a.model.id);
          const bCurated = getCuratedModel(b.model.id);
          const aSweScore = aCurated?.swe_score || 0;
          const bSweScore = bCurated?.swe_score || 0;
          if (aSweScore !== bSweScore) return bSweScore - aSweScore;
          
          return b.stabilityScore - a.stabilityScore;
        });
        // Filter for models with good context window
        candidates = candidates.filter(r => r.model.contextWindow >= 32000);
        break;

      case 'reasoning':
        candidates = candidates.filter(r =>
          r.tier === 'S+' || r.tier === 'S' || r.model.id.includes('o1') || r.model.id.includes('reasoning')
        );
        break;
    }

    if (candidates.length === 0) {
      candidates = rankedModels.slice(0, 5);
    }

    const selected = candidates[0];
    alternatives = candidates.slice(1, 4);

    return {
      model: selected,
      alternatives,
      mode,
    };
  }

  private filterBestForCoding(models: RankedModel[]): RankedModel[] {
    const codingKeywords = [
      'llama-3.1', 'llama3.1', 'nemotron', 'codellama', 'deepseek-coder',
      'gpt-4', 'claude-3', 'mistral', 'mixtral', 'gemma',
    ];

    const scored = models.map(r => {
      const id = r.model.id.toLowerCase();
      let boost = 0;

      if (id.includes('405b') || id.includes('70b') || id.includes('nemotron')) boost += 20;
      else if (id.includes('34b') || id.includes('mixtral-8x22')) boost += 15;
      else if (id.includes('8x7b') || id.includes('70b')) boost += 10;

      if (r.model.contextWindow >= 128000) boost += 15;
      else if (r.model.contextWindow >= 32000) boost += 10;

      if (r.model.supportsFunctionCalling) boost += 10;

      const isCodingModel = codingKeywords.some(kw => id.includes(kw));
      if (!isCodingModel) boost -= 20;

      return { ...r, stabilityScore: r.stabilityScore + boost };
    });

    return scored.sort((a, b) => b.stabilityScore - a.stabilityScore);
  }

  selectBestModel(
    rankedModels: RankedModel[],
    criteria?: SelectionCriteria
  ): RankedModel | null {
    if (rankedModels.length === 0) return null;

    let candidates = [...rankedModels];

    if (criteria?.minTier) {
      const minWeight = TIER_WEIGHTS[criteria.minTier];
      candidates = candidates.filter(r => TIER_WEIGHTS[r.tier] >= minWeight);
    }

    if (criteria?.maxLatency !== undefined) {
      const maxLat = criteria.maxLatency;
      candidates = candidates.filter(r => r.health.latency <= maxLat);
    }

    if (criteria?.requireStreaming) {
      candidates = candidates.filter(r => r.model.supportsStreaming);
    }

    if (criteria?.requireFunctionCalling) {
      candidates = candidates.filter(r => r.model.supportsFunctionCalling);
    }

    if (criteria?.requireVision) {
      candidates = candidates.filter(r => r.model.supportsVision);
    }

    if (criteria?.minContextWindow !== undefined) {
      const minCtx = criteria.minContextWindow;
      candidates = candidates.filter(r => r.model.contextWindow >= minCtx);
    }

    if (criteria?.excludedProviders) {
      candidates = candidates.filter(r => !criteria.excludedProviders!.includes(r.model.provider));
    }

    if (criteria?.preferredProviders && criteria.preferredProviders.length > 0) {
      const preferred = candidates.filter(r => criteria.preferredProviders!.includes(r.model.provider));
      if (preferred.length > 0) candidates = preferred;
    }

    return candidates[0] || null;
  }

  getFallbackChain(rankedModels: RankedModel[], count: number = 3): RankedModel[] {
    const chain: RankedModel[] = [];
    const usedProviders = new Set<string>();

    for (const model of rankedModels) {
      if (chain.length >= count) break;

      if (!usedProviders.has(model.model.provider) || chain.length < 2) {
        chain.push(model);
        usedProviders.add(model.model.provider);
      }
    }

    if (chain.length < count) {
      for (const model of rankedModels) {
        if (chain.length >= count) break;
        if (!chain.includes(model)) {
          chain.push(model);
        }
      }
    }

    return chain;
  }

  filterByProvider(rankedModels: RankedModel[], providers: string[]): RankedModel[] {
    return rankedModels.filter(r => providers.includes(r.model.provider));
  }

  filterByTier(rankedModels: RankedModel[], minTier: ModelTier): RankedModel[] {
    const minWeight = TIER_WEIGHTS[minTier];
    return rankedModels.filter(r => TIER_WEIGHTS[r.tier] >= minWeight);
  }
}

export const smartModelSelector = new SmartModelSelector();
