# Rate Limiting & Caching Quick Start

## Installation Complete

All rate limiting and caching infrastructure is now implemented and ready to use.

## Quick Start (5 Minutes)

### 1. Configure Environment

Add to your `.env`:

```bash
# Rate Limiting
RATE_LIMIT_CAPACITY=100
RATE_LIMIT_REFILL_RATE=10
RATE_LIMIT_BURST_MULTIPLIER=1.5

# Caching
CACHE_DEFAULT_TTL=3600
CACHE_USER_PREFS_TTL=3600
CACHE_TEMPLATES_TTL=86400
CACHE_MAX_MEMORY=512mb
```

### 2. Start Services

```bash
# Redis must be running
docker-compose up redis -d

# Start notification service (already configured)
npm run dev
```

### 3. Test Rate Limiting

```bash
# Make requests - watch the headers
for i in {1..10}; do
  curl -X POST http://localhost:3000/api/v1/notifications \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer YOUR_TOKEN" \
    -d '{"userId": "123", "channel": "email", "content": {"subject": "Test"}}' \
    -v 2>&1 | grep -E "X-RateLimit"
done

# Output:
# X-RateLimit-Limit: 100
# X-RateLimit-Remaining: 99
# X-RateLimit-Reset: 2025-01-15T10:30:00Z
```

### 4. Monitor Metrics

```bash
# View metrics
curl http://localhost:3000/metrics | grep rate_limit

# View cache metrics
curl http://localhost:3000/metrics | grep cache
```

## Common Use Cases

### Use Case 1: Cache User Preferences

```typescript
import { CacheAsideStrategy } from '@notification-system/utils';

const cache = new CacheAsideStrategy(redis, 'user-prefs');

// Automatically caches on first load
const prefs = await cache.get(
  `prefs:${userId}`,
  async () => await db.getUserPreferences(userId),
  { ttl: 3600 }
);
```

### Use Case 2: Strict Rate Limit for Auth

```typescript
import { RateLimitMiddlewares } from '@notification-system/utils';

const rateLimits = new RateLimitMiddlewares(redis);

// Only 5 requests per minute
app.post('/auth/login', rateLimits.auth(), loginHandler);
```

### Use Case 3: Cache Templates with Warming

```typescript
import { CacheWarmingStrategy } from '@notification-system/utils';

const warming = new CacheWarmingStrategy(redis);

// Preload on startup
await warming.warm([
  {
    key: 'template:welcome',
    dataSource: async () => await db.getTemplate('welcome'),
    ttl: 86400,  // 24 hours
  },
  {
    key: 'template:password-reset',
    dataSource: async () => await db.getTemplate('password-reset'),
    ttl: 86400,
  }
]);
```

### Use Case 4: Invalidate Cache on Update

```typescript
import { CacheInvalidationManager } from '@notification-system/utils';

const invalidation = new CacheInvalidationManager(redis);

// After updating user
await db.updateUser(userId, data);

// Invalidate all user-related caches
await invalidation.invalidateByPattern(`user:${userId}:*`);

// Or invalidate by tag
await invalidation.invalidateByTags([`user:${userId}`]);
```

## Key Files

| File | Purpose |
|------|---------|
| `shared/utils/rate-limiter.ts` | Token bucket implementation |
| `shared/utils/middleware/rate-limit.middleware.ts` | Express middleware |
| `shared/utils/cache-strategies.ts` | 5 caching strategies |
| `shared/utils/cache-invalidation.ts` | Invalidation & stampede prevention |
| `shared/utils/cache-metrics.ts` | Prometheus metrics |
| `docs/RATE_LIMITING_AND_CACHING.md` | Full documentation |

## Metrics Dashboard

Key metrics to watch:

```prometheus
# Rate limiting
rate_limit_requests_total{allowed="false"}  # Rejections
rate_limit_tokens_remaining                  # Available capacity

# Caching
cache_hit_rate                               # Should be >70%
cache_memory_usage_bytes                     # Monitor growth
cache_evictions_total                        # Should be low
```

## Troubleshooting

### Rate Limit Not Working?

```bash
# Check Redis connection
redis-cli ping

# Check environment variables
echo $RATE_LIMIT_CAPACITY

# View logs
docker logs notification-service | grep "rate-limit"
```

### Low Cache Hit Rate?

```bash
# Check cache metrics
curl http://localhost:3000/metrics | grep cache_hit_rate

# Increase TTLs in .env
CACHE_DEFAULT_TTL=7200  # 2 hours instead of 1
```

### High Memory Usage?

```bash
# Check Redis memory
redis-cli INFO memory

# Reduce TTLs or increase max memory
CACHE_MAX_MEMORY=1024mb
```

## Next Steps

1. Review full docs: `docs/RATE_LIMITING_AND_CACHING.md`
2. Set up Grafana dashboards for metrics
3. Adjust rate limits based on your traffic
4. Implement caching in your specific use cases
5. Load test the system

## Support

- Full docs: `docs/RATE_LIMITING_AND_CACHING.md`
- Summary: `RATE_LIMITING_CACHING_SUMMARY.md`
- Code examples in all implementation files

**You're ready to go!** The system is production-ready with:
- ✅ Token bucket rate limiting
- ✅ 5 caching strategies
- ✅ Cache invalidation
- ✅ Stampede prevention
- ✅ Comprehensive metrics
- ✅ Full documentation
