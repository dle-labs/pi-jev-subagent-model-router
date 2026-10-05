export class FakeBus {
  readonly listeners = new Map<string, Set<(payload: unknown) => void>>();

  on(name: string, handler: (payload: unknown) => void): () => void {
    let handlers = this.listeners.get(name);
    if (!handlers) {
      handlers = new Set();
      this.listeners.set(name, handlers);
    }
    handlers.add(handler);
    const registered = handlers;
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      registered.delete(handler);
      if (registered.size === 0 && this.listeners.get(name) === registered) {
        this.listeners.delete(name);
      }
    };
  }

  emit(name: string, payload: unknown): void {
    for (const handler of [...(this.listeners.get(name) ?? [])]) handler(payload);
  }

  count(): number {
    let total = 0;
    for (const handlers of this.listeners.values()) total += handlers.size;
    return total;
  }
}
