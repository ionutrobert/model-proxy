# Model Tier Classification

This document describes how models are classified into tiers and the reasoning behind each classification.

## Tier System Overview

Models are classified into tiers based on:
1. **SWE-bench score** - Performance on software engineering benchmarks
2. **Context window** - Maximum tokens the model can process
3. **Capabilities** - Function calling, vision, streaming support
4. **Parameter size** - Model scale (7B, 70B, 405B, etc.)
5. **Real-world performance** - Observed reliability and quality

---

## S+ Tier (Best in Class)

**Criteria**: SWE-bench score > 65%, or exceptional parameter size/capabilities

| Model | SWE Score | Context | Key Strengths |
|-------|-----------|---------|---------------|
| **MiniMax M2.5** | 80.2% | 200K | Highest SWE score, excellent coding |
| **GLM5** | 77.8% | 128K | Top Chinese model, great reasoning |
| **Kimi K2.5** | 76.8% | 128K | Strong reasoning, good tool support |
| **Step 3.5 Flash** | 74.4% | 256K | Large context, complex tasks |
| **MiniMax M2.1** | 74.0% | 200K | Consistent high performance |
| **GLM 4.7** | 73.8% | 200K | Large context window |
| **DeepSeek V3.1** | 73.1% | 128K | Excellent tool calling, reliable |
| **DeepSeek V3.2** | 73.1% | 128K | Improved V3.1 variant |
| **Devstral 2 123B** | 72.2% | 256K | Mistral's coding specialist |
| **Kimi K2 Thinking** | 71.3% | 256K | Extended reasoning, large context |
| **Qwen3 Coder 480B** | 70.6% | 256K | Massive scale coding model |
| **Qwen3 235B** | 70.0% | 128K | General purpose powerhouse |
| **MiniMax M2** | 69.4% | 128K | Solid baseline |
| **DeepSeek V3.1 Terminus** | 68.4% | 128K | Optimized variant |
| **Kimi K2 Instruct** | 65.8% | 128K | Instruction-tuned variant |

### Other S+ Models (Non-NVIDIA NIM)

| Model | Provider | Context | Notes |
|-------|----------|---------|-------|
| **Llama 3.1 405B** | Meta | 128K | Largest open model |
| **Llama 3.3 70B** | Meta | 128K | Optimized 70B |
| **Nemotron Ultra** | NVIDIA | 128K | NVIDIA's flagship |
| **Nemotron 70B** | NVIDIA | 128K | Optimized for efficiency |
| **Claude 3 Opus** | Anthropic | 200K | Top-tier reasoning |
| **GPT-4 Turbo** | OpenAI | 128K | Reliable, tool-native |
| **GPT-4o** | OpenAI | 128K | Multimodal, fast |
| **o1-preview** | OpenAI | 128K | Advanced reasoning |
| **o1-mini** | OpenAI | 128K | Efficient reasoning |

---

## S Tier (High Quality)

**Criteria**: SWE-bench 50-65%, or 70B+ parameters with good performance

| Model Category | Examples | Context | Notes |
|----------------|----------|---------|-------|
| **70B Models** | Llama 3.1 70B, Qwen 2.5 72B | 128K | Large but not top-tier |
| **GPT-4 Class** | GPT-4 (base) | 8K | Original GPT-4 |
| **Claude 3 Sonnet** | Anthropic | 200K | Balanced performance |
| **Gemini Pro** | Google | 32K | Good general purpose |
| **Mixtral 8x22B** | Mistral | 65K | MoE architecture |
| **Mistral Large** | Mistral | 65K | Flagship model |
| **Qwen 2.5/3** | Alibaba | 32K | General purpose |

---

## A+ Tier (Above Average)

**Criteria**: SWE-bench 40-50%, or 34B+ parameters

| Model Category | Examples | Context |
|----------------|----------|---------|
| **34B Models** | Yi 34B, CodeLlama 34B | 16K-32K |
| **Claude 3 Haiku** | Anthropic | 200K |
| **GPT-3.5 Turbo** | OpenAI | 16K |
| **Gemini Flash** | Google | 32K |
| **Mixtral 8x7B** | Mistral | 32K |

---

## A Tier (Average)

**Criteria**: 7B-14B parameters, standard performance

| Model Category | Examples | Context |
|----------------|----------|---------|
| **Llama 3 8B** | Meta | 8K |
| **Mistral 7B** | Mistral | 32K |
| **CodeLlama 7B/13B** | Meta | 16K |
| **Gemma 7B** | Google | 8K |

---

## A- Tier (Below Average)

**Criteria**: 6B parameters or smaller capable models

| Model Category | Examples | Context |
|----------------|----------|---------|
| **Gemma 7B** | Google | 8K |
| **ChatGLM 6B** | THUDM | 4K-8K |

---

## B+ Tier (Small Models)

**Criteria**: 2B-3B parameters

| Model Category | Examples | Context |
|----------------|----------|---------|
| **Gemma 2B** | Google | 8K |
| **Qwen 2.5 3B** | Alibaba | 8K |

---

## B Tier (Baseline)

Default tier for models not matching other criteria. Most smaller or unknown models fall here.

---

## Tool Calling Support

Models known to work well with function calling:

| Model | Native Support | Notes |
|-------|----------------|-------|
| DeepSeek V3.x | ✅ Yes | Excellent tool calling |
| GLM 5 / 4.7 | ✅ Yes | Good tool support |
| Qwen 3 | ✅ Yes | Strong function calling |
| Llama 3.1+ | ✅ Yes | Native support |
| Kimi K2 | ⚠️ Partial | Works but uses reasoning field |
| GPT-4 / GPT-4o | ✅ Yes | Gold standard |
| Claude 3 | ✅ Yes | Native tool use |

---

## Reasoning Models

Models that return content in the `reasoning` field:

- **Kimi K2.5** - Uses `reasoning` when `content` is null
- **Kimi K2 Thinking** - Extended reasoning output
- **DeepSeek R1** - Returns `reasoning_content` field

The proxy automatically extracts content from the `reasoning` field when `content` is null.

---

## Context Window Inference

Context windows are inferred from:
1. Explicit markers in model ID (`128k`, `200k`, etc.)
2. Model family defaults (Llama 3.1 = 128K, Claude 3 = 200K)
3. Curated model database (see `src/core/curated-models.ts`)

---

## Updating Tiers

To add or modify tier classifications:

1. Update `src/core/curated-models.ts` for the curated list
2. Update `src/core/model-discovery.ts` `estimateTier()` function
3. Update `src/core/model-discovery.ts` `inferContextWindow()` function
4. Update this documentation file

---

## Sources

- **SWE-bench scores**: From free-coding-models CLI tool
- **Context windows**: Official model documentation
- **Capabilities**: Provider API documentation and testing
