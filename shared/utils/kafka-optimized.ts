import {
  Kafka,
  Producer,
  Consumer,
  EachMessagePayload,
  ProducerRecord,
  CompressionTypes,
  logLevel,
  Partitioners,
} from 'kafkajs';
import { KafkaEvent } from '@notification-system/types';
import { createLogger } from './logger';

const logger = createLogger('kafka-optimized');

/**
 * Optimized Kafka Client with batching, compression, and connection pooling
 * Implements best practices for high-throughput, low-latency messaging
 */
export class KafkaOptimizedClient {
  private kafka: Kafka;
  private producer: Producer | null = null;
  private consumers: Map<string, Consumer> = new Map();
  private messageBuffer: Map<string, Array<{ key: string; value: string }>> = new Map();
  private flushInterval: NodeJS.Timeout | null = null;

  constructor(
    brokers: string[],
    clientId: string,
    config?: {
      batchSize?: number;
      batchTimeout?: number;
      compression?: CompressionTypes;
      connectionTimeout?: number;
      requestTimeout?: number;
    }
  ) {
    this.kafka = new Kafka({
      clientId,
      brokers,
      logLevel: logLevel.INFO,

      // Connection optimization
      connectionTimeout: config?.connectionTimeout || 10000,
      requestTimeout: config?.requestTimeout || 30000,

      // Retry configuration
      retry: {
        initialRetryTime: 100,
        retries: 8,
        maxRetryTime: 30000,
        multiplier: 2,
        retries: 10,
      },

      // Socket keepalive
      socketFactory: undefined, // Use default with keepalive enabled
    });

    logger.info('Kafka client initialized', {
      brokers: brokers.join(','),
      clientId,
    });
  }

  /**
   * Get or create optimized producer with batching and compression
   */
  async getProducer(config?: {
    maxInFlightRequests?: number;
    idempotent?: boolean;
    transactional?: boolean;
  }): Promise<Producer> {
    if (!this.producer) {
      this.producer = this.kafka.producer({
        // Idempotent producer for exactly-once semantics
        idempotent: config?.idempotent ?? true,

        // Transactional producer
        transactionalId: config?.transactional ? `txn-${Date.now()}` : undefined,

        // Maximum in-flight requests for throughput
        maxInFlightRequests: config?.maxInFlightRequests || 5,

        // Use default partitioner with murmur2 hash
        createPartitioner: Partitioners.DefaultPartitioner,

        // Producer optimizations
        allowAutoTopicCreation: false,

        // Batching configuration
        batch: {
          size: 16384, // 16KB batch size
          maxBytes: 1048576, // 1MB max batch
        },

        // Linger time for batching
        linger: {
          ms: 10, // Wait 10ms to batch messages
        },

        // Compression
        compression: CompressionTypes.GZIP,

        // Retry configuration
        retry: {
          initialRetryTime: 100,
          retries: 5,
          maxRetryTime: 30000,
        },
      });

      await this.producer.connect();
      logger.info('Kafka producer connected with optimizations');
    }

    return this.producer;
  }

  /**
   * Publish single event with automatic batching
   */
  async publishEvent(
    topic: string,
    event: KafkaEvent,
    options?: {
      partition?: number;
      headers?: Record<string, string>;
      compression?: CompressionTypes;
    }
  ): Promise<void> {
    try {
      const producer = await this.getProducer();

      const message = {
        key: event.data.notificationId || (event.data as any).id || '',
        value: JSON.stringify(event),
        timestamp: event.timestamp.getTime().toString(),
        headers: options?.headers,
        partition: options?.partition,
      };

      await producer.send({
        topic,
        messages: [message],
        compression: options?.compression || CompressionTypes.GZIP,
      });

      logger.debug(`Event published to ${topic}`, { eventType: event.type });
    } catch (error) {
      logger.error('Failed to publish event', { topic, error });
      throw error;
    }
  }

  /**
   * Batch publish multiple events for improved throughput
   */
  async publishBatch(
    topic: string,
    events: KafkaEvent[],
    options?: {
      compression?: CompressionTypes;
    }
  ): Promise<void> {
    if (events.length === 0) {
      return;
    }

    try {
      const producer = await this.getProducer();

      const messages = events.map((event) => ({
        key: event.data.notificationId || (event.data as any).id || '',
        value: JSON.stringify(event),
        timestamp: event.timestamp.getTime().toString(),
      }));

      await producer.send({
        topic,
        messages,
        compression: options?.compression || CompressionTypes.GZIP,
      });

      logger.info(`Batch published to ${topic}`, { count: events.length });
    } catch (error) {
      logger.error('Failed to publish batch', { topic, error, count: events.length });
      throw error;
    }
  }

  /**
   * Buffered publishing with automatic flush
   */
  async publishBuffered(
    topic: string,
    event: KafkaEvent,
    options?: {
      flushInterval?: number;
      maxBufferSize?: number;
    }
  ): Promise<void> {
    const maxBufferSize = options?.maxBufferSize || 100;
    const flushInterval = options?.flushInterval || 1000;

    // Initialize buffer for topic
    if (!this.messageBuffer.has(topic)) {
      this.messageBuffer.set(topic, []);
    }

    const buffer = this.messageBuffer.get(topic)!;

    // Add message to buffer
    buffer.push({
      key: event.data.notificationId || (event.data as any).id || '',
      value: JSON.stringify(event),
    });

    // Flush if buffer is full
    if (buffer.length >= maxBufferSize) {
      await this.flushBuffer(topic);
    }

    // Start periodic flush if not already running
    if (!this.flushInterval) {
      this.flushInterval = setInterval(() => {
        this.flushAllBuffers();
      }, flushInterval);
    }

    logger.debug(`Event buffered for ${topic}`, { bufferSize: buffer.length });
  }

  private async flushBuffer(topic: string): Promise<void> {
    const buffer = this.messageBuffer.get(topic);

    if (!buffer || buffer.length === 0) {
      return;
    }

    try {
      const producer = await this.getProducer();

      await producer.send({
        topic,
        messages: buffer,
        compression: CompressionTypes.GZIP,
      });

      logger.info(`Buffer flushed for ${topic}`, { count: buffer.length });

      // Clear buffer
      this.messageBuffer.set(topic, []);
    } catch (error) {
      logger.error('Failed to flush buffer', { topic, error, count: buffer.length });
    }
  }

  private async flushAllBuffers(): Promise<void> {
    const topics = Array.from(this.messageBuffer.keys());

    for (const topic of topics) {
      await this.flushBuffer(topic);
    }
  }

  /**
   * Subscribe to topics with optimized consumer configuration
   */
  async subscribe(
    groupId: string,
    topics: string[],
    handler: (event: KafkaEvent) => Promise<void>,
    options?: {
      fromBeginning?: boolean;
      sessionTimeout?: number;
      heartbeatInterval?: number;
      maxBytesPerPartition?: number;
      maxWaitTime?: number;
      autoCommit?: boolean;
      autoCommitInterval?: number;
      eachBatchAutoResolve?: boolean;
    }
  ): Promise<void> {
    const consumer = this.kafka.consumer({
      groupId,

      // Session timeout and heartbeat
      sessionTimeout: options?.sessionTimeout || 30000,
      heartbeatInterval: options?.heartbeatInterval || 3000,

      // Rebalance timeout
      rebalanceTimeout: 60000,

      // Consumer optimization
      maxBytesPerPartition: options?.maxBytesPerPartition || 1048576, // 1MB
      maxWaitTimeInMs: options?.maxWaitTime || 5000,

      // Retry configuration
      retry: {
        initialRetryTime: 100,
        retries: 8,
        maxRetryTime: 30000,
        multiplier: 2,
      },
    });

    await consumer.connect();
    await consumer.subscribe({
      topics,
      fromBeginning: options?.fromBeginning ?? false,
    });

    // Optimized message processing
    await consumer.run({
      autoCommit: options?.autoCommit ?? true,
      autoCommitInterval: options?.autoCommitInterval || 5000,
      autoCommitThreshold: 100,

      // Parallel processing per partition
      partitionsConsumedConcurrently: 3,

      eachMessage: async ({ topic, partition, message, heartbeat }: EachMessagePayload) => {
        const startTime = Date.now();

        try {
          const event: KafkaEvent = JSON.parse(message.value?.toString() || '{}');

          logger.debug(`Processing message from ${topic}`, {
            eventType: event.type,
            partition,
            offset: message.offset,
          });

          // Call heartbeat periodically for long-running handlers
          await Promise.race([
            handler(event),
            this.heartbeatLoop(heartbeat, 1000),
          ]);

          const duration = Date.now() - startTime;

          // Log slow processing
          if (duration > 5000) {
            logger.warn('Slow message processing', {
              topic,
              duration,
              eventType: event.type,
            });
          }
        } catch (error) {
          logger.error('Failed to process message', {
            topic,
            partition,
            offset: message.offset,
            error,
          });

          // Message will not be committed on error
          throw error;
        }
      },
    });

    this.consumers.set(groupId, consumer);
    logger.info(`Consumer subscribed with optimizations`, { groupId, topics });
  }

  /**
   * Subscribe with batch processing for higher throughput
   */
  async subscribeBatch(
    groupId: string,
    topics: string[],
    batchHandler: (events: KafkaEvent[]) => Promise<void>,
    options?: {
      maxBatchSize?: number;
      batchTimeout?: number;
    }
  ): Promise<void> {
    const consumer = this.kafka.consumer({
      groupId,
      sessionTimeout: 30000,
      heartbeatInterval: 3000,
      maxBytesPerPartition: 1048576,
    });

    await consumer.connect();
    await consumer.subscribe({ topics, fromBeginning: false });

    await consumer.run({
      autoCommit: true,
      autoCommitInterval: 5000,

      eachBatch: async ({ batch, resolveOffset, heartbeat, isRunning }) => {
        try {
          const events: KafkaEvent[] = [];

          for (const message of batch.messages) {
            if (!isRunning()) {
              break;
            }

            try {
              const event: KafkaEvent = JSON.parse(message.value?.toString() || '{}');
              events.push(event);
            } catch (error) {
              logger.error('Failed to parse message', { error });
            }

            // Heartbeat periodically
            await heartbeat();
          }

          if (events.length > 0) {
            await batchHandler(events);
            logger.info('Batch processed', {
              topic: batch.topic,
              partition: batch.partition,
              count: events.length,
            });
          }

          // Commit offset
          const lastMessage = batch.messages[batch.messages.length - 1];
          if (lastMessage) {
            resolveOffset(lastMessage.offset);
          }
        } catch (error) {
          logger.error('Failed to process batch', {
            topic: batch.topic,
            partition: batch.partition,
            error,
          });
          throw error;
        }
      },
    });

    this.consumers.set(groupId, consumer);
    logger.info('Batch consumer subscribed', { groupId, topics });
  }

  /**
   * Pause consumer for backpressure management
   */
  async pauseConsumer(groupId: string, topics?: string[]): Promise<void> {
    const consumer = this.consumers.get(groupId);

    if (!consumer) {
      throw new Error(`Consumer not found: ${groupId}`);
    }

    if (topics) {
      await consumer.pause(topics.map((topic) => ({ topic })));
      logger.info('Consumer paused for topics', { groupId, topics });
    } else {
      await consumer.pause();
      logger.info('Consumer paused', { groupId });
    }
  }

  /**
   * Resume paused consumer
   */
  async resumeConsumer(groupId: string, topics?: string[]): Promise<void> {
    const consumer = this.consumers.get(groupId);

    if (!consumer) {
      throw new Error(`Consumer not found: ${groupId}`);
    }

    if (topics) {
      await consumer.resume(topics.map((topic) => ({ topic })));
      logger.info('Consumer resumed for topics', { groupId, topics });
    } else {
      await consumer.resume();
      logger.info('Consumer resumed', { groupId });
    }
  }

  /**
   * Get consumer lag for monitoring
   */
  async getConsumerLag(groupId: string): Promise<any> {
    const consumer = this.consumers.get(groupId);

    if (!consumer) {
      throw new Error(`Consumer not found: ${groupId}`);
    }

    try {
      const admin = this.kafka.admin();
      await admin.connect();

      const offsets = await admin.fetchOffsets({ groupId });

      await admin.disconnect();

      return offsets;
    } catch (error) {
      logger.error('Failed to get consumer lag', { error, groupId });
      throw error;
    }
  }

  private async heartbeatLoop(
    heartbeat: () => Promise<void>,
    intervalMs: number
  ): Promise<never> {
    return new Promise((_, reject) => {
      const interval = setInterval(async () => {
        try {
          await heartbeat();
        } catch (error) {
          clearInterval(interval);
          reject(error);
        }
      }, intervalMs);
    });
  }

  async disconnect(): Promise<void> {
    // Flush all buffers before disconnect
    await this.flushAllBuffers();

    // Stop flush interval
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
    }

    // Disconnect producer
    if (this.producer) {
      await this.producer.disconnect();
      logger.info('Producer disconnected');
    }

    // Disconnect all consumers
    for (const [groupId, consumer] of this.consumers) {
      await consumer.disconnect();
      logger.info(`Consumer disconnected`, { groupId });
    }

    logger.info('Kafka client disconnected');
  }
}

export default KafkaOptimizedClient;
