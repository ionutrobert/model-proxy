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
} from '../core/types.js';
import { autoModesHandler, AutoMode } from '../core/auto-modes.js';
import { healthTracker } from '../core/health-tracker.js';
import { proxyExecutor } from '../core/proxy-executor.js';

// ============================================================================
// Request Validation Schemas
// ============================================================================

const chatMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant', 'tool']),
  content: z.string(),
  name: z.string().optional(),
});

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
});

// ============================================================================
// Authentication Middleware
// ============================================================================

export function createAuthMiddleware(proxyApiKey: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Skip auth for health check endpoint
    if (req.path === '/health' || req.path === '/health/simple') {
      next();
      return;
    }

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

        try {
          await proxy.executeStreaming(
            request,
            (chunk) => {
              const data = JSON.stringify(chunk);
              res.write(`data: ${data}\n\n`);
            },
            () => {
              res.write('data: [DONE]\n\n');
              res.end();
            },
            (error) => {
              const errorData = JSON.stringify({
                error: {
                  message: error.message,
                  type: 'server_error',
                  code: 'stream_error',
                },
              });
              res.write(`data: ${errorData}\n\n`);
              res.end();
            },
            mode
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Streaming failed';
          res.write(`data: ${JSON.stringify({ error: message })}\n\n`);
          res.end();
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
        models: {
          total: health.models.length,
          byTier: health.models.reduce((acc, m) => {
            acc[m.tier] = (acc[m.tier] || 0) + 1;
            return acc;
          }, {} as Record<string, number>),
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
// Main Express Routes Setup
// ============================================================================

export function createExpressRoutes(proxy: ModelProxyCore, proxyApiKey: string) {
  const router = Router();

  // Apply authentication
  router.use(createAuthMiddleware(proxyApiKey));

  // Mount routes
  router.use('/v1/chat', createChatRoutes(proxy));
  router.use('/v1/models', createModelRoutes(proxy));
  router.use('/health', createHealthRoutes(proxy));

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
