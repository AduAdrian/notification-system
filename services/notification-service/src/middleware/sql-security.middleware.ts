import { Request, Response, NextFunction } from 'express';
import { createLogger } from '@notification-system/utils';

const logger = createLogger('sql-security-middleware');

/**
 * SQL Injection Prevention Middleware
 *
 * This middleware provides additional protection against SQL injection attacks
 * by validating and sanitizing inputs before they reach the database layer.
 *
 * Best Practices Implemented:
 * 1. Parameterized queries are enforced at the database service layer
 * 2. Input validation for common SQL injection patterns
 * 3. Type checking to ensure data integrity
 * 4. Blocklist for dangerous SQL keywords in user inputs
 */

// Dangerous SQL patterns to detect
const SQL_INJECTION_PATTERNS = [
  /(\bunion\b.*\bselect\b)/i,
  /(\bselect\b.*\bfrom\b.*\bwhere\b)/i,
  /(\bdrop\b.*\btable\b)/i,
  /(\bdelete\b.*\bfrom\b)/i,
  /(\binsert\b.*\binto\b)/i,
  /(\bupdate\b.*\bset\b)/i,
  /(\bexec\b|\bexecute\b)/i,
  /(;.*--)/, // SQL comment after semicolon
  /('.*or.*'.*=.*')/i, // Classic SQL injection
  /(\bor\b.*1.*=.*1)/i,
  /(\band\b.*1.*=.*1)/i,
  /(\/\*.*\*\/)/,  // SQL comments
  /(\bxp_.*)/i, // Extended stored procedures
  /(\bsp_.*)/i, // System stored procedures
];

// Check if string contains SQL injection patterns
const containsSqlInjection = (value: string): boolean => {
  return SQL_INJECTION_PATTERNS.some(pattern => pattern.test(value));
};

// Recursively check object for SQL injection attempts
const checkObjectForSqlInjection = (obj: any, path: string = 'root'): string | null => {
  if (typeof obj === 'string') {
    if (containsSqlInjection(obj)) {
      return path;
    }
  } else if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      const result = checkObjectForSqlInjection(obj[i], `${path}[${i}]`);
      if (result) return result;
    }
  } else if (typeof obj === 'object' && obj !== null) {
    for (const key in obj) {
      const result = checkObjectForSqlInjection(obj[key], `${path}.${key}`);
      if (result) return result;
    }
  }

  return null;
};

/**
 * SQL Injection Detection Middleware
 * Scans request data for potential SQL injection patterns
 */
export const sqlInjectionProtection = (req: Request, res: Response, next: NextFunction): void => {
  try {
    // Check body
    if (req.body) {
      const bodyResult = checkObjectForSqlInjection(req.body, 'body');
      if (bodyResult) {
        logger.warn('Potential SQL injection detected in request body', {
          path: bodyResult,
          ip: req.ip,
          method: req.method,
          url: req.url,
        });

        res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_INPUT',
            message: 'Invalid characters detected in input',
          },
        });
        return;
      }
    }

    // Check query parameters
    if (req.query) {
      const queryResult = checkObjectForSqlInjection(req.query, 'query');
      if (queryResult) {
        logger.warn('Potential SQL injection detected in query parameters', {
          path: queryResult,
          ip: req.ip,
          method: req.method,
          url: req.url,
        });

        res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_INPUT',
            message: 'Invalid characters detected in query parameters',
          },
        });
        return;
      }
    }

    // Check URL parameters
    if (req.params) {
      const paramsResult = checkObjectForSqlInjection(req.params, 'params');
      if (paramsResult) {
        logger.warn('Potential SQL injection detected in URL parameters', {
          path: paramsResult,
          ip: req.ip,
          method: req.method,
          url: req.url,
        });

        res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_INPUT',
            message: 'Invalid characters detected in URL parameters',
          },
        });
        return;
      }
    }

    next();
  } catch (error) {
    logger.error('SQL injection check failed', { error });
    next(); // Fail open for availability
  }
};

/**
 * Query Parameter Validator
 * Ensures query parameters match expected types and formats
 */
export const validateQueryParams = (
  allowedParams: { [key: string]: 'string' | 'number' | 'boolean' }
) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      for (const [param, type] of Object.entries(allowedParams)) {
        if (req.query[param] !== undefined) {
          const value = req.query[param];

          if (type === 'number' && isNaN(Number(value))) {
            res.status(400).json({
              success: false,
              error: {
                code: 'VALIDATION_ERROR',
                message: `Parameter '${param}' must be a number`,
              },
            });
            return;
          }

          if (type === 'boolean' && value !== 'true' && value !== 'false') {
            res.status(400).json({
              success: false,
              error: {
                code: 'VALIDATION_ERROR',
                message: `Parameter '${param}' must be a boolean`,
              },
            });
            return;
          }
        }
      }

      next();
    } catch (error) {
      logger.error('Query parameter validation failed', { error });
      next();
    }
  };
};

/**
 * Database Service Best Practices Documentation
 *
 * The database.service.ts file already implements parameterized queries correctly:
 *
 * GOOD EXAMPLES (Already implemented):
 * ✓ await this.pool.query('SELECT * FROM notifications WHERE id = $1', [id]);
 * ✓ await this.pool.query(query, [status, new Date(), id]);
 *
 * BAD EXAMPLES (Never do this):
 * ✗ await this.pool.query(`SELECT * FROM notifications WHERE id = '${id}'`);
 * ✗ await this.pool.query('SELECT * FROM users WHERE email = ' + email);
 *
 * Key Principles:
 * 1. Always use parameterized queries ($1, $2, etc.)
 * 2. Never concatenate user input into SQL strings
 * 3. Use prepared statements for repeated queries
 * 4. Validate and sanitize inputs before database operations
 * 5. Use ORM/Query builders when possible for additional safety
 * 6. Implement least privilege database access
 * 7. Enable database query logging for security audits
 */

export const SQL_SECURITY_DOCUMENTATION = {
  parameterizedQueries: 'Always use $1, $2 placeholders instead of string concatenation',
  inputValidation: 'Validate all user inputs before database operations',
  leastPrivilege: 'Database users should have minimal required permissions',
  auditLogging: 'Log all database queries for security monitoring',
  preparedStatements: 'Use prepared statements for frequently executed queries',
};
