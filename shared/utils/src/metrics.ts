/**
 * Prometheus Metrics Utility for Notification System
 *
 * This module provides a centralized metrics collection utility following
 * Prometheus best practices for microservices monitoring.
 *
 * Best Practices Applied:
 * - Four Golden Signals: Latency, Traffic, Errors, Saturation
 * - RED Method: Rate, Errors, Duration
 * - Proper metric naming conventions (snake_case with unit suffixes)
 * - Low cardinality labels to prevent metric explosion
 * - Histogram buckets optimized for notification delivery patterns
 */

import { Registry, Counter, Histogram, Gauge, collectDefaultMetrics } from 'prom-client';
import { NotificationChannel } from '@notification-system/types';

export class MetricsCollector {
  private registry: Registry;

  // HTTP Metrics
  public httpRequestsTotal: Counter;
  public httpRequestDuration: Histogram;
  public httpRequestsInFlight: Gauge;
  public httpRequestsRateLimited: Counter;

  // Notification Delivery Metrics
  public notificationDeliveryTotal: Counter;
  public notificationDeliveryDuration: Histogram;
  public notificationDeadLetterQueue: Counter;

  // Kafka Metrics
  public kafkaMessagesProduced: Counter;
  public kafkaMessagesConsumed: Counter;
  public kafkaConsumerLag: Gauge;
  public kafkaConnected: Gauge;

  // Database Metrics
  public dbConnectionsActive: Gauge;
  public dbConnectionsIdle: Gauge;
  public dbConnectionsWaiting: Gauge;
  public dbConnectionsMax: Gauge;
  public dbQueryDuration: Histogram;
  public dbQueriesTotal: Counter;

  // Redis Metrics
  public redisConnected: Gauge;
  public redisCommandDuration: Histogram;
  public redisCommandsTotal: Counter;

  // Node.js Process Metrics
  public nodejsHeapSizeTotal: Gauge;
  public nodejsHeapSizeUsed: Gauge;
  public nodejsEventLoopLag: Histogram;

  // Custom Business Metrics
  public notificationQueueDepth: Gauge;
  public notificationRetryCount: Counter;
  public notificationBatchSize: Histogram;

  // Circuit Breaker Metrics
  public circuitBreakerState: Gauge;
  public circuitBreakerCallsTotal: Counter;
  public circuitBreakerCallDuration: Histogram;

  constructor(serviceName: string, enableDefaultMetrics: boolean = true) {
    this.registry = new Registry();
    this.registry.setDefaultLabels({ service: serviceName });

    // Collect default Node.js metrics (memory, CPU, event loop, etc.)
    if (enableDefaultMetrics) {
      collectDefaultMetrics({
        register: this.registry,
        prefix: 'nodejs_',
        gcDurationBuckets: [0.001, 0.01, 0.1, 1, 2, 5],
      });
    }

    // Initialize HTTP Metrics
    this.httpRequestsTotal = new Counter({
      name: 'http_requests_total',
      help: 'Total number of HTTP requests',
      labelNames: ['method', 'route', 'status_code'],
      registers: [this.registry],
    });

    this.httpRequestDuration = new Histogram({
      name: 'http_request_duration_seconds',
      help: 'HTTP request duration in seconds',
      labelNames: ['method', 'route', 'status_code'],
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
      registers: [this.registry],
    });

    this.httpRequestsInFlight = new Gauge({
      name: 'http_requests_in_flight',
      help: 'Current number of HTTP requests being processed',
      registers: [this.registry],
    });

    this.httpRequestsRateLimited = new Counter({
      name: 'http_requests_rate_limited_total',
      help: 'Total number of rate-limited HTTP requests',
      labelNames: ['route'],
      registers: [this.registry],
    });

    // Initialize Notification Delivery Metrics
    this.notificationDeliveryTotal = new Counter({
      name: 'notification_delivery_total',
      help: 'Total number of notification delivery attempts',
      labelNames: ['channel', 'status', 'provider'],
      registers: [this.registry],
    });

    this.notificationDeliveryDuration = new Histogram({
      name: 'notification_delivery_duration_seconds',
      help: 'Notification delivery duration in seconds',
      labelNames: ['channel', 'provider'],
      // Buckets optimized for notification delivery (typically 0.1s to 30s)
      buckets: [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60],
      registers: [this.registry],
    });

    this.notificationDeadLetterQueue = new Counter({
      name: 'notification_dead_letter_queue_total',
      help: 'Total number of notifications sent to dead letter queue',
      labelNames: ['channel', 'reason'],
      registers: [this.registry],
    });

    // Initialize Kafka Metrics
    this.kafkaMessagesProduced = new Counter({
      name: 'kafka_messages_produced_total',
      help: 'Total number of messages produced to Kafka',
      labelNames: ['topic'],
      registers: [this.registry],
    });

    this.kafkaMessagesConsumed = new Counter({
      name: 'kafka_messages_consumed_total',
      help: 'Total number of messages consumed from Kafka',
      labelNames: ['topic', 'consumer_group'],
      registers: [this.registry],
    });

    this.kafkaConsumerLag = new Gauge({
      name: 'kafka_consumer_lag',
      help: 'Current Kafka consumer lag',
      labelNames: ['topic', 'partition', 'consumer_group'],
      registers: [this.registry],
    });

    this.kafkaConnected = new Gauge({
      name: 'kafka_connected',
      help: 'Kafka connection status (1 = connected, 0 = disconnected)',
      registers: [this.registry],
    });

    // Initialize Database Metrics
    this.dbConnectionsActive = new Gauge({
      name: 'db_connections_active',
      help: 'Current number of active database connections',
      registers: [this.registry],
    });

    this.dbConnectionsIdle = new Gauge({
      name: 'db_connections_idle',
      help: 'Current number of idle database connections',
      registers: [this.registry],
    });

    this.dbConnectionsWaiting = new Gauge({
      name: 'db_connections_waiting',
      help: 'Current number of clients waiting for a database connection',
      registers: [this.registry],
    });

    this.dbConnectionsMax = new Gauge({
      name: 'db_connections_max',
      help: 'Maximum number of database connections',
      registers: [this.registry],
    });

    this.dbQueryDuration = new Histogram({
      name: 'db_query_duration_seconds',
      help: 'Database query duration in seconds',
      labelNames: ['operation', 'table'],
      buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
      registers: [this.registry],
    });

    this.dbQueriesTotal = new Counter({
      name: 'db_queries_total',
      help: 'Total number of database queries',
      labelNames: ['operation', 'table', 'status'],
      registers: [this.registry],
    });

    // Initialize Redis Metrics
    this.redisConnected = new Gauge({
      name: 'redis_connected',
      help: 'Redis connection status (1 = connected, 0 = disconnected)',
      registers: [this.registry],
    });

    this.redisCommandDuration = new Histogram({
      name: 'redis_command_duration_seconds',
      help: 'Redis command duration in seconds',
      labelNames: ['command'],
      buckets: [0.0001, 0.0005, 0.001, 0.005, 0.01, 0.025, 0.05, 0.1],
      registers: [this.registry],
    });

    this.redisCommandsTotal = new Counter({
      name: 'redis_commands_total',
      help: 'Total number of Redis commands',
      labelNames: ['command', 'status'],
      registers: [this.registry],
    });

    // Initialize Custom Business Metrics
    this.notificationQueueDepth = new Gauge({
      name: 'notification_queue_depth',
      help: 'Current depth of notification queue',
      labelNames: ['channel'],
      registers: [this.registry],
    });

    this.notificationRetryCount = new Counter({
      name: 'notification_retry_total',
      help: 'Total number of notification retry attempts',
      labelNames: ['channel', 'attempt'],
      registers: [this.registry],
    });

    this.notificationBatchSize = new Histogram({
      name: 'notification_batch_size',
      help: 'Size of notification batches being processed',
      labelNames: ['channel'],
      buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000],
      registers: [this.registry],
    });

    // Initialize Circuit Breaker Metrics
    this.circuitBreakerState = new Gauge({
      name: 'circuit_breaker_state',
      help: 'Circuit breaker state (0 = closed, 1 = half-open, 2 = open)',
      labelNames: ['name'],
      registers: [this.registry],
    });

    this.circuitBreakerCallsTotal = new Counter({
      name: 'circuit_breaker_calls_total',
      help: 'Total number of circuit breaker calls',
      labelNames: ['name', 'status'],
      registers: [this.registry],
    });

    this.circuitBreakerCallDuration = new Histogram({
      name: 'circuit_breaker_call_duration_seconds',
      help: 'Circuit breaker call duration in seconds',
      labelNames: ['name'],
      buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10, 30],
      registers: [this.registry],
    });
  }

  /**
   * Get metrics in Prometheus format
   */
  public async getMetrics(): Promise<string> {
    return this.registry.metrics();
  }

  /**
   * Get metrics registry
   */
  public getRegistry(): Registry {
    return this.registry;
  }

  /**
   * Helper method to track HTTP request
   */
  public trackHttpRequest(
    method: string,
    route: string,
    statusCode: number,
    durationSeconds: number
  ): void {
    this.httpRequestsTotal.inc({ method, route, status_code: statusCode });
    this.httpRequestDuration.observe({ method, route, status_code: statusCode }, durationSeconds);
  }

  /**
   * Helper method to track notification delivery
   */
  public trackNotificationDelivery(
    channel: NotificationChannel | string,
    status: 'success' | 'failed',
    provider: string,
    durationSeconds: number
  ): void {
    this.notificationDeliveryTotal.inc({ channel, status, provider });
    this.notificationDeliveryDuration.observe({ channel, provider }, durationSeconds);
  }

  /**
   * Helper method to track database query
   */
  public trackDbQuery(
    operation: string,
    table: string,
    status: 'success' | 'error',
    durationSeconds: number
  ): void {
    this.dbQueriesTotal.inc({ operation, table, status });
    this.dbQueryDuration.observe({ operation, table }, durationSeconds);
  }

  /**
   * Helper method to track Redis command
   */
  public trackRedisCommand(
    command: string,
    status: 'success' | 'error',
    durationSeconds: number
  ): void {
    this.redisCommandsTotal.inc({ command, status });
    this.redisCommandDuration.observe({ command }, durationSeconds);
  }

  /**
   * Update database connection pool metrics
   */
  public updateDbConnectionPool(active: number, idle: number, waiting: number, max: number): void {
    this.dbConnectionsActive.set(active);
    this.dbConnectionsIdle.set(idle);
    this.dbConnectionsWaiting.set(waiting);
    this.dbConnectionsMax.set(max);
  }

  /**
   * Update Kafka connection status
   */
  public updateKafkaConnectionStatus(connected: boolean): void {
    this.kafkaConnected.set(connected ? 1 : 0);
  }

  /**
   * Update Redis connection status
   */
  public updateRedisConnectionStatus(connected: boolean): void {
    this.redisConnected.set(connected ? 1 : 0);
  }

  /**
   * Record circuit breaker state change
   */
  public recordCircuitBreakerState(name: string, state: 'open' | 'half-open' | 'closed'): void {
    const stateValue = state === 'closed' ? 0 : state === 'half-open' ? 1 : 2;
    this.circuitBreakerState.set({ name }, stateValue);
  }

  /**
   * Record circuit breaker call
   */
  public recordCircuitBreakerCall(
    name: string,
    status: 'success' | 'failure' | 'timeout' | 'rejected' | 'fallback',
    durationSeconds?: number
  ): void {
    this.circuitBreakerCallsTotal.inc({ name, status });
    if (durationSeconds !== undefined) {
      this.circuitBreakerCallDuration.observe({ name }, durationSeconds);
    }
  }
}

/**
 * Express middleware for automatic HTTP metrics collection
 */
export function metricsMiddleware(metrics: MetricsCollector) {
  return (req: any, res: any, next: any) => {
    const start = Date.now();

    // Increment in-flight requests
    metrics.httpRequestsInFlight.inc();

    // Track when response finishes
    res.on('finish', () => {
      const duration = (Date.now() - start) / 1000; // Convert to seconds
      const route = req.route?.path || req.path || 'unknown';

      metrics.trackHttpRequest(
        req.method,
        route,
        res.statusCode,
        duration
      );

      // Decrement in-flight requests
      metrics.httpRequestsInFlight.dec();
    });

    next();
  };
}

/**
 * Create a timer function for measuring operation duration
 */
export function createTimer() {
  const start = Date.now();
  return () => (Date.now() - start) / 1000; // Returns duration in seconds
}
