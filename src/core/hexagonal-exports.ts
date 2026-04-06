export { ModelProxyApplication, type ProviderAdapter, type ModelProxyConfig } from './application/ModelProxyApplication';
export { CompositionRoot, createModelProxy, type CompositionRootConfig } from './composition-root';

export type { IModelProxy, StreamingEvent } from './ports/driving/IModelProxy';
export type { IModelSelector } from './ports/driven/IModelSelector';
export type { IHealthService } from './ports/driven/IHealthService';
export type { IVerificationOrchestrator, VerificationEvent } from './ports/driven/IVerificationOrchestrator';
export type { IEventBus } from './ports/driven/IEventBus';

export { SmartModelSelector } from './adapters/driven/model-selection/SmartModelSelector';
export { HealthService, type HealthCheckConfig } from './adapters/driven/health/HealthService';
export { VerificationOrchestratorAdapter } from './adapters/driven/verification/VerificationOrchestratorAdapter';
export { InMemoryEventBus } from './adapters/driven/events/InMemoryEventBus';

export { ModelId } from './domain/value-objects/ModelId';
export { HealthScore } from './domain/value-objects/HealthScore';
export { IterationCount } from './domain/value-objects/IterationCount';
export { SelectionCriteria } from './domain/value-objects/SelectionCriteria';
export { SelectionResult } from './domain/entities/SelectionResult';
export { VerificationContext } from './domain/entities/VerificationContext';

export { DomainEvent } from './events/DomainEvent';
export { ModelSelectedEvent } from './events/ModelSelectedEvent';
export { HealthChangedEvent } from './events/HealthChangedEvent';
export type { HealthAssessmentDto } from './DataTransfer/HealthAssessmentDto';
