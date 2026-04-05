import {
 ProviderConfig,
 ChatCompletionRequest,
 ChatCompletionResponse,
 ChatCompletionChunk,
 StreamHandler,
 StreamCompleteHandler,
 StreamErrorHandler,
 ToolCall,
} from '../core/types.js';
 import { KeyPool, KeyPoolManager } from '../core/key-pool.js';

export interface RequestResult {
  response: Response;
  keyUsed: string;
}

export class AllKeysRateLimitedError extends Error {
  constructor(providerId: string) {
    super(`All API keys for ${providerId} are rate limited`);
    this.name = 'AllKeysRateLimitedError';
  }
}

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

  protected getKeyPool(): KeyPool | undefined {
    return this.config.keyPool;
  }

  protected getCurrentKey(): string {
    const pool = this.getKeyPool();
    if (pool) {
      const key = KeyPoolManager.getNextKey(pool);
      if (key) return key;
    }
    return this.config.apiKey;
  }

  protected hasAvailableKey(): boolean {
    const pool = this.getKeyPool();
    if (!pool) return !!this.config.apiKey;
    return KeyPoolManager.hasAvailableKey(pool);
  }

  protected markKeyRateLimited(key: string, retryAfterSeconds?: number): void {
    const pool = this.getKeyPool();
    if (pool) {
      KeyPoolManager.markRateLimited(pool, key, retryAfterSeconds);
    }
  }

  protected markKeySuccess(key: string): void {
    const pool = this.getKeyPool();
    if (pool) {
      KeyPoolManager.markSuccess(pool, key);
    }
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
   * Make an HTTP request to the provider with automatic key rotation
   */
  protected async makeRequest(
    endpoint: string,
    body: unknown,
    stream: boolean = false
  ): Promise<Response> {
    const pool = this.getKeyPool();
    
    if (pool && !this.hasAvailableKey()) {
      throw new AllKeysRateLimitedError(this.config.id);
    }

    const maxRetries = pool ? pool.keys.length : 1;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const key = this.getCurrentKey();
      const url = `${this.config.baseUrl}${endpoint}`;

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`,
        ...this.config.headers,
      };

      if (stream) {
        headers['Accept'] = 'text/event-stream';
      }

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: this.config.timeout > 0 ? AbortSignal.timeout(this.config.timeout) : undefined,
      });

      if (response.status === 429 && pool) {
        const retryAfter = response.headers.get('Retry-After');
        const retrySeconds = retryAfter ? parseInt(retryAfter, 10) : 60;
        this.markKeyRateLimited(key, retrySeconds);
        
        if (this.hasAvailableKey()) {
          console.log(`[KEY-ROTATION] ${this.config.id}: key rate limited, trying next key`);
          continue;
        }
        
        throw new AllKeysRateLimitedError(this.config.id);
      }

      if (response.ok && pool) {
        this.markKeySuccess(key);
      }

      return response;
    }

    throw lastError || new AllKeysRateLimitedError(this.config.id);
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

  // Check if tool_calls present - content MUST be null when tool_calls exist
  const hasToolCalls = messageObj.tool_calls && Array.isArray(messageObj.tool_calls) && messageObj.tool_calls.length > 0;
  
  let content: string | null;
  if (hasToolCalls) {
  // Tool calls present - content MUST be null per OpenAI spec
  content = null;
  } else {
  // No tool calls - handle content normally
  const rawContent = messageObj.content;
  if (rawContent === null || rawContent === undefined) {
  // Some models (like Kimi) return content in 'reasoning' field
  content = (messageObj.reasoning as string) || '';
  } else {
  content = rawContent as string;
  }
  }

  const message: ChatCompletionResponse['choices'][0]['message'] = {
  role: 'assistant' as const,
  content,
  };

  // Pass through tool_calls if present
  if (messageObj.tool_calls) {
  message.tool_calls = messageObj.tool_calls as ToolCall[];
  }

  // Preserve finish_reason from upstream - critical for "tool_calls"
  const finishReason = choiceObj.finish_reason as string | undefined;
  
  return {
  index,
  message,
  finish_reason: finishReason || 'stop',
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
  
  // Debug logging for reasoning/content
  if (process.env.DEBUG_STREAMING === 'true') {
  const choices = parsed.choices || [];
  choices.forEach((choice: any, idx: number) => {
  const delta = choice.delta || {};
  if (delta.content || delta.reasoning || delta.reasoning_content) {
  console.log(`[STREAM DEBUG] Chunk ${idx}: content=${JSON.stringify(delta.content)}, reasoning=${JSON.stringify(delta.reasoning)}, reasoning_content=${JSON.stringify(delta.reasoning_content)}`);
  }
  });
  }
  
  const choices = parsed.choices || [];

const mappedChoices = choices.map((choice: any) => {
  const delta = choice.delta || {};
  
  // Check if tool_calls present in delta
  const hasToolCalls = delta.tool_calls && Array.isArray(delta.tool_calls) && delta.tool_calls.length > 0;
  
  // If content is null/empty but reasoning exists, use reasoning (but not when tool_calls present)
  if (!hasToolCalls && !delta.content && (delta.reasoning || delta.reasoning_content)) {
  // Use reasoning as content, but also preserve it in case client expects it
  delta.content = delta.reasoning || delta.reasoning_content;
  // Don't delete reasoning - some clients may use it
  }
  
  return {
  index: choice.index || 0,
  delta: delta,
  finish_reason: choice.finish_reason || null,
  };
  });

 return {
 id: parsed.id || `chatcmpl-${Date.now()}`,
 object: 'chat.completion.chunk',
 created: parsed.created || Math.floor(Date.now() / 1000),
 model: parsed.model || 'unknown',
 choices: mappedChoices,
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
  const body: Record<string, unknown> = {
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

  if (request.tools && request.tools.length > 0) {
    body.tools = request.tools;
  }

  if (request.tool_choice) {
    body.tool_choice = request.tool_choice;
  }

  return body;
}
}
