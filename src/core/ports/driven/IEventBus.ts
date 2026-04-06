import type { DomainEvent } from '../../events';

type EventHandler = (event: DomainEvent) => Promise<void> | void;

export interface IEventBus {
  publish<T extends DomainEvent>(event: T): Promise<void>;
  subscribe(eventType: string, handler: EventHandler): void;
}
