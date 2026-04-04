// ============================================================================
// Proxy Executor - Executes requests with passive health tracking
// Records health data from real proxy requests (zero extra API calls)
// ============================================================================

import {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionChunk,
  ProviderId,
  ModelConfig,
} from './types.js';
import { healthTracker } from './health-tracker.js';

export interface ProxyExecutionResult {
  response: ChatCompletionResponse;
  modelId: string;
  providerId: ProviderId;
  latency: number;
  success: boolean;
  statusCode: string;
}

export interface ProxyExecutionMetrics {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  avgLatency: number;
  modelsUsed: Map<string, number>;
}

export interface ProviderExecuteFn {
  (request: ChatCompletionRequest): Promise<ChatCompletionResponse>;
}

class ProxyExecutor {
  private metrics: ProxyExecutionMetrics = {
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    avgLatency: 0,
    modelsUsed: new Map(),
  };

  private totalLatency = 0;

  async execute(
    request: ChatCompletionRequest,
    executeFn: ProviderExecuteFn,
    modelConfig: ModelConfig
  ): Promise<ProxyExecutionResult> {
    const startTime = performance.now();
    let statusCode = '000';
    let success = false;
    let response: ChatCompletionResponse;

    try {
      response = await executeFn({ ...request, model: modelConfig.id });
      statusCode = '200';
      success = true;
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

      response = this.createErrorResponse(modelConfig.id, errorMessage);
    }

    const latency = Math.round(performance.now() - startTime);

    healthTracker.recordRequest(modelConfig.id, modelConfig.provider, {
      latency,
      statusCode,
      success,
    });

    this.updateMetrics(modelConfig.id, latency, success);

    return {
      response,
      modelId: modelConfig.id,
      providerId: modelConfig.provider,
      latency,
      success,
      statusCode,
    };
  }

  getMetrics(): ProxyExecutionMetrics {
    return { ...this.metrics };
  }

  resetMetrics(): void {
    this.metrics = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      avgLatency: 0,
      modelsUsed: new Map(),
    };
    this.totalLatency = 0;
  }

  private updateMetrics(modelId: string, latency: number, success: boolean): void {
    this.metrics.totalRequests++;
    this.totalLatency += latency;
    this.metrics.avgLatency = Math.round(this.totalLatency / this.metrics.totalRequests);

    if (success) {
      this.metrics.successfulRequests++;
    } else {
      this.metrics.failedRequests++;
    }

    const count = this.metrics.modelsUsed.get(modelId) || 0;
    this.metrics.modelsUsed.set(modelId, count + 1);
  }

  private createErrorResponse(modelId: string, errorMessage: string): ChatCompletionResponse {
    return {
      id: `error-${Date.now()}`,
      object: 'chat.completion',
      created: Date.now(),
      model: modelId,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: `Error: ${errorMessage}`,
          },
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
      },
    };
  }
}

export const proxyExecutor = new ProxyExecutor();
