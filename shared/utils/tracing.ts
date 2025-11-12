import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { JaegerExporter } from '@opentelemetry/exporter-jaeger';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { trace, context, Span, SpanStatusCode } from '@opentelemetry/api';
import { createLogger } from './logger';

const logger = createLogger('tracing');

/**
 * Configuration options for OpenTelemetry tracing
 */
export interface TracingConfig {
  serviceName: string;
  jaegerEndpoint?: string;
  enableAutoInstrumentation?: boolean;
  environment?: string;
}

/**
 * Initialize OpenTelemetry distributed tracing with Jaeger exporter
 *
 * This function sets up OpenTelemetry with automatic instrumentation for:
 * - HTTP/HTTPS requests
 * - Kafka messages
 * - Database queries (PostgreSQL, MongoDB, Redis)
 * - Express.js routes
 *
 * @param config - Tracing configuration options
 * @returns NodeSDK instance for manual shutdown if needed
 *
 * @example
 * ```typescript
 * // At the top of your service entry point (before any imports that need instrumentation)
 * import { initTracing } from '@notification-system/utils';
 *
 * initTracing({
 *   serviceName: 'email-service',
 *   jaegerEndpoint: process.env.JAEGER_ENDPOINT || 'http://localhost:14268/api/traces',
 *   environment: process.env.NODE_ENV || 'development'
 * });
 * ```
 */
export function initTracing(config: TracingConfig): NodeSDK {
  const {
    serviceName,
    jaegerEndpoint = process.env.JAEGER_ENDPOINT || 'http://localhost:14268/api/traces',
    enableAutoInstrumentation = true,
    environment = process.env.NODE_ENV || 'development',
  } = config;

  logger.info('Initializing OpenTelemetry tracing', {
    serviceName,
    jaegerEndpoint,
    environment,
  });

  // Configure Jaeger exporter
  const jaegerExporter = new JaegerExporter({
    endpoint: jaegerEndpoint,
    // Use HTTP protocol for better compatibility
  });

  // Define service resource attributes
  const resource = Resource.default().merge(
    new Resource({
      [SemanticResourceAttributes.SERVICE_NAME]: serviceName,
      [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: environment,
      [SemanticResourceAttributes.SERVICE_VERSION]: process.env.SERVICE_VERSION || '1.0.0',
      [SemanticResourceAttributes.SERVICE_NAMESPACE]: 'notification-system',
    })
  );

  // Configure SDK with auto-instrumentation
  const sdk = new NodeSDK({
    resource,
    traceExporter: jaegerExporter,
    instrumentations: enableAutoInstrumentation
      ? [
          getNodeAutoInstrumentations({
            // Customize auto-instrumentation
            '@opentelemetry/instrumentation-fs': {
              enabled: false, // Disable filesystem instrumentation to reduce noise
            },
            '@opentelemetry/instrumentation-http': {
              enabled: true,
              ignoreIncomingPaths: ['/health', '/metrics', '/ready', '/live'], // Don't trace health checks
            },
            '@opentelemetry/instrumentation-express': {
              enabled: true,
            },
            '@opentelemetry/instrumentation-kafkajs': {
              enabled: true,
            },
            '@opentelemetry/instrumentation-pg': {
              enabled: true,
            },
            '@opentelemetry/instrumentation-mongodb': {
              enabled: true,
            },
            '@opentelemetry/instrumentation-redis-4': {
              enabled: true,
            },
          }),
        ]
      : [],
  });

  // Start the SDK
  sdk.start();

  logger.info('OpenTelemetry tracing initialized successfully', { serviceName });

  // Handle graceful shutdown
  process.on('SIGTERM', async () => {
    try {
      await sdk.shutdown();
      logger.info('OpenTelemetry tracing shut down successfully');
    } catch (error) {
      logger.error('Error shutting down OpenTelemetry', { error });
    }
  });

  return sdk;
}

/**
 * Get the current tracer instance for manual span creation
 *
 * @param serviceName - Name of the service/component
 * @returns Tracer instance
 *
 * @example
 * ```typescript
 * const tracer = getTracer('email-service');
 * const span = tracer.startSpan('send-email-operation');
 * try {
 *   // ... operation code
 *   span.setStatus({ code: SpanStatusCode.OK });
 * } catch (error) {
 *   span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
 *   throw error;
 * } finally {
 *   span.end();
 * }
 * ```
 */
export function getTracer(serviceName: string) {
  return trace.getTracer(serviceName, process.env.SERVICE_VERSION || '1.0.0');
}

/**
 * Create a new span for tracing an operation
 *
 * @param name - Name of the span/operation
 * @param attributes - Additional attributes to add to the span
 * @returns Span instance
 *
 * @example
 * ```typescript
 * const span = createSpan('kafka-publish', {
 *   'kafka.topic': 'email.queued',
 *   'notification.id': notificationId
 * });
 *
 * try {
 *   await publishToKafka(message);
 *   span.setStatus({ code: SpanStatusCode.OK });
 * } catch (error) {
 *   span.recordException(error);
 *   span.setStatus({ code: SpanStatusCode.ERROR });
 * } finally {
 *   span.end();
 * }
 * ```
 */
export function createSpan(name: string, attributes?: Record<string, string | number>): Span {
  const tracer = trace.getTracer('notification-system');
  const span = tracer.startSpan(name);

  if (attributes) {
    span.setAttributes(attributes);
  }

  return span;
}

/**
 * Decorator/wrapper function to automatically trace an async function
 *
 * @param spanName - Name of the span to create
 * @param fn - Async function to trace
 * @param attributes - Optional attributes to add to the span
 * @returns Wrapped function with tracing
 *
 * @example
 * ```typescript
 * const sendEmailWithTracing = traceAsync(
 *   'send-email',
 *   async (email: string, content: string) => {
 *     await sgMail.send({ to: email, html: content });
 *   },
 *   { 'email.provider': 'sendgrid' }
 * );
 *
 * await sendEmailWithTracing('user@example.com', '<h1>Hello</h1>');
 * ```
 */
export function traceAsync<T extends (...args: any[]) => Promise<any>>(
  spanName: string,
  fn: T,
  attributes?: Record<string, string | number>
): T {
  return (async (...args: any[]) => {
    const span = createSpan(spanName, attributes);

    try {
      const result = await fn(...args);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error: any) {
      span.recordException(error);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error.message || 'Unknown error',
      });
      throw error;
    } finally {
      span.end();
    }
  }) as T;
}

/**
 * Add an event to the current active span
 *
 * @param name - Event name
 * @param attributes - Event attributes
 *
 * @example
 * ```typescript
 * addSpanEvent('email-queued', {
 *   'notification.id': notificationId,
 *   'queue.name': 'email.queued'
 * });
 * ```
 */
export function addSpanEvent(name: string, attributes?: Record<string, string | number>): void {
  const span = trace.getActiveSpan();
  if (span) {
    span.addEvent(name, attributes);
  }
}

/**
 * Set attributes on the current active span
 *
 * @param attributes - Attributes to set
 *
 * @example
 * ```typescript
 * setSpanAttributes({
 *   'http.status_code': 200,
 *   'notification.channel': 'email'
 * });
 * ```
 */
export function setSpanAttributes(attributes: Record<string, string | number | boolean>): void {
  const span = trace.getActiveSpan();
  if (span) {
    span.setAttributes(attributes);
  }
}

/**
 * Record an exception in the current active span
 *
 * @param error - Error to record
 *
 * @example
 * ```typescript
 * try {
 *   await riskyOperation();
 * } catch (error) {
 *   recordException(error);
 *   throw error;
 * }
 * ```
 */
export function recordException(error: Error): void {
  const span = trace.getActiveSpan();
  if (span) {
    span.recordException(error);
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: error.message,
    });
  }
}

/**
 * Execute a function within a new span context
 *
 * @param spanName - Name of the span
 * @param fn - Function to execute
 * @param attributes - Optional span attributes
 * @returns Result of the function
 *
 * @example
 * ```typescript
 * await withSpan('process-notification', async () => {
 *   addSpanEvent('validation-start');
 *   await validateNotification(data);
 *   addSpanEvent('validation-complete');
 *
 *   await sendNotification(data);
 * }, { 'notification.type': 'email' });
 * ```
 */
export async function withSpan<T>(
  spanName: string,
  fn: () => Promise<T>,
  attributes?: Record<string, string | number>
): Promise<T> {
  const span = createSpan(spanName, attributes);
  const ctx = trace.setSpan(context.active(), span);

  try {
    const result = await context.with(ctx, fn);
    span.setStatus({ code: SpanStatusCode.OK });
    return result;
  } catch (error: any) {
    span.recordException(error);
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: error.message || 'Unknown error',
    });
    throw error;
  } finally {
    span.end();
  }
}

// Export OpenTelemetry API for advanced usage
export { trace, context, SpanStatusCode } from '@opentelemetry/api';
