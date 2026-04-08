// ============================================================================
// Express Adapter for Standalone Server
// ============================================================================

import { Request, Response, NextFunction, Router } from 'express';
import { z } from 'zod';
import { ModelProxyCore } from '../core/index.js';
import {
  ChatCompletionRequest,
  ChatMessage,
  ModelProxyError,
  AuthenticationError,
  EmbeddingRequest,
  EmbeddingResponse,
  CompletionRequest,
  CompletionResponse,
  CompletionChunk,
  ResponseRequest,
  ResponseAPIResponse,
} from '../core/types.js';
import { autoModesHandler, AutoMode } from '../core/auto-modes.js';
import { healthTracker } from '../core/health-tracker.js';
import { proxyExecutor } from '../core/proxy-executor.js';
import { circuitBreaker } from '../core/circuit-breaker.js';
import { KeyPoolManager } from '../core/key-pool.js';
import { modelHealthVerifier } from '../core/model-health-verifier.js';

// ============================================================================
// Request Validation Schemas
// ============================================================================

const chatMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant', 'tool']),
  content: z.union([
    z.string().nullable(),
    z.array(z.any()), // Support multimodal content (images, etc.)
  ]),
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
  // Additional OpenAI parameters
  seed: z.number().optional(),
  logit_bias: z.record(z.number()).optional(),
  parallel_tool_calls: z.boolean().optional(),
  logprobs: z.boolean().optional(),
  top_logprobs: z.number().optional(),
  response_format: z.object({ type: z.enum(['text', 'json_object']) }).optional(),
});

// ============================================================================
// Authentication Middleware
// ============================================================================

export function createAuthMiddleware(proxyApiKey: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.log(`[AUTH] Missing authorization header for ${req.method} ${req.path}`);
      res.status(401).json({
        error: {
          message: 'Missing or invalid authorization header',
          type: 'authentication_error',
          code: 'invalid_api_key',
        },
      });
      return;
    }

    const apiKey = authHeader.slice(7);

    if (apiKey !== proxyApiKey) {
      console.log(`[AUTH] Invalid API key for ${req.method} ${req.path} (key: ${apiKey.substring(0, 8)}...)`);
      res.status(401).json({
        error: {
          message: 'Invalid API key',
          type: 'authentication_error',
          code: 'invalid_api_key',
        },
      });
      return;
    }

    console.log(`[AUTH] ✓ Authenticated for ${req.method} ${req.path}`);
    next();
  };
}

// ============================================================================
// Route Handlers
// ============================================================================

export function createChatRoutes(proxy: ModelProxyCore) {
  const router = Router();

  /**
   * POST /v1/chat/completions
   * OpenAI-compatible chat completions endpoint
   */
  router.post('/completions', async (req: Request, res: Response): Promise<void> => {
    try {
      // Validate request
      const validation = chatCompletionRequestSchema.safeParse(req.body);
      if (!validation.success) {
        res.status(400).json({
          error: {
            message: `Invalid request: ${validation.error.errors.map(e => e.message).join(', ')}`,
            type: 'invalid_request_error',
            code: 'invalid_request',
          },
        });
        return;
      }

    const request: ChatCompletionRequest = validation.data;

    // Determine selection mode from model name
    let mode: 'best' | 'fastest' | 'cheapest' | 'coding' | 'reasoning' = 'best';
    let useAutoSelection = true;
    const modelId = request.model || 'auto';

    // New auto-modes (health-aware)
    const newAutoModes: AutoMode[] = ['auto-coding', 'auto-fast', 'auto-balanced'];
    if (newAutoModes.includes(modelId as AutoMode)) {
      const allModels = proxy.getAvailableModels();
      const allHealth = healthTracker.getAllHealth();
      const selection = autoModesHandler.select(modelId as AutoMode, allModels, allHealth);
      
      if (!selection) {
        res.status(500).json({
          error: {
            message: `No suitable model found for ${modelId}`,
            type: 'server_error',
            code: 'no_model_available',
          },
        });
        return;
      }

      console.log(`[AUTO-MODE] ${modelId} → ${selection.selected.id} (${selection.reason})`);
      request.model = selection.selected.id;
      useAutoSelection = false;
    } else if (modelId === 'auto-best' || modelId === 'auto') {
      mode = 'best';
      request.model = undefined;
    } else if (modelId === 'auto-fastest') {
      mode = 'fastest';
      request.model = undefined;
    } else if (modelId === 'auto-cheapest') {
      mode = 'cheapest';
      request.model = undefined;
    } else if (modelId === 'auto-reasoning') {
      mode = 'reasoning';
      request.model = undefined;
    } else {
      useAutoSelection = false;
    }

    console.log(`[REQUEST] Model requested: ${modelId}, Auto selection: ${useAutoSelection}`);

    // Handle streaming
    if (request.stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');

      // Track stream state to prevent writes after end
      let streamClosed = false;

      const safeWrite = (data: string): boolean => {
        if (streamClosed || res.writableEnded) {
          return false;
        }
        try {
          return res.write(data);
        } catch (err) {
          console.error('[STREAM] Write failed:', err);
          streamClosed = true;
          return false;
        }
      };

      const safeEnd = (): void => {
        if (streamClosed || res.writableEnded) {
          return;
        }
        streamClosed = true;
        try {
          res.end();
        } catch (err) {
          console.error('[STREAM] End failed:', err);
        }
      };

      try {
        await proxy.executeStreaming(
          request,
          (chunk) => {
            const data = JSON.stringify(chunk);
            safeWrite(`data: ${data}\n\n`);
          },
          () => {
            safeWrite('data: [DONE]\n\n');
            safeEnd();
          },
          (error) => {
            const errorData = JSON.stringify({
              error: {
                message: error.message,
                type: 'server_error',
                code: 'stream_error',
              },
            });
            safeWrite(`data: ${errorData}\n\n`);
            safeEnd();
          },
          mode
        );
      } catch (error) {
        if (!streamClosed) {
          const message = error instanceof Error ? error.message : 'Streaming failed';
          safeWrite(`data: ${JSON.stringify({
            error: {
              message,
              type: 'server_error',
              code: 'no_model_available'
            }
          })}\n\n`);
          safeEnd();
        }
      }
      return;
    }

    // Non-streaming request
    const response = await proxy.execute(request, { mode, useAutoSelection });
    res.json(response);

    } catch (error) {
      handleError(error, res);
    }
  });

  return router;
}

export function createModelRoutes(proxy: ModelProxyCore) {
  const router = Router();

  /**
   * GET /v1/models
   * List available models
   */
  router.get('/', (req: Request, res: Response): void => {
    try {
      const models = proxy.getAvailableModels();

      // Add virtual "auto" models for different selection strategies
      const autoModels = [
        {
          id: 'auto',
          object: 'model',
          created: Math.floor(Date.now() / 1000),
          owned_by: 'model-proxy',
          permission: [],
          root: 'auto',
          parent: null,
          context_window: 128000,
          description: 'Automatically selects the best model based on performance and quality',
        },
        {
          id: 'auto-best',
          object: 'model',
          created: Math.floor(Date.now() / 1000),
          owned_by: 'model-proxy',
          permission: [],
          root: 'auto-best',
          parent: null,
          context_window: 128000,
          description: 'Selects the highest quality model available',
        },
        {
          id: 'auto-fastest',
          object: 'model',
          created: Math.floor(Date.now() / 1000),
          owned_by: 'model-proxy',
          permission: [],
          root: 'auto-fastest',
          parent: null,
          context_window: 128000,
          description: 'Selects the fastest responding model',
        },
        {
          id: 'auto-cheapest',
          object: 'model',
          created: Math.floor(Date.now() / 1000),
          owned_by: 'model-proxy',
          permission: [],
          root: 'auto-cheapest',
          parent: null,
          context_window: 128000,
          description: 'Selects the most cost-effective model',
        },
        {
          id: 'auto-coding',
          object: 'model',
          created: Math.floor(Date.now() / 1000),
          owned_by: 'model-proxy',
          permission: [],
          root: 'auto-coding',
          parent: null,
          context_window: 128000,
          description: 'Selects the best model for coding tasks (health-aware, prefers thinking models)',
        },
        {
          id: 'auto-fast',
          object: 'model',
          created: Math.floor(Date.now() / 1000),
          owned_by: 'model-proxy',
          permission: [],
          root: 'auto-fast',
          parent: null,
          context_window: 128000,
          description: 'Selects the fastest stable model (health-aware, max 1s latency)',
        },
        {
          id: 'auto-balanced',
          object: 'model',
          created: Math.floor(Date.now() / 1000),
          owned_by: 'model-proxy',
          permission: [],
          root: 'auto-balanced',
          parent: null,
          context_window: 128000,
          description: 'Balances quality and speed (health-aware, stability + SWE score)',
        },
      ];

      res.json({
        object: 'list',
        data: [...autoModels, ...models.map(model => ({
          id: model.id,
          object: 'model',
          created: Math.floor(Date.now() / 1000),
          owned_by: model.provider,
          permission: [],
          root: model.id,
          parent: null,
          context_window: model.contextWindow,
          tier: model.tier,
          supports_streaming: model.supportsStreaming,
          supports_function_calling: model.supportsFunctionCalling,
          supports_vision: model.supportsVision,
        }))],
      });
    } catch (error) {
      handleError(error, res);
    }
  });

  /**
   * GET /v1/models/:modelId
   * Get model details
   */
  router.get('/:modelId', (req: Request, res: Response): void => {
    try {
      const models = proxy.getAvailableModels();
      const model = models.find(m => m.id === req.params.modelId);
      
      if (!model) {
        res.status(404).json({
          error: {
            message: `Model ${req.params.modelId} not found`,
            type: 'not_found',
            code: 'model_not_found',
          },
        });
        return;
      }

      res.json({
        id: model.id,
        object: 'model',
        created: Math.floor(Date.now() / 1000),
        owned_by: model.provider,
        permission: [],
        root: model.id,
        parent: null,
      });
    } catch (error) {
      handleError(error, res);
    }
  });

  return router;
}

export function createHealthRoutes(proxy: ModelProxyCore) {
  const router = Router();

  /**
   * GET /health
   * Health and status endpoint
   */
  router.get('/', async (req: Request, res: Response): Promise<void> => {
    try {
      const health = proxy.getHealthStatus();
      const config = proxy.getConfig();
      const allHealth = healthTracker.getAllHealth();

      const trackerSummary = {
        totalModels: allHealth.size,
        byVerdict: {} as Record<string, number>,
        avgStability: 0,
        perfect: 0,
        unhealthy: 0,
      };

      let totalStability = 0;
      for (const [modelId, h] of allHealth) {
        trackerSummary.byVerdict[h.verdict] = (trackerSummary.byVerdict[h.verdict] || 0) + 1;
        totalStability += h.stabilityScore;
        if (h.verdict === 'Perfect') trackerSummary.perfect++;
        if (['Unstable', 'Not Active', 'Overloaded'].includes(h.verdict)) trackerSummary.unhealthy++;
      }
      trackerSummary.avgStability = allHealth.size > 0 ? Math.round(totalStability / allHealth.size) : 0;
      
      res.json({
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
        healthTracker: {
          summary: trackerSummary,
          topModels: [...allHealth.entries()]
            .sort((a, b) => b[1].stabilityScore - a[1].stabilityScore)
            .slice(0, 10)
            .map(([id, h]) => ({
              id,
              verdict: h.verdict,
              stability: h.stabilityScore,
              avgLatency: h.metrics.avgLatency,
              p95Latency: h.metrics.p95Latency,
              uptime: h.metrics.uptimePercent,
              totalRequests: h.metrics.totalRequests,
            })),
        },
        models: {
          total: health.models.length,
          byTier: health.models.reduce((acc, m) => {
            acc[m.tier] = (acc[m.tier] || 0) + 1;
            return acc;
          }, {} as Record<string, number>),
          top: health.models.slice(0, 10).map(m => {
            const h = allHealth.get(m.model.id.toLowerCase());
            return {
              id: m.model.id,
              name: m.model.name,
              provider: m.model.provider,
              tier: m.model.tier,
              latency: m.health.latency,
              stability: h?.stabilityScore ?? -1,
              verdict: h?.verdict ?? 'Pending',
            };
          }),
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
      handleError(error, res);
    }
  });

  /**
   * POST /health/refresh
   * Force health check refresh
   */
  router.post('/refresh', async (req: Request, res: Response): Promise<void> => {
    try {
      await proxy.forceHealthRefresh();
      res.json({
        status: 'refreshed',
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      handleError(error, res);
    }
  });

  /**
   * GET /health/models
   * Get model verification status
   */
  router.get('/models', (req: Request, res: Response): void => {
    try {
      const allHealth = healthTracker.getAllHealth();
      const verifierStatus = modelHealthVerifier.getAllStatus();
      const verifierSummary = modelHealthVerifier.getSummary();

      const models: Array<{
        id: string;
        provider: string;
        verified: boolean;
        status: string;
        verdict: string;
        stability: number;
        lastSuccess: string | null;
        lastFailure: string | null;
        consecutiveFailures: number;
        isHealthy: boolean;
      }> = [];

      for (const [key, status] of verifierStatus) {
        const health = allHealth.get(key);
        models.push({
          id: status.modelId,
          provider: status.providerId,
          verified: status.isVerified,
          status: status.status,
          verdict: status.verdict,
          stability: status.stabilityScore,
          lastSuccess: status.lastSuccess ? new Date(status.lastSuccess).toISOString() : null,
          lastFailure: status.lastFailure ? new Date(status.lastFailure).toISOString() : null,
          consecutiveFailures: status.consecutiveFailures,
          isHealthy: modelHealthVerifier.isHealthy(status.modelId),
        });
      }

      res.json({
        summary: verifierSummary,
        verified: modelHealthVerifier.getVerifiedModels(),
        unhealthy: modelHealthVerifier.getUnhealthyModels(),
        models,
      });
    } catch (error) {
      handleError(error, res);
    }
  });

  return router;
}

// ============================================================================
// Error Handler
// ============================================================================

function handleError(error: unknown, res: Response): void {
  if (error instanceof ModelProxyError) {
    res.status(error.statusCode).json({
      error: {
        message: error.message,
        type: error.type,
        code: error.code,
      },
    });
    return;
  }

  const message = error instanceof Error ? error.message : 'Internal server error';
  
  res.status(500).json({
    error: {
      message,
      type: 'server_error',
      code: 'internal_error',
    },
  });
}

// ============================================================================
// Embeddings Routes
// ============================================================================

export function createEmbeddingsRoutes(proxy: ModelProxyCore) {
  const router = Router();

  const embeddingRequestSchema = z.object({
    model: z.string(),
    input: z.union([
      z.string(),
      z.array(z.string()),
      z.array(z.number()),
      z.array(z.array(z.number())),
    ]),
    dimensions: z.number().positive().optional(),
    encoding_format: z.enum(['float', 'base64']).optional().default('float'),
    user: z.string().optional(),
  });

  router.post('/', async (req: Request, res: Response): Promise<void> => {
    try {
      const validation = embeddingRequestSchema.safeParse(req.body);
      if (!validation.success) {
        res.status(400).json({
          error: {
            message: `Invalid request: ${validation.error.errors.map(e => e.message).join(', ')}`,
            type: 'invalid_request_error',
            code: 'invalid_request',
          },
        });
        return;
      }

      const request: EmbeddingRequest = validation.data;

      const allModels = proxy.getAvailableModels();
      const model = allModels.find(m => m.id === request.model);

      if (!model) {
        res.status(400).json({
          error: {
            message: `Model ${request.model} not found`,
            type: 'invalid_request_error',
            code: 'model_not_found',
          },
        });
        return;
      }

      const provider = proxy.getProvider(model.provider);
      if (!provider) {
        res.status(503).json({
          error: {
            message: `Provider ${model.provider} unavailable`,
            type: 'server_error',
            code: 'provider_unavailable',
          },
        });
        return;
      }

      const apiKey = (provider.keyPool ? KeyPoolManager.getNextKey(provider.keyPool) : null) || provider.apiKey;
      const baseUrl = provider.baseUrl;

      const response = await fetch(`${baseUrl}/v1/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          ...provider.headers,
        },
        body: JSON.stringify({
          model: request.model,
          input: request.input,
          dimensions: request.dimensions,
          encoding_format: request.encoding_format,
          user: request.user,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        console.error(`[EMBEDDINGS] Provider error: ${response.status} ${error}`);
        res.status(response.status).json({
          error: {
            message: `Embedding generation failed: ${response.statusText}`,
            type: 'server_error',
            code: 'embedding_failed',
          },
        });
        return;
      }

      const data = await response.json() as EmbeddingResponse;

      const result: EmbeddingResponse = {
        object: 'list',
        data: data.data.map((item, index) => ({
          object: 'embedding' as const,
          embedding: item.embedding,
          index,
        })),
        model: request.model,
        usage: data.usage,
      };

      res.json(result);
    } catch (error) {
      handleError(error, res);
    }
  });

  return router;
}

// ============================================================================
// Legacy Completions Routes
// ============================================================================

export function createCompletionsRoutes(proxy: ModelProxyCore) {
  const router = Router();

   const completionRequestSchema = z.object({
     model: z.string(),
     prompt: z.union([
       z.string(),
       z.array(z.string()),
       z.array(z.number()),
       z.array(z.array(z.number())),
     ]),
     max_tokens: z.number().positive().optional(),
     temperature: z.number().min(0).max(2).optional().default(1),
     top_p: z.number().min(0).max(1).optional().default(1),
     n: z.number().positive().optional().default(1),
     stream: z.boolean().optional().default(false),
     logprobs: z.number().min(0).max(5).optional(),
     echo: z.boolean().optional().default(false),
     stop: z.union([z.string(), z.array(z.string())]).optional(),
     presence_penalty: z.number().min(-2).max(2).optional().default(0),
     frequency_penalty: z.number().min(-2).max(2).optional().default(0),
     best_of: z.number().positive().optional(),
     logit_bias: z.record(z.number()).optional(),
     user: z.string().optional(),
     suffix: z.string().optional(),
     seed: z.number().optional(),
   });

  router.post('/', async (req: Request, res: Response): Promise<void> => {
    try {
      const validation = completionRequestSchema.safeParse(req.body);
      if (!validation.success) {
        res.status(400).json({
          error: {
            message: `Invalid request: ${validation.error.errors.map(e => e.message).join(', ')}`,
            type: 'invalid_request_error',
            code: 'invalid_request',
          },
        });
        return;
      }

      const request: CompletionRequest = validation.data;

      const allModels = proxy.getAvailableModels();
      const model = allModels.find(m => m.id === request.model);

      if (!model) {
        res.status(400).json({
          error: {
            message: `Model ${request.model} not found`,
            type: 'invalid_request_error',
            code: 'model_not_found',
          },
        });
        return;
      }

      const provider = proxy.getProvider(model.provider);
      if (!provider) {
        res.status(503).json({
          error: {
            message: `Provider ${model.provider} unavailable`,
            type: 'server_error',
            code: 'provider_unavailable',
          },
        });
        return;
      }

      const apiKey = (provider.keyPool ? KeyPoolManager.getNextKey(provider.keyPool) : null) || provider.apiKey;
      const baseUrl = provider.baseUrl;

      if (request.stream) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');

        const response = await fetch(`${baseUrl}/v1/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
            ...provider.headers,
          },
           body: JSON.stringify({
             model: request.model,
             prompt: request.prompt,
             max_tokens: request.max_tokens,
             temperature: request.temperature,
             top_p: request.top_p,
             n: request.n,
             stream: true,
             logprobs: request.logprobs,
             echo: request.echo,
             stop: request.stop,
             presence_penalty: request.presence_penalty,
             frequency_penalty: request.frequency_penalty,
             best_of: request.best_of,
             logit_bias: request.logit_bias,
             user: request.user,
             suffix: request.suffix,
             seed: request.seed,
           }),
        });

        if (!response.ok) {
          const error = await response.text();
          res.write(`data: ${JSON.stringify({ error: { message: error } })}\n\n`);
          res.end();
          return;
        }

        if (!response.body) {
          res.write(`data: ${JSON.stringify({ error: { message: 'No response body' } })}\n\n`);
          res.end();
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value);
            const lines = chunk.split('\n').filter(line => line.trim() !== '');

            for (const line of lines) {
              if (line.startsWith('data: ')) {
                res.write(`${line}\n\n`);
              }
            }
          }
          res.write('data: [DONE]\n\n');
          res.end();
        } catch (streamError) {
          const message = streamError instanceof Error ? streamError.message : 'Streaming failed';
          res.write(`data: ${JSON.stringify({ error: { message } })}\n\n`);
          res.end();
        }
      } else {
      const response = await fetch(`${baseUrl}/v1/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          ...provider.headers,
        },
        body: JSON.stringify({
          model: request.model,
          prompt: request.prompt,
          max_tokens: request.max_tokens,
          temperature: request.temperature,
          top_p: request.top_p,
          n: request.n,
          stream: false,
          logprobs: request.logprobs,
          echo: request.echo,
          stop: request.stop,
          presence_penalty: request.presence_penalty,
          frequency_penalty: request.frequency_penalty,
          best_of: request.best_of,
          logit_bias: request.logit_bias,
          user: request.user,
          suffix: request.suffix,
          seed: request.seed,
        }),
      });

        if (!response.ok) {
          const error = await response.text();
          console.error(`[COMPLETIONS] Provider error: ${response.status} ${error}`);
          res.status(response.status).json({
            error: {
              message: `Completion failed: ${response.statusText}`,
              type: 'server_error',
              code: 'completion_failed',
            },
          });
          return;
        }

        const data = await response.json() as CompletionResponse;
        res.json(data);
      }
    } catch (error) {
      handleError(error, res);
    }
  });

  return router;
}

// ============================================================================
// Responses API Routes
// ============================================================================

export function createResponsesRoutes(proxy: ModelProxyCore) {
  const router = Router();

  const contentPartSchema = z.object({
    type: z.enum(['text', 'image']),
    text: z.string().optional(),
    image_url: z.object({ url: z.string() }).optional(),
  });

  const inputMessageSchema = z.object({
    type: z.literal('message'),
    role: z.enum(['system', 'user', 'assistant']),
    content: z.union([
      z.string(),
      z.array(contentPartSchema),
    ]),
  });

  const responseRequestSchema = z.object({
    model: z.string(),
    input: z.union([z.string(), z.array(inputMessageSchema)]),
    instructions: z.string().optional(),
    temperature: z.number().min(0).max(2).optional(),
    top_p: z.number().min(0).max(1).optional(),
    max_output_tokens: z.number().positive().optional(),
    stream: z.boolean().optional().default(false),
    tools: z.array(z.object({
      type: z.literal('function'),
      function: z.object({
        name: z.string(),
        description: z.string().optional(),
        parameters: z.record(z.unknown()).optional(),
        strict: z.boolean().optional(),
      }),
    })).optional(),
    tool_choice: z.union([
      z.literal('none'),
      z.literal('auto'),
      z.literal('required'),
      z.object({
        type: z.literal('function'),
        function: z.object({ name: z.string() }),
      }),
    ]).optional(),
    metadata: z.record(z.unknown()).optional(),
  });

  router.post('/', async (req: Request, res: Response): Promise<void> => {
    try {
      const validation = responseRequestSchema.safeParse(req.body);
      if (!validation.success) {
        res.status(400).json({
          error: {
            message: `Invalid request: ${validation.error.errors.map(e => e.message).join(', ')}`,
            type: 'invalid_request_error',
            code: 'invalid_request',
          },
        });
        return;
      }

      const request: ResponseRequest = validation.data;

      const allModels = proxy.getAvailableModels();
      const model = allModels.find(m => m.id === request.model);

      if (!model) {
        res.status(400).json({
          error: {
            message: `Model ${request.model} not found`,
            type: 'invalid_request_error',
            code: 'model_not_found',
          },
        });
        return;
      }

      const provider = proxy.getProvider(model.provider);
      if (!provider) {
        res.status(503).json({
          error: {
            message: `Provider ${model.provider} unavailable`,
            type: 'server_error',
            code: 'provider_unavailable',
          },
        });
        return;
      }

      const apiKey = (provider.keyPool ? KeyPoolManager.getNextKey(provider.keyPool) : null) || provider.apiKey;
      const baseUrl = provider.baseUrl;

      if (request.stream) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');

        const response = await fetch(`${baseUrl}/v1/responses`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
            ...provider.headers,
          },
          body: JSON.stringify(request),
        });

        if (!response.ok) {
          const error = await response.text();
          res.write(`data: ${JSON.stringify({ error: { message: error } })}\n\n`);
          res.end();
          return;
        }

        if (!response.body) {
          res.write(`data: ${JSON.stringify({ error: { message: 'No response body' } })}\n\n`);
          res.end();
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value);
            const lines = chunk.split('\n').filter(line => line.trim() !== '');

            for (const line of lines) {
              if (line.startsWith('data: ')) {
                res.write(`${line}\n\n`);
              }
            }
          }
          res.write('data: [DONE]\n\n');
          res.end();
        } catch (streamError) {
          const message = streamError instanceof Error ? streamError.message : 'Streaming failed';
          res.write(`data: ${JSON.stringify({ error: { message } })}\n\n`);
          res.end();
        }
      } else {
        const response = await fetch(`${baseUrl}/v1/responses`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
            ...provider.headers,
          },
          body: JSON.stringify(request),
        });

        if (!response.ok) {
          const error = await response.text();
          console.error(`[RESPONSES] Provider error: ${response.status} ${error}`);
          res.status(response.status).json({
            error: {
              message: `Response generation failed: ${response.statusText}`,
              type: 'server_error',
              code: 'response_failed',
            },
          });
          return;
        }

        const data = await response.json() as ResponseAPIResponse;
        res.json(data);
      }
    } catch (error) {
      handleError(error, res);
    }
  });

  return router;
}

// ============================================================================
// Main Express Routes Setup
// ============================================================================

export function createExpressRoutes(proxy: ModelProxyCore, proxyApiKey: string) {
  const router = Router();

  // Mount public routes (no auth)
  router.use('/metrics', createMetricsRoutes(proxy));
  router.use('/health', createHealthRoutes(proxy));

  // Apply authentication to protected routes
  router.use(createAuthMiddleware(proxyApiKey));

  // Mount protected routes
  router.use('/v1/chat', createChatRoutes(proxy));
  router.use('/v1/models', createModelRoutes(proxy));
  router.use('/v1/embeddings', createEmbeddingsRoutes(proxy));
  router.use('/v1/completions', createCompletionsRoutes(proxy));
  router.use('/v1/responses', createResponsesRoutes(proxy));

  // 404 handler
  router.use((req: Request, res: Response) => {
    res.status(404).json({
      error: {
        message: `Route ${req.method} ${req.path} not found`,
        type: 'not_found',
        code: 'route_not_found',
      },
    });
  });

  return router;
}

// ============================================================================
// Metrics Routes
// ============================================================================

export function createMetricsRoutes(proxy: ModelProxyCore) {
  const router = Router();

  /**
   * GET /metrics
   * Prometheus-compatible metrics
   */
  router.get('/', (req: Request, res: Response): void => {
    const allHealth = healthTracker.getAllHealth();
    const providerHealth = circuitBreaker.getHealthStatus();
    
    const lines: string[] = [];
    const timestamp = Date.now();
    
    lines.push('# HELP model_proxy_model_stability Model stability score (0-100)');
    lines.push('# TYPE model_proxy_model_stability gauge');
    for (const [modelId, health] of allHealth) {
      const safeId = modelId.replace(/[^a-zA-Z0-9_]/g, '_');
      lines.push(`model_proxy_model_stability{model="${safeId}",verdict="${health.verdict}"} ${health.stabilityScore}`);
    }
    
    lines.push('');
    lines.push('# HELP model_proxy_model_latency_avg Average latency in ms');
    lines.push('# TYPE model_proxy_model_latency_avg gauge');
    for (const [modelId, health] of allHealth) {
      const safeId = modelId.replace(/[^a-zA-Z0-9_]/g, '_');
      lines.push(`model_proxy_model_latency_avg{model="${safeId}"} ${health.metrics.avgLatency}`);
    }
    
    lines.push('');
    lines.push('# HELP model_proxy_model_latency_p95 P95 latency in ms');
    lines.push('# TYPE model_proxy_model_latency_p95 gauge');
    for (const [modelId, health] of allHealth) {
      const safeId = modelId.replace(/[^a-zA-Z0-9_]/g, '_');
      lines.push(`model_proxy_model_latency_p95{model="${safeId}"} ${health.metrics.p95Latency}`);
    }
    
    lines.push('');
    lines.push('# HELP model_proxy_model_jitter Latency jitter in ms');
    lines.push('# TYPE model_proxy_model_jitter gauge');
    for (const [modelId, health] of allHealth) {
      const safeId = modelId.replace(/[^a-zA-Z0-9_]/g, '_');
      lines.push(`model_proxy_model_jitter{model="${safeId}"} ${health.metrics.jitter}`);
    }
    
    lines.push('');
    lines.push('# HELP model_proxy_model_uptime_percent Model uptime percentage');
    lines.push('# TYPE model_proxy_model_uptime_percent gauge');
    for (const [modelId, health] of allHealth) {
      const safeId = modelId.replace(/[^a-zA-Z0-9_]/g, '_');
      lines.push(`model_proxy_model_uptime_percent{model="${safeId}"} ${health.metrics.uptimePercent}`);
    }
    
    lines.push('');
    lines.push('# HELP model_proxy_model_spike_rate Spike rate (fraction)');
    lines.push('# TYPE model_proxy_model_spike_rate gauge');
    for (const [modelId, health] of allHealth) {
      const safeId = modelId.replace(/[^a-zA-Z0-9_]/g, '_');
      lines.push(`model_proxy_model_spike_rate{model="${safeId}"} ${health.metrics.spikeRate}`);
    }
    
    lines.push('');
    lines.push('# HELP model_proxy_model_requests_total Total requests per model');
    lines.push('# TYPE model_proxy_model_requests_total counter');
    for (const [modelId, health] of allHealth) {
      const safeId = modelId.replace(/[^a-zA-Z0-9_]/g, '_');
      lines.push(`model_proxy_model_requests_total{model="${safeId}"} ${health.metrics.totalRequests}`);
    }
    
    lines.push('');
    lines.push('# HELP model_proxy_model_requests_successful Successful requests per model');
    lines.push('# TYPE model_proxy_model_requests_successful counter');
    for (const [modelId, health] of allHealth) {
      const safeId = modelId.replace(/[^a-zA-Z0-9_]/g, '_');
      lines.push(`model_proxy_model_requests_successful{model="${safeId}"} ${health.metrics.successfulRequests}`);
    }
    
    lines.push('');
    lines.push('# HELP model_proxy_provider_status Provider health status (1=healthy, 0=unhealthy)');
    lines.push('# TYPE model_proxy_provider_status gauge');
    for (const provider of providerHealth) {
      lines.push(`model_proxy_provider_status{provider="${provider.providerId}"} ${provider.status === 'closed' ? 1 : 0}`);
    }
    
    lines.push('');
    lines.push('# HELP model_proxy_provider_failures Provider failure count');
    lines.push('# TYPE model_proxy_provider_failures gauge');
    for (const provider of providerHealth) {
      lines.push(`model_proxy_provider_failures{provider="${provider.providerId}"} ${provider.failureCount}`);
    }
    
    lines.push('');
    lines.push('# HELP model_proxy_proxy_executor_total Total proxy executor requests');
    lines.push('# TYPE model_proxy_proxy_executor_total gauge');
    const metrics = proxyExecutor.getMetrics();
    lines.push(`model_proxy_proxy_executor_total ${metrics.totalRequests}`);
    
    lines.push('');
    lines.push('# HELP model_proxy_proxy_executor_successful Successful proxy executor requests');
    lines.push('# TYPE model_proxy_proxy_executor_successful gauge');
    lines.push(`model_proxy_proxy_executor_successful ${metrics.successfulRequests}`);
    
    lines.push('');
    lines.push('# HELP model_proxy_proxy_executor_failed Failed proxy executor requests');
    lines.push('# TYPE model_proxy_proxy_executor_failed gauge');
    lines.push(`model_proxy_proxy_executor_failed ${metrics.failedRequests}`);
    
    lines.push('');
    lines.push('# HELP model_proxy_proxy_executor_avg_latency Average proxy executor latency in ms');
    lines.push('# TYPE model_proxy_proxy_executor_avg_latency gauge');
    lines.push(`model_proxy_proxy_executor_avg_latency ${metrics.avgLatency}`);
    
    res.set('Content-Type', 'text/plain; version=0.0.4');
    res.send(lines.join('\n') + '\n');
  });

  /**
   * GET /metrics/json
   * JSON metrics for programmatic access
   */
  router.get('/json', (req: Request, res: Response): void => {
    const allHealth = healthTracker.getAllHealth();
    const providerHealth = circuitBreaker.getHealthStatus();
    const proxyMetrics = proxyExecutor.getMetrics();
    
    const metrics = {
      timestamp: new Date().toISOString(),
      models: {} as Record<string, {
        stability: number;
        verdict: string;
        latency: { avg: number; p95: number; jitter: number };
        uptime: number;
        spikeRate: number;
        requests: { total: number; successful: number };
      }>,
      providers: {} as Record<string, {
        status: string;
        failures: number;
        lastFailure: string | null;
      }>,
      proxyExecutor: {
        totalRequests: proxyMetrics.totalRequests,
        successfulRequests: proxyMetrics.successfulRequests,
        failedRequests: proxyMetrics.failedRequests,
        avgLatency: proxyMetrics.avgLatency,
        modelsUsed: Object.fromEntries(proxyMetrics.modelsUsed),
      },
      summary: {
        totalModels: allHealth.size,
        avgStability: 0,
        healthyProviders: providerHealth.filter(p => p.status === 'closed').length,
        unhealthyModels: 0,
        perfectModels: 0,
      },
    };
    
    let totalStability = 0;
    for (const [modelId, health] of allHealth) {
      metrics.models[modelId] = {
        stability: health.stabilityScore,
        verdict: health.verdict,
        latency: {
          avg: health.metrics.avgLatency,
          p95: health.metrics.p95Latency,
          jitter: health.metrics.jitter,
        },
        uptime: health.metrics.uptimePercent,
        spikeRate: health.metrics.spikeRate,
        requests: {
          total: health.metrics.totalRequests,
          successful: health.metrics.successfulRequests,
        },
      };
      totalStability += health.stabilityScore;
      if (['Unstable', 'Not Active', 'Overloaded'].includes(health.verdict)) {
        metrics.summary.unhealthyModels++;
      }
      if (health.verdict === 'Perfect') {
        metrics.summary.perfectModels++;
      }
    }
    metrics.summary.avgStability = allHealth.size > 0 ? Math.round(totalStability / allHealth.size) : 0;
    
    for (const provider of providerHealth) {
      metrics.providers[provider.providerId] = {
        status: provider.status,
        failures: provider.failureCount,
        lastFailure: provider.lastFailure ? new Date(provider.lastFailure).toISOString() : null,
      };
    }
    
    res.json(metrics);
  });

  return router;
}
