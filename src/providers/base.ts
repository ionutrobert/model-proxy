import { 
  ProviderConfig, 
  ChatCompletionRequest, 
  ChatCompletionResponse, 
  ChatCompletionChunk,
  StreamHandler,
  StreamCompleteHandler,
  StreamErrorHandler,
} from '../core/types.js';

// ============================================================================
// Base Provider Class
// ============================================================================

export abstract class BaseProvider {
  protected config: ProviderConfig;

  constructor(config: ProviderConfig) {
    this.config = config;
  }

  get id(): string {
    return this.config.id;
  }

  get name(): string {
    return this.config.name;
  }

  get priority(): number {
    switch (this.config.preference) {
      case 'primary': return 1;
      case 'secondary': return 2;
      case 'fallback': return 3;
      default: return 2;
    }
  }

  get isFree(): boolean {
    return this.config.isFree;
  }

  get preference(): string {
    return this.config.preference;
  }

  /**
   * Execute a chat completion request
   */
  abstract execute(request: ChatCompletionRequest): Promise<ChatCompletionResponse>;
  
  /**
   * Execute a streaming chat completion request
   */
  abstract executeStreaming(
    request: ChatCompletionRequest,
    onChunk: (chunk: ChatCompletionChunk) => void,
    onComplete?: StreamCompleteHandler,
    onError?: StreamErrorHandler
  ): Promise<void>;

  /**
   * Make an HTTP request to the provider
   */
  protected async makeRequest(
    endpoint: string,
    body: unknown,
    stream: boolean = false
  ): Promise<Response> {
    const url = `${this.config.baseUrl}${endpoint}`;
    
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.config.apiKey}`,
      ...this.config.headers,
    };

    if (stream) {
      headers['Accept'] = 'text/event-stream';
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.config.timeout),
    });

    return response;
  }

  /**
   * Format response to OpenAI-compatible format
   */
  protected formatResponse(data: unknown, model: string): ChatCompletionResponse {
    const response = data as Record<string, unknown>;
    const choicesData = (response.choices || []) as unknown[];

    const mappedChoices = choicesData.map((choice: unknown, index: number) => {
      const choiceObj = choice as Record<string, unknown>;
      const messageObj = (choiceObj.message || {}) as Record<string, unknown>;
      
      // Some models (like Kimi) return content in 'reasoning' field when it's null
      let content = messageObj.content;
      if (content === null || content === undefined) {
        content = messageObj.reasoning || '';
      }
      
      return {
        index,
        message: {
          role: 'assistant' as const,
          content: String(content),
        },
        finish_reason: (choiceObj.finish_reason as string) || 'stop',
        logprobs: choiceObj.logprobs,
      };
    });

    const usageData = (response.usage || {}) as Record<string, number>;

    return {
      id: (response.id as string) || `chatcmpl-${Date.now()}`,
      object: 'chat.completion',
      created: (response.created as number) || Math.floor(Date.now() / 1000),
      model: model,
      choices: mappedChoices,
      usage: {
        prompt_tokens: usageData.prompt_tokens || 0,
        completion_tokens: usageData.completion_tokens || 0,
        total_tokens: usageData.total_tokens || 0,
      },
    };
  }

  /**
   * Parse SSE stream chunk
   */
  protected parseStreamChunk(line: string): ChatCompletionChunk | null {
    if (!line.startsWith('data: ')) {
      return null;
    }

    const data = line.slice(6).trim();
    
    if (data === '[DONE]') {
      return null;
    }

    try {
      const parsed = JSON.parse(data);
      return {
        id: parsed.id || `chatcmpl-${Date.now()}`,
        object: 'chat.completion.chunk',
        created: parsed.created || Math.floor(Date.now() / 1000),
        model: parsed.model || 'unknown',
        choices: parsed.choices || [{
          index: 0,
          delta: parsed.choices?.[0]?.delta || {},
          finish_reason: parsed.choices?.[0]?.finish_reason || null,
        }],
      };
    } catch {
      return null;
    }
  }

  /**
   * Read stream response
   */
  protected async readStream(
    response: Response,
    onChunk: (chunk: ChatCompletionChunk) => void,
    onComplete?: StreamCompleteHandler,
    onError?: StreamErrorHandler
  ): Promise<void> {
    const reader = response.body?.getReader();
    if (!reader) {
      const error = new Error('No response body for streaming');
      if (onError) onError(error);
      throw error;
    }

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmedLine = line.trim();
          if (!trimmedLine) continue;

          const chunk = this.parseStreamChunk(trimmedLine);
          if (chunk) {
            onChunk(chunk);
          }
        }
      }

      // Process remaining buffer
      if (buffer.trim()) {
        const chunk = this.parseStreamChunk(buffer.trim());
        if (chunk) {
          onChunk(chunk);
        }
      }

      if (onComplete) {
        onComplete();
      }
    } catch (error) {
      if (onError && error instanceof Error) {
        onError(error);
      }
      throw error;
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Handle provider error
   */
  protected handleError(response: Response, body: string): Error {
    let message = `Provider ${this.config.name} error: ${response.status}`;
    
    try {
      const errorData = JSON.parse(body);
      if (errorData.error?.message) {
        message = `${message} - ${errorData.error.message}`;
      } else if (errorData.message) {
        message = `${message} - ${errorData.message}`;
      }
    } catch {
      if (body) {
        message = `${message} - ${body}`;
      }
    }

    return new Error(message);
  }

  /**
   * Build request body for provider
   */
  protected buildRequestBody(request: ChatCompletionRequest): unknown {
    return {
      model: request.model,
      messages: request.messages,
      temperature: request.temperature ?? 0.7,
      max_tokens: request.max_tokens ?? 4000,
      stream: request.stream ?? false,
      top_p: request.top_p ?? 1,
      frequency_penalty: request.frequency_penalty ?? 0,
      presence_penalty: request.presence_penalty ?? 0,
      stop: request.stop,
      user: request.user,
      n: request.n ?? 1,
    };
  }
}
