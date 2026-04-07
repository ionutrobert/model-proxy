# Model Proxy

> Your own OpenAI-compatible API with automatic model selection, health monitoring, and intelligent fallback.

[![Status](https://img.shields.io/badge/status-production%20ready-brightgreen)]()
[![Tests](https://img.shields.io/badge/tests-14%2F14%20passing-brightgreen)]()
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue)]()
[![License](https://img.shields.io/badge/license-AGPLv3-blue)]()

---

## What is this?

Model Proxy lets you host your own OpenAI-compatible API that automatically picks the best AI model for each request. You connect multiple providers (like NVIDIA NIM, Groq, etc.), and the proxy handles:

- **Automatic model selection** - Picks the fastest/healthiest model
- **Fallback chains** - If one model fails, tries the next
- **Health tracking** - Learns from real requests which models work best
- **Empty content detection** - Automatically retries when models return nothing
- **Verification loops** - For complex tasks, verifies output before returning

## Why Use This?

Host your own OpenAI-compatible API that unifies multiple AI providers:

1. Connect any OpenAI-compatible provider (NVIDIA NIM, Groq, OpenRouter, etc.)
2. Point your apps to a single endpoint
3. The proxy automatically selects the best available model
4. If one model fails, it falls back to another

Works with any tool that expects OpenAI's API format.

---

## Current Test Results

**All 14 tests passing** (as of April 7, 2026)

| Test | Status | Notes |
|------|:------:|-------|
| Explicit Model Selection | ✅ | `deepseek-v3.1`, `deepseek-v3.2`, `deepseek-r1-distill-llama-8b` |
| Auto Selection Modes | ✅ | `auto`, `auto-best`, `auto-fast` |
| Multi-turn Conversation | ✅ | Remembers context across messages |
| System Prompt Adherence | ✅ | Follows system instructions |
| Function Calling | ✅ | Returns proper `tool_calls` response |
| Streaming Response | ✅ | SSE streaming with content + reasoning |
| Concurrent Requests | ✅ | 5 simultaneous requests, all succeeded |
| Verification Loop | ✅ | `#loop` trigger for complex tasks |
| Long Context | ✅ | Handles 500+ prompt tokens |
| Error Handling | ✅ | Invalid models fallback gracefully |

---

## Quick Start

### Docker (Recommended)

```bash
# Clone and configure
git clone https://github.com/ionutrobert/model-proxy.git
cd model-proxy
cp .env.example .env

# Edit .env with your API keys
nano .env

# Run
docker-compose up -d
```

### Test it works

```bash
curl http://localhost:3000/health
```

### Use it like OpenAI

```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer your-proxy-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "auto",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

---

## Features

### Auto Modes

Use these as the `model` parameter:

| Mode | What it does |
|------|--------------|
| `auto` | Best overall model based on health & performance |
| `auto-best` | Highest quality model available |
| `auto-fast` | Fastest responding model |
| `auto-coding` | Best for coding tasks (prefers thinking models) |
| `auto-balanced` | Balance between quality and speed |

### Intelligent Fallback

When a model fails or returns empty content:

1. **Detects the failure** - Empty responses are treated as failures
2. **Tries next model** - Falls back through the chain
3. **Tracks health** - Unhealthy models get deprioritized
4. **Self-healing** - Models recover after successful requests

### Health Tracking

The proxy learns from every request:

- **Stability score** (0-100) based on latency, errors, uptime
- **Verdicts**: Perfect, Normal, Slow, Unstable, Overloaded
- **Automatic exclusion** of consistently failing models

---

## Supported Providers

| Provider | Free? | Notes |
|----------|:-----:|-------|
| NVIDIA NIM | ✅ | Primary free provider |
| Groq | ✅ | Fast inference |
| OpenCode Zen | ✅ | Free tier |
| Cerebras | ❌ | Paid |
| SambaNova | ❌ | Paid |
| Together AI | ❌ | Paid |
| Fireworks | ❌ | Paid |
| OpenRouter | ❌ | Aggregator |

---

## Configuration

### Environment Variables

```env
# Required: Your proxy API key (for clients to authenticate)
MODEL_PROXY_API_KEY=your-secure-key

# Provider API keys (at least one required)
NVIDIA_NIM_API_KEY=nvapi-xxx
GROQ_API_KEY=gsk-xxx

# Optional preferences
PREFER_FREE_PROVIDERS=true
MAX_LATENCY_MS=5000
```

### Programmatic Usage

```typescript
import { createNextJsProxy } from "model-proxy/adapters/nextjs";

const { handlers } = createNextJsProxy({
  providers: [
    { id: "nvidia-nim", apiKey: process.env.NVIDIA_NIM_API_KEY },
    { id: "groq", apiKey: process.env.GROQ_API_KEY },
  ],
  preferences: {
    preferFreeProviders: true,
    fallbackStrategy: "priority",
  },
});

export const POST = handlers.chat;
```

---

## Monitoring

### Health Endpoint

```bash
curl http://localhost:3000/health
```

Returns provider status, model stability scores, and circuit breaker state.

### Metrics Endpoint

```bash
curl http://localhost:3000/metrics
```

Prometheus-compatible metrics for Grafana/Datadog.

---

## API Reference

All endpoints are OpenAI-compatible:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/chat/completions` | POST | Chat completion |
| `/v1/models` | GET | List available models |
| `/health` | GET | Health status |
| `/metrics` | GET | Prometheus metrics |

### Authentication

```bash
Authorization: Bearer your-proxy-api-key
```

---

---

## License

**GNU Affero General Public License v3.0**

- ✅ Free for personal/non-commercial use
- ✅ Modify and share (under same license)
- ❌ Commercial use requires a license
- 📝 Attribution required

See [LICENSE](./LICENSE) for details.

---

## Contributing

Contributions welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Add tests for new features
4. Submit a pull request

---

<p align="center">
Built with &lt;3
</p>
