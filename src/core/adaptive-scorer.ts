import { circuitBreaker } from './circuit-breaker.js';

/**
 * Adaptive Model Scorer
 * From multi-agent-patterns: Weighted voting and capability-based selection
 * 
 * Learns from conversation success rates to improve model selection
 */
export interface ModelPerformanceMetrics {
  modelId: string;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  averageLatency: number;
  toolCallSuccess: number;
  toolCallFailures: number;
  contextWindowUsage: number[];
  lastUpdated: number;
}

export class AdaptiveModelScorer {
  private metrics: Map<string, ModelPerformanceMetrics> = new Map();
  private decayFactor: number = 0.95; // Decay old metrics over time
  private minSamplesForAdaptation: number = 10;

  /**
   * Record a successful request
   */
  recordSuccess(
    modelId: string,
    latency: number,
    metadata?: {
      hadToolCalls?: boolean;
      contextWindowUsed?: number;
    }
  ): void {
    const metrics = this.getOrCreateMetrics(modelId);
    
    // Apply decay to old metrics
    this.applyDecay(metrics);

    metrics.totalRequests++;
    metrics.successfulRequests++;
    metrics.averageLatency = this.updateAverage(
      metrics.averageLatency,
      latency,
      metrics.successfulRequests
    );

    if (metadata?.hadToolCalls) {
      metrics.toolCallSuccess++;
    }

    if (metadata?.contextWindowUsed) {
      metrics.contextWindowUsage.push(metadata.contextWindowUsed);
      // Keep only last 100 samples
      if (metrics.contextWindowUsage.length > 100) {
        metrics.contextWindowUsage.shift();
      }
    }

    metrics.lastUpdated = Date.now();
  }

  /**
   * Record a failed request
   */
  recordFailure(
    modelId: string,
    error: string,
    metadata?: {
      hadToolCalls?: boolean;
    }
  ): void {
    const metrics = this.getOrCreateMetrics(modelId);
    
    this.applyDecay(metrics);

    metrics.totalRequests++;
    metrics.failedRequests++;

    if (metadata?.hadToolCalls) {
      metrics.toolCallFailures++;
    }

    metrics.lastUpdated = Date.now();
  }

  /**
   * Get adaptive score for a model
   */
  getAdaptiveScore(
    modelId: string,
    contextType: 'tool' | 'reasoning' | 'general'
  ): number {
    const metrics = this.metrics.get(modelId);
    
    if (!metrics || metrics.totalRequests < this.minSamplesForAdaptation) {
      // Not enough data, use default scoring
      return 50;
    }

    let score = 0;

    // Base success rate (0-40 points)
    const successRate = metrics.successfulRequests / metrics.totalRequests;
    score += successRate * 40;

    // Latency score (0-20 points, lower is better)
    const latencyScore = Math.max(0, 20 - (metrics.averageLatency / 100));
    score += latencyScore;

    // Context-specific scoring
    if (contextType === 'tool') {
      // Tool success rate (0-30 points)
      const totalToolCalls = metrics.toolCallSuccess + metrics.toolCallFailures;
      if (totalToolCalls > 0) {
        const toolSuccessRate = metrics.toolCallSuccess / totalToolCalls;
        score += toolSuccessRate * 30;
      }
    } else if (contextType === 'reasoning') {
      // Reward models with high success on complex tasks
      score += successRate * 10;
    }

    // Reliability bonus (0-10 points)
    const reliabilityScore = Math.min(10, metrics.successfulRequests / 10);
    score += reliabilityScore;

    return Math.min(100, Math.max(0, score));
  }

  /**
   * Get recommended model for context type
   */
  getRecommendedModel(
    candidateModels: string[],
    contextType: 'tool' | 'reasoning' | 'general'
  ): string | null {
    if (candidateModels.length === 0) return null;

    // Filter out models with circuit breaker open
    const availableModels = candidateModels.filter(modelId => 
      circuitBreaker.isModelAvailable(modelId)
    );

    if (availableModels.length === 0) return null;

    // Score each model
    const scoredModels = availableModels.map(modelId => ({
      modelId,
      score: this.getAdaptiveScore(modelId, contextType)
    }));

    // Sort by score descending
    scoredModels.sort((a, b) => b.score - a.score);

    return scoredModels[0].modelId;
  }

  /**
   * Get performance metrics for a model
   */
  getMetrics(modelId: string): ModelPerformanceMetrics | undefined {
    return this.metrics.get(modelId);
  }

  /**
   * Get all metrics
   */
  getAllMetrics(): ModelPerformanceMetrics[] {
    return Array.from(this.metrics.values());
  }

  /**
   * Get top performing models
   */
  getTopPerformers(contextType: 'tool' | 'reasoning' | 'general', count: number = 5): string[] {
    const modelScores = Array.from(this.metrics.keys())
      .map(modelId => ({
        modelId,
        score: this.getAdaptiveScore(modelId, contextType)
      }))
      .sort((a, b) => b.score - a.score);

    return modelScores.slice(0, count).map(m => m.modelId);
  }

  /**
   * Get or create metrics for a model
   */
  private getOrCreateMetrics(modelId: string): ModelPerformanceMetrics {
    if (!this.metrics.has(modelId)) {
      this.metrics.set(modelId, {
        modelId,
        totalRequests: 0,
        successfulRequests: 0,
        failedRequests: 0,
        averageLatency: 0,
        toolCallSuccess: 0,
        toolCallFailures: 0,
        contextWindowUsage: [],
        lastUpdated: Date.now()
      });
    }
    return this.metrics.get(modelId)!;
  }

  /**
   * Apply decay to old metrics
   */
  private applyDecay(metrics: ModelPerformanceMetrics): void {
    const hoursSinceUpdate = (Date.now() - metrics.lastUpdated) / (1000 * 60 * 60);
    
    if (hoursSinceUpdate > 1) {
      const decayMultiplier = Math.pow(this.decayFactor, hoursSinceUpdate);
      metrics.successfulRequests *= decayMultiplier;
      metrics.failedRequests *= decayMultiplier;
      metrics.toolCallSuccess *= decayMultiplier;
      metrics.toolCallFailures *= decayMultiplier;
    }
  }

  /**
   * Update average with new value
   */
  private updateAverage(currentAvg: number, newValue: number, count: number): number {
    return ((currentAvg * (count - 1)) + newValue) / count;
  }
}

export const adaptiveModelScorer = new AdaptiveModelScorer();
