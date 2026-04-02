import { BaseProvider } from './base.js';
import { 
  ChatCompletionRequest, 
  ChatCompletionResponse,
  ChatCompletionChunk,
} from '../core/types.js';

/**
 * NVIDIA NIM Provider Implementation
 * 
 * Free tier provider with excellent performance.
 * Docs: https://www.nvidia.com/en-us/ai/
 */
export class NvidiaNimProvider extends BaseProvider {
  async execute(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const body = this.buildRequestBody(request);
    
    const response = await this.makeRequest('/chat/completions', body);

    if (!response.ok) {
      const errorBody = await response.text();
      throw this.handleError(response, errorBody);
    }

    const data = await response.json();
    return this.formatResponse(data, request.model || 'nvidia/llama-3.1-nemotron-70b-instruct');
  }

  async executeStreaming(
    request: ChatCompletionRequest,
    onChunk: (chunk: ChatCompletionChunk) => void,
    onComplete?: () => void,
    onError?: (error: Error) => void
  ): Promise<void> {
    const baseBody = this.buildRequestBody(request) as Record<string, unknown>;
    const body = {
      ...baseBody,
      stream: true,
    };

    const response = await this.makeRequest('/chat/completions', body, true);

    if (!response.ok) {
      const errorBody = await response.text();
      const error = this.handleError(response, errorBody);
      if (onError) onError(error);
      throw error;
    }

    await this.readStream(response, onChunk, onComplete, onError);
  }
}
