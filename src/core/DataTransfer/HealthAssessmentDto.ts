export interface HealthAssessmentDto {
  modelId: string;
  verdict: 'healthy' | 'degraded' | 'unhealthy' | 'unknown';
  stabilityScore: number;
  avgLatency: number;
  p95Latency: number;
  errorRate: number;
  sampleCount: number;
}
