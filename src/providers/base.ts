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
  // Don't use reasoning as content - they are separate streams
  content = '';
  } else {
  content = rawContent as string;
  }
  }

  const message: ChatCompletionResponse['choices'][0]['message'] = {
  role: 'assistant' as const,
  content,
  };

  // Normalize tool_calls - NVIDIA NIM/Kimi returns numeric IDs, OpenAI spec requires strings
  if (messageObj.tool_calls && Array.isArray(messageObj.tool_calls)) {
    message.tool_calls = (messageObj.tool_calls as any[]).map((tc: any) => ({
      ...tc,
      id: typeof tc.id === 'number' ? String(tc.id) : tc.id,
      function: tc.function ? {
        ...tc.function,
        arguments: typeof tc.function.arguments === 'object' 
          ? JSON.stringify(tc.function.arguments) 
          : tc.function.arguments
      } : tc.function
    })) as ToolCall[];
  }

  // Pass through reasoning_content if present (for thinking models)
  if (messageObj.reasoning_content) {
  (message as any).reasoning_content = messageObj.reasoning_content;
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

    // Normalize tool_calls in streaming chunks - NVIDIA NIM/Kimi returns numeric IDs
    if (delta.tool_calls && Array.isArray(delta.tool_calls)) {
      delta.tool_calls = delta.tool_calls.map((tc: any) => ({
        ...tc,
        id: typeof tc.id === 'number' ? String(tc.id) : tc.id,
        function: tc.function ? {
          ...tc.function,
          arguments: typeof tc.function.arguments === 'object'
            ? JSON.stringify(tc.function.arguments)
            : tc.function.arguments
        } : tc.function
      }));
    }

    // DON'T merge reasoning_content into content - they are separate streams
    // reasoning_content is internal thinking, content is the actual response
    // Let the client decide how to display them

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
   * Read stream response with timeout protection
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
   * Validate and fix message ordering for tool conversations
   * NVIDIA NIM requires: user -> assistant (with tool_calls) -> tool -> assistant
   * Cannot have user after tool without assistant in between
   */
  private validateMessageOrder(messages: any[]): any[] {
    const validated: any[] = [];
    
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      const prevMsg = validated[validated.length - 1];
      
      // Check for invalid sequence: tool followed by user
      if (prevMsg?.role === 'tool' && msg.role === 'user') {
        console.warn(`[BASE-PROVIDER] Invalid message sequence: tool -> user. Inserting assistant message.`);
        // Insert a placeholder assistant message
        validated.push({
          role: 'assistant',
          content: 'I have processed the tool results.',
        });
      }
      
      validated.push(msg);
    }
    
    return validated;
  }

  /**
   * Build request body for provider
   */
  protected buildRequestBody(request: ChatCompletionRequest): unknown {
    // Normalize messages - NVIDIA NIM expects string content, OpenAI may send arrays
    let normalizedMessages = request.messages.map(msg => {
      if (typeof msg.content === 'string') {
        return msg;
      }
      if (Array.isArray(msg.content)) {
        // Convert array content to string (text parts only)
        const textParts = msg.content
          .filter((part: any) => part.type === 'text')
          .map((part: any) => part.text)
          .join('\n');
        return { ...msg, content: textParts || '' };
      }
      return msg;
    });
    
    // Validate message ordering for tool conversations
    normalizedMessages = this.validateMessageOrder(normalizedMessages);

    const body: Record<string, unknown> = {
      model: request.model,
      messages: normalizedMessages,
      temperature: request.temperature ?? 0.7,
      stream: request.stream ?? false,
      top_p: request.top_p ?? 1,
      frequency_penalty: request.frequency_penalty ?? 0,
      presence_penalty: request.presence_penalty ?? 0,
      stop: request.stop,
      user: request.user,
      n: request.n ?? 1,
    };

    // Only set max_tokens if client explicitly requested it
    // Don't hardcode - let upstream provider use its own default
    if (request.max_tokens !== undefined) {
      body.max_tokens = request.max_tokens;
    }

    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools;
    }

    if (request.tool_choice) {
      body.tool_choice = request.tool_choice;
    }

    // Additional OpenAI parameters
    if (request.seed !== undefined) {
      body.seed = request.seed;
    }
    if (request.logit_bias !== undefined) {
      body.logit_bias = request.logit_bias;
    }
    if (request.parallel_tool_calls !== undefined) {
      body.parallel_tool_calls = request.parallel_tool_calls;
    }
    if (request.logprobs !== undefined) {
      body.logprobs = request.logprobs;
    }
    if (request.top_logprobs !== undefined) {
      body.top_logprobs = request.top_logprobs;
    }
    if (request.response_format !== undefined) {
      body.response_format = request.response_format;
    }

    return body;
  }
}
