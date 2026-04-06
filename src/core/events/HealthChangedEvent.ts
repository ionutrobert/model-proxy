import { DomainEvent } from './DomainEvent';

export class HealthChangedEvent extends DomainEvent {
  constructor(
    readonly modelId: string,
    readonly previousScore: number,
    readonly currentScore: number,
    readonly verdict: 'healthy' | 'degraded' | 'unhealthy'
  ) {
    super('health:changed');
  }
}
