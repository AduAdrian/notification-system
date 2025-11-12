import { Request, Response, NextFunction } from 'express';
import { createLogger } from '@notification-system/utils';
import { ApiKeyService } from '../services/apikey.service';

const logger = createLogger('apikey-middleware');

/**
 * API Key Authentication Middleware
 *
 * Supports API key authentication via:
 * 1. Authorization header: "Bearer ns_..."
 * 2. X-API-Key header: "ns_..."
 * 3. Query parameter: ?api_key=ns_... (less secure, for webhooks only)
 */
export const apiKeyAuth = (apiKeyService: ApiKeyService) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      let apiKey: string | undefined;

      // Check Authorization header (Bearer token)
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        apiKey = authHeader.substring(7);
      }

      // Check X-API-Key header
      if (!apiKey && req.headers['x-api-key']) {
        apiKey = req.headers['x-api-key'] as string;
      }

      // Check query parameter (least secure, only for specific use cases)
      if (!apiKey && req.query.api_key) {
        apiKey = req.query.api_key as string;
        // Log warning for query param usage
        logger.warn('API key provided in query parameter', {
          path: req.path,
          ip: req.ip,
        });
      }

      if (!apiKey) {
        res.status(401).json({
          success: false,
          error: {
            code: 'API_KEY_REQUIRED',
            message: 'API key is required for authentication',
          },
        });
        return;
      }

      // Validate the API key
      const validation = await apiKeyService.validateApiKey(apiKey);

      if (!validation.valid) {
        logger.warn('Invalid API key attempt', {
          ip: req.ip,
          path: req.path,
          keyPrefix: apiKey.substring(0, 10),
        });

        res.status(401).json({
          success: false,
          error: {
            code: 'INVALID_API_KEY',
            message: 'Invalid or expired API key',
          },
        });
        return;
      }

      // Attach user info to request
      (req as any).user = {
        userId: validation.userId,
        apiKeyId: validation.keyId,
        authMethod: 'apikey',
      };

      logger.debug('API key authentication successful', {
        userId: validation.userId,
        keyId: validation.keyId,
      });

      next();
    } catch (error) {
      logger.error('API key authentication error', { error });
      res.status(500).json({
        success: false,
        error: {
          code: 'AUTHENTICATION_ERROR',
          message: 'Authentication failed',
        },
      });
    }
  };
};

/**
 * Dual Authentication Middleware
 * Accepts both JWT and API Key authentication
 */
export const dualAuth = (apiKeyService: ApiKeyService, jwtMiddleware: any) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // Check for API key first
    const apiKey =
      req.headers['x-api-key'] ||
      (req.headers.authorization?.startsWith('Bearer ns_')
        ? req.headers.authorization.substring(7)
        : null);

    if (apiKey) {
      // Use API key authentication
      return apiKeyAuth(apiKeyService)(req, res, next);
    }

    // Fall back to JWT authentication
    return jwtMiddleware(req, res, next);
  };
};
