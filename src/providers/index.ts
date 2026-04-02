// ============================================================================
// Provider Exports
// ============================================================================

export { BaseProvider } from './base.js';
export { NvidiaNimProvider } from './nvidia-nim.js';
export { OpenCodeGoProvider, OpenCodeZenProvider } from './opencode-go.js';
export { GroqProvider } from './groq.js';

// ============================================================================
// Provider Factory
// ============================================================================

import { ProviderConfig } from '../core/types.js';
import { BaseProvider } from './base.js';
import { NvidiaNimProvider } from './nvidia-nim.js';
import { OpenCodeGoProvider, OpenCodeZenProvider } from './opencode-go.js';
import { GroqProvider } from './groq.js';

/**
 * Create provider instance from configuration
 */
export function createProvider(config: ProviderConfig): BaseProvider {
  switch (config.id) {
    case 'nvidia-nim':
      return new NvidiaNimProvider(config);
    
    case 'opencode-go':
      return new OpenCodeGoProvider(config);
    
    case 'opencode-zen':
      return new OpenCodeZenProvider(config);
    
    case 'groq':
      return new GroqProvider(config);
    
    default:
      // For unimplemented providers, use a generic provider
      console.warn(`Provider ${config.id} not implemented, using generic provider`);
      return new NvidiaNimProvider(config);
  }
}

/**
 * Get provider class by ID
 */
export function getProviderClass(id: string): typeof BaseProvider | null {
  switch (id) {
    case 'nvidia-nim':
      return NvidiaNimProvider;
    case 'opencode-go':
      return OpenCodeGoProvider;
    case 'opencode-zen':
      return OpenCodeZenProvider;
    case 'groq':
      return GroqProvider;
    default:
      return null;
  }
}

/**
 * Check if provider is implemented
 */
export function isProviderImplemented(id: string): boolean {
  return ['nvidia-nim', 'opencode-go', 'opencode-zen', 'groq'].includes(id);
}

/**
 * List all implemented providers
 */
export function listImplementedProviders(): string[] {
  return ['nvidia-nim', 'opencode-go', 'opencode-zen', 'groq'];
}
