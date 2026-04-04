// ============================================================================
// Health Tracker - In-memory health data storage and rolling window management
// ============================================================================

import { ProviderId, ModelHealthHistory, HealthRequest, Verdict, HealthMetrics } from './types.js';
import {
  detectThinkingModel,
  calculateMetrics,
  getVerdict,
  calculateStabilityScore,
} from './health-calculator.js';

const DEFAULT_WINDOW_SIZE = 20;
const DEFAULT_MAX_AGE_MS = 3600000; // 1 hour

export class HealthTracker {
  private histories = new Map<string, ModelHealthHistory>();
  private windowSize: number;
  private maxAgeMs: number;

  constructor(options?: { windowSize?: number; maxAgeMs?: number }) {
    this.windowSize = options?.windowSize ?? DEFAULT_WINDOW_SIZE;
    this.maxAgeMs = options?.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  }

  recordRequest(
    modelId: string,
    providerId: ProviderId,
    request: Omit<HealthRequest, 'timestamp'>
  ): void {
    const key = this.getKey(modelId);
    let history = this.histories.get(key);

    if (!history) {
      history = {
        modelId,
        providerId,
        requests: [],
        verdict: 'Pending',
        stabilityScore: -1,
        isThinking: detectThinkingModel(modelId),
        lastUpdated: Date.now(),
        metrics: {
          avgLatency: 0,
          p95Latency: 0,
          jitter: 0,
          uptimePercent: 100,
          spikeRate: 0,
          totalRequests: 0,
          successfulRequests: 0,
        },
      };
      this.histories.set(key, history);
    }

    const fullRequest: HealthRequest = {
      ...request,
      timestamp: Date.now(),
    };

    history.requests.push(fullRequest);

    if (history.requests.length > this.windowSize) {
      history.requests = history.requests.slice(-this.windowSize);
    }

    history.lastUpdated = Date.now();
    history.metrics = calculateMetrics(history.requests);
    history.verdict = getVerdict(history);
    history.stabilityScore = calculateStabilityScore(history);
  }

  getHealth(modelId: string): ModelHealthHistory | null {
    const key = this.getKey(modelId);
    return this.histories.get(key) ?? null;
  }

  getVerdict(modelId: string): Verdict {
    const history = this.getHealth(modelId);
    return history?.verdict ?? 'Pending';
  }

  getStabilityScore(modelId: string): number {
    const history = this.getHealth(modelId);
    return history?.stabilityScore ?? -1;
  }

  getMetrics(modelId: string): HealthMetrics | null {
    const history = this.getHealth(modelId);
    return history?.metrics ?? null;
  }

  isHealthy(modelId: string): boolean {
    const verdict = this.getVerdict(modelId);
    const unhealthyVerdicts: Verdict[] = ['Unstable', 'Not Active', 'Overloaded'];
    return !unhealthyVerdicts.includes(verdict);
  }

  getAllHealth(): Map<string, ModelHealthHistory> {
    return new Map(this.histories);
  }

  markUnavailable(modelId: string, providerId: ProviderId, reason: string): void {
    this.recordRequest(modelId, providerId, {
      latency: 0,
      statusCode: 'ERR',
      success: false,
    });
  }

  cleanup(maxAge?: number): void {
    const cutoff = Date.now() - (maxAge ?? this.maxAgeMs);
    for (const [key, history] of this.histories) {
      if (history.lastUpdated < cutoff) {
        this.histories.delete(key);
      }
    }
  }

  clear(): void {
    this.histories.clear();
  }

  private getKey(modelId: string): string {
    return modelId.toLowerCase();
  }
}

export const healthTracker = new HealthTracker();
