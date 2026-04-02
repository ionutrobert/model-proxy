// ============================================================================
// Model Proxy Configuration for Next.js
// ============================================================================
//
// This file centralizes your model proxy configuration.
// You can import this from anywhere in your Next.js app.
//

import { createNextJsProxy } from 'model-proxy/adapters/nextjs';

/**
 * Create and configure the model proxy
 * 
 * This setup:
 * 1. Uses NVIDIA NIM as primary (free, fast)
 * 2. Uses Groq as secondary (free tier)
 * 3. Uses OpenCode Go as fallback (premium)
 * 
 * The proxy automatically:
 * - Selects the best available model
 * - Falls back to alternatives if one fails
 * - Prioritizes free providers when possible
 * - Monitors health of all providers
 */
export const modelProxy = createNextJsProxy({
  providers: [
    {
      id: 'nvidia-nim',
      apiKey: process.env.NVIDIA_NIM_API_KEY!,
      preference: 'primary',
    },
    {
      id: 'groq',
      apiKey: process.env.GROQ_API_KEY!,
      preference: 'secondary',
    },
    {
      id: 'opencode-go',
      apiKey: process.env.OPENCODE_API_KEY!,
      preference: 'fallback',
    },
  ],
  preferences: {
    preferFreeProviders: true,
    maxLatencyMs: 5000,
    providerPriority: ['nvidia-nim', 'groq', 'opencode-go'],
    fallbackStrategy: 'priority',
    requireStreaming: false,
    minContextWindow: 4096,
  },
});

// Export the proxy instance and handlers
export const { proxy, handlers } = modelProxy;

// Export individual handlers for convenience
export const chatHandler = handlers.chat;
export const modelsListHandler = handlers.models.list;
export const modelDetailHandler = handlers.models.detail;
export const healthHandler = handlers.health.get;
export const healthRefreshHandler = handlers.health.refresh;
