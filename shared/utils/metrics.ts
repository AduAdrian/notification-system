import { register, collectDefaultMetrics, Counter, Histogram, Gauge } from 'prom-client';
import { Request, Response, NextFunction } from 'express';
import { createLogger } from './logger';

const logger = createLogger('metrics');

/**
 * Prometheus Metrics Configuration
 * Exposes custom application metrics for monitoring
 */

// Enable default metrics (CPU, memory, etc.)
collectDefaultMetrics({
  prefix: 'notification_system_',
  timeout: 10000,
  gcDurationBuckets: [0.001, 0.01, 0.1, 1, 2, 5],
});

// Custom Metrics

// HTTP Request Counter
export const httpRequestsTotal = new Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'path', 'status', 'service'],
});

// HTTP Request Duration Histogram
export const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'path', 'status', 'service'],
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10],
});

// Active Connections Gauge
export const activeConnections = new Gauge({
  name: 'active_connections',
  help: 'Number of active connections',
  labelNames: ['service'],
});

// Notifications Counter
export const notificationsSentTotal = new Counter({
  name: 'notifications_sent_total',
  help: 'Total number of notifications sent',
  labelNames: ['channel', 'priority', 'status'],
});

// Notification Processing Duration
export const notificationProcessingDuration = new Histogram({
  name: 'notification_processing_duration_seconds',
  help: 'Notification processing duration in seconds',
  labelNames: ['channel', 'priority'],
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60],
});

// Database Query Metrics
export const dbQueryDuration = new Histogram({
  name: 'db_query_duration_seconds',
  help: 'Database query duration in seconds',
  labelNames: ['query', 'operation'],
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5],
});

export const dbConnectionPoolSize = new Gauge({
  name: 'db_connection_pool_size',
  help: 'Database connection pool size',
  labelNames: ['status'], // active, idle, waiting
});

// Redis Metrics
export const redisOperationDuration = new Histogram({
  name: 'redis_operation_duration_seconds',
  help: 'Redis operation duration in seconds',
  labelNames: ['operation'],
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1],
});

export const redisCacheHits = new Counter({
  name: 'redis_cache_hits_total',
  help: 'Total number of Redis cache hits',
  labelNames: ['cache_key'],
});

export const redisCacheMisses = new Counter({
  name: 'redis_cache_misses_total',
  help: 'Total number of Redis cache misses',
  labelNames: ['cache_key'],
});

// Kafka Metrics
export const kafkaMessagesProduced = new Counter({
  name: 'kafka_messages_produced_total',
  help: 'Total number of Kafka messages produced',
  labelNames: ['topic'],
});

export const kafkaMessagesConsumed = new Counter({
  name: 'kafka_messages_consumed_total',
  help: 'Total number of Kafka messages consumed',
  labelNames: ['topic', 'consumer_group'],
});

export const kafkaConsumerLag = new Gauge({
  name: 'kafka_consumer_lag',
  help: 'Kafka consumer lag',
  labelNames: ['topic', 'partition', 'consumer_group'],
});

export const kafkaProduceDuration = new Histogram({
  name: 'kafka_produce_duration_seconds',
  help: 'Kafka produce operation duration in seconds',
  labelNames: ['topic'],
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5],
});

// Error Counter
export const errorsTotal = new Counter({
  name: 'errors_total',
  help: 'Total number of errors',
  labelNames: ['type', 'service', 'severity'],
});

// Business Metrics
export const notificationsByChannel = new Counter({
  name: 'notifications_by_channel_total',
  help: 'Total notifications by channel',
  labelNames: ['channel'],
});

export const notificationsByPriority = new Counter({
  name: 'notifications_by_priority_total',
  help: 'Total notifications by priority',
  labelNames: ['priority'],
});

export const failedNotifications = new Counter({
  name: 'failed_notifications_total',
  help: 'Total number of failed notifications',
  labelNames: ['channel', 'error_type'],
});

/**
 * Express middleware to collect HTTP metrics
 */
export function metricsMiddleware(serviceName: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();

    // Track active connections
    activeConnections.inc({ service: serviceName });

    // Override res.end to capture response metrics
    const originalEnd = res.end;
    res.end = function (this: Response, ...args: any[]): Response {
      const duration = (Date.now() - start) / 1000;

      // Record metrics
      httpRequestsTotal.inc({
        method: req.method,
        path: req.route?.path || req.path,
        status: res.statusCode.toString(),
        service: serviceName,
      });

      httpRequestDuration.observe(
        {
          method: req.method,
          path: req.route?.path || req.path,
          status: res.statusCode.toString(),
          service: serviceName,
        },
        duration
      );

      // Track errors
      if (res.statusCode >= 400) {
        errorsTotal.inc({
          type: res.statusCode >= 500 ? 'server_error' : 'client_error',
          service: serviceName,
          severity: res.statusCode >= 500 ? 'high' : 'medium',
        });
      }

      // Decrease active connections
      activeConnections.dec({ service: serviceName });

      // Call original end
      return originalEnd.apply(this, args);
    };

    next();
  };
}

/**
 * Metrics endpoint handler
 */
export async function metricsHandler(req: Request, res: Response) {
  try {
    res.set('Content-Type', register.contentType);
    const metrics = await register.metrics();
    res.end(metrics);
  } catch (error) {
    logger.error('Failed to generate metrics', { error });
    res.status(500).end('Failed to generate metrics');
  }
}

/**
 * Helper to track database query performance
 */
export function trackDbQuery<T>(
  queryName: string,
  operation: string,
  queryFn: () => Promise<T>
): Promise<T> {
  const end = dbQueryDuration.startTimer({ query: queryName, operation });

  return queryFn()
    .then((result) => {
      end();
      return result;
    })
    .catch((error) => {
      end();
      errorsTotal.inc({ type: 'database_error', service: 'database', severity: 'high' });
      throw error;
    });
}

/**
 * Helper to track Redis operations
 */
export function trackRedisOperation<T>(
  operation: string,
  operationFn: () => Promise<T>
): Promise<T> {
  const end = redisOperationDuration.startTimer({ operation });

  return operationFn()
    .then((result) => {
      end();
      return result;
    })
    .catch((error) => {
      end();
      errorsTotal.inc({ type: 'redis_error', service: 'redis', severity: 'medium' });
      throw error;
    });
}

/**
 * Helper to track Kafka produce
 */
export function trackKafkaProduce<T>(
  topic: string,
  produceFn: () => Promise<T>
): Promise<T> {
  const end = kafkaProduceDuration.startTimer({ topic });

  return produceFn()
    .then((result) => {
      end();
      kafkaMessagesProduced.inc({ topic });
      return result;
    })
    .catch((error) => {
      end();
      errorsTotal.inc({ type: 'kafka_error', service: 'kafka', severity: 'high' });
      throw error;
    });
}

/**
 * Update database connection pool metrics
 */
export function updateDbPoolMetrics(stats: { total: number; idle: number; waiting: number }) {
  dbConnectionPoolSize.set({ status: 'total' }, stats.total);
  dbConnectionPoolSize.set({ status: 'idle' }, stats.idle);
  dbConnectionPoolSize.set({ status: 'waiting' }, stats.waiting);
  dbConnectionPoolSize.set({ status: 'active' }, stats.total - stats.idle);
}

/**
 * Record notification sent
 */
export function recordNotificationSent(channel: string, priority: string, status: 'success' | 'failed') {
  notificationsSentTotal.inc({ channel, priority, status });
  notificationsByChannel.inc({ channel });
  notificationsByPriority.inc({ priority });

  if (status === 'failed') {
    failedNotifications.inc({ channel, error_type: 'unknown' });
  }
}

/**
 * Clear all metrics (useful for testing)
 */
export function clearMetrics() {
  register.clear();
}

export { register };

export default {
  metricsMiddleware,
  metricsHandler,
  trackDbQuery,
  trackRedisOperation,
  trackKafkaProduce,
  updateDbPoolMetrics,
  recordNotificationSent,
  clearMetrics,
  register,
};
