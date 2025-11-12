import { Kafka, Producer, Consumer, EachMessagePayload } from 'kafkajs';
import { KafkaEvent } from '@notification-system/types';
import { createLogger } from './logger';
import { getCorrelationHeaders, runWithCorrelationContext, createKafkaCorrelationContext } from './correlation';

const logger = createLogger('kafka-utils');

export class KafkaClient {
  private kafka: Kafka;
  private producer: Producer | null = null;
  private consumers: Map<string, Consumer> = new Map();

  constructor(brokers: string[], clientId: string) {
    this.kafka = new Kafka({
      clientId,
      brokers,
      // 2025 best practices: optimized connection and retry settings
      connectionTimeout: 3000, // 3s connection timeout
      requestTimeout: 30000, // 30s request timeout
      retry: {
        initialRetryTime: 300, // Start with 300ms
        retries: 10, // Max 10 retries
        maxRetryTime: 30000, // Max backoff 30s
        multiplier: 2, // Exponential backoff multiplier
        factor: 0.2, // Randomization factor
      },
      // Consumer group session settings
      // These are applied when creating consumers
    });
  }

  async getProducer(): Promise<Producer> {
    if (!this.producer) {
      this.producer = this.kafka.producer();
      await this.producer.connect();
      logger.info('Kafka producer connected');
    }
    return this.producer;
  }

  async publishEvent(topic: string, event: KafkaEvent): Promise<void> {
    try {
      const producer = await this.getProducer();
      
      // Get correlation headers from current context
      const correlationHeaders = getCorrelationHeaders();
      
      await producer.send({
        topic,
        messages: [
          {
            key: event.data.notificationId || (event.data as any).id,
            value: JSON.stringify(event),
            timestamp: event.timestamp.getTime().toString(),
            // Attach correlation headers to Kafka message
            headers: {
              ...correlationHeaders,
              'x-event-type': event.type,
            },
          },
        ],
      });
      logger.info(`Event published to ${topic}`, { 
        eventType: event.type,
        correlationId: correlationHeaders['X-Correlation-ID'],
      });
    } catch (error) {
      logger.error('Failed to publish event', { topic, error });
      throw error;
    }
  }

  async subscribe(
    groupId: string,
    topics: string[],
    handler: (event: KafkaEvent) => Promise<void>
  ): Promise<void> {
    const consumer = this.kafka.consumer({
      groupId,
      // 2025 best practices: consumer session and heartbeat configuration
      sessionTimeout: 30000, // 30s session timeout
      heartbeatInterval: 3000, // 3s heartbeat interval (must be < sessionTimeout/3)
      maxBytes: 10485760, // 10MB max fetch size
      maxWaitTimeInMs: 5000, // 5s max wait time for fetch
    });
    await consumer.connect();
    await consumer.subscribe({ topics, fromBeginning: false });

    await consumer.run({
      eachMessage: async ({ topic, partition, message }: EachMessagePayload) => {
        try {
          const event: KafkaEvent = JSON.parse(message.value?.toString() || '{}');
          
          // Extract correlation context from Kafka message headers
          const correlationContext = createKafkaCorrelationContext(message.headers || {});
          
          // Run handler within correlation context for proper log correlation
          await runWithCorrelationContext(correlationContext, async () => {
            logger.info(`Received event from ${topic}`, {
              eventType: event.type,
              partition,
              correlationId: correlationContext.correlationId,
            });
            await handler(event);
          });
        } catch (error) {
          logger.error('Failed to process message', { topic, error });
        }
      },
    });

    this.consumers.set(groupId, consumer);
    logger.info(`Consumer subscribed`, { groupId, topics });
  }

  async disconnect(): Promise<void> {
    if (this.producer) {
      await this.producer.disconnect();
    }
    for (const [groupId, consumer] of this.consumers) {
      await consumer.disconnect();
      logger.info(`Consumer disconnected`, { groupId });
    }
  }
}

export default KafkaClient;
