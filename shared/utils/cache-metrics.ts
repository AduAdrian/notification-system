import { Counter, Histogram, Gauge } from 'prom-client';

/**
 * Prometheus metrics for rate limiting and caching
 */

// Rate Limiting Metrics
export const rateLimitRequestsTotal = new Counter({
  name: 'rate_limit_requests_total',
  help: 'Total number of rate limit checks',
  labelNames: ['allowed', 'identifier_type'],
});

export const rateLimitTokensRemaining = new Gauge({
  name: 'rate_limit_tokens_remaining',
  help: 'Number of tokens remaining in bucket',
  labelNames: ['identifier'],
});

export const rateLimitCheckDuration = new Histogram({
  name: 'rate_limit_check_duration_seconds',
  help: 'Rate limit check duration in seconds',
  labelNames: ['identifier_type'],
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1],
});

export const rateLimitResets = new Counter({
  name: 'rate_limit_resets_total',
  help: 'Total number of rate limit resets',
  labelNames: ['identifier'],
});

// Cache Metrics
export const cacheHitsTotal = new Counter({
  name: 'cache_hits_total',
  help: 'Total number of cache hits',
  labelNames: ['cache_type', 'namespace'],
});

export const cacheMissesTotal = new Counter({
  name: 'cache_misses_total',
  help: 'Total number of cache misses',
  labelNames: ['cache_type', 'namespace'],
});

export const cacheSetsTotal = new Counter({
  name: 'cache_sets_total',
  help: 'Total number of cache sets',
  labelNames: ['cache_type', 'namespace'],
});

export const cacheDeletesTotal = new Counter({
  name: 'cache_deletes_total',
  help: 'Total number of cache deletes',
  labelNames: ['cache_type', 'namespace'],
});

export const cacheEvictionsTotal = new Counter({
  name: 'cache_evictions_total',
  help: 'Total number of cache evictions',
  labelNames: ['namespace', 'reason'],
});

export const cacheOperationDuration = new Histogram({
  name: 'cache_operation_duration_seconds',
  help: 'Cache operation duration in seconds',
  labelNames: ['operation', 'cache_type', 'namespace'],
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1],
});

export const cacheMemoryUsageBytes = new Gauge({
  name: 'cache_memory_usage_bytes',
  help: 'Cache memory usage in bytes',
  labelNames: ['namespace'],
});

export const cacheKeyCount = new Gauge({
  name: 'cache_key_count',
  help: 'Number of keys in cache',
  labelNames: ['namespace'],
});

export const cacheHitRate = new Gauge({
  name: 'cache_hit_rate',
  help: 'Cache hit rate percentage',
  labelNames: ['cache_type', 'namespace'],
});

export const cacheStampedesPreventedTotal = new Counter({
  name: 'cache_stampedes_prevented_total',
  help: 'Total number of cache stampedes prevented',
  labelNames: ['namespace'],
});

export const cacheInvalidationsTotal = new Counter({
  name: 'cache_invalidations_total',
  help: 'Total number of cache invalidations',
  labelNames: ['type', 'namespace'], // type: pattern, tag, key, all
});

export const cacheWarmingDuration = new Histogram({
  name: 'cache_warming_duration_seconds',
  help: 'Cache warming operation duration in seconds',
  labelNames: ['namespace'],
  buckets: [1, 5, 10, 30, 60, 120, 300],
});

export const cacheWarmingEntriesTotal = new Counter({
  name: 'cache_warming_entries_total',
  help: 'Total number of cache warming entries',
  labelNames: ['status', 'namespace'], // status: loaded, failed
});

/**
 * Helper to track cache operations with metrics
 */
export function trackCacheOperation<T>(
  operation: string,
  cacheType: string,
  namespace: string,
  fn: () => Promise<T>
): Promise<T> {
  const end = cacheOperationDuration.startTimer({
    operation,
    cache_type: cacheType,
    namespace,
  });

  return fn()
    .then((result) => {
      end();
      return result;
    })
    .catch((error) => {
      end();
      throw error;
    });
}

/**
 * Helper to record cache hit/miss
 */
export function recordCacheAccess(
  hit: boolean,
  cacheType: string,
  namespace: string
): void {
  if (hit) {
    cacheHitsTotal.inc({ cache_type: cacheType, namespace });
  } else {
    cacheMissesTotal.inc({ cache_type: cacheType, namespace });
  }
}

/**
 * Helper to record rate limit check
 */
export function recordRateLimitCheck(
  allowed: boolean,
  identifierType: string,
  duration: number
): void {
  rateLimitRequestsTotal.inc({
    allowed: allowed.toString(),
    identifier_type: identifierType,
  });

  rateLimitCheckDuration.observe({ identifier_type: identifierType }, duration);
}

/**
 * Helper to update cache hit rate
 */
export function updateCacheHitRate(
  hits: number,
  misses: number,
  cacheType: string,
  namespace: string
): void {
  const total = hits + misses;
  const hitRate = total > 0 ? (hits / total) * 100 : 0;
  cacheHitRate.set({ cache_type: cacheType, namespace }, hitRate);
}
