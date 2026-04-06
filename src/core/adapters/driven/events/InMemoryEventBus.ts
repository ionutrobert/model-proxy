import type { IEventBus } from '../../../ports/driven/IEventBus';
import type { DomainEvent } from '../../../events';

type EventHandler<T extends DomainEvent> = (event: T) => Promise<void>;

export class InMemoryEventBus implements IEventBus {
  private handlers: Map<string, EventHandler<DomainEvent>[]> = new Map();

  async publish<T extends DomainEvent>(event: T): Promise<void> {
    const handlers = this.handlers.get(event.eventType) || [];
    await Promise.all(handlers.map(h => h(event)));
  }

  subscribe<T extends DomainEvent>(
    eventType: string,
    handler: EventHandler<T>
  ): void {
    const existing = this.handlers.get(eventType) || [];
    this.handlers.set(eventType, [...existing, handler as EventHandler<DomainEvent>]);
  }
}
