import CircuitBreaker from 'opossum';
import { createLogger } from './logger';
import { MetricsCollector } from './metrics';

const logger = createLogger('circuit-breaker');

/**
 * Configuration options for circuit breaker
 */
export interface CircuitBreakerConfig {
  /**
   * Name/identifier for this circuit breaker (for logging and metrics)
   */
  name: string;

  /**
   * The time in milliseconds that the breaker should wait before attempting to retry (default: 60000)
   */
  timeout?: number;

  /**
   * The error threshold percentage (0-1) at which the circuit should open (default: 0.5 = 50%)
   */
  errorThresholdPercentage?: number;

  /**
   * Minimum number of requests within the rolling window before the breaker can open (default: 10)
   */
  volumeThreshold?: number;

  /**
   * Time in milliseconds to keep the circuit breaker open before attempting to close (default: 60000)
   */
  resetTimeout?: number;

  /**
   * Optional metrics collector for tracking circuit breaker state
   */
  metrics?: MetricsCollector;

  /**
   * Optional fallback function to execute when circuit is open
   */
  fallback?: (...args: any[]) => Promise<any>;
}

/**
 * Circuit breaker states
 */
export enum CircuitState {
  OPEN = 'open',
  HALF_OPEN = 'half-open',
  CLOSED = 'closed',
}

/**
 * Create a circuit breaker for a function
 *
 * Implements the circuit breaker pattern to prevent cascading failures in distributed systems.
 * The circuit breaker monitors function calls and "opens" (stops calling the function) when
 * failures exceed the threshold, giving the downstream system time to recover.
 *
 * States:
 * - CLOSED: Normal operation, requests pass through
 * - OPEN: Too many failures, requests are blocked
 * - HALF_OPEN: Testing if service has recovered
 *
 * @param fn - The async function to wrap with circuit breaker
 * @param config - Circuit breaker configuration
 * @returns Circuit breaker instance
 *
 * @example
 * ```typescript
 * // Wrap SendGrid API call
 * const sendEmailWithCircuitBreaker = createCircuitBreaker(
 *   async (email: EmailPayload) => {
 *     return await sgMail.send(email);
 *   },
 *   {
 *     name: 'sendgrid-api',
 *     timeout: 10000,  // 10 second timeout
 *     errorThresholdPercentage: 0.5,  // Open circuit at 50% failure rate
 *     volumeThreshold: 10,  // Need at least 10 requests
 *     resetTimeout: 60000,  // Try to close circuit after 60 seconds
 *     fallback: async (email) => {
 *       // Queue for retry or send alert
 *       logger.error('SendGrid circuit open, email queued for retry');
 *       return { status: 'queued' };
 *     }
 *   }
 * );
 *
 * // Use the circuit breaker
 * try {
 *   await sendEmailWithCircuitBreaker({ to: 'user@example.com', ... });
 * } catch (error) {
 *   // Handle failure or fallback
 * }
 * ```
 */
export function createCircuitBreaker<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  config: CircuitBreakerConfig
): CircuitBreaker<Parameters<T>, ReturnType<T>> {
  const {
    name,
    timeout = 30000,
    errorThresholdPercentage = 0.5,
    volumeThreshold = 10,
    resetTimeout = 60000,
    metrics,
    fallback,
  } = config;

  // Create circuit breaker options
  const options: CircuitBreaker.Options = {
    timeout,
    errorThresholdPercentage,
    volumeThreshold,
    resetTimeout,
    name,
    // Consider these errors as failures (all errors by default)
    errorFilter: (error: any) => {
      // Don't count validation errors as circuit breaker failures
      if (error.name === 'ValidationError' || error.statusCode === 400) {
        return false;
      }
      return true;
    },
  };

  // Create the circuit breaker
  const breaker = new CircuitBreaker(fn, options);

  // Add fallback if provided
  if (fallback) {
    breaker.fallback(fallback);
  }

  // Register event handlers for logging and metrics
  breaker.on('open', () => {
    logger.warn(`Circuit breaker opened`, { name });
    if (metrics) {
      metrics.recordCircuitBreakerState(name, CircuitState.OPEN);
    }
  });

  breaker.on('halfOpen', () => {
    logger.info(`Circuit breaker half-open`, { name });
    if (metrics) {
      metrics.recordCircuitBreakerState(name, CircuitState.HALF_OPEN);
    }
  });

  breaker.on('close', () => {
    logger.info(`Circuit breaker closed`, { name });
    if (metrics) {
      metrics.recordCircuitBreakerState(name, CircuitState.CLOSED);
    }
  });

  breaker.on('success', (result, latency) => {
    logger.debug(`Circuit breaker success`, { name, latency });
    if (metrics) {
      metrics.recordCircuitBreakerCall(name, 'success', latency);
    }
  });

  breaker.on('failure', (error) => {
    logger.error(`Circuit breaker failure`, { name, error: error.message });
    if (metrics) {
      metrics.recordCircuitBreakerCall(name, 'failure');
    }
  });

  breaker.on('timeout', () => {
    logger.warn(`Circuit breaker timeout`, { name, timeout });
    if (metrics) {
      metrics.recordCircuitBreakerCall(name, 'timeout');
    }
  });

  breaker.on('fallback', (result) => {
    logger.info(`Circuit breaker fallback executed`, { name });
    if (metrics) {
      metrics.recordCircuitBreakerCall(name, 'fallback');
    }
  });

  breaker.on('reject', () => {
    logger.warn(`Circuit breaker rejected call (circuit open)`, { name });
    if (metrics) {
      metrics.recordCircuitBreakerCall(name, 'rejected');
    }
  });

  return breaker;
}

/**
 * Helper function to create a circuit breaker for HTTP API calls
 *
 * Pre-configured with sensible defaults for external HTTP APIs
 *
 * @param name - Name of the API/service
 * @param apiFn - Function that makes the API call
 * @param metrics - Optional metrics collector
 * @returns Circuit breaker instance
 *
 * @example
 * ```typescript
 * const sendgridBreaker = createHttpCircuitBreaker(
 *   'sendgrid-api',
 *   async (payload) => await sgMail.send(payload),
 *   metrics
 * );
 * ```
 */
export function createHttpCircuitBreaker<T extends (...args: any[]) => Promise<any>>(
  name: string,
  apiFn: T,
  metrics?: MetricsCollector
): CircuitBreaker<Parameters<T>, ReturnType<T>> {
  return createCircuitBreaker(apiFn, {
    name,
    timeout: 10000, // 10 second timeout for HTTP calls
    errorThresholdPercentage: 0.5, // Open at 50% failure rate
    volumeThreshold: 10,
    resetTimeout: 60000, // Try to recover after 1 minute
    metrics,
  });
}

/**
 * Helper function to create a circuit breaker for database operations
 *
 * Pre-configured with sensible defaults for database queries
 *
 * @param name - Name of the database operation
 * @param dbFn - Function that executes the database query
 * @param metrics - Optional metrics collector
 * @returns Circuit breaker instance
 *
 * @example
 * ```typescript
 * const queryBreaker = createDatabaseCircuitBreaker(
 *   'notifications-query',
 *   async (userId) => await db.getNotifications(userId),
 *   metrics
 * );
 * ```
 */
export function createDatabaseCircuitBreaker<T extends (...args: any[]) => Promise<any>>(
  name: string,
  dbFn: T,
  metrics?: MetricsCollector
): CircuitBreaker<Parameters<T>, ReturnType<T>> {
  return createCircuitBreaker(dbFn, {
    name,
    timeout: 5000, // 5 second timeout for DB queries
    errorThresholdPercentage: 0.6, // More tolerant - open at 60% failure rate
    volumeThreshold: 20, // Need more samples for DB
    resetTimeout: 30000, // Recover faster for DB (30 seconds)
    metrics,
  });
}

/**
 * Get the current state and statistics of a circuit breaker
 *
 * @param breaker - Circuit breaker instance
 * @returns Circuit breaker statistics
 *
 * @example
 * ```typescript
 * const stats = getCircuitBreakerStats(myBreaker);
 * console.log('Circuit state:', stats.state);
 * console.log('Success rate:', stats.successRate);
 * ```
 */
export function getCircuitBreakerStats(breaker: CircuitBreaker<any, any>) {
  const stats = breaker.stats;
  const totalCalls = stats.fires;
  const failures = stats.failures + stats.timeouts;
  const successRate = totalCalls > 0 ? ((totalCalls - failures) / totalCalls) * 100 : 0;

  return {
    state: breaker.opened ? CircuitState.OPEN : CircuitState.CLOSED,
    isOpen: breaker.opened,
    totalCalls: stats.fires,
    successfulCalls: stats.successes,
    failedCalls: stats.failures,
    timeouts: stats.timeouts,
    fallbacks: stats.fallbacks,
    rejects: stats.rejects,
    successRate: successRate.toFixed(2),
    latency: {
      mean: stats.latencyMean,
      percentiles: breaker.stats.percentiles,
    },
  };
}

/**
 * Manually open a circuit breaker
 *
 * Useful for maintenance or when you detect issues externally
 *
 * @param breaker - Circuit breaker to open
 *
 * @example
 * ```typescript
 * // Manually open circuit during maintenance
 * openCircuitBreaker(sendgridBreaker);
 * ```
 */
export function openCircuitBreaker(breaker: CircuitBreaker<any, any>): void {
  breaker.open();
  logger.warn('Circuit breaker manually opened', { name: breaker.name });
}

/**
 * Manually close a circuit breaker
 *
 * Use with caution - only when you're sure the service has recovered
 *
 * @param breaker - Circuit breaker to close
 *
 * @example
 * ```typescript
 * // Manually close circuit after confirming service is healthy
 * closeCircuitBreaker(sendgridBreaker);
 * ```
 */
export function closeCircuitBreaker(breaker: CircuitBreaker<any, any>): void {
  breaker.close();
  logger.info('Circuit breaker manually closed', { name: breaker.name });
}

/**
 * Shutdown and cleanup a circuit breaker
 *
 * @param breaker - Circuit breaker to shutdown
 *
 * @example
 * ```typescript
 * process.on('SIGTERM', () => {
 *   shutdownCircuitBreaker(myBreaker);
 * });
 * ```
 */
export function shutdownCircuitBreaker(breaker: CircuitBreaker<any, any>): void {
  breaker.shutdown();
  logger.info('Circuit breaker shut down', { name: breaker.name });
}

export default createCircuitBreaker;
