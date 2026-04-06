import type { IHealthService } from '../../../ports/driven/IHealthService';
import type { ModelId } from '../../../domain/value-objects/ModelId';
import type { HealthAssessmentDto } from '../../../DataTransfer/HealthAssessmentDto';
import type { IEventBus } from '../../../ports/driven/IEventBus';
import { HealthChangedEvent } from '../../../events/HealthChangedEvent';
import { ModelId as ModelIdClass } from '../../../domain/value-objects/ModelId';

export interface HealthCheckConfig {
  endpoint: string;
  intervalMs: number;
  timeoutMs: number;
}

export class HealthService implements IHealthService {
  private healthCache: Map<string, HealthAssessmentDto> = new Map();
  private lastRefresh: number = 0;
  private refreshIntervalMs: number;

  constructor(
    private config: HealthCheckConfig,
    private eventBus: IEventBus
  ) {
    this.refreshIntervalMs = config.intervalMs;
  }

  async getHealth(modelId: ModelId): Promise<HealthAssessmentDto> {
    const cached = this.healthCache.get(modelId.value);
    if (cached && Date.now() - cached.timestamp < this.refreshIntervalMs) {
      return cached;
    }

    const assessment = await this.checkModelHealth(modelId.value);
    this.healthCache.set(modelId.value, assessment);
    
    return assessment;
  }

  async getAllHealth(): Promise<Map<string, HealthAssessmentDto>> {
    await this.refresh();
    return new Map(this.healthCache);
  }

  async refresh(): Promise<void> {
    if (Date.now() - this.lastRefresh < this.refreshIntervalMs) {
      return;
    }

    this.lastRefresh = Date.now();
    
    const previousHealth = new Map(this.healthCache);
    
    for (const [modelId] of this.healthCache) {
      const assessment = await this.checkModelHealth(modelId);
      const previous = previousHealth.get(modelId);
      
      if (previous !== undefined && previous.score !== assessment.score) {
        this.eventBus.publish(new HealthChangedEvent(
          ModelIdClass.fromString(modelId),
          previous.score,
          assessment.score
        ));
      }
      
      this.healthCache.set(modelId, assessment);
    }
  }

  private async checkModelHealth(modelId: string): Promise<HealthAssessmentDto> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);

      const response = await fetch(`${this.config.endpoint}/v1/models/${modelId}`, {
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        return {
          modelId,
          score: 0,
          latencyMs: 0,
          available: false,
          timestamp: Date.now(),
          error: `HTTP ${response.status}`,
        };
      }

      const startTime = Date.now();
      const testResponse = await fetch(`${this.config.endpoint}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: modelId,
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 1,
        }),
        signal: controller.signal,
      });
      const latencyMs = Date.now() - startTime;

      clearTimeout(timeoutId);

      return {
        modelId,
        score: testResponse.ok ? 100 : 50,
        latencyMs,
        available: testResponse.ok,
        timestamp: Date.now(),
      };
    } catch (error) {
      return {
        modelId,
        score: 0,
        latencyMs: 0,
        available: false,
        timestamp: Date.now(),
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}
