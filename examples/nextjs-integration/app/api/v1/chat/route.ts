import { NextRequest } from 'next/server';
import { createNextJsProxy } from 'model-proxy/adapters/nextjs';

/**
 * Next.js API Route - Chat Completions
 * 
 * This example shows how to integrate model-proxy into a Next.js app.
 * The proxy automatically selects the best available provider based on
 * health checks and user preferences.
 */

// Initialize the proxy with your providers
const { handlers } = createNextJsProxy({
  providers: [
    {
      id: 'nvidia-nim',
      apiKey: process.env.NVIDIA_NIM_API_KEY!,
      preference: 'primary', // Use as primary provider
    },
    {
      id: 'opencode-go',
      apiKey: process.env.OPENCODE_API_KEY!,
      preference: 'secondary', // Use as backup
    },
    {
      id: 'groq',
      apiKey: process.env.GROQ_API_KEY!,
      preference: 'fallback', // Use as last resort
    },
  ],
  preferences: {
    // Prioritize free providers
    preferFreeProviders: true,
    
    // Max acceptable latency
    maxLatencyMs: 5000,
    
    // Provider priority order
    providerPriority: ['nvidia-nim', 'groq', 'opencode-go'],
    
    // Fallback strategy
    fallbackStrategy: 'priority',
  },
});

// Export the handler for POST requests
export const POST = handlers.chat;

// Optionally export GET for getting available models
export const GET = handlers.models.list;
