// ============================================================================
// Model Health Verifier - Active model verification via real requests
// Based on free-coding-models approach: ping each model with actual requests
// ============================================================================

import type { ProviderId, Verdict, ModelConfig } from './types.js';
import { healthTracker } from './health-tracker.js';

// Constants from free-coding-models
const PING_TIMEOUT_MS = 15000; // 15 seconds per request
const PING_INTERVAL_MS = 10000; // 10 seconds between pings (steady state)
const BURST_INTERVAL_MS = 2000; // 2 seconds (burst mode for new models)
const IDLE_INTERVAL_MS = 30000; // 30 seconds (idle mode for stable models)

// Unhealthy thresholds
const MAX_CONSECUTIVE_FAILURES = 3;
const UNHEALTHY_WINDOW_MS = 60000; // If last failure within 60s, consider unhealthy

export interface ModelVerificationStatus {
  modelId: string;
  providerId: ProviderId;
  isVerified: boolean;
  lastVerification: number | null;
  lastSuccess: number | null;
  lastFailure: number | null;
  consecutiveFailures: number;
  totalPings: number;
  successfulPings: number;
  verdict: Verdict;
  stabilityScore: number;
  status: 'verified' | 'pending' | 'unverified' | 'unhealthy';
}

interface PingRequest {
  model: string;
  messages: Array<{ role: 'user'; content: string }>;
  max_tokens: number;
  stream: boolean;
}

interface VerificationResult {
  success: boolean;
  statusCode: number | string;
  latency: number;
  error?: string;
}

export class ModelHealthVerifier {
  private verificationStatus = new Map<string, ModelVerificationStatus>();
  private activeVerifications = new Map<string, Promise<void>>();
  private intervalTimers = new Map<string, NodeJS.Timeout>();
  private baseUrl: string | null = null;
  private apiKey: string | null = null;

  setConfig(baseUrl: string, apiKey: string): void {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
  }

  buildPingRequest(modelId: string): PingRequest {
    return {
      model: modelId,
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 1,
      stream: false,
    };
  }

  async pingModel(
    modelId: string,
    providerConfig?: { baseUrl: string; apiKey: string }
  ): Promise<VerificationResult> {
    // Provider baseUrl already includes /v1, so just append /chat/completions
    const url = providerConfig
      ? `${providerConfig.baseUrl}/chat/completions`
      : this.baseUrl
        ? `${this.baseUrl}/chat/completions`
        : null;

    const apiKey = providerConfig?.apiKey ?? this.apiKey;

    if (!url || !apiKey) {
      return {
        success: false,
        statusCode: 'ERR',
        latency: 0,
        error: 'No endpoint configuration',
      };
    }

    const request = this.buildPingRequest(modelId);
    const startTime = performance.now();

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), PING_TIMEOUT_MS);

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      const latency = Math.round(performance.now() - startTime);

      // Per free-coding-models: even 401 counts as "up" because endpoint responded
      if (response.ok || response.status === 401 || response.status === 403) {
        return {
          success: true,
          statusCode: response.status,
          latency,
        };
      }

      const errorBody = await response.text().catch(() => 'Unknown error');
      return {
        success: false,
        statusCode: response.status,
        latency,
        error: `HTTP ${response.status}: ${errorBody.slice(0, 200)}`,
      };
    } catch (error) {
      const latency = Math.round(performance.now() - startTime);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      if (errorMessage.includes('abort') || errorMessage.includes('timeout')) {
        return {
          success: false,
          statusCode: '000',
          latency: PING_TIMEOUT_MS,
          error: 'Timeout',
        };
      }

      return {
        success: false,
        statusCode: 'ERR',
        latency,
        error: errorMessage,
      };
    }
  }

  async verifyModel(model: ModelConfig, providerConfig: { baseUrl: string; apiKey: string }): Promise<ModelVerificationStatus> {
    const key = model.id.toLowerCase();

    // Check if verification already in progress
    const existing = this.activeVerifications.get(key);
    if (existing) {
      await existing;
      return this.getStatus(model.id);
    }

    const verificationPromise = this._performVerification(model, providerConfig);
    this.activeVerifications.set(key, verificationPromise);

    try {
      await verificationPromise;
    } finally {
      this.activeVerifications.delete(key);
    }

    return this.getStatus(model.id);
  }

  private async _performVerification(model: ModelConfig, providerConfig: { baseUrl: string; apiKey: string }): Promise<void> {
    const key = model.id.toLowerCase();
    const now = Date.now();

    // Initialize status if needed
    if (!this.verificationStatus.has(key)) {
      this.verificationStatus.set(key, {
        modelId: model.id,
        providerId: model.provider,
        isVerified: false,
        lastVerification: null,
        lastSuccess: null,
        lastFailure: null,
        consecutiveFailures: 0,
        totalPings: 0,
        successfulPings: 0,
        verdict: 'Pending',
        stabilityScore: -1,
        status: 'pending',
      });
    }

    const status = this.verificationStatus.get(key)!;

    console.log(`[VERIFIER] Pinging ${model.id}...`);

    const result = await this.pingModel(model.id, providerConfig);

    status.totalPings++;
    status.lastVerification = now;

    if (result.success) {
      status.lastSuccess = now;
      status.successfulPings++;
      status.consecutiveFailures = 0;
      status.isVerified = true;
      status.status = 'verified';

      // Record in health tracker
      healthTracker.recordRequest(model.id, model.provider, {
        latency: result.latency,
        statusCode: String(result.statusCode),
        success: true,
      });

      console.log(`[VERIFIER] ✓ ${model.id} responded (${result.latency}ms, status ${result.statusCode})`);
    } else {
      status.lastFailure = now;
      status.consecutiveFailures++;

      // Record failure in health tracker
      healthTracker.recordRequest(model.id, model.provider, {
        latency: result.latency,
        statusCode: String(result.statusCode),
        success: false,
      });

      // Update status based on failure pattern
      if (status.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        status.status = 'unhealthy';
        console.log(`[VERIFIER] ✗ ${model.id} marked UNHEALTHY (${status.consecutiveFailures} consecutive failures)`);
      } else {
        status.status = 'unverified';
        console.log(`[VERIFIER] ✗ ${model.id} failed (${result.error}, attempt ${status.consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES})`);
      }
    }

    // Sync verdict and stability from health tracker
    const health = healthTracker.getHealth(model.id);
    if (health) {
      status.verdict = health.verdict;
      status.stabilityScore = health.stabilityScore;
    }
  }

  isHealthy(modelId: string): boolean {
    const status = this.getStatus(modelId);

    // Not verified yet
    if (status.status === 'pending') {
      return false;
    }

    // Explicitly marked unhealthy
    if (status.status === 'unhealthy') {
      return false;
    }

    // Check consecutive failures
    if (status.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      return false;
    }

    // Check if last failure was recent
    if (status.lastFailure) {
      const timeSinceFailure = Date.now() - status.lastFailure;
      if (timeSinceFailure < UNHEALTHY_WINDOW_MS && status.consecutiveFailures > 0) {
        return false;
      }
    }

    // Must have at least one successful ping
    if (status.successfulPings === 0) {
      return false;
    }

    // Check verdict from health tracker
    const unhealthyVerdicts: Verdict[] = ['Unstable', 'Not Active', 'Overloaded'];
    if (unhealthyVerdicts.includes(status.verdict)) {
      return false;
    }

    return true;
  }

  isVerified(modelId: string): boolean {
    const status = this.getStatus(modelId);
    return status.status === 'verified';
  }

  getStatus(modelId: string): ModelVerificationStatus {
    const key = modelId.toLowerCase();
    const existing = this.verificationStatus.get(key);

    if (existing) {
      return existing;
    }

    // Return default status
    return {
      modelId,
      providerId: 'unknown' as ProviderId,
      isVerified: false,
      lastVerification: null,
      lastSuccess: null,
      lastFailure: null,
      consecutiveFailures: 0,
      totalPings: 0,
      successfulPings: 0,
      verdict: 'Pending',
      stabilityScore: -1,
      status: 'pending',
    };
  }

  getAllStatus(): Map<string, ModelVerificationStatus> {
    return new Map(this.verificationStatus);
  }

  getVerifiedModels(): string[] {
    const verified: string[] = [];
    for (const [key, status] of this.verificationStatus) {
      if (status.status === 'verified' && this.isHealthy(status.modelId)) {
        verified.push(status.modelId);
      }
    }
    return verified;
  }

  getUnhealthyModels(): string[] {
    const unhealthy: string[] = [];
    for (const [key, status] of this.verificationStatus) {
      if (status.status === 'unhealthy' || !this.isHealthy(status.modelId)) {
        unhealthy.push(status.modelId);
      }
    }
    return unhealthy;
  }

  async verifyAllModels(
    models: ModelConfig[],
    getProviderConfig: (providerId: ProviderId) => { baseUrl: string; apiKey: string } | null
  ): Promise<{ verified: string[]; failed: string[] }> {
    console.log(`[VERIFIER] Starting verification of ${models.length} models...`);

    const verified: string[] = [];
    const failed: string[] = [];

    // Verify models in parallel (max 5 concurrent)
    const batchSize = 5;
    for (let i = 0; i < models.length; i += batchSize) {
      const batch = models.slice(i, i + batchSize);

      const results = await Promise.all(
        batch.map(async (model) => {
          const config = getProviderConfig(model.provider);
          if (!config) {
            console.log(`[VERIFIER] Skipping ${model.id} - no provider config`);
            return { modelId: model.id, success: false };
          }

          try {
            const status = await this.verifyModel(model, config);
            return {
              modelId: model.id,
              success: status.status === 'verified' || status.status === 'unverified',
            };
          } catch (error) {
            console.error(`[VERIFIER] Error verifying ${model.id}:`, error);
            return { modelId: model.id, success: false };
          }
        })
      );

      for (const result of results) {
        if (result.success) {
          verified.push(result.modelId);
        } else {
          failed.push(result.modelId);
        }
      }
    }

    console.log(`[VERIFIER] Verification complete: ${verified.length} verified, ${failed.length} failed`);
    return { verified, failed };
  }

  startPeriodicVerification(
    models: ModelConfig[],
    getProviderConfig: (providerId: ProviderId) => { baseUrl: string; apiKey: string } | null,
    intervalMs: number = PING_INTERVAL_MS
  ): void {
    // Clear existing timers
    for (const timer of this.intervalTimers.values()) {
      clearInterval(timer);
    }
    this.intervalTimers.clear();

    // Initial verification
    this.verifyAllModels(models, getProviderConfig);

    // Set up periodic verification
    const timer = setInterval(async () => {
      await this.verifyAllModels(models, getProviderConfig);
    }, intervalMs);

    this.intervalTimers.set('_global', timer);
    console.log(`[VERIFIER] Started periodic verification (${intervalMs}ms interval)`);
  }

  stopPeriodicVerification(): void {
    for (const timer of this.intervalTimers.values()) {
      clearInterval(timer);
    }
    this.intervalTimers.clear();
    console.log('[VERIFIER] Stopped periodic verification');
  }

  getSummary(): {
    total: number;
    verified: number;
    unverified: number;
    unhealthy: number;
    pending: number;
  } {
    let verified = 0;
    let unverified = 0;
    let unhealthy = 0;
    let pending = 0;

    for (const status of this.verificationStatus.values()) {
      switch (status.status) {
        case 'verified':
          verified++;
          break;
        case 'unverified':
          unverified++;
          break;
        case 'unhealthy':
          unhealthy++;
          break;
        case 'pending':
          pending++;
          break;
      }
    }

    return {
      total: this.verificationStatus.size,
      verified,
      unverified,
      unhealthy,
      pending,
    };
  }
}

export const modelHealthVerifier = new ModelHealthVerifier();
