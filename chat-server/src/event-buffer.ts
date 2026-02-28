export interface BufferedEvent {
  type: 'join' | 'leave' | 'mute' | 'kick' | 'unmute';
  name: string;
  timestamp: number;
  details?: string;
}

export class EventBuffer {
  private static instance: EventBuffer;
  private events: BufferedEvent[] = [];
  private readonly MAX_EVENTS = 100;
  private readonly RETENTION_MS = 30 * 60 * 1000; // 30 minutes

  private constructor() {}

  static getInstance(): EventBuffer {
    if (!EventBuffer.instance) {
      EventBuffer.instance = new EventBuffer();
    }
    return EventBuffer.instance;
  }

  addEvent(event: Omit<BufferedEvent, 'timestamp'>): void {
    this.events.push({
      ...event,
      timestamp: Date.now()
    });

    // Trim oldest if exceeds max
    if (this.events.length > this.MAX_EVENTS) {
      this.events = this.events.slice(-this.MAX_EVENTS);
    }

    // Clean expired events
    this.cleanup();
  }

  getRecentEvents(since?: number): BufferedEvent[] {
    this.cleanup();

    if (since !== undefined) {
      return this.events.filter(e => e.timestamp > since);
    }

    return [...this.events];
  }

  cleanup(): void {
    const now = Date.now();
    const cutoff = now - this.RETENTION_MS;
    this.events = this.events.filter(e => e.timestamp > cutoff);
  }
}

export const eventBuffer = EventBuffer.getInstance();
