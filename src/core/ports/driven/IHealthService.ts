import type { ModelId } from '../../domain/value-objects/ModelId';
import type { HealthAssessmentDto } from '../../DataTransfer/HealthAssessmentDto';

export interface IHealthService {
  getHealth(modelId: ModelId): Promise<HealthAssessmentDto>;
  getAllHealth(): Promise<Map<string, HealthAssessmentDto>>;
  refresh(): Promise<void>;
}
