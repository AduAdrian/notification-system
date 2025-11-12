export { createLogger } from './logger';
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
