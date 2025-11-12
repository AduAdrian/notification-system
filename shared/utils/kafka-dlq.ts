import { Kafka, Producer, Consumer, EachMessagePayload, KafkaMessage } from 'kafkajs';
import { KafkaEvent } from '@notification-system/types';
import { createLogger } from './logger';
import { createSpan, recordException, SpanStatusCode } from './tracing';
import { MetricsCollector } from './src/metrics';

const logger = createLogger('kafka-dlq');

/**
 * Dead Letter Queue configuration
 */
export interface DLQConfig {
  /**
   * Enable DLQ functionality
   */
  enabled: boolean;

  /**
   * Maximum number of retry attempts before sending to DLQ
   */
  maxRetries: number;

  /**
   * Base delay for exponential backoff (milliseconds)
   */
  retryDelayMs: number;

  /**
   * Dead letter queue topic suffix
   */
  dlqTopicSuffix: string;

  /**
   * Optional metrics collector
   */
  metrics?: MetricsCollector;
}

/**
 * Message metadata for retry tracking
 */
interface MessageMetadata {
  originalTopic: string;
  retryCount: number;
  firstAttemptTimestamp: number;
  lastAttemptTimestamp: number;
  errorMessage?: string;
  errorType?: string;
}

/**
 * Enhanced Kafka client with Dead Letter Queue (DLQ) support
 *
 * Implements the DLQ pattern for handling failed message processing:
 * 1. Messages are retried with exponential backoff
 * 2. After max retries, non-retryable errors send messages to DLQ
 * 3. DLQ messages can be reprocessed or analyzed later
 *
 * @example
 * ```typescript
 * const client = new KafkaClientWithDLQ(
 *   ['kafka:9093'],
 *   'email-service',
 *   {
 *     enabled: true,
 *     maxRetries: 3,
 *     retryDelayMs: 1000,
 *     dlqTopicSuffix: '.dlq'
 *   }
 * );
 *
 * await client.subscribe(
 *   'email-group',
 *   ['channel.email.queued'],
 *   async (event) => {
 *     await processEmail(event);
 *   }
 * );
 * ```
 */
export class KafkaClientWithDLQ {
  private kafka: Kafka;
  private producer: Producer | null = null;
  private consumers: Map<string, Consumer> = new Map();
  private dlqConfig: DLQConfig;
  private clientId: string;

  constructor(brokers: string[], clientId: string, dlqConfig?: Partial<DLQConfig>) {
    this.clientId = clientId;
    this.kafka = new Kafka({
      clientId,
      brokers,
      retry: {
        initialRetryTime: 300,
        retries: 10,
      },
    });

    this.dlqConfig = {
      enabled: dlqConfig?.enabled ?? true,
      maxRetries: dlqConfig?.maxRetries ?? 3,
      retryDelayMs: dlqConfig?.retryDelayMs ?? 1000,
      dlqTopicSuffix: dlqConfig?.dlqTopicSuffix ?? '.dlq',
      metrics: dlqConfig?.metrics,
    };

    logger.info('KafkaClientWithDLQ initialized', {
      clientId,
      dlqEnabled: this.dlqConfig.enabled,
      maxRetries: this.dlqConfig.maxRetries,
    });
  }

  /**
   * Get or create Kafka producer
   */
  async getProducer(): Promise<Producer> {
    if (!this.producer) {
      this.producer = this.kafka.producer();
      await this.producer.connect();
      logger.info('Kafka producer connected');

      if (this.dlqConfig.metrics) {
        this.dlqConfig.metrics.updateKafkaConnectionStatus(true);
      }
    }
    return this.producer;
  }

  /**
   * Publish an event to Kafka with distributed tracing
   *
   * @param topic - Kafka topic
   * @param event - Event payload
   */
  async publishEvent(topic: string, event: KafkaEvent): Promise<void> {
    const span = createSpan('kafka-publish', {
      'kafka.topic': topic,
      'event.type': event.type,
      'notification.id': event.data.notificationId || '',
    });

    try {
      const producer = await this.getProducer();
      await producer.send({
        topic,
        messages: [
          {
            key: event.data.notificationId || (event.data as any).id,
            value: JSON.stringify(event),
            timestamp: event.timestamp.getTime().toString(),
          },
        ],
      });

      if (this.dlqConfig.metrics) {
        this.dlqConfig.metrics.kafkaMessagesProduced.inc({ topic });
      }

      span.setStatus({ code: SpanStatusCode.OK });
      logger.info(`Event published to ${topic}`, { eventType: event.type });
    } catch (error: any) {
      span.recordException(error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
      logger.error('Failed to publish event', { topic, error: error.message });
      throw error;
    } finally {
      span.end();
    }
  }

  /**
   * Send a message to the Dead Letter Queue
   *
   * @param originalTopic - Original topic name
   * @param message - Original Kafka message
   * @param metadata - Retry metadata
   * @param error - Error that caused the failure
   */
  private async sendToDLQ(
    originalTopic: string,
    message: KafkaMessage,
    metadata: MessageMetadata,
    error: Error
  ): Promise<void> {
    const dlqTopic = `${originalTopic}${this.dlqConfig.dlqTopicSuffix}`;
    const span = createSpan('kafka-dlq-send', {
      'kafka.topic': dlqTopic,
      'kafka.original_topic': originalTopic,
      'retry.count': metadata.retryCount.toString(),
    });

    try {
      const producer = await this.getProducer();

      // Enhance message with DLQ metadata
      const dlqMessage = {
        value: message.value,
        key: message.key,
        headers: {
          ...message.headers,
          'x-original-topic': originalTopic,
          'x-retry-count': metadata.retryCount.toString(),
          'x-first-attempt': metadata.firstAttemptTimestamp.toString(),
          'x-last-attempt': metadata.lastAttemptTimestamp.toString(),
          'x-error-message': error.message,
          'x-error-type': error.name,
          'x-dlq-timestamp': Date.now().toString(),
        },
      };

      await producer.send({
        topic: dlqTopic,
        messages: [dlqMessage],
      });

      // Track DLQ metric
      if (this.dlqConfig.metrics) {
        this.dlqConfig.metrics.notificationDeadLetterQueue.inc({
          channel: originalTopic.split('.')[1] || 'unknown',
          reason: error.name || 'unknown',
        });
      }

      span.setStatus({ code: SpanStatusCode.OK });
      logger.warn('Message sent to DLQ', {
        originalTopic,
        dlqTopic,
        retryCount: metadata.retryCount,
        error: error.message,
      });
    } catch (dlqError: any) {
      span.recordException(dlqError);
      span.setStatus({ code: SpanStatusCode.ERROR });
      logger.error('Failed to send message to DLQ', {
        originalTopic,
        dlqTopic,
        error: dlqError.message,
      });
      // Don't throw - we don't want to crash the consumer
    } finally {
      span.end();
    }
  }

  /**
   * Check if an error is retryable
   *
   * Non-retryable errors should go directly to DLQ:
   * - Validation errors
   * - Parse errors
   * - Schema errors
   * - 4xx HTTP errors (client errors)
   *
   * Retryable errors (temporary failures):
   * - Network errors
   * - Timeout errors
   * - 5xx HTTP errors (server errors)
   * - Rate limit errors
   */
  private isRetryableError(error: Error): boolean {
    const errorMessage = error.message.toLowerCase();
    const errorName = error.name.toLowerCase();

    // Non-retryable error patterns
    const nonRetryablePatterns = [
      'validation',
      'parse',
      'schema',
      'invalid',
      'malformed',
      'unauthorized',
      'forbidden',
      'not found',
      '400',
      '401',
      '403',
      '404',
      '422',
    ];

    for (const pattern of nonRetryablePatterns) {
      if (errorMessage.includes(pattern) || errorName.includes(pattern)) {
        return false;
      }
    }

    // Everything else is considered retryable
    return true;
  }

  /**
   * Calculate exponential backoff delay
   *
   * @param retryCount - Current retry attempt
   * @returns Delay in milliseconds
   */
  private calculateBackoffDelay(retryCount: number): number {
    // Exponential backoff: baseDelay * 2^retryCount
    // With jitter to prevent thundering herd
    const exponentialDelay = this.dlqConfig.retryDelayMs * Math.pow(2, retryCount);
    const jitter = Math.random() * 0.3 * exponentialDelay; // 0-30% jitter
    return Math.min(exponentialDelay + jitter, 60000); // Cap at 60 seconds
  }

  /**
   * Extract retry metadata from message headers
   *
   * @param message - Kafka message
   * @param topic - Topic name
   * @returns Message metadata
   */
  private extractMetadata(message: KafkaMessage, topic: string): MessageMetadata {
    const headers = message.headers || {};
    const now = Date.now();

    return {
      originalTopic: (headers['x-original-topic']?.toString() as string) || topic,
      retryCount: parseInt(headers['x-retry-count']?.toString() || '0'),
      firstAttemptTimestamp: parseInt(
        headers['x-first-attempt']?.toString() || now.toString()
      ),
      lastAttemptTimestamp: now,
    };
  }

  /**
   * Subscribe to Kafka topics with DLQ and retry support
   *
   * @param groupId - Consumer group ID
   * @param topics - Array of topic names
   * @param handler - Message handler function
   */
  async subscribe(
    groupId: string,
    topics: string[],
    handler: (event: KafkaEvent) => Promise<void>
  ): Promise<void> {
    const consumer = this.kafka.consumer({ groupId });
    await consumer.connect();
    await consumer.subscribe({ topics, fromBeginning: false });

    await consumer.run({
      eachMessage: async ({ topic, partition, message }: EachMessagePayload) => {
        const span = createSpan('kafka-consume', {
          'kafka.topic': topic,
          'kafka.partition': partition.toString(),
          'kafka.offset': message.offset,
          'consumer.group': groupId,
        });

        let metadata: MessageMetadata;
        let event: KafkaEvent;

        try {
          // Parse event
          event = JSON.parse(message.value?.toString() || '{}');
          metadata = this.extractMetadata(message, topic);

          logger.info(`Processing message from ${topic}`, {
            eventType: event.type,
            partition,
            offset: message.offset,
            retryCount: metadata.retryCount,
          });

          // Track consumption metric
          if (this.dlqConfig.metrics) {
            this.dlqConfig.metrics.kafkaMessagesConsumed.inc({
              topic,
              consumer_group: groupId,
            });
          }

          // Process the message
          await handler(event);

          span.setStatus({ code: SpanStatusCode.OK });
          logger.debug(`Successfully processed message from ${topic}`, {
            eventType: event.type,
            retryCount: metadata.retryCount,
          });
        } catch (error: any) {
          recordException(error);
          span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });

          metadata = metadata || this.extractMetadata(message, topic);

          logger.error('Failed to process message', {
            topic,
            error: error.message,
            retryCount: metadata.retryCount,
          });

          // Handle retry logic
          if (this.dlqConfig.enabled) {
            const isRetryable = this.isRetryableError(error);
            const shouldRetry = isRetryable && metadata.retryCount < this.dlqConfig.maxRetries;

            if (shouldRetry) {
              // Retry with exponential backoff
              const delay = this.calculateBackoffDelay(metadata.retryCount);

              logger.info('Scheduling message retry', {
                topic,
                retryCount: metadata.retryCount + 1,
                delayMs: delay,
              });

              // Track retry metric
              if (this.dlqConfig.metrics) {
                this.dlqConfig.metrics.notificationRetryCount.inc({
                  channel: topic.split('.')[1] || 'unknown',
                  attempt: (metadata.retryCount + 1).toString(),
                });
              }

              // Wait for backoff delay
              await new Promise((resolve) => setTimeout(resolve, delay));

              // Retry by re-publishing with updated metadata
              try {
                const producer = await this.getProducer();
                await producer.send({
                  topic,
                  messages: [
                    {
                      ...message,
                      headers: {
                        ...message.headers,
                        'x-original-topic': metadata.originalTopic,
                        'x-retry-count': (metadata.retryCount + 1).toString(),
                        'x-first-attempt': metadata.firstAttemptTimestamp.toString(),
                        'x-last-attempt': Date.now().toString(),
                      },
                    },
                  ],
                });

                logger.info('Message re-queued for retry', {
                  topic,
                  retryCount: metadata.retryCount + 1,
                });
              } catch (retryError: any) {
                logger.error('Failed to re-queue message for retry', {
                  topic,
                  error: retryError.message,
                });
                // Send to DLQ as fallback
                await this.sendToDLQ(metadata.originalTopic, message, metadata, error);
              }
            } else {
              // Send to DLQ (max retries exceeded or non-retryable error)
              const reason = !isRetryable
                ? 'non-retryable error'
                : 'max retries exceeded';

              logger.warn(`Sending message to DLQ: ${reason}`, {
                topic,
                retryCount: metadata.retryCount,
                isRetryable,
              });

              await this.sendToDLQ(metadata.originalTopic, message, metadata, error);
            }
          } else {
            // DLQ disabled, just log the error
            logger.error('Message processing failed (DLQ disabled)', {
              topic,
              error: error.message,
            });
          }
        } finally {
          span.end();
        }
      },
    });

    this.consumers.set(groupId, consumer);
    logger.info(`Consumer subscribed with DLQ support`, { groupId, topics });
  }

  /**
   * Subscribe to a DLQ topic for manual reprocessing
   *
   * @param originalTopic - Original topic name (without .dlq suffix)
   * @param handler - Reprocessing handler
   */
  async subscribeToDLQ(
    originalTopic: string,
    handler: (event: KafkaEvent, metadata: any) => Promise<void>
  ): Promise<void> {
    const dlqTopic = `${originalTopic}${this.dlqConfig.dlqTopicSuffix}`;
    const groupId = `${this.clientId}-dlq-processor`;

    const consumer = this.kafka.consumer({ groupId });
    await consumer.connect();
    await consumer.subscribe({ topics: [dlqTopic], fromBeginning: true });

    await consumer.run({
      eachMessage: async ({ topic, partition, message }: EachMessagePayload) => {
        try {
          const event = JSON.parse(message.value?.toString() || '{}');
          const headers = message.headers || {};

          const metadata = {
            originalTopic: headers['x-original-topic']?.toString(),
            retryCount: parseInt(headers['x-retry-count']?.toString() || '0'),
            firstAttempt: headers['x-first-attempt']?.toString(),
            lastAttempt: headers['x-last-attempt']?.toString(),
            errorMessage: headers['x-error-message']?.toString(),
            errorType: headers['x-error-type']?.toString(),
            dlqTimestamp: headers['x-dlq-timestamp']?.toString(),
          };

          logger.info('Processing DLQ message', {
            dlqTopic,
            originalTopic: metadata.originalTopic,
            retryCount: metadata.retryCount,
          });

          await handler(event, metadata);

          logger.info('Successfully reprocessed DLQ message', {
            dlqTopic,
            originalTopic: metadata.originalTopic,
          });
        } catch (error: any) {
          logger.error('Failed to reprocess DLQ message', {
            dlqTopic,
            error: error.message,
          });
          // Don't retry DLQ messages - they need manual intervention
        }
      },
    });

    this.consumers.set(`${groupId}-dlq`, consumer);
    logger.info('Subscribed to DLQ topic', { dlqTopic });
  }

  /**
   * Disconnect all Kafka connections
   */
  async disconnect(): Promise<void> {
    if (this.producer) {
      await this.producer.disconnect();
      logger.info('Kafka producer disconnected');
    }

    for (const [groupId, consumer] of this.consumers) {
      await consumer.disconnect();
      logger.info(`Consumer disconnected`, { groupId });
    }

    if (this.dlqConfig.metrics) {
      this.dlqConfig.metrics.updateKafkaConnectionStatus(false);
    }
  }
}

export default KafkaClientWithDLQ;
