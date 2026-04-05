// ============================================================================
// Next.js Adapter for Framework Integration
// ============================================================================

import { z } from 'zod';
import { ModelProxyCore } from '../core/index.js';
import {
  ChatCompletionRequest,
  ChatMessage,
  ModelProxyError,
  AuthenticationError,
} from '../core/types.js';

// Type declarations for Next.js (avoid direct import)
interface NextRequest {
  headers: Headers;
  json(): Promise<unknown>;
  url: string;
}

interface NextResponseInit {
  status?: number;
  headers?: Record<string, string>;
}

interface NextResponse {
  json(): Promise<unknown>;
}

interface NextResponseConstructor {
  json(data: unknown, init?: NextResponseInit): NextResponse;
  new (stream: unknown, init?: { headers?: Record<string, string> }): NextResponse;
}

interface ReadableStreamController {
  enqueue(chunk: Uint8Array): void;
  close(): void;
}

interface ReadableStreamSource {
  start(controller: ReadableStreamController): Promise<void> | void;
}

interface TextEncoderType {
  encode(text: string): Uint8Array;
}

declare const NextResponse: NextResponseConstructor;
declare const ReadableStream: new (source: ReadableStreamSource) => { [Symbol.asyncIterator](): AsyncIterator<Uint8Array> };
declare const TextEncoder: new () => TextEncoderType;

// ============================================================================
// Request Validation Schemas
// ============================================================================

const chatMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant', 'tool']),
  content: z.string().nullable(), // Allow null for tool calling
  name: z.string().optional(),
  tool_call_id: z.string().optional(),
});

const toolCallSchema = z.object({
  id: z.string(),
  type: z.literal('function'),
  function: z.object({
  name: z.string(),
  arguments: z.string(),
  }),
});

const toolDefinitionSchema = z.object({
  type: z.literal('function'),
  function: z.object({
  name: z.string(),
  description: z.string().optional(),
  parameters: z.record(z.unknown()).optional(),
  strict: z.boolean().optional(),
  }),
});

const toolChoiceSchema = z.union([
  z.literal('none'),
  z.literal('auto'),
  z.literal('required'),
  z.object({
  type: z.literal('function'),
  function: z.object({
  name: z.string(),
  }),
  }),
]);

const chatCompletionRequestSchema = z.object({
  model: z.string().optional(),
  messages: z.array(chatMessageSchema).min(1),
  temperature: z.number().min(0).max(2).optional().default(0.7),
  max_tokens: z.number().positive().optional(),
  stream: z.boolean().optional().default(false),
  top_p: z.number().min(0).max(1).optional(),
  frequency_penalty: z.number().min(-2).max(2).optional(),
  presence_penalty: z.number().min(-2).max(2).optional(),
  stop: z.union([z.string(), z.array(z.string())]).optional(),
  user: z.string().optional(),
  n: z.number().positive().optional(),
  tools: z.array(toolDefinitionSchema).optional(),
  tool_choice: toolChoiceSchema.optional(),
});

// ============================================================================
// Authentication
// ============================================================================

export async function authenticateRequest(
  req: NextRequest,
  proxyApiKey: string
): Promise<boolean> {
  const authHeader = req.headers.get('authorization');
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return false;
  }

  const apiKey = authHeader.slice(7);
  return apiKey === proxyApiKey;
}

// ============================================================================
// Chat Completions Handler
// ============================================================================

export function createChatHandler(proxy: ModelProxyCore, proxyApiKey: string) {
  return async function POST(req: NextRequest): Promise<NextResponse> {
    try {
      // Authenticate
      if (!await authenticateRequest(req, proxyApiKey)) {
        return NextResponse.json(
          {
            error: {
              message: 'Invalid or missing API key',
              type: 'authentication_error',
              code: 'invalid_api_key',
            },
          },
          { status: 401 }
        );
      }

      // Parse and validate request
      const body = await req.json();
      const validation = chatCompletionRequestSchema.safeParse(body);
      
      if (!validation.success) {
        return NextResponse.json(
          {
            error: {
              message: `Invalid request: ${validation.error.errors.map(e => e.message).join(', ')}`,
              type: 'invalid_request_error',
              code: 'invalid_request',
            },
          },
          { status: 400 }
        );
      }

      const request: ChatCompletionRequest = validation.data;

      // Handle streaming
      if (request.stream) {
        const encoder = new TextEncoder();
        
        const stream = new ReadableStream({
          async start(controller) {
            try {
              await proxy.executeStreaming(
                request,
                (chunk) => {
                  const data = JSON.stringify(chunk);
                  controller.enqueue(encoder.encode(`data: ${data}\n\n`));
                },
                () => {
                  controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                  controller.close();
                },
                (error) => {
                  const errorData = JSON.stringify({
                    error: {
                      message: error.message,
                      type: 'server_error',
                      code: 'stream_error',
                    },
                  });
                  controller.enqueue(encoder.encode(`data: ${errorData}\n\n`));
                  controller.close();
                }
              );
            } catch (error) {
              const message = error instanceof Error ? error.message : 'Streaming failed';
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: message })}\n\n`));
              controller.close();
            }
          },
        });

    const responseInit = { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' } };
    return new (NextResponse as unknown as new (body: unknown, init?: unknown) => NextResponse)(stream, responseInit);
      }

      // Non-streaming request
      const response = await proxy.execute(request);
      return NextResponse.json(response);

    } catch (error) {
      return handleError(error);
    }
  };
}

// ============================================================================
// Models List Handler
// ============================================================================

export function createModelsHandler(proxy: ModelProxyCore, proxyApiKey: string) {
  return async function GET(req: NextRequest): Promise<NextResponse> {
    try {
      // Authenticate
      if (!await authenticateRequest(req, proxyApiKey)) {
        return NextResponse.json(
          {
            error: {
              message: 'Invalid or missing API key',
              type: 'authentication_error',
              code: 'invalid_api_key',
            },
          },
          { status: 401 }
        );
      }

      const models = proxy.getAvailableModels();
      
      return NextResponse.json({
        object: 'list',
        data: models.map(model => ({
          id: model.id,
          object: 'model',
          created: Math.floor(Date.now() / 1000),
          owned_by: model.provider,
          permission: [],
          root: model.id,
          parent: null,
        })),
      });
    } catch (error) {
      return handleError(error);
    }
  };
}

// ============================================================================
// Model Detail Handler
// ============================================================================

export function createModelDetailHandler(proxy: ModelProxyCore, proxyApiKey: string) {
  return async function GET(
    req: NextRequest,
    { params }: { params: { modelId: string } }
  ): Promise<NextResponse> {
    try {
      // Authenticate
      if (!await authenticateRequest(req, proxyApiKey)) {
        return NextResponse.json(
          {
            error: {
              message: 'Invalid or missing API key',
              type: 'authentication_error',
              code: 'invalid_api_key',
            },
          },
          { status: 401 }
        );
      }

      const models = proxy.getAvailableModels();
      const model = models.find(m => m.id === params.modelId);
      
      if (!model) {
        return NextResponse.json(
          {
            error: {
              message: `Model ${params.modelId} not found`,
              type: 'not_found',
              code: 'model_not_found',
            },
          },
          { status: 404 }
        );
      }

      return NextResponse.json({
        id: model.id,
        object: 'model',
        created: Math.floor(Date.now() / 1000),
        owned_by: model.provider,
        permission: [],
        root: model.id,
        parent: null,
      });
    } catch (error) {
      return handleError(error);
    }
  };
}

// ============================================================================
// Health Handler
// ============================================================================

export function createHealthHandler(proxy: ModelProxyCore, proxyApiKey: string) {
  return async function GET(req: NextRequest): Promise<NextResponse> {
    try {
      // Authenticate (skip for health check endpoint)
      const isHealthCheck = new URL(req.url).pathname === '/health';
      if (!isHealthCheck && !await authenticateRequest(req, proxyApiKey)) {
        return NextResponse.json(
          {
            error: {
              message: 'Invalid or missing API key',
              type: 'authentication_error',
              code: 'invalid_api_key',
            },
          },
          { status: 401 }
        );
      }

      const health = proxy.getHealthStatus();
      const config = proxy.getConfig();
      
      return NextResponse.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        version: '1.0.0',
        providers: {
          configured: config.providers.length,
          available: health.models.length,
          list: config.providers.map(p => ({
            id: p.id,
            name: p.name,
            preference: p.preference,
            isFree: p.isFree,
          })),
        },
        models: {
          total: health.models.length,
          top: health.models.slice(0, 5).map(m => ({
            id: m.model.id,
            name: m.model.name,
            provider: m.model.provider,
            tier: m.model.tier,
            latency: m.health.latency,
            score: m.stabilityScore.toFixed(2),
          })),
        },
        circuit_breaker: {
          providers: health.providers.map(p => ({
            id: p.providerId,
            status: p.status,
            failures: p.failureCount,
            lastFailure: p.lastFailure ? new Date(p.lastFailure).toISOString() : null,
          })),
        },
        preferences: {
          preferFreeProviders: config.preferences.preferFreeProviders,
          providerPriority: config.preferences.providerPriority,
          fallbackStrategy: config.preferences.fallbackStrategy,
        },
      });
    } catch (error) {
      return handleError(error);
    }
  };
}

// ============================================================================
// Health Refresh Handler
// ============================================================================

export function createHealthRefreshHandler(proxy: ModelProxyCore, proxyApiKey: string) {
  return async function POST(req: NextRequest): Promise<NextResponse> {
    try {
      // Authenticate
      if (!await authenticateRequest(req, proxyApiKey)) {
        return NextResponse.json(
          {
            error: {
              message: 'Invalid or missing API key',
              type: 'authentication_error',
              code: 'invalid_api_key',
            },
          },
          { status: 401 }
        );
      }

      await proxy.forceHealthRefresh();
      
      return NextResponse.json({
        status: 'refreshed',
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      return handleError(error);
    }
  };
}

// ============================================================================
// Error Handler
// ============================================================================

function handleError(error: unknown): NextResponse {
  if (error instanceof ModelProxyError) {
    return NextResponse.json(
      {
        error: {
          message: error.message,
          type: error.type,
          code: error.code,
        },
      },
      { status: error.statusCode }
    );
  }

  const message = error instanceof Error ? error.message : 'Internal server error';
  
  return NextResponse.json(
    {
      error: {
        message,
        type: 'server_error',
        code: 'internal_error',
      },
    },
    { status: 500 }
  );
}

// ============================================================================
// Main Next.js Handler Factory
// ============================================================================

import { ConfigManager, createProxyConfig } from '../core/config.js';

export interface NextJsProxyConfig {
  providers: Array<{
    id: string;
    apiKey: string;
    preference?: 'primary' | 'secondary' | 'fallback';
  }>;
  preferences?: Partial<{
    preferFreeProviders: boolean;
    maxLatencyMs: number;
    requireStreaming: boolean;
    providerPriority: string[];
    fallbackStrategy: 'priority' | 'latency' | 'cost' | 'availability';
  }>;
}

export function createNextJsProxy(config: NextJsProxyConfig) {
  const proxyConfig = createProxyConfig(
    config.providers.map(p => ({
      id: p.id,
      apiKey: p.apiKey,
      preference: p.preference || 'secondary',
    })),
    config.preferences
  );

  const proxy = new ModelProxyCore(proxyConfig);
  const proxyApiKey = process.env.MODEL_PROXY_API_KEY || '';

  // Initialize health checks
  proxy.refreshHealth().catch(console.error);

  return {
    proxy,
    handlers: {
      chat: createChatHandler(proxy, proxyApiKey),
      models: {
        list: createModelsHandler(proxy, proxyApiKey),
        detail: createModelDetailHandler(proxy, proxyApiKey),
      },
      health: {
        get: createHealthHandler(proxy, proxyApiKey),
        refresh: createHealthRefreshHandler(proxy, proxyApiKey),
      },
    },
  };
}

// NextJsProxyConfig already exported above
