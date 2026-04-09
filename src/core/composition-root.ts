import type { IModelProxy } from './ports/driving/IModelProxy';
import type { IModelSelector } from './ports/driven/IModelSelector';
import type { IHealthService } from './ports/driven/IHealthService';
import type { IVerificationOrchestrator } from './ports/driven/IVerificationOrchestrator';
import type { IEventBus } from './ports/driven/IEventBus';
import { ModelProxyApplication, type ModelProxyConfig, type ProviderAdapter } from './application/ModelProxyApplication';
import { SmartModelSelector } from './adapters/driven/model-selection/SmartModelSelector';
import { HealthService } from './adapters/driven/health/HealthService';
import { VerificationOrchestratorAdapter } from './adapters/driven/verification/VerificationOrchestratorAdapter';
import { InMemoryEventBus } from './adapters/driven/events/InMemoryEventBus';
import { CURATED_MODELS, type CuratedModel } from './curated-models';

export interface CompositionRootConfig {
  endpoint: string;
  providers: ProviderAdapter[];
  healthCheckIntervalMs?: number;
  healthCheckTimeoutMs?: number;
  verificationMaxIterations?: number;
  verificationTimeoutMs?: number;
}

export class CompositionRoot {
  private eventBus: IEventBus;
  private healthService: IHealthService;
  private modelSelector: IModelSelector;
  private verificationOrchestrator: IVerificationOrchestrator;
  private application: IModelProxy;

  constructor(config: CompositionRootConfig) {
    this.eventBus = this.createEventBus();
    this.healthService = this.createHealthService(config);
    this.modelSelector = this.createModelSelector(config);
    this.verificationOrchestrator = this.createVerificationOrchestrator(config);
    this.application = this.createApplication(config);
  }

  getModelProxy(): IModelProxy {
    return this.application;
  }

  getEventBus(): IEventBus {
    return this.eventBus;
  }

  getHealthService(): IHealthService {
    return this.healthService;
  }

  getModelSelector(): IModelSelector {
    return this.modelSelector;
  }

  private createEventBus(): IEventBus {
    return new InMemoryEventBus();
  }

  private createHealthService(config: CompositionRootConfig): IHealthService {
    return new HealthService(
      {
        endpoint: config.endpoint,
        intervalMs: config.healthCheckIntervalMs ?? 300000, // 5 minutes default
        timeoutMs: config.healthCheckTimeoutMs ?? 10000
      },
      this.eventBus
    );
  }

  private createModelSelector(config: CompositionRootConfig): IModelSelector {
    return new SmartModelSelector(
      this.healthService,
      this.eventBus,
      CURATED_MODELS
    );
  }

  private createVerificationOrchestrator(config: CompositionRootConfig): IVerificationOrchestrator {
    return new VerificationOrchestratorAdapter({
      maxIterations: config.verificationMaxIterations ?? 5,
      timeoutMs: config.verificationTimeoutMs ?? 300000,
      completionMarker: '[TASK_DONE]',
      triggerPhrase: '#loop'
    });
  }

  private createApplication(config: CompositionRootConfig): IModelProxy {
    const appConfig: ModelProxyConfig = {
      providers: config.providers,
      defaultMaxIterations: config.verificationMaxIterations ?? 5,
      defaultTimeoutMs: config.verificationTimeoutMs ?? 300000
    };

    return new ModelProxyApplication(
      this.modelSelector,
      this.healthService,
      this.verificationOrchestrator,
      this.eventBus,
      appConfig
    );
  }
}

export function createModelProxy(config: CompositionRootConfig): IModelProxy {
  const root = new CompositionRoot(config);
  return root.getModelProxy();
}
