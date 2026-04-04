// ============================================================================
// Background Poller - Polls unhealthy/unknown models with max_tokens: 1
// Sequential polling to avoid rate limits
// ============================================================================

import { ProviderId, ModelConfig } from './types.js';
import { healthTracker } from './health-tracker.js';

export interface PollerConfig {
  enabled: boolean;
  intervalMs: number;
  timeoutMs: number;
  maxConcurrent: number;
}

const DEFAULT_CONFIG: PollerConfig = {
  enabled: true,
  intervalMs: 10000,
  timeoutMs: 15000,
  maxConcurrent: 1,
};

export interface PollResult {
  modelId: string;
  providerId: ProviderId;
  latency: number;
  success: boolean;
  statusCode: string;
  verdict: string;
}

type PollFn = (modelId: string, providerId: ProviderId) => Promise<{ latency: number; statusCode: string }>;

class BackgroundPoller {
  private config: PollerConfig;
  private running = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pollFn: PollFn | null = null;
  private models: ModelConfig[] = [];

  constructor(config?: Partial<PollerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  setPollFn(pollFn: PollFn): void {
    this.pollFn = pollFn;
  }

  setConfig(config: Partial<PollerConfig>): void {
    this.config = { ...this.config, ...config };
  }

  setModels(models: ModelConfig[]): void {
    this.models = models;
  }

  start(): void {
    if (!this.config.enabled || !this.pollFn) return;

    this.running = true;
    console.log(`🔄 Background polling started (${this.config.intervalMs}ms interval)`);

    this.poll();
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    console.log('⏹️ Background polling stopped');
  }

  async pollOnce(): Promise<PollResult[]> {
    if (!this.pollFn) return [];

    const results: PollResult[] = [];

    const modelsToPoll = this.getModelsToPoll();
    if (modelsToPoll.length === 0) return results;

    console.log(`🔍 Polling ${modelsToPoll.length} model(s)...`);

    for (const model of modelsToPoll) {
      try {
        const result = await this.pollModel(model);
        results.push(result);

        console.log(`  ├─ ${model.id}: ${result.verdict} (${result.latency}ms)`);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`  ✗ ${model.id}: Error - ${errorMessage}`);
      }

      if (modelsToPoll.indexOf(model) < modelsToPoll.length - 1) {
        await this.delay(this.config.intervalMs);
      }
    }

    return results;
  }

  private async poll(): Promise<void> {
    if (!this.running) return;

    await this.pollOnce();

    this.timer = setTimeout(() => this.poll(), this.config.intervalMs);
  }

  private async pollModel(model: ModelConfig): Promise<PollResult> {
    if (!this.pollFn) {
      return {
        modelId: model.id,
        providerId: model.provider,
        latency: 0,
        success: false,
        statusCode: 'ERR',
        verdict: 'Not Active',
      };
    }

    const startTime = performance.now();
    let statusCode = '000';
    let success = false;

    try {
      const result = await this.pollFn(model.id, model.provider);
      statusCode = result.statusCode;
      success = statusCode === '200' || statusCode === '401' || statusCode === '403';
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      if (errorMessage.includes('401') || errorMessage.includes('403')) {
        statusCode = '401';
        success = true;
      } else if (errorMessage.includes('429')) {
        statusCode = '429';
        success = false;
      } else if (errorMessage.includes('404')) {
        statusCode = '404';
        success = false;
      } else if (errorMessage.includes('timeout') || errorMessage.includes('ETIMEDOUT')) {
        statusCode = '000';
        success = false;
      } else {
        statusCode = 'ERR';
        success = false;
      }
    }

    const latency = Math.round(performance.now() - startTime);

    healthTracker.recordRequest(model.id, model.provider, {
      latency,
      statusCode,
      success,
    });

    const verdict = healthTracker.getVerdict(model.id);

    return {
      modelId: model.id,
      providerId: model.provider,
      latency,
      success,
      statusCode,
      verdict,
    };
  }

  private getModelsToPoll(): ModelConfig[] {
    return this.models.filter(model => {
      const health = healthTracker.getHealth(model.id);
      if (!health) return true;

      const unhealthyVerdicts = ['Unstable', 'Not Active', 'Overloaded', 'Pending'];
      return unhealthyVerdicts.includes(health.verdict);
    });
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  isRunning(): boolean {
    return this.running;
  }

  getConfig(): PollerConfig {
    return { ...this.config };
  }
}

export const backgroundPoller = new BackgroundPoller();
