#!/usr/bin/env node
// ============================================================================
// Model Proxy Standalone Server
// ============================================================================

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import * as crypto from 'crypto';
import { ConfigManager, getConfig } from '../core/config.js';
import { ModelProxyCore } from '../core/index.js';
import { createExpressRoutes } from '../adapters/express.js';
import { createLoggingMiddleware, createErrorMiddleware } from './middleware.js';

// Load environment variables
dotenv.config();

// ============================================================================
// Auto-generate MODEL_PROXY_API_KEY if not set
// ============================================================================
if (!process.env.MODEL_PROXY_API_KEY) {
  const generatedKey = crypto.randomBytes(32).toString('hex');
  process.env.MODEL_PROXY_API_KEY = generatedKey;
  
  console.log('');
  console.log('⚠️  ═══════════════════════════════════════════════════════');
  console.log('⚠️  MODEL_PROXY_API_KEY not set in environment');
  console.log('⚠️  Generated temporary key for this session:');
  console.log('⚠️');
  console.log(`⚠️  ${generatedKey}`);
  console.log('⚠️');
  console.log('⚠️  Save this key for future use!');
  console.log('⚠️  Set it in your environment: MODEL_PROXY_API_KEY=<key>');
  console.log('⚠️  ═══════════════════════════════════════════════════════');
  console.log('');
}

// ============================================================================
// Server Setup
// ============================================================================

const app = express();
const PORT = parseInt(process.env.PORT || '3000');
const HOST = process.env.HOST || '0.0.0.0';

// ============================================================================
// Middleware
// ============================================================================

// Security middleware
app.use(helmet({
  contentSecurityPolicy: false, // Disable for API server
  crossOriginEmbedderPolicy: false,
}));

// CORS configuration
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging
app.use(createLoggingMiddleware());

// ============================================================================
// Simple Health Check (before proxy routes - for Docker/container health checks)
// ============================================================================

app.get('/health/simple', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'model-proxy',
    version: '1.0.0',
  });
});

// ============================================================================
// Initialize Proxy
// ============================================================================

async function initializeProxy(): Promise<ModelProxyCore> {
  const configManager = ConfigManager.getInstance();
  const config = configManager.loadFromEnv();

  if (config.providers.length === 0) {
    throw new Error(
      'No providers configured. Please set at least one provider API key in .env ' +
      '(e.g., NVIDIA_NIM_API_KEY, OPENCODE_API_KEY, GROQ_API_KEY)'
    );
  }

  console.log(`Found ${config.providers.length} provider(s):`);
  for (const provider of config.providers) {
    console.log(`  - ${provider.name} (${provider.id}) [${provider.preference}]`);
  }

  const proxy = new ModelProxyCore(config);

  // Initial health check
  console.log('\nPerforming initial health check...');
  await proxy.refreshHealth();

  // Periodic health refresh
  const healthCheckInterval = setInterval(async () => {
    try {
      await proxy.refreshHealth();
    } catch (error) {
      console.error('Health check failed:', error);
    }
  }, config.healthCheck.cacheTtlMs);

  // Cleanup on exit
  process.on('SIGTERM', () => {
    clearInterval(healthCheckInterval);
  });

  process.on('SIGINT', () => {
    clearInterval(healthCheckInterval);
  });

  return proxy;
}

// ============================================================================
// Start Server
// ============================================================================

async function startServer() {
  try {
    const proxy = await initializeProxy();
    const proxyApiKey = process.env.MODEL_PROXY_API_KEY!;

    // Mount proxy routes
    app.use('/', createExpressRoutes(proxy, proxyApiKey));

    // Error handling middleware (must be last)
    app.use(createErrorMiddleware());

    // Start listening
    const server = app.listen(PORT, HOST, () => {
      console.log(`\n🚀 Model Proxy Server running on http://${HOST}:${PORT}`);
      console.log(`📖 Health Check: http://${HOST}:${PORT}/health`);
      console.log(`\n📌 OpenAI-compatible endpoints:`);
      console.log(`   POST /v1/chat/completions`);
      console.log(`   GET  /v1/models`);
      console.log(`   GET  /v1/models/:modelId`);
      console.log(`   GET  /health`);
      console.log(`   POST /health/refresh`);
      console.log(`\n✅ Server is ready!\n`);
    });

    // Graceful shutdown
    process.on('SIGTERM', () => {
      console.log('SIGTERM received. Shutting down gracefully...');
      server.close(() => {
        console.log('Server closed');
        process.exit(0);
      });
    });

    process.on('SIGINT', () => {
      console.log('SIGINT received. Shutting down gracefully...');
      server.close(() => {
        console.log('Server closed');
        process.exit(0);
      });
    });

  } catch (error) {
    console.error('\n❌ Failed to start server:');
    if (error instanceof Error) {
      console.error(`   ${error.message}`);
    } else {
      console.error(error);
    }
    process.exit(1);
  }
}

// Start the server
startServer();
