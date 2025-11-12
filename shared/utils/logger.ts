/**
 * Production-Grade Logging with Pino
 *
 * Pino is 5x faster than Winston with async I/O and JSON-first design.
 * Perfect for high-throughput microservices.
 *
 * Features:
 * - Structured JSON logging
 * - Async I/O (non-blocking)
 * - Low overhead
 * - Child loggers with bound context
 * - Pretty printing in development
 * - ISO 8601 timestamps
 * - Automatic serialization
 * - Winston-compatible API (backward compatible)
 *
 * Best Practices:
 * - ERROR: Failures requiring immediate attention
 * - WARN: Degraded functionality, should be monitored
 * - INFO: Important business events (user actions, external calls)
 * - DEBUG: Detailed diagnostics (dev/staging only)
 * - TRACE: Ultra-verbose (never in production)
 */

import pino, { Logger as PinoLogger } from 'pino';

// Stub implementation to avoid circular dependency during build
let getCorrelationContextStub: (() => any) | undefined;
try {
  const correlation = require('./correlation');
  getCorrelationContextStub = correlation.getCorrelationContext;
} catch {
  // Correlation module not yet available during initial build
  getCorrelationContextStub = () => undefined;
}

interface LoggerOptions {
  serviceName: string;
  level?: string;
  prettyPrint?: boolean;
}

/**
 * Winston-compatible logger wrapper around Pino
 * Supports both Winston-style (message, object) and Pino-style (object, message) signatures
 */
class CompatibleLogger {
  private logger: PinoLogger;

  constructor(logger: PinoLogger) {
    this.logger = logger;
  }

  // Support both Winston (msg, obj) and Pino (obj, msg) signatures
  private normalizeArgs(msgOrObj: any, objOrMsg?: any): [any, string] {
    if (typeof msgOrObj === 'string') {
      // Winston style: logger.info('message', { data })
      return [objOrMsg || {}, msgOrObj];
    } else {
      // Pino style: logger.info({ data }, 'message')
      return [msgOrObj, objOrMsg || ''];
    }
  }

  info(msgOrObj: any, objOrMsg?: any) {
    const [obj, msg] = this.normalizeArgs(msgOrObj, objOrMsg);
    this.logger.info(obj, msg);
  }

  error(msgOrObj: any, objOrMsg?: any) {
    const [obj, msg] = this.normalizeArgs(msgOrObj, objOrMsg);
    this.logger.error(obj, msg);
  }

  warn(msgOrObj: any, objOrMsg?: any) {
    const [obj, msg] = this.normalizeArgs(msgOrObj, objOrMsg);
    this.logger.warn(obj, msg);
  }

  debug(msgOrObj: any, objOrMsg?: any) {
    const [obj, msg] = this.normalizeArgs(msgOrObj, objOrMsg);
    this.logger.debug(obj, msg);
  }

  trace(msgOrObj: any, objOrMsg?: any) {
    const [obj, msg] = this.normalizeArgs(msgOrObj, objOrMsg);
    this.logger.trace(obj, msg);
  }

  child(bindings: any): CompatibleLogger {
    return new CompatibleLogger(this.logger.child(bindings));
  }

  // Expose underlying Pino logger for advanced usage
  get pino(): PinoLogger {
    return this.logger;
  }
}

/**
 * Create a Pino logger instance with production-grade configuration
 */
export const createLogger = (serviceNameOrOptions: string | LoggerOptions): CompatibleLogger => {
  const options: LoggerOptions = typeof serviceNameOrOptions === 'string'
    ? { serviceName: serviceNameOrOptions }
    : serviceNameOrOptions;

  const {
    serviceName,
    level = process.env.LOG_LEVEL || 'info',
    prettyPrint = process.env.NODE_ENV !== 'production',
  } = options;

  const config: pino.LoggerOptions = {
    level,
    // Base metadata included in every log
    base: {
      serviceName,
      pid: process.pid,
      hostname: process.env.HOSTNAME || require('os').hostname(),
    },
    // ISO 8601 timestamp
    timestamp: () => `,"time":"${new Date().toISOString()}"`,
    // Format level as string instead of number
    formatters: {
      level: (label) => {
        return { level: label };
      },
      // Auto-inject correlation ID from AsyncLocalStorage
      bindings: (bindings) => {
        const getContext = getCorrelationContextStub;
        if (!getContext) return bindings;
        
        const context = getContext();
        return {
          ...bindings,
          ...(context?.correlationId && { correlationId: context.correlationId }),
          ...(context?.userId && { userId: context.userId }),
          ...(context?.requestId && { requestId: context.requestId }),
        };
      },
    },
    // Serialize errors properly
    serializers: {
      err: pino.stdSerializers.err,
      error: pino.stdSerializers.err,
      req: pino.stdSerializers.req,
      res: pino.stdSerializers.res,
    },
  };

  // Pretty print in development, JSON in production
  if (prettyPrint) {
    config.transport = {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname',
        singleLine: false,
        messageFormat: '[{serviceName}] {msg}',
        errorLikeObjectKeys: ['err', 'error'],
      },
    };
  }

  return new CompatibleLogger(pino(config));
};

/**
 * Create a child logger with additional context
 *
 * Usage:
 * const logger = createLogger('my-service');
 * const userLogger = createChildLogger(logger, { userId: '123' });
 * userLogger.info('User action'); // Automatically includes userId
 */
export const createChildLogger = (logger: CompatibleLogger, context: Record<string, any>): CompatibleLogger => {
  return logger.child(context);
};

export default createLogger;
