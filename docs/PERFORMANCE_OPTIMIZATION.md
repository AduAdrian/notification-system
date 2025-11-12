# Performance Optimization Guide

## Overview

This document outlines the performance optimizations implemented in the Notification System to achieve high throughput, low latency, and efficient resource utilization.

## Table of Contents

1. [Redis Caching Strategies](#redis-caching-strategies)
2. [Database Query Optimization](#database-query-optimization)
3. [Kafka Producer/Consumer Optimization](#kafka-optimization)
4. [Connection Pooling](#connection-pooling)
5. [Compression Middleware](#compression-middleware)
6. [CDN Configuration](#cdn-configuration)
7. [Load Testing](#load-testing)
8. [Performance Monitoring](#performance-monitoring)
9. [Best Practices](#best-practices)

---

## Redis Caching Strategies

### Implementation

Located in: `C:\Users\Adrian\notification-system\shared\utils\redis-advanced.ts`

### Features

#### 1. Cache-Aside Pattern (Lazy Loading)
```typescript
const data = await redisService.getOrSet(
  'user:123:notifications',
  async () => await fetchFromDatabase(),
  3600 // TTL in seconds
);
```

**Benefits:**
- Only cache data that's actually requested
- Reduces memory usage
- Automatic cache population

#### 2. Write-Through Pattern
```typescript
await redisService.writeThrough(
  'notification:456',
  notificationData,
  async (data) => await saveToDatabase(data),
  7200
);
```

**Benefits:**
- Cache and database always in sync
- No stale data
- Atomic operations

#### 3. Cache Prefetching
```typescript
await redisService.prefetch([
  { key: 'user:1:prefs', fetchFn: () => getPreferences(1), ttl: 86400 },
  { key: 'user:2:prefs', fetchFn: () => getPreferences(2), ttl: 86400 }
]);
```

**Benefits:**
- Proactive cache warming
- Reduced cache misses
- Better user experience

#### 4. Multi-Get/Multi-Set Operations
```typescript
// Batch read
const results = await redisService.mGet(['key1', 'key2', 'key3']);

// Batch write
await redisService.mSet([
  { key: 'key1', value: data1, ttl: 3600 },
  { key: 'key2', value: data2, ttl: 3600 }
]);
```

**Benefits:**
- Reduced network round trips
- Higher throughput
- Better performance under load

#### 5. Sliding Window Rate Limiting
```typescript
const { allowed, remaining } = await redisService.rateLimitSlidingWindow(
  'user:123',
  100, // max requests
  60   // window in seconds
);
```

**Benefits:**
- More accurate than fixed window
- Prevents burst attacks
- Fair resource allocation

#### 6. Distributed Locking
```typescript
const lockValue = await redisService.acquireLock('resource:123', 10);
if (lockValue) {
  try {
    // Critical section
  } finally {
    await redisService.releaseLock('resource:123', lockValue);
  }
}
```

**Benefits:**
- Prevents race conditions
- Ensures data consistency
- Automatic expiration

### Configuration

```typescript
// config/performance.config.ts
redis: {
  primary: {
    url: 'redis://localhost:6379',
    isolationPoolOptions: { min: 2, max: 10 }
  },
  replica: {
    url: 'redis://replica:6379', // Read replica for scaling
    enabled: true
  },
  caching: {
    defaultTTL: 3600,
    notificationTTL: 7200,
    userPreferencesTTL: 86400
  }
}
```

### Performance Metrics

- **Cache Hit Rate:** Target > 85%
- **Average Response Time:** < 5ms
- **Connection Pool Utilization:** 60-80%

---

## Database Query Optimization

### Implementation

Located in: `C:\Users\Adrian\notification-system\shared\utils\database-optimized.ts`

### Features

#### 1. Connection Pooling
```typescript
const pool = new Pool({
  max: 25,        // Maximum pool size
  min: 5,         // Minimum pool size (keep warm)
  idleTimeoutMillis: 30000,
  maxUses: 7500   // Recycle connections
});
```

**Benefits:**
- Reuses connections
- Reduces connection overhead
- Better resource utilization

#### 2. Prepared Statements
```typescript
// Pre-defined and optimized
await dbService.queryPrepared('getNotificationById', [notificationId]);
```

**Benefits:**
- Query plan caching
- SQL injection prevention
- Faster execution

#### 3. Batch Operations
```typescript
await dbService.batchInsert(
  'notifications',
  ['id', 'user_id', 'message'],
  rows,
  500 // batch size
);
```

**Benefits:**
- Single database round trip
- Reduced network overhead
- Higher throughput

#### 4. Transaction Support
```typescript
await dbService.transaction(async (client) => {
  await client.query('INSERT INTO ...');
  await client.query('UPDATE ...');
  // Automatic commit/rollback
});
```

**Benefits:**
- ACID guarantees
- Automatic rollback on error
- Data consistency

#### 5. Cursor-Based Pagination
```typescript
for await (const batch of dbService.cursorQuery(query, params, 'cursor', 1000)) {
  // Process batch
}
```

**Benefits:**
- Handles large result sets
- Constant memory usage
- Efficient streaming

#### 6. Query Performance Analysis
```typescript
const plan = await dbService.explainQuery('SELECT * FROM notifications WHERE ...');
```

**Benefits:**
- Identify slow queries
- Optimize indexes
- Performance tuning

### Optimization Techniques

#### Indexing Strategy
```sql
-- Composite index for common queries
CREATE INDEX idx_user_notifications ON notifications(user_id, created_at DESC);

-- Partial index for active notifications
CREATE INDEX idx_active_notifications ON notifications(user_id) WHERE status = 'pending';

-- GIN index for JSON fields
CREATE INDEX idx_notification_metadata ON notifications USING GIN (metadata);
```

#### Query Optimization
```typescript
// Bad: SELECT *
const bad = await pool.query('SELECT * FROM notifications');

// Good: Select only needed columns
const good = await pool.query('SELECT id, message FROM notifications');

// Bad: Function on indexed column
const bad = await pool.query("SELECT * FROM notifications WHERE DATE(created_at) = '2025-01-01'");

// Good: Range query
const good = await pool.query("SELECT * FROM notifications WHERE created_at >= '2025-01-01' AND created_at < '2025-01-02'");
```

### Performance Metrics

- **Query Duration (P95):** < 100ms
- **Connection Pool Usage:** 60-80%
- **Slow Query Threshold:** > 1000ms

---

## Kafka Optimization

### Implementation

Located in: `C:\Users\Adrian\notification-system\shared\utils\kafka-optimized.ts`

### Producer Optimizations

#### 1. Batching
```typescript
const producer = kafka.producer({
  batch: {
    size: 16384,      // 16KB
    maxBytes: 1048576 // 1MB
  },
  linger: { ms: 10 }  // Wait 10ms for batching
});
```

**Benefits:**
- Reduced network calls
- Higher throughput
- Better resource utilization

#### 2. Compression
```typescript
await producer.send({
  topic: 'notifications',
  messages: [...],
  compression: CompressionTypes.GZIP
});
```

**Compression Options:**
- **GZIP:** Best compression ratio, moderate CPU
- **Snappy:** Fast, good for real-time
- **LZ4:** Very fast, modern
- **ZSTD:** Best balance (recommended)

#### 3. Idempotent Producer
```typescript
const producer = kafka.producer({
  idempotent: true,  // Exactly-once semantics
  maxInFlightRequests: 5
});
```

**Benefits:**
- Prevents duplicate messages
- Exactly-once delivery
- Data consistency

#### 4. Buffered Publishing
```typescript
await kafkaClient.publishBuffered(
  'notifications',
  event,
  { maxBufferSize: 100, flushInterval: 1000 }
);
```

**Benefits:**
- Automatic batching
- Reduced latency
- Better throughput

### Consumer Optimizations

#### 1. Parallel Processing
```typescript
await consumer.run({
  partitionsConsumedConcurrently: 3,
  eachMessage: async ({ message }) => {
    // Process message
  }
});
```

**Benefits:**
- Higher throughput
- Better CPU utilization
- Reduced lag

#### 2. Batch Processing
```typescript
await consumer.run({
  eachBatch: async ({ batch }) => {
    // Process batch of messages
    await processBatch(batch.messages);
  }
});
```

**Benefits:**
- Efficient bulk operations
- Reduced overhead
- Higher throughput

#### 3. Fetch Size Optimization
```typescript
const consumer = kafka.consumer({
  maxBytesPerPartition: 1048576, // 1MB
  maxWaitTimeInMs: 5000
});
```

**Benefits:**
- Fewer fetch requests
- Better network utilization
- Reduced latency

#### 4. Auto-commit Configuration
```typescript
await consumer.run({
  autoCommit: true,
  autoCommitInterval: 5000,
  autoCommitThreshold: 100
});
```

**Benefits:**
- Automatic offset management
- Configurable commit frequency
- Balance between safety and performance

### Topic Configuration

```typescript
kafka: {
  topics: {
    notifications: {
      numPartitions: 6,           // Parallelism
      replicationFactor: 2,       // Reliability
      retentionMs: 604800000      // 7 days
    }
  }
}
```

### Performance Metrics

- **Producer Throughput:** > 10,000 msg/s
- **Consumer Lag:** < 100 messages
- **End-to-End Latency (P95):** < 500ms

---

## Connection Pooling

### HTTP Keep-Alive

```typescript
// Express server configuration
server: {
  keepAliveTimeout: 65000,  // 65 seconds
  headersTimeout: 66000     // Slightly higher than keepAlive
}
```

### Database Connection Pool

```typescript
database: {
  postgres: {
    max: 25,                  // Maximum connections
    min: 5,                   // Minimum (keep warm)
    idleTimeoutMillis: 30000, // Close idle after 30s
    maxUses: 7500             // Recycle after uses
  }
}
```

### Redis Connection Pool

```typescript
redis: {
  isolationPoolOptions: {
    min: 2,
    max: 10
  }
}
```

### MongoDB Connection Pool

```typescript
mongodb: {
  maxPoolSize: 20,
  minPoolSize: 5,
  maxIdleTimeMS: 30000
}
```

### Best Practices

1. **Size pools appropriately:** `pool_size = (core_count * 2) + effective_spindle_count`
2. **Monitor pool usage:** Keep utilization at 60-80%
3. **Set timeouts:** Prevent resource exhaustion
4. **Recycle connections:** Prevent memory leaks

---

## Compression Middleware

### Implementation

Located in: `C:\Users\Adrian\notification-system\services\notification-service\src\middleware\compression.middleware.ts`

### Configuration

```typescript
const compressionMiddleware = compression({
  level: 6,          // Compression level (0-9)
  threshold: 1024,   // Only compress > 1KB
  filter: (req, res) => {
    // Custom filtering logic
    return compression.filter(req, res);
  }
});
```

### Usage

```typescript
app.use(compressionMiddleware);
app.use(compressionStatsMiddleware); // Optional: logging
```

### Performance Impact

| Response Size | Uncompressed | Compressed | Ratio | Time |
|--------------|--------------|------------|-------|------|
| 10 KB        | 10 KB        | 2.5 KB     | 75%   | 5ms  |
| 100 KB       | 100 KB       | 20 KB      | 80%   | 15ms |
| 1 MB         | 1 MB         | 150 KB     | 85%   | 50ms |

### Best Practices

1. **Don't compress small responses:** < 1KB overhead may exceed savings
2. **Skip already-compressed formats:** Images, videos
3. **Use appropriate level:** 6 is good balance
4. **Enable on reverse proxy:** Nginx/CloudFlare for better performance

---

## CDN Configuration

### Cloudflare Configuration

Located in: `C:\Users\Adrian\notification-system\config\cdn\cloudflare.config.json`

#### Key Features

1. **Aggressive Caching**
   - Static assets: 30 days
   - Edge cache: 30 days
   - Browser cache: 1 year

2. **Performance Features**
   - Brotli compression
   - HTTP/2 and HTTP/3
   - Early Hints
   - Image optimization

3. **Page Rules**
   ```json
   {
     "pattern": "/static/*",
     "actions": [
       { "cache_level": "cache_everything" },
       { "edge_cache_ttl": 2592000 }
     ]
   }
   ```

### CloudFront Configuration

Located in: `C:\Users\Adrian\notification-system\config\cdn\cloudfront.config.json`

#### Key Features

1. **Multiple Origins**
   - API origin (dynamic content)
   - S3 origin (static assets)

2. **Cache Behaviors**
   - `/static/*`: Long TTL
   - `/api/*`: No cache
   - `*.jpg|png|css|js`: Long TTL

3. **Origin Shield**
   - Reduces origin load
   - Better cache hit rate

### Performance Benefits

- **Response Time:** 50-90% reduction
- **Bandwidth Savings:** 70-85%
- **Origin Load:** 80-95% reduction

---

## Load Testing

### K6 Load Testing

Located in: `C:\Users\Adrian\notification-system\tests\load\k6-load-test.js`

#### Running Tests

```bash
# Smoke test (5 VUs, 1 minute)
k6 run --env BASE_URL=http://localhost:3000 k6-load-test.js

# Load test (ramp up to 100 VUs)
k6 run --stage 2m:50,5m:50,2m:100,5m:100,2m:0 k6-load-test.js

# Stress test (up to 300 VUs)
k6 run --stage 2m:100,2m:200,2m:300,5m:300,5m:0 k6-load-test.js
```

#### Test Scenarios

1. **Smoke Test:** Basic functionality (5 VUs)
2. **Load Test:** Normal load (50-100 VUs)
3. **Stress Test:** High load (300 VUs)
4. **Spike Test:** Sudden burst (500 VUs)
5. **Soak Test:** Sustained load (30 minutes)

#### Success Criteria

```javascript
thresholds: {
  'http_req_duration': ['p(95)<500'],  // 95% < 500ms
  'errors': ['rate<0.01'],              // Error rate < 1%
  'http_req_waiting': ['p(95)<200']     // TTFB < 200ms
}
```

### Artillery Load Testing

Located in: `C:\Users\Adrian\notification-system\tests\load\artillery-load-test.yml`

#### Running Tests

```bash
# Run Artillery test
artillery run artillery-load-test.yml

# With custom target
artillery run --target http://api.example.com artillery-load-test.yml

# Generate HTML report
artillery run --output report.json artillery-load-test.yml
artillery report report.json
```

#### Test Phases

1. **Warm up:** 5 req/s for 60s
2. **Ramp up:** 5 → 50 req/s over 120s
3. **Sustained:** 50 req/s for 300s
4. **Peak:** 50 → 100 req/s over 120s
5. **Cool down:** 100 → 0 req/s over 60s

#### Performance Targets

```yaml
ensure:
  maxErrorRate: 1    # Max 1% errors
  p95: 500          # P95 < 500ms
  p99: 1000         # P99 < 1000ms
```

### Best Practices

1. **Start small:** Smoke test first
2. **Gradual ramp-up:** Don't spike immediately
3. **Monitor resources:** CPU, memory, disk I/O
4. **Test in production-like environment:** Similar hardware/network
5. **Test different scenarios:** Read-heavy, write-heavy, mixed

---

## Performance Monitoring

### Prometheus + Grafana Stack

Located in: `C:\Users\Adrian\notification-system\infrastructure\monitoring\`

#### Starting Monitoring Stack

```bash
# Start monitoring services
cd infrastructure/monitoring
docker-compose -f docker-compose.monitoring.yml up -d

# Access Grafana
open http://localhost:3001
# Username: admin, Password: admin

# Access Prometheus
open http://localhost:9090
```

#### Key Metrics

**Application Metrics:**
- Request rate (req/s)
- Response time (P50, P95, P99)
- Error rate (%)
- Active connections

**Database Metrics:**
- Query duration
- Connection pool size
- Slow queries
- Deadlocks

**Redis Metrics:**
- Cache hit rate
- Memory usage
- Commands/s
- Evicted keys

**Kafka Metrics:**
- Message rate
- Consumer lag
- Partition count
- Broker health

**System Metrics:**
- CPU usage
- Memory usage
- Disk I/O
- Network traffic

#### Custom Metrics

Located in: `C:\Users\Adrian\notification-system\shared\utils\metrics.ts`

```typescript
import { metricsMiddleware, recordNotificationSent } from '@notification-system/utils';

// Add metrics middleware
app.use(metricsMiddleware('notification-service'));

// Expose metrics endpoint
app.get('/metrics', metricsHandler);

// Record custom metrics
recordNotificationSent('email', 'high', 'success');
```

#### Alerts

Configure alerts in `infrastructure/monitoring/alerts/`:

```yaml
groups:
  - name: notification-system
    rules:
      - alert: HighErrorRate
        expr: rate(http_requests_total{status=~"5.."}[5m]) > 0.05
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "High error rate detected"
```

### Performance Dashboards

1. **Overview Dashboard:** System health at a glance
2. **Application Dashboard:** Request metrics, errors
3. **Database Dashboard:** Query performance, connections
4. **Kafka Dashboard:** Message rates, lag
5. **Infrastructure Dashboard:** CPU, memory, disk

---

## Best Practices

### 1. Caching Strategy

- **Cache hot data:** Frequently accessed data
- **Set appropriate TTLs:** Balance freshness vs. performance
- **Use cache-aside pattern:** For read-heavy workloads
- **Implement cache warming:** Prefetch data
- **Monitor hit rates:** Target > 85%

### 2. Database Optimization

- **Use connection pooling:** Reuse connections
- **Create proper indexes:** Speed up queries
- **Use prepared statements:** Query plan caching
- **Batch operations:** Reduce round trips
- **Monitor slow queries:** Optimize regularly

### 3. Message Queue Optimization

- **Enable compression:** Reduce network bandwidth
- **Batch messages:** Higher throughput
- **Tune fetch size:** Balance latency vs. throughput
- **Monitor lag:** Keep it minimal
- **Use partitioning:** Increase parallelism

### 4. API Optimization

- **Enable compression:** Reduce response size
- **Implement rate limiting:** Prevent abuse
- **Use pagination:** Limit result sets
- **Cache responses:** Reduce backend load
- **Use CDN:** Offload static content

### 5. Monitoring & Alerting

- **Set up comprehensive monitoring:** Cover all layers
- **Define SLOs/SLIs:** Measure what matters
- **Configure alerts:** Be proactive
- **Regular load testing:** Prevent surprises
- **Capacity planning:** Scale before needed

### 6. Code-Level Optimizations

- **Async/await properly:** Non-blocking I/O
- **Avoid N+1 queries:** Batch database queries
- **Use connection keep-alive:** Reduce overhead
- **Implement circuit breakers:** Prevent cascading failures
- **Profile regularly:** Find bottlenecks

---

## Performance Targets

| Metric | Target | Critical |
|--------|--------|----------|
| Response Time (P95) | < 500ms | > 1000ms |
| Error Rate | < 1% | > 5% |
| Cache Hit Rate | > 85% | < 70% |
| Database Query (P95) | < 100ms | > 500ms |
| Kafka Consumer Lag | < 100 | > 1000 |
| CPU Usage | < 70% | > 90% |
| Memory Usage | < 80% | > 95% |

---

## Troubleshooting

### High Latency

1. Check database query performance
2. Verify cache hit rates
3. Monitor Kafka consumer lag
4. Check network latency
5. Review application logs

### High Error Rate

1. Check service health
2. Verify database connections
3. Monitor resource usage
4. Review error logs
5. Check dependencies

### Memory Issues

1. Check for memory leaks
2. Monitor connection pools
3. Verify cache sizes
4. Review object retention
5. Profile heap usage

### Database Performance

1. Analyze slow queries
2. Check index usage
3. Monitor connection pool
4. Verify statistics are updated
5. Consider table partitioning

---

## Additional Resources

- [Node.js Performance Best Practices](https://nodejs.org/en/docs/guides/simple-profiling/)
- [PostgreSQL Performance Tuning](https://wiki.postgresql.org/wiki/Performance_Optimization)
- [Redis Best Practices](https://redis.io/docs/manual/patterns/)
- [Kafka Performance Tuning](https://kafka.apache.org/documentation/#producerconfigs)
- [Prometheus Best Practices](https://prometheus.io/docs/practices/)

---

## Conclusion

This performance optimization guide provides a comprehensive approach to building a high-performance notification system. Regular monitoring, testing, and optimization are essential for maintaining optimal performance as the system scales.

For questions or improvements, please contact the DevOps team or create an issue in the repository.
