import { KafkaEvent } from '@notification-system/types';

export class MockKafkaClient {
  public publishedEvents: Array<{ topic: string; event: KafkaEvent }> = [];
  public subscriptions: Map<string, (event: KafkaEvent) => Promise<void>> = new Map();
  public connected = false;

  async getProducer() {
    return {
      connect: jest.fn(),
      send: jest.fn(),
      disconnect: jest.fn(),
    };
  }

  async publishEvent(topic: string, event: KafkaEvent): Promise<void> {
    this.publishedEvents.push({ topic, event });
    return Promise.resolve();
  }

  async subscribe(
    groupId: string,
    topics: string[],
    handler: (event: KafkaEvent) => Promise<void>
  ): Promise<void> {
    topics.forEach((topic) => {
      this.subscriptions.set(topic, handler);
    });
    this.connected = true;
    return Promise.resolve();
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.subscriptions.clear();
    return Promise.resolve();
  }

  // Helper method to simulate receiving an event
  async simulateEvent(topic: string, event: KafkaEvent): Promise<void> {
    const handler = this.subscriptions.get(topic);
    if (handler) {
      await handler(event);
    }
  }

  // Helper method to reset mock state
  reset(): void {
    this.publishedEvents = [];
    this.subscriptions.clear();
    this.connected = false;
  }

  // Helper method to get events by topic
  getEventsByTopic(topic: string): KafkaEvent[] {
    return this.publishedEvents
      .filter((e) => e.topic === topic)
      .map((e) => e.event);
  }

  // Helper method to get last event
  getLastEvent(topic?: string): KafkaEvent | undefined {
    if (topic) {
      const events = this.getEventsByTopic(topic);
      return events[events.length - 1];
    }
    return this.publishedEvents[this.publishedEvents.length - 1]?.event;
  }
}

// Factory function to create mock Kafka client
export const createMockKafkaClient = (): MockKafkaClient => {
  return new MockKafkaClient();
};
