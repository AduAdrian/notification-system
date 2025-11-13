export { createLogger, createChildLogger, logWithContext } from './logger';
export { KafkaClient } from './kafka';
export { KafkaClientWithDLQ } from './kafka-dlq';
export { v4 as uuid } from 'uuid';
export { MetricsCollector, metricsMiddleware, createTimer } from './src/metrics';
export {
  initTracing,
  getTracer,
  createSpan,
  traceAsync,
  addSpanEvent,
  setSpanAttributes,
  recordException,
  withSpan,
  trace,
  context,
  SpanStatusCode,
} from './tracing';
export {
  createCircuitBreaker,
  createHttpCircuitBreaker,
  createDatabaseCircuitBreaker,
  getCircuitBreakerStats,
  openCircuitBreaker,
  closeCircuitBreaker,
  shutdownCircuitBreaker,
  CircuitState,
} from './circuit-breaker';
export {
  correlationMiddleware,
  getCorrelationContext,
  getCorrelationId,
  getRequestId,
  getUserId,
  updateCorrelationContext,
  runWithCorrelationContext,
  createKafkaCorrelationContext,
  getCorrelationHeaders,
} from './correlation';
export {
  createHttpClient,
  get,
  post,
  put,
  del,
  patch,
} from './http-client';

// Rate Limiting
export {
  TokenBucketLimiter,
  FixedWindowLimiter,
  SlidingWindowLimiter,
  RateLimitResult,
  TokenBucketConfig,
} from './rate-limiter';

export {
  createRateLimitMiddleware,
  RateLimitMiddlewares,
  createMetricsAwareRateLimitMiddleware,
  RateLimitConfig,
} from './middleware/rate-limit.middleware';

// Caching
export {
  CacheAsideStrategy,
  WriteThroughStrategy,
  WriteBehindStrategy,
  CacheWarmingStrategy,
  TTLManagementStrategy,
  CacheOptions,
  CacheStats,
} from './cache-strategies';

export {
  CacheInvalidationManager,
  TimedInvalidationScheduler,
  InvalidationEvent,
} from './cache-invalidation';

// Cache & Rate Limit Metrics
export * from './cache-metrics';
