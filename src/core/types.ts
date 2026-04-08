// ============================================================================
// OpenAI-compatible types
// ============================================================================

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | any[] | null; // Support multimodal content (text, images, etc.)
  name?: string;
  tool_call_id?: string;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
    strict?: boolean;
  };
}

export type ToolChoice = 'none' | 'auto' | 'required' | { type: 'function'; function: { name: string } };

export interface ChatCompletionRequest {
  model?: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  stop?: string | string[];
  user?: string;
  n?: number;
  tools?: ToolDefinition[];
  tool_choice?: ToolChoice;
}

export interface ChatCompletionResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: {
    index: number;
    message: ChatMessage & {
      tool_calls?: ToolCall[];
    };
    finish_reason: string | null;
    logprobs?: unknown;
  }[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface ChatCompletionChunk {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  choices: {
    index: number;
    delta: Partial<ChatMessage>;
    finish_reason: string | null;
  }[];
}

export interface ModelSwitchInfo {
  fromModel: string;
  toModel: string;
  partialContent: string;
  error: string;
  chunkCount: number;
}

export type ModelSwitchCallback = (info: ModelSwitchInfo) => void;

// ============================================================================
// Provider types
// ============================================================================

export type ProviderId = 
  | 'nvidia-nim'
  | 'opencode-go'
  | 'opencode-zen'
  | 'groq'
  | 'cerebras'
  | 'sambanova'
  | 'together'
  | 'fireworks'
  | 'hyperbolic'
  | 'openrouter'
  | string;

export type ProviderPreference = 'primary' | 'secondary' | 'fallback' | 'disabled';

import { KeyPool } from './key-pool.js';

export interface ProviderConfig {
  id: ProviderId;
  name: string;
  baseUrl: string;
  apiKey: string;
  keyPool?: KeyPool;
  headers?: Record<string, string>;
  timeout: number;
  healthCheckTimeout: number;
  preference: ProviderPreference;
  isFree: boolean;
}

export type ModelTier = 'S+' | 'S' | 'A+' | 'A' | 'A-' | 'B+' | 'B' | 'C';

export interface ModelConfig {
  id: string;
  provider: ProviderId;
  name: string;
  tier: ModelTier;
  contextWindow: number;
  maxOutputTokens?: number;
  supportsStreaming: boolean;
  supportsFunctionCalling?: boolean;
  supportsVision?: boolean;
  description?: string;
  costPer1kTokens?: {
    input: number;
    output: number;
  };
}

// ============================================================================
// Health check types
// ============================================================================

export type HealthStatus = 'healthy' | 'unhealthy' | 'timeout' | 'error';

export type Verdict = 'Perfect' | 'Normal' | 'Slow' | 'Very Slow' | 'Spiky' | 'Unstable' | 'Overloaded' | 'Not Active' | 'Pending';

export interface HealthRequest {
  timestamp: number;
  latency: number;
  statusCode: string;
  success: boolean;
}

export interface HealthMetrics {
  avgLatency: number;
  p95Latency: number;
  jitter: number;
  uptimePercent: number;
  spikeRate: number;
  totalRequests: number;
  successfulRequests: number;
}

export interface ModelHealthHistory {
  modelId: string;
  providerId: ProviderId;
  requests: HealthRequest[];
  verdict: Verdict;
  stabilityScore: number;
  isThinking: boolean;
  lastUpdated: number;
  metrics: HealthMetrics;
}

export interface HealthCheckResult {
  providerId: ProviderId;
  modelId: string;
  status: HealthStatus;
  latency: number;
  timestamp: number;
  error?: string;
}

export type CircuitState = 'closed' | 'open' | 'half-open';

export interface ProviderHealth {
  providerId: ProviderId;
  status: CircuitState;
  failureCount: number;
  lastFailure?: number;
  lastSuccess?: number;
  consecutiveSuccesses: number;
}

// ============================================================================
// Ranking types
// ============================================================================

export interface RankedModel {
  model: ModelConfig;
  health: HealthCheckResult;
  stabilityScore: number;
  tier: ModelTier;
  providerPreference: number;
}

export interface SelectionCriteria {
  minTier?: ModelTier;
  maxLatency?: number;
  requireStreaming?: boolean;
  requireFunctionCalling?: boolean;
  requireVision?: boolean;
  preferredProviders?: ProviderId[];
  excludedProviders?: ProviderId[];
  minContextWindow?: number;
  maxCostPer1kTokens?: number;
}

// ============================================================================
// User preferences
// ============================================================================

export type FallbackStrategy = 'priority' | 'latency' | 'cost' | 'availability';

export interface UserPreferences {
  // Cost optimization
  preferFreeProviders: boolean;
  maxCostPer1kTokens?: number;
  
  // Performance
  maxLatencyMs: number;
  requireStreaming: boolean;
  requireFunctionCalling: boolean;
  
  // Provider preferences
  providerPriority: ProviderId[];
  disabledProviders: ProviderId[];
  
  // Fallback strategy
  fallbackStrategy: FallbackStrategy;
  
  // Model capabilities
  minContextWindow: number;
  preferredTiers: ModelTier[];
  
  // Circuit breaker
  circuitBreakerThreshold: number;
  circuitBreakerResetMs: number;
}

// Default preferences
export const defaultPreferences: UserPreferences = {
  preferFreeProviders: true,
  maxLatencyMs: 10000,
  requireStreaming: false,
  requireFunctionCalling: false,
  providerPriority: [],
  disabledProviders: [],
  fallbackStrategy: 'priority',
  minContextWindow: 4096,
  preferredTiers: ['S+', 'S', 'A+', 'A', 'A-', 'B+', 'B', 'C'],
  circuitBreakerThreshold: 5,
  circuitBreakerResetMs: 60000,
};

// ============================================================================
// Configuration types
// ============================================================================

export interface ProxyConfig {
  providers: ProviderConfig[];
  preferences: UserPreferences;
  healthCheck: {
    timeoutMs: number;
    cacheTtlMs: number;
    enabled: boolean;
  };
}

export interface ProviderRegistration {
  id: ProviderId;
  name: string;
  baseUrl: string;
  apiKeyEnvVar: string;
  defaultTimeout: number;
  defaultHealthCheckTimeout: number;
  isFree: boolean;
  models: Omit<ModelConfig, 'provider'>[];
}

// ============================================================================
// Error types
// ============================================================================

export class ModelProxyError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 500,
    public type: string = 'server_error'
  ) {
    super(message);
    this.name = 'ModelProxyError';
  }
}

export class ProviderUnavailableError extends ModelProxyError {
  constructor(providerId: ProviderId) {
    super(
      `Provider ${providerId} is unavailable`,
      'provider_unavailable',
      503,
      'server_error'
    );
  }
}

export class ModelNotFoundError extends ModelProxyError {
  constructor(modelId: string) {
    super(
      `Model ${modelId} not found`,
      'model_not_found',
      404,
      'invalid_request_error'
    );
  }
}

export class NoHealthyModelsError extends ModelProxyError {
  constructor() {
    super(
      'No healthy models available',
      'no_healthy_models',
      503,
      'service_unavailable'
    );
  }
}

export class AuthenticationError extends ModelProxyError {
  constructor() {
    super(
      'Invalid or missing API key',
      'authentication_error',
      401,
      'authentication_error'
    );
  }
}

// ============================================================================
// Stream types
// ============================================================================

export type StreamChunk = {
  content: string;
  finishReason?: string;
};

export type StreamHandler = (chunk: StreamChunk) => void;
export type StreamCompleteHandler = () => void;
export type StreamErrorHandler = (error: Error) => void;

// ============================================================================
// Embeddings API types
// ============================================================================

export interface EmbeddingRequest {
  model: string;
  input: string | string[] | number[] | number[][];
  dimensions?: number;
  encoding_format?: 'float' | 'base64';
  user?: string;
}

export interface EmbeddingResponse {
  object: 'list';
  data: Array<{
    object: 'embedding';
    embedding: number[] | string;
    index: number;
  }>;
  model: string;
  usage: {
    prompt_tokens: number;
    total_tokens: number;
  };
}

// ============================================================================
// Legacy Completions API types
// ============================================================================

export interface CompletionRequest {
  model: string;
  prompt: string | string[] | number[] | number[][];
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  n?: number;
  stream?: boolean;
  logprobs?: number;
  echo?: boolean;
  stop?: string | string[];
  presence_penalty?: number;
  frequency_penalty?: number;
  best_of?: number;
  logit_bias?: Record<string, number>;
  user?: string;
}

export interface CompletionResponse {
  id: string;
  object: 'text_completion';
  created: number;
  model: string;
  choices: Array<{
    text: string;
    index: number;
    logprobs?: {
      tokens?: string[];
      token_logprobs?: number[];
      top_logprobs?: Array<Record<string, number>>;
      text_offset?: number[];
    } | null;
    finish_reason: 'stop' | 'length' | 'content_filter' | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface CompletionChunk {
  id: string;
  object: 'text_completion';
  created: number;
  model: string;
  choices: Array<{
    text: string;
    index: number;
    logprobs?: {
      tokens?: string[];
      token_logprobs?: number[];
      top_logprobs?: Array<Record<string, number>>;
      text_offset?: number[];
    } | null;
    finish_reason: 'stop' | 'length' | 'content_filter' | null;
  }>;
}

// ============================================================================
// Responses API types
// ============================================================================

export interface ResponseRequest {
  model: string;
  input: string | Array<{
    type: 'message';
    role: 'system' | 'user' | 'assistant';
    content: string | Array<{
      type: 'text' | 'image';
      text?: string;
      image_url?: { url: string };
    }>;
  }>;
  instructions?: string;
  temperature?: number;
  top_p?: number;
  max_output_tokens?: number;
  stream?: boolean;
  tools?: ToolDefinition[];
  tool_choice?: ToolChoice;
  metadata?: Record<string, unknown>;
}

export interface ResponseOutput {
  id: string;
  type: 'message';
  status: 'in_progress' | 'completed' | 'incomplete' | 'failed';
  role: 'assistant';
  content: Array<{
    type: 'text' | 'refusal' | 'tool_use';
    text?: string;
    refusal?: string;
    tool_use?: {
      id: string;
      type: 'function';
      function: {
        name: string;
        arguments: string;
      };
    };
  }>;
}

export interface ResponseAPIResponse {
  id: string;
  object: 'response';
  created: number;
  model: string;
  output: ResponseOutput;
  usage?: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
  };
  metadata?: Record<string, unknown>;
}
