# Metrics Reference Guide

Quick reference for developers using the Notification System metrics library.

## Table of Contents
- [Quick Start](#quick-start)
- [MetricsCollector API](#metricscollector-api)
- [Common Patterns](#common-patterns)
- [Metric Types](#metric-types)
- [Example Queries](#example-queries)

## Quick Start

### 1. Add Dependency

Already included in `@notification-system/utils`:

```typescript
import { MetricsCollector, metricsMiddleware, createTimer } from '@notification-system/utils';
```

### 2. Initialize Metrics

```typescript
// In your service main file
const metrics = new MetricsCollector('my-service-name');
```

### 3. Add HTTP Middleware (Express)

```typescript
app.use(metricsMiddleware(metrics));
```

### 4. Expose Metrics Endpoint

```typescript
app.get('/metrics', async (req, res) => {
  res.set('Content-Type', metrics.getRegistry().contentType);
  res.end(await metrics.getMetrics());
});
```

## MetricsCollector API

### Constructor

```typescript
new MetricsCollector(serviceName: string, enableDefaultMetrics?: boolean)
```

**Parameters:**
- `serviceName`: Name of your service (used as label)
- `enableDefaultMetrics`: Enable Node.js default metrics (default: true)

**Example:**
```typescript
const metrics = new MetricsCollector('email-service', true);
```

### Helper Methods

#### trackHttpRequest()

Automatically track HTTP request metrics.

```typescript
trackHttpRequest(
  method: string,
  route: string,
  statusCode: number,
  durationSeconds: number
): void
```

**Example:**
```typescript
const start = Date.now();
// ... handle request ...
const duration = (Date.now() - start) / 1000;
metrics.trackHttpRequest('POST', '/api/notifications', 200, duration);
```

**Better:** Use middleware (automatic):
```typescript
app.use(metricsMiddleware(metrics));
```

#### trackNotificationDelivery()

Track notification delivery attempts.

```typescript
trackNotificationDelivery(
  channel: NotificationChannel | string,
  status: 'success' | 'failed',
  provider: string,
  durationSeconds: number
): void
```

**Example:**
```typescript
const endTimer = createTimer();
try {
  await sendEmail(payload);
  metrics.trackNotificationDelivery('email', 'success', 'sendgrid', endTimer());
} catch (error) {
  metrics.trackNotificationDelivery('email', 'failed', 'sendgrid', endTimer());
}
```

#### trackDbQuery()

Track database query performance.

```typescript
trackDbQuery(
  operation: string,
  table: string,
  status: 'success' | 'error',
  durationSeconds: number
): void
```

**Example:**
```typescript
const timer = createTimer();
try {
  const result = await db.query('SELECT * FROM notifications WHERE id = $1', [id]);
  metrics.trackDbQuery('SELECT', 'notifications', 'success', timer());
  return result;
} catch (error) {
  metrics.trackDbQuery('SELECT', 'notifications', 'error', timer());
  throw error;
}
```

#### trackRedisCommand()

Track Redis command performance.

```typescript
trackRedisCommand(
  command: string,
  status: 'success' | 'error',
  durationSeconds: number
): void
```

**Example:**
```typescript
const timer = createTimer();
try {
  const value = await redis.get('user:123');
  metrics.trackRedisCommand('GET', 'success', timer());
  return value;
} catch (error) {
  metrics.trackRedisCommand('GET', 'error', timer());
  throw error;
}
```

#### updateDbConnectionPool()

Update database connection pool metrics.

```typescript
updateDbConnectionPool(
  active: number,
  idle: number,
  waiting: number,
  max: number
): void
```

**Example:**
```typescript
// Update every 5 seconds
setInterval(() => {
  const pool = dbService.getPoolStatus();
  metrics.updateDbConnectionPool(
    pool.active,
    pool.idle,
    pool.waiting,
    pool.max
  );
}, 5000);
```

#### updateKafkaConnectionStatus()

Track Kafka connection status.

```typescript
updateKafkaConnectionStatus(connected: boolean): void
```

**Example:**
```typescript
// On connection
kafkaClient.on('connect', () => {
  metrics.updateKafkaConnectionStatus(true);
});

// On disconnect
kafkaClient.on('disconnect', () => {
  metrics.updateKafkaConnectionStatus(false);
});
```

#### updateRedisConnectionStatus()

Track Redis connection status.

```typescript
updateRedisConnectionStatus(connected: boolean): void
```

**Example:**
```typescript
redisClient.on('ready', () => {
  metrics.updateRedisConnectionStatus(true);
});

redisClient.on('error', () => {
  metrics.updateRedisConnectionStatus(false);
});
```

### Direct Metric Access

Access individual metrics directly:

```typescript
// Counters
metrics.httpRequestsTotal.inc({ method: 'GET', route: '/health', status_code: 200 });
metrics.kafkaMessagesProduced.inc({ topic: 'notifications' });

// Gauges
metrics.notificationQueueDepth.set({ channel: 'email' }, 42);
metrics.kafkaConnected.set(1); // 1 = connected, 0 = disconnected

// Histograms
metrics.httpRequestDuration.observe({ method: 'POST', route: '/api/notifications' }, 0.523);
metrics.notificationBatchSize.observe({ channel: 'sms' }, 100);
```

## Common Patterns

### Pattern 1: Timed Operation

```typescript
import { createTimer } from '@notification-system/utils';

async function performOperation() {
  const endTimer = createTimer();

  try {
    // ... your operation ...
    const duration = endTimer();
    logger.info('Operation completed', { duration });
    return result;
  } catch (error) {
    const duration = endTimer();
    logger.error('Operation failed', { duration, error });
    throw error;
  }
}
```

### Pattern 2: Track with Retry

```typescript
async function sendWithRetry(notification: Notification, maxRetries = 3) {
  let attempt = 0;

  while (attempt < maxRetries) {
    const endTimer = createTimer();
    attempt++;

    try {
      await send(notification);
      metrics.trackNotificationDelivery(
        notification.channel,
        'success',
        'provider',
        endTimer()
      );
      return;
    } catch (error) {
      metrics.notificationRetryCount.inc({
        channel: notification.channel,
        attempt: attempt.toString()
      });

      if (attempt === maxRetries) {
        metrics.trackNotificationDelivery(
          notification.channel,
          'failed',
          'provider',
          endTimer()
        );
        metrics.notificationDeadLetterQueue.inc({
          channel: notification.channel,
          reason: 'max_retries_exceeded'
        });
        throw error;
      }
    }
  }
}
```

### Pattern 3: Batch Processing

```typescript
async function processBatch(notifications: Notification[]) {
  const batchSize = notifications.length;
  const channel = notifications[0].channel;

  metrics.notificationBatchSize.observe({ channel }, batchSize);

  const endTimer = createTimer();
  const results = await Promise.allSettled(
    notifications.map(n => send(n))
  );
  const duration = endTimer();

  const successful = results.filter(r => r.status === 'fulfilled').length;
  const failed = results.filter(r => r.status === 'rejected').length;

  // Track each result
  for (let i = 0; i < successful; i++) {
    metrics.notificationDeliveryTotal.inc({ channel, status: 'success', provider: 'batch' });
  }
  for (let i = 0; i < failed; i++) {
    metrics.notificationDeliveryTotal.inc({ channel, status: 'failed', provider: 'batch' });
  }

  logger.info('Batch processed', {
    batchSize,
    successful,
    failed,
    duration,
    successRate: successful / batchSize
  });
}
```

### Pattern 4: Queue Monitoring

```typescript
class QueueMonitor {
  constructor(private metrics: MetricsCollector) {
    // Update queue depth every 10 seconds
    setInterval(() => this.updateQueueMetrics(), 10000);
  }

  private async updateQueueMetrics() {
    const channels = ['email', 'sms', 'push', 'inapp'];

    for (const channel of channels) {
      const depth = await this.getQueueDepth(channel);
      this.metrics.notificationQueueDepth.set({ channel }, depth);
    }
  }

  private async getQueueDepth(channel: string): Promise<number> {
    // Get queue depth from Kafka/Redis/etc.
    return 0; // implement based on your queue system
  }
}
```

## Metric Types

### Counter
Monotonically increasing value (can only go up).

**Use for:**
- Request counts
- Error counts
- Messages processed
- Events occurred

**Example:**
```typescript
metrics.httpRequestsTotal.inc({ method: 'POST', route: '/api', status_code: 200 });
```

### Gauge
Value that can go up or down.

**Use for:**
- Current queue depth
- Active connections
- Memory usage
- Temperature readings

**Example:**
```typescript
metrics.notificationQueueDepth.set({ channel: 'email' }, 42);
```

### Histogram
Samples observations and counts them in configurable buckets.

**Use for:**
- Request durations
- Response sizes
- Batch sizes

**Example:**
```typescript
metrics.httpRequestDuration.observe({ method: 'GET', route: '/health' }, 0.023);
```

**Query for percentiles:**
```promql
histogram_quantile(0.95,
  sum(rate(http_request_duration_seconds_bucket[5m])) by (le)
)
```

## Example Queries

### HTTP Metrics

```promql
# Request rate per second
rate(http_requests_total[5m])

# Error rate
sum(rate(http_requests_total{status_code=~"5.."}[5m])) by (service)

# P95 latency
histogram_quantile(0.95,
  sum(rate(http_request_duration_seconds_bucket[5m])) by (le, service)
)

# Requests by status code
sum(rate(http_requests_total[5m])) by (status_code)
```

### Notification Metrics

```promql
# Total notifications sent
sum(notification_delivery_total)

# Success rate
sum(rate(notification_delivery_total{status="success"}[5m]))
/
sum(rate(notification_delivery_total[5m]))

# Success rate by channel
sum(rate(notification_delivery_total{status="success"}[5m])) by (channel)
/
sum(rate(notification_delivery_total[5m])) by (channel)

# P99 delivery latency
histogram_quantile(0.99,
  sum(rate(notification_delivery_duration_seconds_bucket[5m])) by (le, channel)
)

# Current queue depth
notification_queue_depth

# Dead letter queue rate
rate(notification_dead_letter_queue_total[5m])
```

### Infrastructure Metrics

```promql
# Database connections
db_connections_active
db_connections_idle
db_connections_waiting

# Connection pool utilization
db_connections_active / db_connections_max

# Slow queries (>100ms)
histogram_quantile(0.95,
  sum(rate(db_query_duration_seconds_bucket[5m])) by (le, operation)
) > 0.1

# Kafka consumer lag
kafka_consumer_lag

# Redis command latency
histogram_quantile(0.95,
  sum(rate(redis_command_duration_seconds_bucket[5m])) by (le, command)
)
```

### Node.js Metrics

```promql
# Heap memory usage
nodejs_heap_size_used_bytes / nodejs_heap_size_total_bytes

# Memory growth rate
rate(nodejs_heap_size_used_bytes[5m])

# CPU usage
rate(process_cpu_seconds_total[5m])

# Event loop lag
nodejs_eventloop_lag_seconds
```

## Best Practices

### DO ✅

1. **Use meaningful labels**
   ```typescript
   metrics.notificationDeliveryTotal.inc({
     channel: 'email',
     status: 'success',
     provider: 'sendgrid'
   });
   ```

2. **Keep cardinality low**
   - Avoid user IDs, request IDs as labels
   - Use fixed sets of label values

3. **Use helper methods**
   ```typescript
   metrics.trackNotificationDelivery('email', 'success', 'sendgrid', duration);
   // vs manually incrementing counters
   ```

4. **Track duration with timers**
   ```typescript
   const endTimer = createTimer();
   await operation();
   const duration = endTimer();
   ```

### DON'T ❌

1. **Don't use high-cardinality labels**
   ```typescript
   // BAD - unique values
   metrics.httpRequestsTotal.inc({ user_id: '12345' });
   metrics.httpRequestsTotal.inc({ request_id: 'uuid-...' });
   ```

2. **Don't create metrics dynamically**
   ```typescript
   // BAD
   const newMetric = new Counter({ name: 'dynamic_metric_' + Date.now() });
   ```

3. **Don't track metrics for every single item in high-volume scenarios**
   ```typescript
   // BAD - if processing millions
   for (const item of millionItems) {
     metrics.itemProcessed.inc();
   }

   // GOOD - use batch metrics
   metrics.batchSize.observe(millionItems.length);
   ```

4. **Don't forget to handle errors in tracking**
   ```typescript
   // GOOD
   try {
     await operation();
     metrics.track('success');
   } catch (error) {
     metrics.track('failed');
     throw error; // re-throw
   }
   ```

## Troubleshooting

### Metrics not appearing

```typescript
// Check metrics are being collected
console.log(await metrics.getMetrics());

// Verify endpoint is accessible
curl http://localhost:3000/metrics

// Check Prometheus is scraping
// Visit: http://localhost:9090/targets
```

### High memory usage

```typescript
// Check metric cardinality
curl http://localhost:9090/api/v1/label/__name__/values | jq length

// Check specific metric cardinality
curl http://localhost:9090/api/v1/series?match[]={__name__="metric_name"} | jq length
```

### Incorrect values

```typescript
// For counters - make sure you're using .inc() not .set()
metrics.httpRequestsTotal.inc(); // ✅
metrics.httpRequestsTotal.set(1); // ❌

// For gauges - make sure you're using .set() not .inc()
metrics.queueDepth.set(42); // ✅
metrics.queueDepth.inc(); // ❌ (unless tracking changes)
```

## Resources

- [Prometheus Client Documentation](https://github.com/siimon/prom-client)
- [Prometheus Best Practices](https://prometheus.io/docs/practices/naming/)
- [Grafana Dashboard Best Practices](https://grafana.com/docs/grafana/latest/dashboards/build-dashboards/best-practices/)
- [System Monitoring README](./README.md)
- [Quick Start Guide](./QUICKSTART.md)

---

For questions or issues, consult the main [Monitoring README](./README.md) or contact the SRE team.
