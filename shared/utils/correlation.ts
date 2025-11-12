/**
 * Correlation ID Middleware for Request Tracing
 *
 * Uses AsyncLocalStorage to propagate correlation context across async operations
 * without manual parameter passing. This enables distributed tracing across
 * microservices.
 *
 * Features:
 * - UUID v4 generation for unique request IDs
 * - Auto-propagation via X-Correlation-ID header
 * - Context accessible throughout async call stack
 * - No dependency injection needed
 * - Thread-safe context isolation
 *
 * Flow:
 * 1. Gateway receives request -> generates/extracts correlation ID
 * 2. ID stored in AsyncLocalStorage
 * 3. ID auto-injected into logs, HTTP calls, Kafka messages
 * 4. Downstream services receive and continue the trace
 */

import { AsyncLocalStorage } from 'async_hooks';
import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';

export interface CorrelationContext {
  correlationId: string;
  requestId?: string;
  userId?: string;
  method?: string;
  path?: string;
  userAgent?: string;
  ip?: string;
}

// AsyncLocalStorage for context propagation
const asyncLocalStorage = new AsyncLocalStorage<CorrelationContext>();

/**
 * Express middleware to extract or generate correlation ID
 * and store it in AsyncLocalStorage for the entire request lifecycle
 */
export function correlationMiddleware(req: Request, res: Response, next: NextFunction) {
  // Extract or generate correlation ID
  const correlationId = (req.headers['x-correlation-id'] as string) || uuidv4();
  const requestId = (req.headers['x-request-id'] as string) || uuidv4();

  // Set response headers
  res.setHeader('X-Correlation-ID', correlationId);
  res.setHeader('X-Request-ID', requestId);

  // Extract user context (if available from auth middleware)
  const userId = (req as any).user?.id || (req as any).user?.userId;

  // Build correlation context
  const context: CorrelationContext = {
    correlationId,
    requestId,
    userId,
    method: req.method,
    path: req.path,
    userAgent: req.headers['user-agent'],
    ip: req.ip || req.socket.remoteAddress,
  };

  // Attach to request object for easy access
  (req as any).correlationId = correlationId;
  (req as any).requestId = requestId;
  (req as any).correlationContext = context;

  // Run the rest of the request in AsyncLocalStorage context
  asyncLocalStorage.run(context, () => {
    next();
  });
}

/**
 * Get current correlation context from AsyncLocalStorage
 * Works anywhere in the async call stack without manual passing
 */
export function getCorrelationContext(): CorrelationContext | undefined {
  return asyncLocalStorage.getStore();
}

/**
 * Get correlation ID from current context
 */
export function getCorrelationId(): string | undefined {
  return asyncLocalStorage.getStore()?.correlationId;
}

/**
 * Get request ID from current context
 */
export function getRequestId(): string | undefined {
  return asyncLocalStorage.getStore()?.requestId;
}

/**
 * Get user ID from current context
 */
export function getUserId(): string | undefined {
  return asyncLocalStorage.getStore()?.userId;
}

/**
 * Update correlation context (useful for adding userId after authentication)
 */
export function updateCorrelationContext(updates: Partial<CorrelationContext>) {
  const current = asyncLocalStorage.getStore();
  if (current) {
    Object.assign(current, updates);
  }
}

/**
 * Run a function with a specific correlation context
 * Useful for background jobs, cron tasks, Kafka consumers
 */
export function runWithCorrelationContext<T>(
  context: CorrelationContext,
  fn: () => T
): T {
  return asyncLocalStorage.run(context, fn);
}

/**
 * Create correlation context for Kafka message consumers
 */
export function createKafkaCorrelationContext(headers: any): CorrelationContext {
  const correlationId = headers['x-correlation-id']?.toString() || uuidv4();
  const userId = headers['x-user-id']?.toString();
  
  return {
    correlationId,
    requestId: uuidv4(),
    userId,
  };
}

/**
 * Extract correlation headers for outgoing requests
 */
export function getCorrelationHeaders(): Record<string, string> {
  const context = getCorrelationContext();
  if (!context) {
    return {};
  }

  return {
    'X-Correlation-ID': context.correlationId,
    ...(context.requestId && { 'X-Request-ID': context.requestId }),
    ...(context.userId && { 'X-User-ID': context.userId }),
  };
}

export default correlationMiddleware;
