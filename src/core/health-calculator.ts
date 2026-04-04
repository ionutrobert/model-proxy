// ============================================================================
// Health Calculator - Pure functions for health calculations
// Based on free-coding-models utils.js algorithms
// ============================================================================

import type { Verdict, HealthRequest, ModelHealthHistory, HealthMetrics } from './types.js';

// Latency thresholds (ms)
const STANDARD_THRESHOLDS = {
  perfect: 400,
  normal: 1000,
  slow: 3000,
  verySlow: 5000,
};

// Thinking model thresholds (ms) - 10-60s response times are normal
const THINKING_THRESHOLDS = {
  perfect: 10000,
  normal: 30000,
  slow: 45000,
  verySlow: 60000,
};

// Stability score weights
const STABILITY_WEIGHTS = {
  p95: 0.3,
  jitter: 0.3,
  spike: 0.2,
  uptime: 0.2,
};

// Thinking model detection patterns
const THINKING_MODEL_PATTERNS = [
  'thinking',
  'reasoning',
  'o1',
  'r1',
  'qwq',
  'deepseek-r',
  'deepseek-r1',
];

export function detectThinkingModel(modelId: string): boolean {
  const id = modelId.toLowerCase();
  return THINKING_MODEL_PATTERNS.some(pattern => id.includes(pattern));
}

export function calculateP95(requests: HealthRequest[]): number {
  const latencies = requests
    .filter(r => typeof r.latency === 'number' && r.latency >= 0)
    .map(r => r.latency)
    .sort((a, b) => a - b);

  if (latencies.length === 0) return 0;

  const index = Math.ceil(0.95 * latencies.length) - 1;
  return latencies[Math.max(0, index)];
}

export function calculateJitter(requests: HealthRequest[]): number {
  const latencies = requests
    .filter(r => typeof r.latency === 'number' && r.latency >= 0)
    .map(r => r.latency);

  if (latencies.length < 2) return 0;

  const mean = latencies.reduce((sum, v) => sum + v, 0) / latencies.length;
  const variance = latencies.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / latencies.length;
  return Math.sqrt(variance);
}

export function calculateUptime(requests: HealthRequest[]): number {
  if (requests.length === 0) return 100;

  const successful = requests.filter(r => r.success).length;
  return (successful / requests.length) * 100;
}

export function calculateSpikeRate(requests: HealthRequest[], threshold?: number): number {
  if (requests.length === 0) return 0;

  const latencies = requests
    .filter(r => typeof r.latency === 'number' && r.latency >= 0)
    .map(r => r.latency);

  if (latencies.length === 0) return 0;

  const avgLatency = latencies.reduce((sum, v) => sum + v, 0) / latencies.length;
  const spikeThreshold = threshold || avgLatency * 3;
  const spikes = latencies.filter(l => l > spikeThreshold).length;

  return spikes / requests.length;
}

export function calculateAvgLatency(requests: HealthRequest[]): number {
  const latencies = requests
    .filter(r => typeof r.latency === 'number' && r.latency >= 0)
    .map(r => r.latency);

  if (latencies.length === 0) return 0;
  return latencies.reduce((sum, v) => sum + v, 0) / latencies.length;
}

export function getVerdict(history: ModelHealthHistory): Verdict {
  const { requests, isThinking } = history;

  if (requests.length === 0) return 'Pending';

  const lastRequest = requests[requests.length - 1];

  if (lastRequest.statusCode === '429') return 'Overloaded';

  if (lastRequest.statusCode === '000' || lastRequest.statusCode === 'ERR' || lastRequest.statusCode === '404') {
    const wasUpBefore = requests.some(r => r.statusCode === '200');
    return wasUpBefore ? 'Unstable' : 'Not Active';
  }

  const thresholds = isThinking ? THINKING_THRESHOLDS : STANDARD_THRESHOLDS;
  const { avgLatency, p95Latency } = history.metrics;

  if (avgLatency < thresholds.perfect) {
    if (requests.length >= 3 && p95Latency > thresholds.slow) {
      return 'Spiky';
    }
    return 'Perfect';
  }

  if (avgLatency < thresholds.normal) {
    if (requests.length >= 3 && p95Latency > thresholds.verySlow) {
      return 'Spiky';
    }
    return 'Normal';
  }

  if (avgLatency < thresholds.slow) return 'Slow';
  if (avgLatency < thresholds.verySlow) return 'Very Slow';
  return 'Unstable';
}

export function calculateStabilityScore(history: ModelHealthHistory): number {
  const { p95Latency, jitter, spikeRate, uptimePercent } = history.metrics;

  if (history.requests.length === 0) return -1;

  const p95Score = Math.max(0, Math.min(100, 100 * (1 - p95Latency / 5000)));
  const jitterScore = Math.max(0, Math.min(100, 100 * (1 - jitter / 2000)));
  const spikeScore = Math.max(0, 100 * (1 - spikeRate));
  const reliabilityScore = uptimePercent;

  return Math.round(
    STABILITY_WEIGHTS.p95 * p95Score +
    STABILITY_WEIGHTS.jitter * jitterScore +
    STABILITY_WEIGHTS.spike * spikeScore +
    STABILITY_WEIGHTS.uptime * reliabilityScore
  );
}

export function calculateMetrics(requests: HealthRequest[]): HealthMetrics {
  const totalRequests = requests.length;
  const successfulRequests = requests.filter(r => r.success).length;

  return {
    avgLatency: Math.round(calculateAvgLatency(requests)),
    p95Latency: Math.round(calculateP95(requests)),
    jitter: Math.round(calculateJitter(requests)),
    uptimePercent: parseFloat(calculateUptime(requests).toFixed(1)),
    spikeRate: parseFloat(calculateSpikeRate(requests).toFixed(3)),
    totalRequests,
    successfulRequests,
  };
}
