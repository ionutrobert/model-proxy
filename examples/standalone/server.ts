#!/usr/bin/env node
// ============================================================================
// Standalone Model Proxy Server Example
// ============================================================================
//
// This example shows how to use Model Proxy as a standalone Express server.
// It creates an OpenAI-compatible API that automatically selects the best
// available AI provider.
//
// Usage:
//   1. Set environment variables in .env
//   2. Run: npm start
//   3. Access: http://localhost:3000
//
// ============================================================================

import express from 'express';
import { createModelProxy } from 'model-proxy';

// ============================================================================
// Configuration
// ============================================================================

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const PROXY_API_KEY = process.env.MODEL_PROXY_API_KEY;

if (!PROXY_API_KEY) {
  console.error('❌ Error: MODEL_PROXY_API_KEY not set');
  console.error('   Generate one with: openssl rand -hex 32');
  process.exit(1);
}

// ============================================================================
// Create Model Proxy
// ============================================================================

const proxy = createModelProxy({
  providers: [
    // Primary: NVIDIA NIM (free tier, fast)
    {
      id: 'nvidia-nim',
      apiKey: process.env.NVIDIA_NIM_API_KEY!,
      preference: 'primary',
    },
    // Secondary: Groq (free tier, very fast)
    {
      id: 'groq',
      apiKey: process.env.GROQ_API_KEY!,
      preference: 'secondary',
    },
    // Fallback: OpenCode Go (premium)
    {
      id: 'opencode-go',
      apiKey: process.env.OPENCODE_API_KEY!,
      preference: 'fallback',
    },
  ],
  preferences: {
    // Prefer free providers when available
    preferFreeProviders: true,
    
    // Max acceptable latency (5 seconds)
    maxLatencyMs: 5000,
    
    // Provider priority order
    providerPriority: ['nvidia-nim', 'groq', 'opencode-go'],
    
    // Fallback strategy
    fallbackStrategy: 'priority', // or 'latency', 'cost', 'availability'
    
    // Require streaming support
    requireStreaming: false,
    
    // Minimum context window (4K tokens)
    minContextWindow: 4096,
  },
  healthCheck: {
    timeoutMs: 5000,
    cacheTtlMs: 300000, // 5 minutes
    enabled: true,
  },
});

// ============================================================================
// Express App
// ============================================================================

const app = express();

// Parse JSON bodies
app.use(express.json({ limit: '10mb' }));

// Simple health check (no auth required)
app.get('/health', (req, res) => {
  const health = proxy.getHealthStatus();
  const config = proxy.getConfig();
  
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    providers: {
      configured: config.providers.length,
      available: health.models.length,
    },
    models: {
      total: health.models.length,
    },
  });
});

// Authentication middleware
app.use((req, res, next) => {
  // Skip auth for health endpoint
  if (req.path === '/health') {
    return next();
  }
  
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
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
  
  if (apiKey !== PROXY_API_KEY) {
    res.status(401).json({
      error: {
        message: 'Invalid API key',
        type: 'authentication_error',
        code: 'invalid_api_key',
      },
    });
    return;
  }
  
  next();
});

// ============================================================================
// OpenAI-Compatible Endpoints
// ============================================================================

// List available models
app.get('/v1/models', (req, res) => {
  const models = proxy.getAvailableModels();
  
  res.json({
    object: 'list',
    data: models.map(model => ({
      id: model.id,
      object: 'model',
      created: Math.floor(Date.now() / 1000),
      owned_by: model.provider,
    })),
  });
});

// Get model details
app.get('/v1/models/:modelId', (req, res) => {
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
  });
});

// Chat completions
app.post('/v1/chat/completions', async (req, res) => {
  try {
    const request = req.body;
    
    // Check if streaming
    if (request.stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      
      await proxy.executeStreaming(
        request,
        (chunk) => {
          res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        },
        () => {
          res.write('data: [DONE]\n\n');
          res.end();
        },
        (error) => {
          res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
          res.end();
        }
      );
    } else {
      // Non-streaming
      const response = await proxy.execute(request);
      res.json(response);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal error';
    res.status(500).json({
      error: {
        message,
        type: 'server_error',
        code: 'internal_error',
      },
    });
  }
});

// Force health refresh
app.post('/health/refresh', async (req, res) => {
  try {
    await proxy.forceHealthRefresh();
    res.json({
      status: 'refreshed',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({
      error: {
        message: 'Failed to refresh health',
        type: 'server_error',
      },
    });
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: {
      message: `Route ${req.method} ${req.path} not found`,
      type: 'not_found',
      code: 'route_not_found',
    },
  });
});

// ============================================================================
// Start Server
// ============================================================================

async function startServer() {
  // Initial health check
  console.log('🔍 Performing initial health check...');
  await proxy.refreshHealth();
  
  // Start server
  app.listen(PORT, () => {
    console.log(`
🚀 Model Proxy Server running on http://${HOST}:${PORT}`);
    console.log(`📖 Health Check: http://${HOST}:${PORT}/health`);
    console.log(`🔑 Use Authorization: Bearer ${PROXY_API_KEY.substring(0, 10)}...`);
    console.log(`
📌 OpenAI-compatible endpoints:`);
    console.log(`   POST /v1/chat/completions`);
    console.log(`   GET /v1/models`);
    console.log(`   GET /v1/models/:modelId`);
    console.log(`   GET /health`);
    console.log(`   POST /health/refresh`);
    console.log(`
✅ Server is ready!\n`);
    
    // Log available models
    const health = proxy.getHealthStatus();
    if (health.models.length > 0) {
      console.log(`📊 Available Models: ${health.models.length}`);
      health.models.slice(0, 5).forEach((m, i) => {
        console.log(`   ${i + 1}. ${m.model.name} (${m.model.provider})`);
      });
    } else {
      console.log('⚠️ No models available - check provider API keys');
    }
  });
}

startServer().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
