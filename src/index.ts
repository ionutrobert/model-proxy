// ============================================================================
// Model Proxy - Public API
// ============================================================================
//
// This is the main entry point for the model-proxy package.
// It exports everything needed for both standalone and integrated usage.
//
// Usage:
//   // Standalone server
//   npm run start
//
//   // Next.js integration
//   import { createModelProxy, createNextJsProxy } from 'model-proxy';
//
//   // Express integration
//   import { createExpressRoutes } from 'model-proxy/adapters/express';
//
// ============================================================================

// ============================================================================
// Core Exports
// ============================================================================

export {
  // Types
  ChatMessage,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionChunk,
  ProviderConfig,
  ProviderId,
  ProviderPreference,
  ModelConfig,
  ModelTier,
  HealthCheckResult,
  HealthStatus,
  ProviderHealth,
  CircuitState,
  RankedModel,
  SelectionCriteria,
  UserPreferences,
  FallbackStrategy,
  StreamChunk,
  StreamHandler,
  ModelProxyError,
  ProviderUnavailableError,
  NoHealthyModelsError,
  AuthenticationError,
  defaultPreferences,
} from './core/types.js';

// ============================================================================
// Core Classes
// ============================================================================

export {
  // Main proxy class
  ModelProxyCore,
  createModelProxy,
  
  // Configuration
  ConfigManager,
  createProxyConfig,
  getConfig,
  
  // Provider registry
  ProviderRegistry,
  PROVIDER_DEFINITIONS,
  
  // Circuit breaker
  CircuitBreaker,
  circuitBreaker,
  isHealthy,
  isAvailable,
  recordSuccess,
  recordFailure,
  
  // Health service
  HealthService,
  healthService,
  
  // Model selector
  ModelSelector,
  modelSelector,
} from './core/index.js';

// ============================================================================
// Provider Exports
// ============================================================================

export {
  // Base provider
  BaseProvider,
  
  // Provider implementations
  NvidiaNimProvider,
  OpenCodeGoProvider,
  OpenCodeZenProvider,
  GroqProvider,
  
  // Provider factory
  createProvider,
  getProviderClass,
  isProviderImplemented,
  listImplementedProviders,
} from './providers/index.js';

// ============================================================================
// Adapter Exports
// ============================================================================

// Next.js adapter (requires Next.js as peer dependency)
// Note: Import types directly from the adapter to avoid type naming issues
export type { NextJsProxyConfig } from './adapters/nextjs.js';

// Re-export handler factory functions
export {
  createNextJsProxy,
  createChatHandler,
  createModelsHandler,
  createModelDetailHandler,
  createHealthHandler,
  createHealthRefreshHandler,
  authenticateRequest,
} from './adapters/nextjs.js';

// Express adapter
export {
  createExpressRoutes,
  createChatRoutes,
  createModelRoutes,
  createHealthRoutes,
  createAuthMiddleware,
} from './adapters/express.js';

// ============================================================================
// Standalone Server (for direct imports)
// ============================================================================

// Re-export standalone server entry point
// Note: This is also available at 'model-proxy/standalone'
export { createLoggingMiddleware } from './standalone/middleware.js';

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Quick setup function for Next.js apps
 *
 * @example
 * // app/api/chat/route.ts
 * import { createNextJsProxy, createChatHandler } from 'model-proxy/adapters/nextjs';
 *
 * const { handlers } = createNextJsProxy({
 *   providers: [
 *     { id: 'nvidia-nim', apiKey: process.env.NVIDIA_NIM_API_KEY! },
 *   ]
 * });
 *
 * export const POST = handlers.chat;
 */
export function quickSetupNextJs(options: {
  providers: Array<{
    id: string;
    apiKey: string;
    preference?: 'primary' | 'secondary' | 'fallback';
  }>;
  preferFreeProviders?: boolean;
}): Promise<unknown> {
  return import('./adapters/nextjs.js').then(module => {
    return module.createNextJsProxy({
      providers: options.providers,
      preferences: {
        preferFreeProviders: options.preferFreeProviders ?? true,
      },
    });
  });
}

/**
 * Quick setup function for Express apps
 * 
 * @example
 * import express from 'express';
 * import { quickSetupExpress } from 'model-proxy';
 * 
 * const app = express();
 * const routes = await quickSetupExpress({
 *   providers: [
 *     { id: 'nvidia-nim', apiKey: process.env.NVIDIA_NIM_API_KEY! },
 *   ]
 * });
 * 
 * app.use(routes);
 */
export async function quickSetupExpress(options: {
  providers: Array<{
    id: string;
    apiKey: string;
    preference?: 'primary' | 'secondary' | 'fallback';
  }>;
  preferFreeProviders?: boolean;
  proxyApiKey?: string;
}) {
  const { createExpressRoutes } = await import('./adapters/express.js');
  const { createProxyConfig } = await import('./core/config.js');
  const { ModelProxyCore } = await import('./core/index.js');

  const config = createProxyConfig(
    options.providers.map(p => ({
      id: p.id,
      apiKey: p.apiKey,
      preference: p.preference || 'secondary',
    })),
    {
      preferFreeProviders: options.preferFreeProviders ?? true,
    }
  );

  const proxy = new ModelProxyCore(config);
  await proxy.refreshHealth();

  return createExpressRoutes(proxy, options.proxyApiKey || process.env.MODEL_PROXY_API_KEY || '');
}

// ============================================================================
// Version
// ============================================================================

export const VERSION = '1.0.0';

// ============================================================================
// Package Info
// ============================================================================

export const PACKAGE_NAME = 'model-proxy';
export const PACKAGE_DESCRIPTION = 'OpenAI-compatible model proxy with automatic provider selection and health monitoring';
