import { ProviderConfig, ModelConfig, ProviderId } from './types.js';

export interface DiscoveredModel {
  id: string;
  name: string;
  context_window?: number;
  max_output_tokens?: number;
  supports_streaming?: boolean;
  supports_function_calling?: boolean;
  supports_vision?: boolean;
  supports_tools?: boolean;
  owned_by?: string;
  description?: string;
  pricing?: {
    prompt?: number;
    completion?: number;
  };
}

export interface ModelDiscoveryResult {
  providerId: ProviderId;
  models: DiscoveredModel[];
  timestamp: number;
  error?: string;
}

export class ModelDiscovery {
  private cache: Map<ProviderId, ModelDiscoveryResult> = new Map();
  private cacheTtlMs: number = 3600000;

  setCacheTtl(ttlMs: number): void {
    this.cacheTtlMs = ttlMs;
  }

  async discoverProviderModels(provider: ProviderConfig): Promise<ModelDiscoveryResult> {
    const cached = this.cache.get(provider.id);
    if (cached && Date.now() - cached.timestamp < this.cacheTtlMs) {
      console.log(`[DISCOVERY] Using cached models for ${provider.id}`);
      return cached;
    }

    console.log(`[DISCOVERY] Fetching models from ${provider.name} (${provider.id})...`);

    try {
      const response = await fetch(`${provider.baseUrl}/models`, {
        headers: {
          'Authorization': `Bearer ${provider.apiKey}`,
          ...provider.headers,
        },
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      const models: DiscoveredModel[] = (data.data || []).map((m: any) => this.parseModel(m));

      const result: ModelDiscoveryResult = {
        providerId: provider.id,
        models,
        timestamp: Date.now(),
      };

      this.cache.set(provider.id, result);
      console.log(`[DISCOVERY] ✓ Found ${models.length} models from ${provider.name}`);

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[DISCOVERY] ✗ Failed to discover models from ${provider.name}:`, errorMessage);

      return {
        providerId: provider.id,
        models: [],
        timestamp: Date.now(),
        error: errorMessage,
      };
    }
  }

  async discoverAllProviders(providers: ProviderConfig[]): Promise<Map<ProviderId, ModelDiscoveryResult>> {
    const results = new Map<ProviderId, ModelDiscoveryResult>();

    const discoveries = providers.map(async (provider) => {
      const result = await this.discoverProviderModels(provider);
      results.set(provider.id, result);
    });

    await Promise.allSettled(discoveries);
    return results;
  }

  private parseModel(rawModel: any): DiscoveredModel {
    const model: DiscoveredModel = {
      id: rawModel.id || rawModel.name || '',
      name: rawModel.name || rawModel.id || '',
      owned_by: rawModel.owned_by || rawModel.owned_by || 'unknown',
    };

    if (rawModel.context_window !== undefined) {
      model.context_window = rawModel.context_window;
    } else if (rawModel.context_length !== undefined) {
      model.context_window = rawModel.context_length;
    } else if (rawModel.max_context_tokens !== undefined) {
      model.context_window = rawModel.max_context_tokens;
    }

    if (rawModel.max_output_tokens !== undefined) {
      model.max_output_tokens = rawModel.max_output_tokens;
    } else if (rawModel.max_tokens !== undefined) {
      model.max_output_tokens = rawModel.max_tokens;
    }

    if (rawModel.supports_streaming !== undefined) {
      model.supports_streaming = rawModel.supports_streaming;
    } else if (rawModel.streaming !== undefined) {
      model.supports_streaming = rawModel.streaming;
    } else {
      model.supports_streaming = true;
    }

    if (rawModel.supports_function_calling !== undefined) {
      model.supports_function_calling = rawModel.supports_function_calling;
    } else if (rawModel.supports_tools !== undefined) {
      model.supports_function_calling = rawModel.supports_tools;
    } else if (rawModel.tool_choice !== undefined) {
      model.supports_function_calling = true;
    }

    if (rawModel.supports_vision !== undefined) {
      model.supports_vision = rawModel.supports_vision;
    } else if (rawModel.vision !== undefined) {
      model.supports_vision = rawModel.vision;
    } else if (rawModel.multimodal !== undefined) {
      model.supports_vision = rawModel.multimodal;
    }

    if (rawModel.pricing) {
      model.pricing = {
        prompt: rawModel.pricing.prompt || rawModel.pricing.input,
        completion: rawModel.pricing.completion || rawModel.pricing.output,
      };
    }

    if (rawModel.description) {
      model.description = rawModel.description;
    }

    return model;
  }

  invalidateCache(providerId?: ProviderId): void {
    if (providerId) {
      this.cache.delete(providerId);
    } else {
      this.cache.clear();
    }
  }

  getCachedModels(providerId: ProviderId): DiscoveredModel[] | null {
    const cached = this.cache.get(providerId);
    if (!cached || Date.now() - cached.timestamp >= this.cacheTtlMs) {
      return null;
    }
    return cached.models;
  }

  inferContextWindow(modelId: string): number {
    const id = modelId.toLowerCase();

    // Explicit context markers
    if (id.includes('256k') || id.includes('256000')) return 256000;
    if (id.includes('200k') || id.includes('200000')) return 200000;
    if (id.includes('128k') || id.includes('128000')) return 128000;
    if (id.includes('100k') || id.includes('100000')) return 100000;
    if (id.includes('64k') || id.includes('65536')) return 65536;
    if (id.includes('32k') || id.includes('32768')) return 32768;
    if (id.includes('16k') || id.includes('16384')) return 16384;
    if (id.includes('8k') || id.includes('8192')) return 8192;
    if (id.includes('4k') || id.includes('4096')) return 4096;

    // S+ tier models (synced with curated-models.ts)
    // DeepSeek
    if (id.includes('deepseek-v3') || id.includes('deepseek-r1')) return 128000;
    
    // Kimi
    if (id.includes('kimi-k2-thinking')) return 256000;
    if (id.includes('kimi-k2')) return 128000;
    
    // GLM
    if (id.includes('glm4.7') || id.includes('glm-4.7')) return 200000;
    if (id.includes('glm5') || id.includes('glm-5')) return 128000;
    
    // MiniMax
    if (id.includes('minimax-m2.5') || id.includes('minimax-m2.1')) return 200000;
    if (id.includes('minimax-m2')) return 128000;
    
    // Qwen
    if (id.includes('qwen3-coder') || id.includes('qwen3-480b')) return 256000;
    if (id.includes('qwen3-235b')) return 128000;
    
    // Other S+ models
    if (id.includes('step-3.5')) return 256000;
    if (id.includes('devstral')) return 256000;
    
    // Llama
    if (id.includes('llama-3.1') || id.includes('llama3.1') || id.includes('llama-3.3')) return 128000;
    if (id.includes('llama-3') || id.includes('llama3')) return 8192;
    
    // OpenAI
    if (id.includes('gpt-4') || id.includes('gpt4')) {
      if (id.includes('turbo') || id.includes('1106') || id.includes('0125')) return 128000;
      return 8192;
    }
    if (id.includes('gpt-3.5') || id.includes('gpt35')) return 16384;
    
    // Anthropic
    if (id.includes('claude-3') || id.includes('claude3')) return 200000;
    if (id.includes('claude-2') || id.includes('claude2')) return 100000;
    
    // Mistral
    if (id.includes('mistral-large') || id.includes('mixtral-8x22')) return 65536;
    if (id.includes('mixtral') || id.includes('mistral')) return 32768;
    
    // Google
    if (id.includes('gemini')) return 32000;
    
    // Qwen general
    if (id.includes('qwen3') || id.includes('qwen2.5') || id.includes('qwen-2.5')) return 32768;
    
    // NVIDIA
    if (id.includes('nemotron')) return 128000;

    return 8192;
  }

  inferCapabilities(modelId: string): { streaming: boolean; functionCalling: boolean; vision: boolean } {
    const id = modelId.toLowerCase();

    const streaming = true;

    let functionCalling = true;

    let vision = false;
    if (id.includes('vision') || id.includes('gpt-4-vision') || id.includes('gpt-4-turbo') ||
        id.includes('claude-3') || id.includes('gemini') || id.includes('llava')) {
      vision = true;
    }

    return { streaming, functionCalling, vision };
  }

  estimateTier(modelId: string): 'S+' | 'S' | 'A+' | 'A' | 'A-' | 'B+' | 'B' | 'C' {
    const id = modelId.toLowerCase();

    // S+ tier - Premium/large models (synced with curated-models.ts)
    if (
      // DeepSeek models
      id.includes('deepseek-v3') || id.includes('deepseek-r1') ||
      // Kimi models
      id.includes('kimi-k2') || id.includes('moonshotai/kimi') ||
      // GLM models
      id.includes('glm5') || id.includes('glm-5') || id.includes('glm4.7') || id.includes('glm-4.7') ||
      // MiniMax models
      id.includes('minimax-m2.5') || id.includes('minimax-m2.1') || id.includes('minimax-m2') ||
      // Qwen models
      id.includes('qwen3-coder') || id.includes('qwen3-480b') || id.includes('qwen3-235b') ||
      // Other premium
      id.includes('step-3.5') || id.includes('devstral') ||
      // Large parameter models
      id.includes('405b') || id.includes('llama-3.1-405b') || id.includes('llama-3.3-70b') ||
      id.includes('nemotron-ultra') || id.includes('nemotron-70b') ||
      // OpenAI/Anthropic/Google top tier
      id.includes('o1-preview') || id.includes('o1-mini') ||
      id.includes('claude-3-opus') || id.includes('gpt-4-turbo') || id.includes('gpt-4o') ||
      id.includes('gemini-ultra')
    ) {
      return 'S+';
    }

    // S tier - High quality models
    if (
      id.includes('70b') || id.includes('72b') ||
      id.includes('gpt-4') || id.includes('claude-3-sonnet') || id.includes('gemini-pro') ||
      id.includes('mixtral-8x22') || id.includes('mistral-large') ||
      id.includes('qwen3') || id.includes('qwen2.5') || id.includes('qwen-2.5')
    ) {
      return 'S';
    }

    // A+ tier
    if (id.includes('34b') || id.includes('mixtral-8x7') ||
        id.includes('claude-3-haiku') || id.includes('gpt-3.5-turbo') || id.includes('gemini-flash')) {
      return 'A+';
    }

    // A tier
    if (id.includes('13b') || id.includes('14b') || id.includes('7b') || id.includes('8b') ||
        id.includes('mistral-7b') || id.includes('llama-3-8') || id.includes('llama3-8')) {
      return 'A';
    }

    // A- tier
    if (id.includes('6b') || id.includes('gemma-7')) {
      return 'A-';
    }

    // B+ tier
    if (id.includes('2b') || id.includes('3b') || id.includes('gemma-2')) {
      return 'B+';
    }

    return 'B';
  }
}

export const modelDiscovery = new ModelDiscovery();
