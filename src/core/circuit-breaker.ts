import { 
  ProviderHealth, 
  CircuitState, 
  ProviderId,
  HealthStatus,
} from './types.js';
import { getConfig } from './config.js';

// ============================================================================
// Circuit Breaker Pattern
// ============================================================================

export class CircuitBreaker {
  private health: Map<ProviderId, ProviderHealth> = new Map();

  /**
   * Get current circuit state for a provider
   */
  getState(providerId: ProviderId): CircuitState {
    const provider = this.health.get(providerId);
    if (!provider) return 'closed';
    
    if (provider.status === 'open') {
      const config = getConfig();
      const resetTimeout = config.preferences.circuitBreakerResetMs;
      
      // Check if enough time has passed to try again
      if (provider.lastFailure && 
          Date.now() - provider.lastFailure > resetTimeout) {
        this.health.set(providerId, {
          ...provider,
          status: 'half-open',
          consecutiveSuccesses: 0,
        });
        return 'half-open';
      }
    }
    
    return provider.status;
  }

  /**
   * Check if provider is available (circuit is not open)
   */
  isAvailable(providerId: ProviderId): boolean {
    const state = this.getState(providerId);
    return state !== 'open';
  }

  /**
   * Record a successful request
   */
  recordSuccess(providerId: ProviderId): void {
    const provider = this.health.get(providerId);
    
    if (!provider) {
      this.health.set(providerId, {
        providerId,
        status: 'closed',
        failureCount: 0,
        lastSuccess: Date.now(),
        consecutiveSuccesses: 1,
      });
      return;
    }

    const consecutiveSuccesses = provider.consecutiveSuccesses + 1;

    if (provider.status === 'half-open') {
      // Two consecutive successes needed to close circuit
      if (consecutiveSuccesses >= 2) {
        this.health.set(providerId, {
          ...provider,
          status: 'closed',
          failureCount: 0,
          consecutiveSuccesses,
          lastSuccess: Date.now(),
        });
      } else {
        this.health.set(providerId, {
          ...provider,
          consecutiveSuccesses,
          lastSuccess: Date.now(),
        });
      }
    } else {
      this.health.set(providerId, {
        ...provider,
        failureCount: 0,
        consecutiveSuccesses,
        lastSuccess: Date.now(),
      });
    }
  }

  /**
   * Record a failed request
   */
  recordFailure(providerId: ProviderId, error: string): void {
    const provider = this.health.get(providerId);
    const now = Date.now();
    const config = getConfig();
    const threshold = config.preferences.circuitBreakerThreshold;

    if (!provider) {
      this.health.set(providerId, {
        providerId,
        status: 'closed',
        failureCount: 1,
        lastFailure: now,
        consecutiveSuccesses: 0,
      });
      return;
    }

    const newFailureCount = provider.failureCount + 1;
    
    // If in half-open state, any failure reopens circuit
    if (provider.status === 'half-open') {
      this.health.set(providerId, {
        ...provider,
        status: 'open',
        failureCount: newFailureCount,
        lastFailure: now,
        consecutiveSuccesses: 0,
      });
      return;
    }

    // Otherwise check if threshold reached
    const newStatus: CircuitState = newFailureCount >= threshold ? 'open' : provider.status;

    this.health.set(providerId, {
      ...provider,
      status: newStatus,
      failureCount: newFailureCount,
      lastFailure: now,
      consecutiveSuccesses: 0,
    });
  }

  /**
   * Manually trip the circuit (open it)
   */
  trip(providerId: ProviderId): void {
    const provider = this.health.get(providerId);
    const now = Date.now();

    if (!provider) {
      this.health.set(providerId, {
        providerId,
        status: 'open',
        failureCount: 1,
        lastFailure: now,
        consecutiveSuccesses: 0,
      });
      return;
    }

    this.health.set(providerId, {
      ...provider,
      status: 'open',
      failureCount: provider.failureCount + 1,
      lastFailure: now,
      consecutiveSuccesses: 0,
    });
  }

  /**
   * Manually reset the circuit (close it)
   */
  reset(providerId: ProviderId): void {
    const provider = this.health.get(providerId);
    
    if (!provider) {
      this.health.set(providerId, {
        providerId,
        status: 'closed',
        failureCount: 0,
        consecutiveSuccesses: 0,
      });
      return;
    }

    this.health.set(providerId, {
      ...provider,
      status: 'closed',
      failureCount: 0,
      consecutiveSuccesses: 0,
    });
  }

  /**
   * Get health status for all providers
   */
  getHealthStatus(): ProviderHealth[] {
    return Array.from(this.health.values());
  }

  /**
   * Get health status for a specific provider
   */
  getProviderHealth(providerId: ProviderId): ProviderHealth | undefined {
    return this.health.get(providerId);
  }

  /**
   * Remove a provider from tracking
   */
  removeProvider(providerId: ProviderId): void {
    this.health.delete(providerId);
  }

  /**
   * Get statistics summary
   */
  getStats(): {
    total: number;
    closed: number;
    halfOpen: number;
    open: number;
    healthy: number;
    unhealthy: number;
  } {
    const providers = Array.from(this.health.values());
    return {
      total: providers.length,
      closed: providers.filter(p => p.status === 'closed').length,
      halfOpen: providers.filter(p => p.status === 'half-open').length,
      open: providers.filter(p => p.status === 'open').length,
      healthy: providers.filter(p => p.status === 'closed' && p.failureCount === 0).length,
      unhealthy: providers.filter(p => p.status !== 'closed' || p.failureCount > 0).length,
    };
  }
}

// Global circuit breaker instance
export const circuitBreaker = new CircuitBreaker();

// ============================================================================
// Health Status Helpers
// ============================================================================

export function isHealthy(health: HealthStatus): boolean {
  return health === 'healthy';
}

export function isAvailable(providerId: ProviderId): boolean {
  return circuitBreaker.isAvailable(providerId);
}

export function recordSuccess(providerId: ProviderId): void {
  circuitBreaker.recordSuccess(providerId);
}

export function recordFailure(providerId: ProviderId, error: string): void {
  circuitBreaker.recordFailure(providerId, error);
}
