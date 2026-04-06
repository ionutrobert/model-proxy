// ============================================================================
// Auto-Modes Handler - Handles auto-coding, auto-fast, auto-balanced aliases
// ============================================================================

import { ModelConfig, ProviderId, Verdict } from './types.js';
import { getCuratedModel, supportsToolCalling } from './curated-models.js';
import { detectThinkingModel } from './health-calculator.js';
import type { ModelHealthHistory } from './types.js';

export type AutoMode = 'auto-coding' | 'auto-fast' | 'auto-balanced';

export interface AutoModeConfig {
  minTier: string;
  minContextWindow: number;
  preferThinking: boolean;
  minStability: number;
  maxLatency?: number;
  task: string;
}

export interface AutoModeSelection {
  selected: {
    id: string;
    provider: ProviderId;
    name: string;
    tier: string;
    contextWindow: number;
    isThinking: boolean;
    stability: number;
    verdict: Verdict;
    sweScore: number;
  };
  alternatives: Array<{
    id: string;
    name: string;
    stability: number;
    sweScore: number;
    compositeScore: number;
  }>;
  reason: string;
  mode: AutoMode;
}

export const AUTO_MODE_CONFIGS: Record<AutoMode, AutoModeConfig> = {
  'auto-coding': {
    minTier: 'A',
    minContextWindow: 100000,
    preferThinking: true,
    minStability: 50,
    task: 'coding',
  },
  'auto-fast': {
    minTier: 'A-',
    minContextWindow: 8000,
    preferThinking: false,
    minStability: 60,
    maxLatency: 1000,
    task: 'fast',
  },
  'auto-balanced': {
    minTier: 'A-',
    minContextWindow: 32000,
    preferThinking: false,
    minStability: 60,
    task: 'balanced',
  },
};

const TIER_WEIGHTS: Record<string, number> = {
  'S+': 100,
  'S': 90,
  'A+': 80,
  'A': 70,
  'A-': 60,
  'B+': 50,
  'B': 40,
  'C': 30,
};

class AutoModesHandler {
  selectForCoding(
    models: ModelConfig[],
    healthData: Map<string, ModelHealthHistory>
  ): AutoModeSelection | null {
    const config = AUTO_MODE_CONFIGS['auto-coding'];
    const candidates = this.filterCandidates(models, healthData, config);

    if (candidates.length === 0) return null;

    const scored = candidates.map(candidate => {
      const curated = getCuratedModel(candidate.model.id);
      const sweScore = curated?.swe_score || 0;
      const tierWeight = TIER_WEIGHTS[candidate.model.tier] || 0;
      
      // Reduce thinking boost from 15 to 5 - thinking models often have issues
      const thinkingBoost = candidate.health.isThinking && config.preferThinking ? 5 : 0;
      const toolBoost = supportsToolCalling(candidate.model.id) ? 10 : 0;
      const contextBoost = candidate.model.contextWindow >= 128000 ? 10 : candidate.model.contextWindow >= 80000 ? 5 : 0;

      // Penalize models with failures
      const totalRequests = candidate.health.metrics.totalRequests || 1;
      const successRate = candidate.health.metrics.successfulRequests / totalRequests;
      const failurePenalty = successRate < 0.9 ? 15 : successRate < 0.95 ? 10 : 0;
      
      // Penalize unstable verdicts more heavily
      const unstablePenalty = candidate.health.verdict === 'Unstable' ? 20 : 0;

      const compositeScore = candidate.stability + thinkingBoost + (sweScore * 0.5) + (tierWeight * 0.3) + toolBoost + contextBoost - failurePenalty - unstablePenalty;

      return {
        ...candidate,
        sweScore,
        compositeScore: Math.round(compositeScore),
      };
    });

    scored.sort((a, b) => b.compositeScore - a.compositeScore);

    const selected = scored[0];
    const alternatives = scored.slice(1, 4).map(s => ({
      id: s.model.id,
      name: s.model.name,
      stability: s.stability,
      sweScore: s.sweScore,
      compositeScore: s.compositeScore,
    }));

    const successRate = selected.health.metrics.successfulRequests / (selected.health.metrics.totalRequests || 1);
    const reason = selected.health.isThinking
      ? `Thinking model: stability(${selected.stability}) + SWE(${selected.sweScore}) + success(${(successRate * 100).toFixed(0)}%)`
      : `Highest score: stability(${selected.stability}) + SWE(${selected.sweScore}) + tier(${TIER_WEIGHTS[selected.model.tier]})`;

    return {
      selected: {
        id: selected.model.id,
        provider: selected.model.provider,
        name: selected.model.name,
        tier: selected.model.tier,
        contextWindow: selected.model.contextWindow,
        isThinking: selected.health.isThinking,
        stability: selected.stability,
        verdict: selected.health.verdict,
        sweScore: selected.sweScore,
      },
      alternatives,
      reason,
      mode: 'auto-coding',
    };
  }

  selectForFast(
    models: ModelConfig[],
    healthData: Map<string, ModelHealthHistory>
  ): AutoModeSelection | null {
    const config = AUTO_MODE_CONFIGS['auto-fast'];
    const candidates = this.filterCandidates(models, healthData, config);

    if (candidates.length === 0) return null;

    const scored = candidates.map(candidate => {
      const latencyPenalty = candidate.health.metrics.avgLatency > 0
        ? Math.max(0, 100 - (candidate.health.metrics.avgLatency / config.maxLatency!) * 50)
        : 50;

      const compositeScore = candidate.stability * 0.6 + latencyPenalty * 0.4;

      return {
        ...candidate,
        sweScore: getCuratedModel(candidate.model.id)?.swe_score || 0,
        compositeScore: Math.round(compositeScore),
      };
    });

    scored.sort((a, b) => b.compositeScore - a.compositeScore);

    const selected = scored[0];
    const alternatives = scored.slice(1, 4).map(s => ({
      id: s.model.id,
      name: s.model.name,
      stability: s.stability,
      sweScore: s.sweScore,
      compositeScore: s.compositeScore,
    }));

    return {
      selected: {
        id: selected.model.id,
        provider: selected.model.provider,
        name: selected.model.name,
        tier: selected.model.tier,
        contextWindow: selected.model.contextWindow,
        isThinking: selected.health.isThinking,
        stability: selected.stability,
        verdict: selected.health.verdict,
        sweScore: selected.sweScore,
      },
      alternatives,
      reason: `Fastest stable model: latency(${selected.health.metrics.avgLatency}ms) + stability(${selected.stability})`,
      mode: 'auto-fast',
    };
  }

  selectBalanced(
    models: ModelConfig[],
    healthData: Map<string, ModelHealthHistory>
  ): AutoModeSelection | null {
    const config = AUTO_MODE_CONFIGS['auto-balanced'];
    const candidates = this.filterCandidates(models, healthData, config);

    if (candidates.length === 0) return null;

    const scored = candidates.map(candidate => {
      const curated = getCuratedModel(candidate.model.id);
      const sweScore = curated?.swe_score || 0;
      const tierWeight = TIER_WEIGHTS[candidate.model.tier] || 0;

      const compositeScore = candidate.stability * 0.5 + (sweScore * 0.3) + (tierWeight * 0.2);

      return {
        ...candidate,
        sweScore,
        compositeScore: Math.round(compositeScore),
      };
    });

    scored.sort((a, b) => b.compositeScore - a.compositeScore);

    const selected = scored[0];
    const alternatives = scored.slice(1, 4).map(s => ({
      id: s.model.id,
      name: s.model.name,
      stability: s.stability,
      sweScore: s.sweScore,
      compositeScore: s.compositeScore,
    }));

    return {
      selected: {
        id: selected.model.id,
        provider: selected.model.provider,
        name: selected.model.name,
        tier: selected.model.tier,
        contextWindow: selected.model.contextWindow,
        isThinking: selected.health.isThinking,
        stability: selected.stability,
        verdict: selected.health.verdict,
        sweScore: selected.sweScore,
      },
      alternatives,
      reason: `Balanced selection: stability(${selected.stability}) + SWE(${selected.sweScore}) + tier(${TIER_WEIGHTS[selected.model.tier]})`,
      mode: 'auto-balanced',
    };
  }

  select(
    mode: AutoMode,
    models: ModelConfig[],
    healthData: Map<string, ModelHealthHistory>
  ): AutoModeSelection | null {
    switch (mode) {
      case 'auto-coding':
        return this.selectForCoding(models, healthData);
      case 'auto-fast':
        return this.selectForFast(models, healthData);
      case 'auto-balanced':
        return this.selectBalanced(models, healthData);
      default:
        return null;
    }
  }

  private filterCandidates(
    models: ModelConfig[],
    healthData: Map<string, ModelHealthHistory>,
    config: AutoModeConfig
  ): Array<{ model: ModelConfig; health: ModelHealthHistory; stability: number }> {
    const results: Array<{ model: ModelConfig; health: ModelHealthHistory; stability: number }> = [];

    for (const model of models) {
      const health = healthData.get(model.id.toLowerCase());
      if (!health) continue;
      if (health.stabilityScore < config.minStability) continue;
      if (model.contextWindow < config.minContextWindow) continue;

      const tierWeight = TIER_WEIGHTS[model.tier] || 0;
      const minTierWeight = TIER_WEIGHTS[config.minTier] || 0;
      if (tierWeight < minTierWeight) continue;

      if (config.maxLatency && health.metrics.avgLatency > config.maxLatency) continue;

      const unhealthyVerdicts: Verdict[] = ['Unstable', 'Not Active', 'Overloaded'];
      if (unhealthyVerdicts.includes(health.verdict)) continue;

      results.push({
        model,
        health,
        stability: health.stabilityScore,
      });
    }

    return results;
  }
}

export const autoModesHandler = new AutoModesHandler();
