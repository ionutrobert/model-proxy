# Model Proxy

> **OpenAI-compatible model proxy with automatic provider selection, health monitoring, and intelligent fallback.**

[![Build Status](https://img.shields.io/badge/build-passing-brightgreen)]()
[![Tests](https://img.shields.io/badge/tests-36%2F36%20passing-brightgreen)]()
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue)]()
[![Node](https://img.shields.io/badge/Node-20+-green)]()
[![Docker](https://img.shields.io/badge/Docker-ready-blue)]()

A unified API proxy that aggregates multiple AI providers (NVIDIA NIM, OpenCode, Groq, etc.) with automatic model selection based on health, performance, and user preferences.

## 🚀 Quick Start

### Installation

```bash
npm install model-proxy
```

### Standalone Server (Docker)

```bash
# 1. Clone and configure
git clone <repository>
cd model-proxy
cp .env.example .env
# Edit .env with your API keys

# 2. Run with Docker Compose
docker-compose up -d

# 3. Test
curl http://localhost:3000/health
```

### Next.js Integration

```typescript
// app/api/chat/route.ts
import { createNextJsProxy } from "model-proxy/adapters/nextjs";

const { handlers } = createNextJsProxy({
  providers: [
    { id: "nvidia-nim", apiKey: process.env.NVIDIA_NIM_API_KEY! },
    { id: "groq", apiKey: process.env.GROQ_API_KEY! },
  ],
  preferences: {
    preferFreeProviders: true,
    fallbackStrategy: "priority",
  },
});

export const POST = handlers.chat;
```

---

## 📖 Table of Contents

- [Features](#-features)
- [Architecture](#-architecture)
- [Configuration](#-configuration)
- [API Reference](#-api-reference)
- [Model Selection](#-model-selection)
- [Deployment](#-deployment)
- [Providers](#-providers)
- [Troubleshooting](#-troubleshooting)

---

## ✨ Features

### 🔀 Intelligent Model Selection

- **Automatic ranking** by tier, latency, and stability
- **Task-based selection** (simple/complex/critical)
- **Fallback chain** with 3+ backup models
- **Preference-based** provider priority

### 🏥 Health Monitoring

- **Token-free health checks** (minimal cost)
- **Parallel health monitoring** across providers
- **Automatic failover** to healthy providers
- **Cached health results** (5-minute default)

### 📊 Passive Health Tracking

- **Zero extra API calls** - Health tracked from real proxy requests
- **Rolling window** - Last 20 requests per model
- **Stability scoring** - 30% p95 + 30% jitter + 20% spikes + 20% uptime
- **Adaptive thresholds** - Thinking models get 10x higher latency tolerance
- **Verdict system** - Perfect, Normal, Slow, Unstable, Overloaded, Not Active

### 🤖 Auto-Modes

- **`auto-coding`** - Best model for coding (prefers thinking models, 80k+ context)
- **`auto-fast`** - Fastest stable model (<1s latency)
- **`auto-balanced`** - Balances quality and speed

### 📈 Metrics & Monitoring

- **`/metrics`** - Prometheus-compatible metrics for Grafana/Datadog
- **`/metrics/json`** - JSON metrics for programmatic access
- **`/health`** - Enhanced with stability scores and health tracker data

### ⚡ Circuit Breaker Pattern

- **Automatic failure detection**
- **Self-healing** with half-open state
- **Configurable thresholds** (default: 5 failures)
- **Exponential backoff** reset (60s default)

### 💰 Cost Optimization

- **Prefer free providers** option
- **Cost-based sorting**
- **Tier-based filtering** (S+ to C)
- **Context window optimization**

### 🔧 Flexible Deployment

- **Standalone server** with Express
- **Next.js integration** (API routes)
- **Docker ready** with health checks
- **VPS/Coolify compatible**

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Clients                              │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐           │
│  │Next.js  │ │ Express │ │ Direct  │ │  Curl   │           │
│  └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘           │
└───────┼───────────┼───────────┼───────────┼────────────────┘
        │           │           │           │
        └───────────┴───────────┴───────────┘
                        │
        ┌───────────────┴───────────────┐
        │       Model Proxy Core         │
        │  ┌────────┐ ┌──────────┐      │
        │  │ Health │ │ Circuit  │      │
        │  │Service │ │ Breaker  │      │
        │  └───┬────┘ └────┬─────┘      │
        │      │           │             │
        │  ┌───┴───────────┴───┐         │
        │  │  Model Selector  │         │
        │  │ ┌─────┐ ┌─────┐ │         │
        │  │ │Tier │ │Cost │ │         │
        │  │ └─────┘ └─────┘ │         │
        │  └────────┬────────┘         │
        └───────────┼──────────────────┘
                    │
        ┌───────────┴───────────────────┐
        │      Provider Registry          │
        │  ┌───────┐ ┌───────┐ ┌──────┐ │
        │  │NVIDIA │ │ Groq  │ │OpenCd│ │
        │  │  NIM  │ │       │ │      │ │
        │  └───┬───┘ └───┬───┘ └──┬───┘ │
        └──────┼────────┼────────┼──────┘
               │        │        │
        ┌──────┴────────┴────────┴──────┐
        │        LLM Providers           │
        └────────────────────────────────┘
```

### Core Components

| Component            | Purpose                      | Key Features                        |
| -------------------- | ---------------------------- | ----------------------------------- |
| **ProviderRegistry** | Manages provider definitions | Auto-discovery, custom registration |
| **HealthService**    | Monitors provider health     | Token-free checks, caching          |
| **CircuitBreaker**   | Handles failures             | Open/closed/half-open states        |
| **ModelSelector**    | Ranks and selects models     | Multi-criteria scoring              |
| **ModelProxyCore**   | Main orchestrator            | Execution, fallback, streaming      |

---

## ⚙️ Configuration

### Environment Variables

```env
# Server Configuration
PORT=3000
NODE_ENV=production
MODEL_PROXY_API_KEY=your-secure-proxy-api-key

# Provider API Keys (at least one required)
NVIDIA_NIM_API_KEY=nvapi-your-key
GROQ_API_KEY=gsk-your-key
OPENCODE_API_KEY=your-key
CEREBRAS_API_KEY=your-key
SAMBANOVA_API_KEY=your-key
TOGETHER_API_KEY=your-key
FIREWORKS_API_KEY=your-key
HYPERBOLIC_API_KEY=your-key
OPENROUTER_API_KEY=your-key

# Health Check
HEALTH_CHECK_TIMEOUT_MS=5000
HEALTH_CHECK_CACHE_TTL_MS=300000

# Circuit Breaker
CIRCUIT_BREAKER_THRESHOLD=5
CIRCUIT_BREAKER_RESET_MS=60000

# Preferences
PREFER_FREE_PROVIDERS=1
PROVIDER_PRIORITY=nvidia-nim,groq
MAX_LATENCY_MS=5000
FALLBACK_STRATEGY=priority
```

### Programmatic Configuration

```typescript
import { createModelProxy } from "model-proxy";

const proxy = createModelProxy({
  providers: [
    {
      id: "nvidia-nim",
      apiKey: process.env.NVIDIA_NIM_API_KEY!,
      preference: "primary",
    },
    {
      id: "groq",
      apiKey: process.env.GROQ_API_KEY!,
      preference: "secondary",
    },
  ],
  preferences: {
    preferFreeProviders: true,
    fallbackStrategy: "priority", // or 'latency', 'cost', 'availability'
    providerPriority: ["nvidia-nim", "groq"],
    maxLatencyMs: 5000,
    requireStreaming: false,
  },
  healthCheck: {
    timeoutMs: 5000,
    cacheTtlMs: 300000,
    enabled: true,
  },
});
```

---

## 🔌 API Reference

### OpenAI-Compatible Endpoints

#### POST `/v1/chat/completions`

Chat completion with automatic model selection.

**Request:**

```json
{
  "messages": [
    { "role": "system", "content": "You are a helpful assistant." },
    { "role": "user", "content": "Hello!" }
  ],
  "temperature": 0.7,
  "max_tokens": 500,
  "stream": false
}
```

**Response:**

```json
{
  "id": "chatcmpl-123",
  "object": "chat.completion",
  "created": 1700000000,
  "model": "nvidia/llama-3.1-nemotron-70b-instruct",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "Hello! How can I help you today?"
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 10,
    "completion_tokens": 10,
    "total_tokens": 20
  }
}
```

#### GET `/v1/models`

List available models.

**Response:**

```json
{
  "object": "list",
  "data": [
    {
      "id": "nvidia/llama-3.1-nemotron-70b-instruct",
      "object": "model",
      "created": 1700000000,
      "owned_by": "nvidia-nim"
    }
  ]
}
```

#### GET `/health`

Health and status endpoint.

**Response:**

```json
{
  "status": "healthy",
  "timestamp": "2026-01-01T00:00:00Z",
  "version": "1.0.0",
  "providers": {
    "configured": 2,
    "available": 12,
    "list": [...]
  },
  "models": {
    "total": 12,
    "top": [...]
  },
  "circuit_breaker": {
    "providers": [...]
  }
}
```

### Authentication

All endpoints (except `/health`, `/metrics`) require Bearer token:

```bash
curl -H "Authorization: Bearer your-proxy-api-key" \
  http://localhost:3000/v1/chat/completions
```

### Auto-Mode Usage

Use auto-modes as the `model` parameter:

```bash
# Best model for coding tasks
curl -H "Authorization: Bearer your-key" \
  -H "Content-Type: application/json" \
  -d '{"model":"auto-coding","messages":[{"role":"user","content":"Write a function"}]}' \
  http://localhost:3000/v1/chat/completions

# Fastest stable model
curl -H "Authorization: Bearer your-key" \
  -H "Content-Type: application/json" \
  -d '{"model":"auto-fast","messages":[{"role":"user","content":"Hello"}]}' \
  http://localhost:3000/v1/chat/completions

# Balanced quality/speed
curl -H "Authorization: Bearer your-key" \
  -H "Content-Type: application/json" \
  -d '{"model":"auto-balanced","messages":[{"role":"user","content":"Explain this"}]}' \
  http://localhost:3000/v1/chat/completions
```

### Monitoring Endpoints

#### GET `/metrics`

Prometheus-compatible metrics (no auth required):

```
# HELP model_proxy_model_stability Model stability score (0-100)
# TYPE model_proxy_model_stability gauge
model_proxy_model_stability{model="z_ai_glm5",verdict="Perfect"} 95
model_proxy_model_stability{model="moonshotai_kimi_k2_5",verdict="Perfect"} 92
...
```

#### GET `/metrics/json`

JSON metrics (no auth required):

```json
{
  "timestamp": "2026-04-04T14:00:00Z",
  "models": {
    "z-ai/glm5": {
      "stability": 95,
      "verdict": "Perfect",
      "latency": { "avg": 300, "p95": 380, "jitter": 45 },
      "uptime": 98.5,
      "requests": { "total": 150, "successful": 148 }
    }
  },
  "summary": {
    "totalModels": 15,
    "avgStability": 85,
    "healthyProviders": 2,
    "perfectModels": 10,
    "unhealthyModels": 1
  }
}
```

---

## 🎯 Model Selection

### How It Works

The proxy automatically selects the best model based on:

1. **Health Status** - Only healthy providers
2. **Circuit State** - Providers with open circuits are skipped
3. **Tier Weighting** - S+ (100) > S (90) > A+ (80) > ...
4. **Latency** - Lower is better
5. **Preferences** - Primary (1.5x) > Secondary (1x) > Fallback (0.7x)
6. **Cost** - Free providers prioritized if configured

### Health-Aware Auto-Modes

The proxy supports health-aware auto-modes that use real-time stability data:

| Mode | Description | Min Tier | Min Context | Thinking |
|------|-------------|----------|-------------|----------|
| `auto-coding` | Best for coding tasks | A | 80k | ✅ Preferred |
| `auto-fast` | Fastest stable model | A- | 8k | ❌ Too slow |
| `auto-balanced` | Quality + speed balance | A- | 32k | ❌ |

**Auto-coding** prefers thinking/reasoning models (kimi-k2-thinking, deepseek-r1, qwq-32b) with adaptive latency thresholds (10x higher tolerance).

**Auto-fast** selects models with <1s average latency and high stability scores.

**Auto-balanced** combines stability score, SWE-bench score, and tier for optimal selection.

### Stability Scoring

Each model receives a stability score (0-100) based on:

- **30% P95 Latency** - 95th percentile response time
- **30% Jitter** - Latency consistency (standard deviation)
- **20% Spike Rate** - Percentage of requests >3x average latency
- **20% Uptime** - Success rate percentage

### Verdicts

| Verdict | Description | Latency Range |
|---------|-------------|---------------|
| **Perfect** | Fast and consistent | <400ms |
| **Normal** | Acceptable performance | 400-1000ms |
| **Slow** | Noticeable delay | 1000-3000ms |
| **Very Slow** | High latency | 3000-5000ms |
| **Unstable** | Errors or extreme latency | >5000ms or errors |
| **Overloaded** | Rate limited (429) | Any |
| **Not Active** | Connection failures | N/A |

*Thinking models use 10x higher thresholds (e.g., Perfect = <10s)*

### Selection Output

```
🤖 Executing chat completion (task: complex)
📊 Available models: 12
🎯 Task-based selection (complex):
✅ Selected: Llama 3.1 Nemotron 70B
   Provider: nvidia-nim
   Model ID: nvidia/llama-3.1-nemotron-70b-instruct
   Tier: S+
   Latency: 150ms
   Score: 95.5
   Context: 128,000 tokens
   Streaming: ✓
   Function calling: ✓
⛓️ Fallback chain (3 models):
   1. Llama 3.1 Nemotron 70B (150ms)
   2. Llama 3.1 70B (Groq) (100ms)
   3. Llama 3.1 405B Instruct (200ms)
```

### Task-Based Selection

```typescript
// Simple tasks: Any tier, prefer free
proxy.execute(request, { task: "simple" });

// Complex tasks: S+ to A tier
proxy.execute(request, { task: "complex" });

// Critical tasks: S+ or S tier only
proxy.execute(request, { task: "critical" });
```

### Selection Strategies

| Strategy       | Description                           |
| -------------- | ------------------------------------- |
| `priority`     | User-defined provider order (default) |
| `latency`      | Fastest response time                 |
| `cost`         | Lowest cost per token                 |
| `availability` | Provider with best health status      |

---

## 🚀 Deployment

### Docker (Recommended)

```bash
# Build
docker build -t model-proxy .

# Run
docker run -p 3000:3000 \
  -e MODEL_PROXY_API_KEY=your-key \
  -e NVIDIA_NIM_API_KEY=your-key \
  -e GROQ_API_KEY=your-key \
  model-proxy
```

### Docker Compose

```bash
# Configure
vi .env

# Start
docker-compose up -d

# View logs
docker-compose logs -f
```

### VPS Deployment (Ubuntu/Debian)

```bash
# 1. Clone repository
git clone <repository>
cd model-proxy

# 2. Install dependencies
npm install

# 3. Configure
cp .env.example .env
vi .env

# 4. Build
npm run build

# 5. Start with PM2
npm install -g pm2
pm2 start dist/standalone/server.js --name model-proxy

# 6. Save PM2 config
pm2 save
pm2 startup
```

### Coolify Deployment

1. **Connect Repository**
   - Add your repository to Coolify
   - Select "Docker Compose" deployment type

2. **Configure Environment**
   - Copy `.env.example` to Coolify environment variables
   - Add your API keys

3. **Deploy**
   - Coolify will use `docker-compose.yml` automatically
   - Health checks are pre-configured

4. **Configure Domain**
   - Add your domain in Coolify
   - SSL/TLS is automatic

---

## 🏢 Supported Providers

The proxy supports major LLM providers. Model availability varies by provider:

| Provider | Free Tier | Paid Tier |
|----------|-----------|-----------|
| **NVIDIA NIM** | ✅ | - |
| **Groq** | ✅ | - |
| **OpenCode Zen** | ✅ | - |
| **OpenCode Go** | - | ✅ |
| **Cerebras** | - | ✅ |
| **SambaNova** | - | ✅ |
| **Together AI** | - | ✅ |
| **Fireworks** | - | ✅ |
| **Hyperbolic** | - | ✅ |
| **OpenRouter** | - | ✅ |

**10 providers supported** - Check each provider's documentation for current model availability.

---

## 🔧 Troubleshooting

### No providers configured

```
Error: No providers configured. Please set at least one provider API key in .env
```

**Solution:** Add at least one API key to `.env`:

```env
NVIDIA_NIM_API_KEY=nvapi-your-key
# or
GROQ_API_KEY=gsk-your-key
```

### Health check fails

```
❌ Health check failed: HTTP 401
```

**Causes:**

- Invalid API key
- Network connectivity issues
- Provider rate limiting

**Solution:**

1. Verify API key is valid
2. Check network connectivity
3. Review provider-specific documentation

### Circuit breaker open

```
⚠️ Circuit breaker open for provider nvidia-nim
```

**Cause:** Provider has failed 5+ times

**Solution:**

1. Wait 60 seconds for automatic reset
2. Check provider status
3. Verify API key hasn't expired

### Build errors

```bash
rm -rf dist node_modules
npm install
npm run build
```

---

## 📄 License

**GNU Affero General Public License v3.0 with Additional Terms**

This software is protected under AGPLv3, which means:

- ✅ You can use, study, and modify for personal/non-commercial use
- ✅ You can share and distribute under the same license
- ⚠️ **Network use requires sharing your modifications**
- ❌ **Commercial use prohibited without a license**
- 📝 **Attribution required** - Must credit the original author

**Key Points:**

1. **Source Code Sharing**: If you modify and make available over a network, you MUST share your source code
2. **Attribution**: All uses must credit the original author and link to this repository
3. **No Commercial Use**: Commercial use requires a separate license
4. **No Warranty**: Provided "as is" without any warranty

For commercial licensing inquiries or permissions beyond this license, contact the author.

See [LICENSE](./LICENSE) file for full terms.

---

<p align="center">
  Built with ❤️
</p>
