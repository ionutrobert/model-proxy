import { 
  ModelConfig, 
  HealthCheckResult, 
  RankedModel,
  ProviderId,
  UserPreferences,
  SelectionCriteria,
  ModelTier,
  defaultPreferences,
} from './types.js';
import { circuitBreaker } from './circuit-breaker.js';
import { getConfig } from './config.js';

// ============================================================================
// Tier Weights for Ranking
// ============================================================================

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

const PREFERENCE_WEIGHTS: Record<string, number> = {
  'primary': 1.5,
  'secondary': 1.0,
  'fallback': 0.7,
  'disabled': 0,
};

// ============================================================================
// Model Selector
// ============================================================================

export class ModelSelector {
  /**
   * Rank models based on health, tier, and user preferences
   */
  rankModels(
    models: ModelConfig[],
    healthResults: HealthCheckResult[],
    preferences: UserPreferences = defaultPreferences
  ): RankedModel[] {
    // Group health results by model
    const healthByModel = new Map<string, HealthCheckResult>();
    for (const result of healthResults) {
      if (result.status === 'healthy') {
        healthByModel.set(result.modelId, result);
      }
    }

    // Filter to only healthy models from available providers
    const healthyModels = models.filter(model => {
      // Skip disabled providers
      if (preferences.disabledProviders.includes(model.provider)) {
        return false;
      }

      const health = healthByModel.get(model.id);
      const isProviderAvailable = circuitBreaker.isAvailable(model.provider);

      // Check if provider is available
      if (!isProviderAvailable) {
        return false;
      }

      // Check min context window
      if (model.contextWindow < preferences.minContextWindow) {
        return false;
      }

      // Check streaming requirement
      if (preferences.requireStreaming && !model.supportsStreaming) {
        return false;
      }

      // Check function calling requirement
      if (preferences.requireFunctionCalling && !model.supportsFunctionCalling) {
        return false;
      }

      // Check tier preference
      if (!preferences.preferredTiers.includes(model.tier)) {
        return false;
      }

      // Check max latency
      if (health && health.latency > preferences.maxLatencyMs) {
        return false;
      }

      return health !== undefined;
    });

    // Calculate stability score and rank
    const ranked = healthyModels.map(model => {
      const health = healthByModel.get(model.id)!;
      const tierWeight = TIER_WEIGHTS[model.tier];
      
      // Get provider preference weight
      const providerIndex = preferences.providerPriority.indexOf(model.provider);
      let providerWeight = 1.0;
      
      if (providerIndex === 0) providerWeight = PREFERENCE_WEIGHTS['primary'];
      else if (providerIndex === 1) providerWeight = PREFERENCE_WEIGHTS['secondary'];
      else if (providerIndex >= 2) providerWeight = PREFERENCE_WEIGHTS['fallback'];
      else if (preferences.providerPriority.length === 0 && getProviderConfig(model.provider)?.isFree) {
        // Default to preferring free providers
        providerWeight = 1.2;
      }

      // Normalize latency (lower is better)
      const maxExpectedLatency = preferences.maxLatencyMs;
      const normalizedLatency = Math.min(health.latency / maxExpectedLatency, 1);
      
      // Cost factor (prefer cheaper models if configured)
      let costFactor = 1.0;
      if (preferences.preferFreeProviders && model.costPer1kTokens) {
        const avgCost = (model.costPer1kTokens.input + model.costPer1kTokens.output) / 2;
        costFactor = Math.max(0.5, 1 - avgCost);
      }
      
      // Calculate stability score
      // 50% tier, 30% latency, 20% provider preference/cost
      const stabilityScore = 
        (tierWeight * 0.5) + 
        ((1 - normalizedLatency) * 30) + 
        (providerWeight * 10 * costFactor);

      return {
        model,
        health,
        stabilityScore,
        tier: model.tier,
        providerPreference: providerIndex >= 0 ? providerIndex : 999,
      };
    });

    // Apply fallback strategy for sorting
    return this.sortByStrategy(ranked, preferences.fallbackStrategy);
  }

  /**
   * Select the best model based on criteria
   */
  selectBestModel(
    rankedModels: RankedModel[],
    criteria?: SelectionCriteria,
    preferences?: Partial<UserPreferences>
  ): RankedModel | null {
    if (rankedModels.length === 0) return null;

    const config = getConfig();
    const mergedPreferences = { ...config.preferences, ...preferences };

    let candidates = [...rankedModels];

    // Apply tier filter
    if (criteria?.minTier) {
      const minWeight = TIER_WEIGHTS[criteria.minTier];
      candidates = candidates.filter(r => {
        const tierWeight = TIER_WEIGHTS[r.tier];
        return tierWeight >= minWeight;
      });
    }

    // Apply latency filter
    if (criteria?.maxLatency !== undefined) {
      candidates = candidates.filter(r => r.health.latency <= criteria.maxLatency!);
    }

    // Apply streaming requirement
    if (criteria?.requireStreaming) {
      candidates = candidates.filter(r => r.model.supportsStreaming);
    }

    // Apply function calling requirement
    if (criteria?.requireFunctionCalling) {
      candidates = candidates.filter(r => r.model.supportsFunctionCalling);
    }

    // Apply vision requirement
    if (criteria?.requireVision) {
      candidates = candidates.filter(r => r.model.supportsVision);
    }

    // Apply provider exclusion
    if (criteria?.excludedProviders) {
      candidates = candidates.filter(r => 
        !criteria.excludedProviders!.includes(r.model.provider)
      );
    }

    // Apply provider preference
    if (criteria?.preferredProviders && criteria.preferredProviders.length > 0) {
      const preferred = candidates.filter(r => 
        criteria.preferredProviders!.includes(r.model.provider)
      );
      if (preferred.length > 0) {
        candidates = preferred;
      }
    }

    // Apply context window requirement
    if (criteria?.minContextWindow) {
      candidates = candidates.filter(r => 
        r.model.contextWindow >= criteria.minContextWindow!
      );
    }

    // Apply cost limit
    if (criteria?.maxCostPer1kTokens && mergedPreferences.preferFreeProviders) {
      candidates = candidates.filter(r => {
        if (!r.model.costPer1kTokens) return true; // Free models
        const avgCost = (r.model.costPer1kTokens.input + r.model.costPer1kTokens.output) / 2;
        return avgCost <= criteria.maxCostPer1kTokens!;
      });
    }

    return candidates[0] || null;
  }

  /**
   * Select model based on task complexity
   */
  selectModelForTask(
    task: 'simple' | 'complex' | 'critical',
    rankedModels: RankedModel[],
    preferences?: Partial<UserPreferences>
  ): RankedModel | null {
    const tierRequirements: Record<string, ModelTier[]> = {
      simple: ['S+', 'S', 'A+', 'A', 'A-', 'B+', 'B', 'C'],
      complex: ['S+', 'S', 'A+', 'A'],
      critical: ['S+', 'S'],
    };

    const allowedTiers = tierRequirements[task] || tierRequirements.simple;
    
    let candidates = rankedModels.filter(r => allowedTiers.includes(r.tier));
    
    // If no candidates, try with all tiers
    if (candidates.length === 0) {
      candidates = rankedModels;
    }

    // Prefer free providers for simple tasks
    const config = getConfig();
    if (task === 'simple' && (preferences?.preferFreeProviders ?? config.preferences.preferFreeProviders)) {
      const freeModels = candidates.filter(r => !r.model.costPer1kTokens);
      if (freeModels.length > 0) {
        return freeModels[0];
      }
    }

    return candidates[0] || null;
  }

  /**
   * Get fallback chain of models
   */
  getFallbackChain(
    rankedModels: RankedModel[],
    count: number = 3
  ): RankedModel[] {
    return rankedModels.slice(0, count);
  }

  /**
   * Sort ranked models by selected strategy
   */
  private sortByStrategy(
    ranked: RankedModel[],
    strategy: UserPreferences['fallbackStrategy']
  ): RankedModel[] {
    switch (strategy) {
      case 'latency':
        return ranked.sort((a, b) => a.health.latency - b.health.latency);
      
      case 'cost':
        return ranked.sort((a, b) => {
          const costA = a.model.costPer1kTokens ? 
            (a.model.costPer1kTokens.input + a.model.costPer1kTokens.output) / 2 : 0;
          const costB = b.model.costPer1kTokens ? 
            (b.model.costPer1kTokens.input + b.model.costPer1kTokens.output) / 2 : 0;
          return costA - costB;
        });
      
      case 'availability':
        return ranked.sort((a, b) => {
          // Sort by provider health state
          const stateA = circuitBreaker.getState(a.model.provider);
          const stateB = circuitBreaker.getState(b.model.provider);
          const stateOrder = { 'closed': 0, 'half-open': 1, 'open': 2 };
          return stateOrder[stateA] - stateOrder[stateB];
        });
      
      case 'priority':
      default:
        // Sort by provider priority first, then by stability score
        return ranked.sort((a, b) => {
          if (a.providerPreference !== b.providerPreference) {
            return a.providerPreference - b.providerPreference;
          }
          return b.stabilityScore - a.stabilityScore;
        });
    }
  }

  /**
   * Filter models by provider
   */
  filterByProvider(
    rankedModels: RankedModel[],
    providers: ProviderId[]
  ): RankedModel[] {
    return rankedModels.filter(r => providers.includes(r.model.provider));
  }

  /**
   * Filter models by tier
   */
  filterByTier(
    rankedModels: RankedModel[],
    minTier: ModelTier
  ): RankedModel[] {
    const minWeight = TIER_WEIGHTS[minTier];
    return rankedModels.filter(r => TIER_WEIGHTS[r.tier] >= minWeight);
  }

  /**
   * Get free providers only
   */
  getFreeProviders(rankedModels: RankedModel[]): RankedModel[] {
    return rankedModels.filter(r => !r.model.costPer1kTokens);
  }

  /**
   * Get paid providers only
   */
  getPaidProviders(rankedModels: RankedModel[]): RankedModel[] {
    return rankedModels.filter(r => r.model.costPer1kTokens);
  }
}

// Get provider config helper
function getProviderConfig(providerId: ProviderId) {
  const config = getConfig();
  return config.providers.find(p => p.id === providerId);
}

// Global model selector instance
export const modelSelector = new ModelSelector();
