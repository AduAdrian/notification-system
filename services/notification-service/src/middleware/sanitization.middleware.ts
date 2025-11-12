import { Request, Response, NextFunction } from 'express';
import { createLogger } from '@notification-system/utils';

const logger = createLogger('sanitization-middleware');

// XSS protection - HTML entity encoding
const escapeHtml = (text: string): string => {
  const map: { [key: string]: string } = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
    '/': '&#x2F;',
  };
  return text.replace(/[&<>"'/]/g, (m) => map[m]);
};

// SQL Injection protection - basic sanitization
const sanitizeSqlInput = (text: string): string => {
  // Remove common SQL injection patterns
  return text
    .replace(/(['";\\])/g, '') // Remove quotes and semicolons
    .replace(/(-{2}|\/\*|\*\/)/g, '') // Remove SQL comment patterns
    .replace(/\b(union|select|insert|update|delete|drop|create|alter|exec|execute)\b/gi, ''); // Remove SQL keywords
};

// NoSQL Injection protection
const sanitizeNoSqlInput = (input: any): any => {
  if (typeof input === 'string') {
    return input;
  }

  if (typeof input === 'object' && input !== null) {
    // Remove MongoDB operators
    const sanitized: any = {};
    for (const key in input) {
      if (!key.startsWith('$')) {
        sanitized[key] = sanitizeNoSqlInput(input[key]);
      }
    }
    return sanitized;
  }

  return input;
};

// Path traversal protection
const sanitizePath = (text: string): string => {
  return text.replace(/\.\./g, '').replace(/[/\\]/g, '');
};

// Command injection protection
const sanitizeCommand = (text: string): string => {
  return text.replace(/[;&|`$()]/g, '');
};

// Deep sanitization for nested objects
const deepSanitize = (obj: any, options: SanitizationOptions): any => {
  if (typeof obj === 'string') {
    let sanitized = obj.trim();

    if (options.xss) {
      sanitized = escapeHtml(sanitized);
    }

    if (options.sql) {
      sanitized = sanitizeSqlInput(sanitized);
    }

    if (options.nosql) {
      sanitized = sanitizeNoSqlInput(sanitized);
    }

    if (options.path) {
      sanitized = sanitizePath(sanitized);
    }

    if (options.command) {
      sanitized = sanitizeCommand(sanitized);
    }

    return sanitized;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => deepSanitize(item, options));
  }

  if (typeof obj === 'object' && obj !== null) {
    const sanitized: any = {};
    for (const key in obj) {
      // Sanitize both keys and values
      const sanitizedKey = deepSanitize(key, options);
      sanitized[sanitizedKey] = deepSanitize(obj[key], options);
    }
    return sanitized;
  }

  return obj;
};

interface SanitizationOptions {
  xss?: boolean;
  sql?: boolean;
  nosql?: boolean;
  path?: boolean;
  command?: boolean;
}

// Middleware factory with configurable options
export const sanitizeInput = (options: SanitizationOptions = {
  xss: true,
  sql: true,
  nosql: true,
  path: true,
  command: true,
}) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      // Sanitize body
      if (req.body) {
        req.body = deepSanitize(req.body, options);
      }

      // Sanitize query parameters
      if (req.query) {
        req.query = deepSanitize(req.query, options);
      }

      // Sanitize URL parameters
      if (req.params) {
        req.params = deepSanitize(req.params, options);
      }

      logger.debug('Input sanitization completed', {
        path: req.path,
        method: req.method,
      });

      next();
    } catch (error) {
      logger.error('Sanitization failed', { error });
      res.status(400).json({
        success: false,
        error: {
          code: 'SANITIZATION_ERROR',
          message: 'Invalid input format',
        },
      });
    }
  };
};

// Export individual sanitization functions for reuse
export {
  escapeHtml,
  sanitizeSqlInput,
  sanitizeNoSqlInput,
  sanitizePath,
  sanitizeCommand,
  deepSanitize,
};
