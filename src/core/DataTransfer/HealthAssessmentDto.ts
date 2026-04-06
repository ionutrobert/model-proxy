export interface HealthAssessmentDto {
  modelId: string;
  score: number;
  latencyMs: number;
  available: boolean;
  timestamp: number;
  error?: string;
}
