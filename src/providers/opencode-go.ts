import { BaseProvider } from './base.js';
import { 
  ChatCompletionRequest, 
  ChatCompletionResponse,
  ChatCompletionChunk,
} from '../core/types.js';

/**
 * OpenCode Go Provider Implementation
 * 
 * Premium subscription tier with extended context windows.
 * Docs: https://opencode.ai/
 */
export class OpenCodeGoProvider extends BaseProvider {
  async execute(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const body = this.buildRequestBody(request);
    
    const response = await this.makeRequest('/chat/completions', body);

    if (!response.ok) {
      const errorBody = await response.text();
      throw this.handleError(response, errorBody);
    }

    const data = await response.json();
    return this.formatResponse(data, request.model || 'opencode-go-premium');
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
   * Override to handle OpenCode-specific request format
   */
  protected override buildRequestBody(request: ChatCompletionRequest): unknown {
    const baseBody = super.buildRequestBody(request) as Record<string, unknown>;

    // OpenCode supports extended context
    return {
      ...baseBody,
      // Add any OpenCode-specific parameters here
    };
  }
}

/**
 * OpenCode Zen Provider Implementation
 * 
 * Free tier with standard capabilities.
 * Uses the same API as Go but with different model endpoints.
 */
export class OpenCodeZenProvider extends OpenCodeGoProvider {
  // Inherits everything from Go provider
  // Models are different as defined in ProviderRegistry
}
