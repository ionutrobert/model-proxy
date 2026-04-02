import { 
  ProxyConfig, 
  UserPreferences, 
  ProviderConfig, 
  ProviderPreference,
  defaultPreferences,
  ProviderId,
} from './types.js';
import { ProviderRegistry } from './provider-registry.js';

// ============================================================================
// Configuration Management
// ============================================================================

export class ConfigManager {
  private static instance: ConfigManager;
  private config: ProxyConfig | null = null;

  static getInstance(): ConfigManager {
    if (!ConfigManager.instance) {
      ConfigManager.instance = new ConfigManager();
    }
    return ConfigManager.instance;
  }

  /**
   * Load configuration from environment variables
   */
  loadFromEnv(): ProxyConfig {
    const preferences = this.loadPreferencesFromEnv();
    const providers = ProviderRegistry.discoverFromEnv(preferences);

    this.config = {
      providers,
      preferences,
      healthCheck: {
        timeoutMs: parseInt(process.env.HEALTH_CHECK_TIMEOUT_MS || '5000'),
        cacheTtlMs: parseInt(process.env.HEALTH_CHECK_CACHE_TTL_MS || '300000'),
        enabled: true,
      },
    };

    return this.config;
  }

  /**
   * Load configuration programmatically
   */
  loadFromConfig(
    input: {
      providers: Array<{
        id: ProviderId;
        apiKey: string;
        preference?: ProviderPreference;
      }>;
      preferences?: Partial<UserPreferences>;
      healthCheck?: {
        timeoutMs?: number;
        cacheTtlMs?: number;
        enabled?: boolean;
      };
    }
  ): ProxyConfig {
    const preferences: UserPreferences = {
      ...defaultPreferences,
      ...input.preferences,
    };

    const providers: ProviderConfig[] = input.providers.map(p =>
      ProviderRegistry.createProviderConfig(p.id, p.apiKey, p.preference || 'secondary')
    ).filter((p): p is ProviderConfig => p !== null);

    this.config = {
      providers,
      preferences,
      healthCheck: {
        timeoutMs: input.healthCheck?.timeoutMs || 5000,
        cacheTtlMs: input.healthCheck?.cacheTtlMs || 300000,
        enabled: input.healthCheck?.enabled ?? true,
      },
    };

    return this.config;
  }

  /**
   * Get current configuration
   */
  getConfig(): ProxyConfig {
    if (!this.config) {
      return this.loadFromEnv();
    }
    return this.config;
  }

  /**
   * Update configuration
   */
  updateConfig(updates: Partial<ProxyConfig>): void {
    if (!this.config) {
      throw new Error('Configuration not loaded');
    }
    this.config = { ...this.config, ...updates };
  }

  /**
   * Update preferences
   */
  updatePreferences(preferences: Partial<UserPreferences>): void {
    if (!this.config) {
      throw new Error('Configuration not loaded');
    }
    this.config.preferences = { ...this.config.preferences, ...preferences };
  }

  /**
   * Add a provider at runtime
   */
  addProvider(
    providerId: ProviderId, 
    apiKey: string, 
    preference: ProviderPreference = 'secondary'
  ): void {
    if (!this.config) {
      throw new Error('Configuration not loaded');
    }

    const providerConfig = ProviderRegistry.createProviderConfig(providerId, apiKey, preference);
    if (providerConfig) {
      // Remove existing provider with same ID
      this.config.providers = this.config.providers.filter(p => p.id !== providerId);
      this.config.providers.push(providerConfig);
    }
  }

  /**
   * Remove a provider at runtime
   */
  removeProvider(providerId: ProviderId): void {
    if (!this.config) {
      throw new Error('Configuration not loaded');
    }
    this.config.providers = this.config.providers.filter(p => p.id !== providerId);
    this.config.preferences.disabledProviders.push(providerId);
  }

  /**
   * Enable a provider
   */
  enableProvider(providerId: ProviderId): void {
    if (!this.config) {
      throw new Error('Configuration not loaded');
    }
    this.config.preferences.disabledProviders = 
      this.config.preferences.disabledProviders.filter(id => id !== providerId);
  }

  /**
   * Disable a provider
   */
  disableProvider(providerId: ProviderId): void {
    if (!this.config) {
      throw new Error('Configuration not loaded');
    }
    if (!this.config.preferences.disabledProviders.includes(providerId)) {
      this.config.preferences.disabledProviders.push(providerId);
    }
  }

  /**
   * Set provider priority
   */
  setProviderPriority(priority: ProviderId[]): void {
    if (!this.config) {
      throw new Error('Configuration not loaded');
    }
    this.config.preferences.providerPriority = priority;
  }

  private loadPreferencesFromEnv(): UserPreferences {
    const parseArray = (value: string | undefined): string[] => {
      if (!value) return [];
      return value.split(',').map(s => s.trim()).filter(Boolean);
    };

    const parseBool = (value: string | undefined, defaultValue: boolean): boolean => {
      if (value === undefined) return defaultValue;
      return value === '1' || value.toLowerCase() === 'true';
    };

    return {
      preferFreeProviders: parseBool(process.env.PREFER_FREE_PROVIDERS, defaultPreferences.preferFreeProviders),
      maxLatencyMs: parseInt(process.env.MAX_LATENCY_MS || String(defaultPreferences.maxLatencyMs)),
      requireStreaming: parseBool(process.env.REQUIRE_STREAMING, defaultPreferences.requireStreaming),
      requireFunctionCalling: parseBool(process.env.REQUIRE_FUNCTION_CALLING, defaultPreferences.requireFunctionCalling),
      providerPriority: parseArray(process.env.PROVIDER_PRIORITY) as ProviderId[],
      disabledProviders: [],
      fallbackStrategy: (process.env.FALLBACK_STRATEGY as UserPreferences['fallbackStrategy']) || defaultPreferences.fallbackStrategy,
      minContextWindow: parseInt(process.env.MIN_CONTEXT_WINDOW || String(defaultPreferences.minContextWindow)),
      preferredTiers: (parseArray(process.env.PREFERRED_TIERS).length > 0 ? parseArray(process.env.PREFERRED_TIERS) : defaultPreferences.preferredTiers) as UserPreferences['preferredTiers'],
      circuitBreakerThreshold: parseInt(process.env.CIRCUIT_BREAKER_THRESHOLD || String(defaultPreferences.circuitBreakerThreshold)),
      circuitBreakerResetMs: parseInt(process.env.CIRCUIT_BREAKER_RESET_MS || String(defaultPreferences.circuitBreakerResetMs)),
    };
  }
}

// Convenience function for quick setup
export function createProxyConfig(
  providers: Array<{
    id: ProviderId;
    apiKey: string;
    preference?: ProviderPreference;
  }>,
  preferences?: Partial<UserPreferences>
): ProxyConfig {
  const manager = ConfigManager.getInstance();
  const safePreferences = preferences ? { ...preferences } as UserPreferences : undefined;
  return manager.loadFromConfig({
    providers,
    preferences: safePreferences,
  });
}

// Get global config instance
export function getConfig(): ProxyConfig {
  return ConfigManager.getInstance().getConfig();
}
