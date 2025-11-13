# Rate Limiting and Caching Guide

## Overview

This guide covers the advanced rate limiting and caching strategies implemented in the notification system, following 2025 best practices for distributed microservices.

## Table of Contents

1. [Rate Limiting](#rate-limiting)
2. [Caching Strategies](#caching-strategies)
3. [Cache Invalidation](#cache-invalidation)
4. [Configuration](#configuration)
5. [Monitoring](#monitoring)
6. [Best Practices](#best-practices)
7. [Troubleshooting](#troubleshooting)

---

## Rate Limiting

### Token Bucket Algorithm

The system uses the **Token Bucket algorithm** for rate limiting, providing smooth rate limiting with burst allowance.

#### How It Works

1. Each identifier (user/IP/API key) has a "bucket" with fixed capacity
2. Tokens refill at a constant rate
3. Each request consumes tokens from the bucket
4. Requests are allowed if sufficient tokens exist
5. Supports burst traffic via burst multiplier

#### Advantages

- **Smooth rate limiting**: No sharp boundaries like fixed windows
- **Burst allowance**: Handles temporary traffic spikes
- **Distributed**: Works across multiple service instances via Redis
- **Atomic operations**: Uses Lua scripts for race-condition-free operations
- **Fail-safe**: Fails open if Redis is unavailable

### Implementation

```typescript
import { TokenBucketLimiter } from '@notification-system/utils';

const limiter = new TokenBucketLimiter({
  capacity: 100,           // Max tokens in bucket
  refillRate: 10,          // Tokens per second
  redisClient: redis,
  burstMultiplier: 1.5,    // Allow 150% burst
});

// Check rate limit
const result = await limiter.check('user:123');
if (!result.allowed) {
  console.log(`Rate limited. Retry after ${result.retryAfter}s`);
}
```

### Rate Limit Response Headers

```http
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 45
X-RateLimit-Reset: 2025-01-15T10:30:00Z
Retry-After: 30
```

### Per-Identifier Types

The system supports three identifier types:

1. **User-based**: `user:{userId}` (authenticated users)
2. **API Key-based**: `apikey:{apiKey}` (API consumers)
3. **IP-based**: `ip:{ipAddress}` (fallback for anonymous)

Priority: User > API Key > IP

### Middleware Usage

#### Basic Usage

```typescript
import { createRateLimitMiddleware } from '@notification-system/utils';

app.use(createRateLimitMiddleware(redis, {
  capacity: 100,
  refillRate: 10,
}));
```

#### Pre-configured Middlewares

```typescript
import { RateLimitMiddlewares } from '@notification-system/utils';

const rateLimits = new RateLimitMiddlewares(redis);

// Strict for auth endpoints
app.post('/auth/login', rateLimits.auth());

// Standard for API
app.use('/api', rateLimits.api());

// Generous for authenticated users
app.use('/api', authMiddleware, rateLimits.authenticated());

// Strict for expensive operations
app.post('/api/bulk-send', rateLimits.expensive());
```

#### Per-Endpoint Limits

```typescript
const endpointLimits = rateLimits.perEndpoint({
  '/api/notifications': { capacity: 100, refillRate: 10 },
  '/api/bulk-send': { capacity: 10, refillRate: 1 },
  '/api/reports': { capacity: 50, refillRate: 5 },
});

app.use(endpointLimits);
```

#### Combined Limits (User + IP)

```typescript
app.use(rateLimits.combined(
  { capacity: 100, refillRate: 10 },  // Per user
  { capacity: 50, refillRate: 5 }     // Per IP
));
```

---

## Caching Strategies

### 1. Cache-Aside (Lazy Loading)

**Best for**: Read-heavy workloads, data that changes infrequently

**Pattern**: Application checks cache first, loads from DB on miss, then caches result.

```typescript
import { CacheAsideStrategy } from '@notification-system/utils';

const cache = new CacheAsideStrategy(redis, 'user-cache');

// Get with automatic fallback
const user = await cache.get(
  'user:123',
  async () => {
    // This only runs on cache miss
    return await database.getUser('123');
  },
  { ttl: 3600 }  // 1 hour
);

// Get multiple with batch optimization
const users = await cache.getMany(
  ['user:123', 'user:456'],
  async (missingIds) => {
    // Only fetches missing keys
    return await database.getUsersByIds(missingIds);
  },
  { ttl: 3600 }
);
```

**When to use**:
- User preferences
- Notification templates
- Read-heavy reference data

### 2. Write-Through

**Best for**: Consistency-critical data, write-heavy workloads

**Pattern**: Updates cache and database synchronously.

```typescript
import { WriteThroughStrategy } from '@notification-system/utils';

const cache = new WriteThroughStrategy(redis, 'user-quota');

// Write to both cache and DB
await cache.set(
  'quota:user:123',
  { used: 50, limit: 100 },
  async (data) => {
    // Write to database
    await database.updateUserQuota('123', data);
  },
  { ttl: 3600 }
);

// Read with fallback
const quota = await cache.get(
  'quota:user:123',
  async () => await database.getUserQuota('123')
);
```

**When to use**:
- User quotas and limits
- Configuration data
- Data requiring strong consistency

### 3. Write-Behind (Write-Back)

**Best for**: Write-heavy scenarios, eventual consistency acceptable

**Pattern**: Writes to cache immediately, persists to DB asynchronously in batches.

```typescript
import { WriteBehindStrategy } from '@notification-system/utils';

const cache = new WriteBehindStrategy(redis, 'analytics', {
  flushIntervalMs: 5000,  // Flush every 5 seconds
  batchSize: 100,         // Or when 100 items queued
});

// Write to cache (returns immediately)
await cache.set(
  'analytics:event:123',
  { userId: '123', event: 'click', timestamp: Date.now() },
  async (entries) => {
    // Batch write to database
    await database.bulkInsertAnalytics(Array.from(entries.values()));
  }
);

// Manual flush
await cache.flush();

// Cleanup on shutdown
await cache.destroy();
```

**When to use**:
- Analytics and metrics
- Logging and audit trails
- High-throughput write scenarios

### 4. Cache Warming

**Best for**: Predictable access patterns, critical data

**Pattern**: Preload data into cache before it's requested.

```typescript
import { CacheWarmingStrategy } from '@notification-system/utils';

const warming = new CacheWarmingStrategy(redis, 'preload');

// Warm cache on startup
await warming.warm([
  {
    key: 'template:welcome',
    dataSource: async () => await database.getTemplate('welcome'),
    ttl: 86400,  // 24 hours
  },
  {
    key: 'config:notifications',
    dataSource: async () => await database.getConfig(),
    ttl: 3600,
  },
], { parallel: 10 });

// Schedule periodic warming
const interval = warming.scheduleWarming(
  async () => {
    // Return data to cache
    return await database.getPopularTemplates();
  },
  3600000  // Every hour
);
```

**When to use**:
- Frequently accessed templates
- Critical configuration data
- Popular content

### 5. TTL Management

**Best for**: Different data types with varying freshness requirements

```typescript
import { TTLManagementStrategy } from '@notification-system/utils';

// Get TTL based on data type
const ttl = TTLManagementStrategy.getTTL('user', {
  readFrequency: 100,   // Reads per minute
  updateFrequency: 1,   // Updates per minute
});

// Adaptive TTL based on staleness tolerance
const adaptiveTTL = TTLManagementStrategy.getAdaptiveTTL(
  3600,    // Max acceptable staleness (1 hour)
  0.9      // 90% confidence
);
```

**Default TTLs**:
- User data: 1 hour
- Session data: 30 minutes
- Static content: 24 hours
- Frequent data: 5 minutes

---

## Cache Invalidation

### Pattern-Based Invalidation

```typescript
import { CacheInvalidationManager } from '@notification-system/utils';

const invalidation = new CacheInvalidationManager(redis, {
  namespace: 'app-cache',
  kafka: kafkaClient,
});

// Invalidate by pattern
await invalidation.invalidateByPattern('user:*');
await invalidation.invalidateByPattern('user:123:*');

// Uses SCAN for large key spaces (production-safe)
await invalidation.invalidateByPattern('notification:*', true);
```

### Tag-Based Invalidation

```typescript
// Set with tags
await cache.set('user:123', userData, {
  ttl: 3600,
  tags: ['user', 'profile', 'account:123'],
});

// Invalidate all entries with tag
await invalidation.invalidateByTags(['user']);
await invalidation.invalidateByTags(['account:123']);
```

### Specific Key Invalidation

```typescript
await invalidation.invalidateKeys(['user:123', 'user:456']);
```

### Cache Stampede Prevention

Prevents multiple processes from loading the same data simultaneously.

```typescript
// With distributed locking
const data = await invalidation.withStampedePrevention(
  'expensive-query',
  async () => {
    // Only one process executes this
    return await database.runExpensiveQuery();
  },
  {
    lockTimeout: 10,     // Lock expires after 10s
    retryDelay: 100,     // Retry delay in ms
    maxRetries: 10,      // Max retry attempts
  }
);
```

### Proactive Cache Refresh

Refresh cache before expiration to avoid cache misses.

```typescript
await invalidation.refreshCache(
  'user:123',
  async () => await database.getUser('123'),
  3600,   // TTL
  0.8     // Refresh when 80% of TTL elapsed
);
```

### Event-Driven Invalidation

```typescript
// Subscribe to Kafka invalidation events
await invalidation.subscribeToInvalidationEvents(
  async (event) => {
    console.log('Cache invalidated:', event);
  }
);

// Events are automatically broadcast to all instances
// when invalidateByPattern/Tags/Keys is called
```

### Scheduled Invalidation

```typescript
import { TimedInvalidationScheduler } from '@notification-system/utils';

const scheduler = new TimedInvalidationScheduler(redis);

// Periodic invalidation
scheduler.schedule(
  'clear-temp-cache',
  'temp:*',
  3600000,  // Every hour
  invalidation
);

// One-time at specific time
scheduler.scheduleAt(
  'daily-reset',
  'daily:*',
  new Date('2025-01-15T00:00:00Z'),
  invalidation
);

// Cancel scheduled task
scheduler.cancel('clear-temp-cache');
```

---

## Configuration

### Environment Variables

```bash
# Rate Limiting
RATE_LIMIT_CAPACITY=100              # Max tokens in bucket
RATE_LIMIT_REFILL_RATE=10            # Tokens per second
RATE_LIMIT_BURST_MULTIPLIER=1.5      # Burst allowance multiplier

# Caching
CACHE_DEFAULT_TTL=3600               # Default TTL (seconds)
CACHE_USER_PREFS_TTL=3600            # User preferences TTL
CACHE_TEMPLATES_TTL=86400            # Templates TTL
CACHE_MAX_MEMORY=512mb               # Redis max memory
```

### Recommendations by Load

#### Low Traffic (<100 req/min)
```bash
RATE_LIMIT_CAPACITY=50
RATE_LIMIT_REFILL_RATE=5
CACHE_DEFAULT_TTL=7200
```

#### Medium Traffic (100-1000 req/min)
```bash
RATE_LIMIT_CAPACITY=100
RATE_LIMIT_REFILL_RATE=10
CACHE_DEFAULT_TTL=3600
```

#### High Traffic (>1000 req/min)
```bash
RATE_LIMIT_CAPACITY=200
RATE_LIMIT_REFILL_RATE=20
CACHE_DEFAULT_TTL=1800
```

#### API Tier-Based Limits
```bash
# Free tier
RATE_LIMIT_FREE_CAPACITY=50
RATE_LIMIT_FREE_REFILL_RATE=5

# Pro tier
RATE_LIMIT_PRO_CAPACITY=500
RATE_LIMIT_PRO_REFILL_RATE=50

# Enterprise tier
RATE_LIMIT_ENTERPRISE_CAPACITY=5000
RATE_LIMIT_ENTERPRISE_REFILL_RATE=500
```

---

## Monitoring

### Prometheus Metrics

#### Rate Limiting Metrics

```prometheus
# Total rate limit checks
rate_limit_requests_total{allowed="true|false", identifier_type="user|apikey|ip"}

# Tokens remaining in bucket
rate_limit_tokens_remaining{identifier="user:123"}

# Rate limit check duration
rate_limit_check_duration_seconds{identifier_type="user"}

# Rate limit resets
rate_limit_resets_total{identifier="user:123"}
```

#### Cache Metrics

```prometheus
# Cache hits and misses
cache_hits_total{cache_type="cache-aside", namespace="user-cache"}
cache_misses_total{cache_type="cache-aside", namespace="user-cache"}

# Cache operations
cache_sets_total{cache_type="cache-aside", namespace="user-cache"}
cache_deletes_total{cache_type="cache-aside", namespace="user-cache"}

# Cache evictions
cache_evictions_total{namespace="user-cache", reason="memory|ttl"}

# Cache memory usage
cache_memory_usage_bytes{namespace="user-cache"}

# Cache hit rate
cache_hit_rate{cache_type="cache-aside", namespace="user-cache"}

# Cache operation duration
cache_operation_duration_seconds{operation="get|set", cache_type="cache-aside"}

# Cache stampede prevention
cache_stampedes_prevented_total{namespace="user-cache"}

# Cache invalidations
cache_invalidations_total{type="pattern|tag|key", namespace="user-cache"}

# Cache warming
cache_warming_duration_seconds{namespace="user-cache"}
cache_warming_entries_total{status="loaded|failed", namespace="user-cache"}
```

### Grafana Dashboards

Create dashboards to monitor:

1. **Rate Limit Overview**
   - Requests allowed vs rejected
   - Top rate-limited users
   - Average tokens remaining
   - Rate limit errors

2. **Cache Performance**
   - Hit rate by cache type
   - Cache operation latency
   - Memory usage trends
   - Eviction patterns

3. **Cache Invalidation**
   - Invalidations by type
   - Stampede prevention effectiveness
   - Warming operation success rate

### Alerts

```yaml
# Rate limit abuse
- alert: HighRateLimitRejections
  expr: rate(rate_limit_requests_total{allowed="false"}[5m]) > 10
  for: 5m
  annotations:
    summary: High rate limit rejections

# Low cache hit rate
- alert: LowCacheHitRate
  expr: cache_hit_rate < 50
  for: 10m
  annotations:
    summary: Cache hit rate below 50%

# Cache memory pressure
- alert: HighCacheMemoryUsage
  expr: cache_memory_usage_bytes > 450000000  # 450MB
  for: 5m
  annotations:
    summary: Cache memory usage high
```

---

## Best Practices

### Rate Limiting

1. **Use appropriate identifiers**
   - User-based for authenticated endpoints
   - IP-based for public endpoints
   - API key-based for external integrations

2. **Set realistic limits**
   - Start conservative, increase based on monitoring
   - Different limits for different endpoint types
   - Higher limits for premium users

3. **Fail open gracefully**
   - Allow requests if Redis is down
   - Log failures for investigation
   - Monitor fail-open events

4. **Provide clear feedback**
   - Return proper status codes (429)
   - Include Retry-After header
   - Explain limit in error message

5. **Monitor and adjust**
   - Track rejection rates
   - Identify abusive patterns
   - Adjust limits based on usage

### Caching

1. **Choose the right strategy**
   - Cache-aside for read-heavy data
   - Write-through for consistency-critical data
   - Write-behind for high-throughput writes
   - Cache warming for predictable access

2. **Set appropriate TTLs**
   - Shorter for frequently changing data
   - Longer for static content
   - Consider staleness tolerance

3. **Use tags for invalidation**
   - Group related cache entries
   - Invalidate by relationship
   - Example: All caches for user

4. **Prevent cache stampede**
   - Use distributed locking
   - Implement proactive refresh
   - Stagger cache expirations

5. **Monitor cache effectiveness**
   - Track hit rates
   - Measure latency improvements
   - Watch memory usage

### General

1. **Use atomic operations**
   - All Redis operations use Lua scripts
   - Prevents race conditions
   - Ensures consistency

2. **Handle failures gracefully**
   - Rate limiting fails open
   - Caching falls back to data source
   - Log all failures

3. **Test under load**
   - Load test rate limiting
   - Verify cache performance
   - Test stampede prevention

---

## Troubleshooting

### Rate Limiting Issues

#### Problem: Users being rate limited unexpectedly

**Diagnosis**:
```bash
# Check current bucket state
curl -H "Authorization: Bearer TOKEN" \
  http://localhost:3000/api/v1/notifications

# Headers will show:
# X-RateLimit-Remaining: 0
# X-RateLimit-Reset: 2025-01-15T10:30:00Z
```

**Solution**:
- Increase `RATE_LIMIT_CAPACITY`
- Increase `RATE_LIMIT_REFILL_RATE`
- Check for burst traffic patterns
- Verify identifier extraction logic

#### Problem: Rate limits not working

**Diagnosis**:
```typescript
// Check Redis connection
const healthy = await redisService.isHealthy();
console.log('Redis healthy:', healthy);

// Check limiter config
const config = limiter.getConfig();
console.log('Limiter config:', config);
```

**Solution**:
- Verify Redis is running
- Check Redis connection string
- Verify Lua script support

### Caching Issues

#### Problem: Low cache hit rate

**Diagnosis**:
```prometheus
cache_hit_rate{namespace="user-cache"} < 50
```

**Solution**:
- Increase TTLs
- Implement cache warming
- Check if data is too dynamic
- Verify cache key consistency

#### Problem: High memory usage

**Diagnosis**:
```bash
# Check Redis memory
redis-cli INFO memory

# Check cache metrics
curl http://localhost:3000/metrics | grep cache_memory
```

**Solution**:
- Reduce TTLs
- Implement eviction policy
- Use shorter cache keys
- Archive old data

#### Problem: Cache stampede occurring

**Diagnosis**:
```prometheus
# Multiple simultaneous loads of same key
cache_operation_duration_seconds{operation="get"} > 1
```

**Solution**:
```typescript
// Use stampede prevention
const data = await invalidation.withStampedePrevention(
  key,
  dataLoader,
  { lockTimeout: 10 }
);
```

#### Problem: Stale data being served

**Solution**:
- Reduce TTL
- Implement proactive refresh
- Use write-through strategy
- Add event-driven invalidation

### Performance Issues

#### Problem: High rate limit check latency

**Diagnosis**:
```prometheus
rate_limit_check_duration_seconds > 0.01  # >10ms
```

**Solution**:
- Check Redis latency
- Verify network connectivity
- Consider Redis cluster/replicas
- Use connection pooling

#### Problem: Cache operation timeouts

**Solution**:
```typescript
// Increase Redis timeouts
const redis = createClient({
  socket: {
    connectTimeout: 5000,
    commandTimeout: 3000,
  },
});
```

---

## Performance Impact

### Rate Limiting

- **Latency**: ~1-5ms per request (Redis + Lua)
- **Throughput**: 10,000+ checks/second per Redis instance
- **Memory**: ~100 bytes per bucket
- **Scalability**: Horizontal (Redis cluster)

### Caching

- **Cache-Aside**: 50-90% latency reduction on hits
- **Write-Through**: 10-20% write latency increase
- **Write-Behind**: 90% write latency reduction
- **Memory**: Depends on data size and TTL

### Expected Improvements

- **API response time**: 50-80% reduction
- **Database load**: 70-95% reduction
- **Scalability**: 5-10x improvement
- **Cost**: 30-50% reduction in infrastructure

---

## Further Reading

- [Redis Rate Limiting Patterns](https://redis.io/docs/manual/patterns/rate-limiter/)
- [Caching Best Practices](https://aws.amazon.com/caching/best-practices/)
- [Token Bucket Algorithm](https://en.wikipedia.org/wiki/Token_bucket)
- [Cache Invalidation Strategies](https://docs.aws.amazon.com/AmazonElastiCache/latest/mem-ug/Strategies.html)
