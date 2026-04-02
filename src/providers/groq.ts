import { BaseProvider } from './base.js';
import { 
  ChatCompletionRequest, 
  ChatCompletionResponse,
  ChatCompletionChunk,
} from '../core/types.js';

/**
 * Groq Provider Implementation
 * 
 * Ultra-fast inference with free tier available.
 * Docs: https://console.groq.com/
 */
export class GroqProvider extends BaseProvider {
  async execute(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const body = this.buildRequestBody(request);
    
    const response = await this.makeRequest('/chat/completions', body);

    if (!response.ok) {
      const errorBody = await response.text();
      throw this.handleError(response, errorBody);
    }

    const data = await response.json();
    return this.formatResponse(data, request.model || 'llama-3.1-70b-versatile');
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

  /**
   * Groq uses shorter default timeout due to fast inference
   */
  protected override buildRequestBody(request: ChatCompletionRequest): unknown {
    const baseBody = super.buildRequestBody(request) as Record<string, unknown>;

    // Groq-specific optimizations
    return {
      ...baseBody,
      // Add any Groq-specific parameters here
    };
  }
}
