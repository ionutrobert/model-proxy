import {
  ProviderConfig,
  ProviderId,
  ProviderPreference,
  ModelConfig,
  UserPreferences,
} from './types.js';
import { KeyPoolManager } from './key-pool.js';

// ============================================================================
// Provider Definitions
// ============================================================================

interface ProviderDefinition {
  id: ProviderId;
  name: string;
  baseUrl: string;
  apiKeyEnvVar: string;
  defaultTimeout: number;
  defaultHealthCheckTimeout: number;
  isFree: boolean;
  models: Omit<ModelConfig, 'provider'>[];
}

// Provider definitions with their configurations
const PROVIDER_DEFINITIONS: Record<string, ProviderDefinition> = {
  'nvidia-nim': {
    id: 'nvidia-nim',
    name: 'NVIDIA NIM',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    apiKeyEnvVar: 'NVIDIA_NIM_API_KEY',
    defaultTimeout: 0,
    defaultHealthCheckTimeout: 5000,
    isFree: true,
    models: [
      {
        id: 'nvidia/llama-3.1-nemotron-70b-instruct',
        name: 'Llama 3.1 Nemotron 70B',
        tier: 'S+',
        contextWindow: 128000,
        supportsStreaming: true,
        supportsFunctionCalling: true,
        description: 'NVIDIA optimized Llama model',
      },
      {
        id: 'meta/llama-3.1-405b-instruct',
        name: 'Llama 3.1 405B Instruct',
        tier: 'S+',
        contextWindow: 128000,
        supportsStreaming: true,
        supportsFunctionCalling: true,
        description: 'Largest Llama 3.1 model',
      },
      {
        id: 'meta/llama-3.1-70b-instruct',
        name: 'Llama 3.1 70B Instruct',
        tier: 'S',
        contextWindow: 128000,
        supportsStreaming: true,
        supportsFunctionCalling: true,
      },
      {
        id: 'meta/llama-3.1-8b-instruct',
        name: 'Llama 3.1 8B Instruct',
        tier: 'A+',
        contextWindow: 128000,
        supportsStreaming: true,
        supportsFunctionCalling: true,
      },
      {
        id: 'nvidia/mistral-7b-instruct',
        name: 'Mistral 7B',
        tier: 'A',
        contextWindow: 8192,
        supportsStreaming: true,
      },
      {
        id: 'nvidia/mixtral-8x7b-instruct',
        name: 'Mixtral 8x7B',
        tier: 'A+',
        contextWindow: 32768,
        supportsStreaming: true,
        supportsFunctionCalling: true,
      },
      {
        id: 'nvidia/mixtral-8x22b-instruct',
        name: 'Mixtral 8x22B',
        tier: 'S',
        contextWindow: 65536,
        supportsStreaming: true,
        supportsFunctionCalling: true,
      },
    ],
  },
  'opencode-go': {
    id: 'opencode-go',
    name: 'OpenCode Go',
    baseUrl: 'https://api.opencode.ai/v1/go',
    apiKeyEnvVar: 'OPENCODE_API_KEY',
    defaultTimeout: 0,
    defaultHealthCheckTimeout: 10000,
    isFree: false,
    models: [
      {
        id: 'opencode-go-premium',
        name: 'OpenCode Go Premium',
        tier: 'S+',
        contextWindow: 200000,
        supportsStreaming: true,
        supportsFunctionCalling: true,
        supportsVision: true,
        description: 'Premium reasoning model with extended context',
        costPer1kTokens: { input: 0.015, output: 0.075 },
      },
      {
        id: 'opencode-go-pro',
        name: 'OpenCode Go Pro',
        tier: 'S',
        contextWindow: 128000,
        supportsStreaming: true,
        supportsFunctionCalling: true,
        costPer1kTokens: { input: 0.005, output: 0.015 },
      },
      {
        id: 'opencode-go-standard',
        name: 'OpenCode Go Standard',
        tier: 'A+',
        contextWindow: 128000,
        supportsStreaming: true,
        costPer1kTokens: { input: 0.001, output: 0.003 },
      },
    ],
  },
  'opencode-zen': {
    id: 'opencode-zen',
    name: 'OpenCode Zen',
    baseUrl: 'https://api.opencode.ai/v1/zen',
    apiKeyEnvVar: 'OPENCODE_API_KEY',
    defaultTimeout: 0,
    defaultHealthCheckTimeout: 10000,
    isFree: true,
    models: [
      {
        id: 'opencode-zen-ultra',
        name: 'OpenCode Zen Ultra',
        tier: 'A',
        contextWindow: 32000,
        supportsStreaming: true,
        description: 'Fast inference model for general tasks',
      },
      {
        id: 'opencode-zen-fast',
        name: 'OpenCode Zen Fast',
        tier: 'A-',
        contextWindow: 32000,
        supportsStreaming: true,
      },
      {
        id: 'opencode-zen-balanced',
        name: 'OpenCode Zen Balanced',
        tier: 'B+',
        contextWindow: 16000,
        supportsStreaming: true,
      },
      {
        id: 'opencode-zen-light',
        name: 'OpenCode Zen Light',
        tier: 'B',
        contextWindow: 8000,
        supportsStreaming: true,
      },
    ],
  },
  'groq': {
    id: 'groq',
    name: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    apiKeyEnvVar: 'GROQ_API_KEY',
    defaultTimeout: 0,
    defaultHealthCheckTimeout: 3000,
    isFree: true,
    models: [
      {
        id: 'llama-3.1-70b-versatile',
        name: 'Llama 3.1 70B (Groq)',
        tier: 'S',
        contextWindow: 128000,
        supportsStreaming: true,
        supportsFunctionCalling: true,
      },
      {
        id: 'llama-3.1-8b-instant',
        name: 'Llama 3.1 8B Instant',
        tier: 'A+',
        contextWindow: 128000,
        supportsStreaming: true,
      },
      {
        id: 'mixtral-8x7b-32768',
        name: 'Mixtral 8x7B',
        tier: 'A+',
        contextWindow: 32768,
        supportsStreaming: true,
        supportsFunctionCalling: true,
      },
      {
        id: 'gemma2-9b-it',
        name: 'Gemma 2 9B',
        tier: 'A',
        contextWindow: 8192,
        supportsStreaming: true,
      },
      {
        id: 'gemma-7b-it',
        name: 'Gemma 7B',
        tier: 'B+',
        contextWindow: 8192,
        supportsStreaming: true,
      },
    ],
  },
  'cerebras': {
    id: 'cerebras',
    name: 'Cerebras',
    baseUrl: 'https://api.cerebras.ai/v1',
    apiKeyEnvVar: 'CEREBRAS_API_KEY',
    defaultTimeout: 0,
    defaultHealthCheckTimeout: 5000,
    isFree: false,
    models: [
      {
        id: 'llama3.1-70b',
        name: 'Llama 3.1 70B (Cerebras)',
        tier: 'S',
        contextWindow: 128000,
        supportsStreaming: true,
      },
      {
        id: 'llama3.1-8b',
        name: 'Llama 3.1 8B (Cerebras)',
        tier: 'A+',
        contextWindow: 128000,
        supportsStreaming: true,
      },
    ],
  },
  'sambanova': {
    id: 'sambanova',
    name: 'SambaNova',
    baseUrl: 'https://api.sambanova.ai/v1',
    apiKeyEnvVar: 'SAMBANOVA_API_KEY',
    defaultTimeout: 0,
    defaultHealthCheckTimeout: 5000,
    isFree: false,
    models: [
      {
        id: 'Meta-Llama-3.1-70B-Instruct',
        name: 'Llama 3.1 70B (SambaNova)',
        tier: 'S',
        contextWindow: 128000,
        supportsStreaming: true,
      },
      {
        id: 'Meta-Llama-3.1-8B-Instruct',
        name: 'Llama 3.1 8B (SambaNova)',
        tier: 'A+',
        contextWindow: 128000,
        supportsStreaming: true,
      },
    ],
  },
  'together': {
    id: 'together',
    name: 'Together AI',
    baseUrl: 'https://api.together.ai/v1',
    apiKeyEnvVar: 'TOGETHER_API_KEY',
    defaultTimeout: 0,
    defaultHealthCheckTimeout: 5000,
    isFree: false,
    models: [
      {
        id: 'meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo',
        name: 'Llama 3.1 70B Turbo',
        tier: 'S',
        contextWindow: 128000,
        supportsStreaming: true,
      },
      {
        id: 'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo',
        name: 'Llama 3.1 8B Turbo',
        tier: 'A+',
        contextWindow: 128000,
        supportsStreaming: true,
      },
    ],
  },
  'fireworks': {
    id: 'fireworks',
    name: 'Fireworks AI',
    baseUrl: 'https://api.fireworks.ai/inference/v1',
    apiKeyEnvVar: 'FIREWORKS_API_KEY',
    defaultTimeout: 0,
    defaultHealthCheckTimeout: 5000,
    isFree: false,
    models: [
      {
        id: 'accounts/fireworks/models/llama-v3p1-70b-instruct',
        name: 'Llama 3.1 70B (Fireworks)',
        tier: 'S',
        contextWindow: 128000,
        supportsStreaming: true,
      },
    ],
  },
  'hyperbolic': {
    id: 'hyperbolic',
    name: 'Hyperbolic',
    baseUrl: 'https://api.hyperbolic.ai/v1',
    apiKeyEnvVar: 'HYPERBOLIC_API_KEY',
    defaultTimeout: 0,
    defaultHealthCheckTimeout: 5000,
    isFree: false,
    models: [
      {
        id: 'meta-llama/Meta-Llama-3.1-70B-Instruct',
        name: 'Llama 3.1 70B (Hyperbolic)',
        tier: 'S',
        contextWindow: 128000,
        supportsStreaming: true,
      },
    ],
  },
  'openrouter': {
    id: 'openrouter',
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKeyEnvVar: 'OPENROUTER_API_KEY',
    defaultTimeout: 0,
    defaultHealthCheckTimeout: 5000,
    isFree: false,
    models: [
      {
        id: 'meta-llama/llama-3.1-70b-instruct',
        name: 'Llama 3.1 70B (OpenRouter)',
        tier: 'S',
        contextWindow: 128000,
        supportsStreaming: true,
      },
    ],
  },
};

// ============================================================================
// Provider Registry
// ============================================================================

export class ProviderRegistry {
  private static customProviders: Map<string, ProviderDefinition> = new Map();

  /**
   * Discover available providers from environment variables
   */
  static discoverFromEnv(preferences: UserPreferences): ProviderConfig[] {
    const providers: ProviderConfig[] = [];

    for (const [id, definition] of Object.entries(PROVIDER_DEFINITIONS)) {
      if (preferences.disabledProviders.includes(id)) {
        continue;
      }

      const keyPool = KeyPoolManager.discoverFromEnv(
        definition.id as ProviderId,
        definition.apiKeyEnvVar
      );

      if (keyPool) {
        const preference = this.getProviderPreference(id, preferences);
        if (preference !== 'disabled') {
          providers.push({
            id: definition.id,
            name: definition.name,
            baseUrl: definition.baseUrl,
            apiKey: keyPool.keys[0]?.key || '',
            keyPool,
            timeout: definition.defaultTimeout,
            healthCheckTimeout: definition.defaultHealthCheckTimeout,
            preference,
            isFree: definition.isFree,
          });
        }
      }
    }

    for (const [id, definition] of this.customProviders) {
      if (!preferences.disabledProviders.includes(id)) {
        const keyPool = KeyPoolManager.discoverFromEnv(
          definition.id as ProviderId,
          definition.apiKeyEnvVar
        );

        if (keyPool) {
          const preference = this.getProviderPreference(id, preferences);
          if (preference !== 'disabled') {
            providers.push({
              id: definition.id,
              name: definition.name,
              baseUrl: definition.baseUrl,
              apiKey: keyPool.keys[0]?.key || '',
              keyPool,
              timeout: definition.defaultTimeout,
              healthCheckTimeout: definition.defaultHealthCheckTimeout,
              preference,
              isFree: definition.isFree,
            });
          }
        }
      }
    }

    return providers;
  }

  /**
   * Create provider configuration programmatically
   */
  static createProviderConfig(
    providerId: ProviderId,
    apiKey: string,
    preference: ProviderPreference
  ): ProviderConfig | null {
    const definition = PROVIDER_DEFINITIONS[providerId] || this.customProviders.get(providerId);

    if (!definition) {
      console.warn(`Unknown provider: ${providerId}`);
      return null;
    }

    const keyPool = KeyPoolManager.discoverFromEnv(
      providerId,
      definition.apiKeyEnvVar
    );

    return {
      id: definition.id,
      name: definition.name,
      baseUrl: definition.baseUrl,
      apiKey: keyPool?.keys[0]?.key || apiKey,
      keyPool: keyPool || undefined,
      timeout: definition.defaultTimeout,
      healthCheckTimeout: definition.defaultHealthCheckTimeout,
      preference,
      isFree: definition.isFree,
    };
  }

  /**
   * Register a custom provider
   */
  static register(definition: ProviderDefinition): void {
    this.customProviders.set(definition.id, definition);
    console.log(`Registered custom provider: ${definition.name}`);
  }

  /**
   * Unregister a custom provider
   */
  static unregister(providerId: string): boolean {
    return this.customProviders.delete(providerId);
  }

  /**
   * Get all available provider definitions
   */
  static getDefinitions(): Record<string, ProviderDefinition> {
    return { ...PROVIDER_DEFINITIONS, ...Object.fromEntries(this.customProviders) };
  }

  /**
   * Get provider definition by ID
   */
  static getDefinition(providerId: string): ProviderDefinition | undefined {
    return PROVIDER_DEFINITIONS[providerId] || this.customProviders.get(providerId);
  }

  /**
   * Get models for a provider
   */
  static getModels(providerId: ProviderId): ModelConfig[] {
    const definition = this.getDefinition(providerId);
    if (!definition) return [];

    return definition.models.map(model => ({
      ...model,
      provider: providerId,
    }));
  }

  /**
   * Get all models from all configured providers
   */
  static getAllModels(providerConfigs: ProviderConfig[]): ModelConfig[] {
    const models: ModelConfig[] = [];
    
    for (const config of providerConfigs) {
      const providerModels = this.getModels(config.id);
      models.push(...providerModels);
    }

    return models;
  }

  /**
   * Get provider preference based on user configuration
   */
  private static getProviderPreference(
    providerId: string, 
    preferences: UserPreferences
  ): ProviderPreference {
    const index = preferences.providerPriority.indexOf(providerId);
    
    if (index === 0) return 'primary';
    if (index === 1) return 'secondary';
    if (index >= 2) return 'fallback';
    
    // Default based on provider type
    const definition = this.getDefinition(providerId);
    if (definition?.isFree) {
      return 'primary';
    }
    
    return 'secondary';
  }

  /**
   * List all available provider IDs
   */
  static listProviderIds(): string[] {
    return Object.keys(this.getDefinitions());
  }

  /**
   * Check if provider exists
   */
  static hasProvider(providerId: string): boolean {
    return providerId in PROVIDER_DEFINITIONS || this.customProviders.has(providerId);
  }
}

// Export provider definitions for reference
export { PROVIDER_DEFINITIONS };
