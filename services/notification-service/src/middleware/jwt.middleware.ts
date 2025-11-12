import { Request, Response, NextFunction } from 'express';
import { createLogger } from '@notification-system/utils';
import { TokenService } from '../services/token.service';

const logger = createLogger('jwt-middleware');

/**
 * Enhanced JWT Authentication Middleware
 * Supports access token validation with automatic refresh token rotation
 */
export const jwtAuth = (tokenService: TokenService) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // Extract token from Authorization header
      const authHeader = req.headers.authorization;

      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.status(401).json({
          success: false,
          error: {
            code: 'UNAUTHORIZED',
            message: 'No authentication token provided',
          },
        });
        return;
      }

      const token = authHeader.substring(7);

      // Validate access token
      const payload = await tokenService.validateAccessToken(token);

      if (!payload) {
        res.status(401).json({
          success: false,
          error: {
            code: 'INVALID_TOKEN',
            message: 'Invalid or expired token',
          },
        });
        return;
      }

      // Attach user info to request
      (req as any).user = {
        userId: payload.userId,
        email: payload.email,
        roles: payload.roles || [],
        permissions: payload.permissions || [],
        authMethod: 'jwt',
      };

      logger.debug('JWT authentication successful', { userId: payload.userId });

      next();
    } catch (error) {
      logger.error('JWT authentication error', { error });
      res.status(401).json({
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
 * Refresh Token Endpoint Handler
 * Implements secure token rotation
 */
export const refreshTokenHandler = (tokenService: TokenService) => {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const { refreshToken } = req.body;

      if (!refreshToken) {
        res.status(400).json({
          success: false,
          error: {
            code: 'REFRESH_TOKEN_REQUIRED',
            message: 'Refresh token is required',
          },
        });
        return;
      }

      // Refresh the token pair
      const tokenPair = await tokenService.refreshAccessToken(refreshToken);

      res.status(200).json({
        success: true,
        data: {
          accessToken: tokenPair.accessToken,
          refreshToken: tokenPair.refreshToken,
          expiresIn: tokenPair.expiresIn,
          tokenType: 'Bearer',
        },
      });
    } catch (error: any) {
      logger.error('Token refresh failed', { error });

      // Check for token reuse (security incident)
      if (error.message && error.message.includes('reuse detected')) {
        res.status(403).json({
          success: false,
          error: {
            code: 'TOKEN_REUSE_DETECTED',
            message: 'Security breach detected. Please log in again.',
          },
        });
        return;
      }

      res.status(401).json({
        success: false,
        error: {
          code: 'INVALID_REFRESH_TOKEN',
          message: 'Invalid or expired refresh token',
        },
      });
    }
  };
};

/**
 * Logout Handler
 * Revokes refresh tokens and blacklists access token
 */
export const logoutHandler = (tokenService: TokenService) => {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const { refreshToken, logoutAll } = req.body;
      const authHeader = req.headers.authorization;

      // Blacklist current access token
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const accessToken = authHeader.substring(7);
        await tokenService.blacklistAccessToken(accessToken);
      }

      // Revoke refresh token(s)
      if (logoutAll && (req as any).user?.userId) {
        // Logout from all devices
        await tokenService.revokeUserTokens((req as any).user.userId);
        logger.info('User logged out from all devices', { userId: (req as any).user.userId });
      } else if (refreshToken) {
        // Logout from current device only
        const decoded = await tokenService.validateAccessToken(refreshToken);
        if (decoded) {
          await tokenService.revokeRefreshToken(refreshToken);
          logger.info('User logged out', { userId: decoded.userId });
        }
      }

      res.status(200).json({
        success: true,
        message: logoutAll ? 'Logged out from all devices' : 'Logged out successfully',
      });
    } catch (error) {
      logger.error('Logout failed', { error });
      res.status(500).json({
        success: false,
        error: {
          code: 'LOGOUT_ERROR',
          message: 'Failed to logout',
        },
      });
    }
  };
};

/**
 * Role-Based Access Control Middleware
 */
export const requireRole = (allowedRoles: string[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const user = (req as any).user;

    if (!user || !user.roles) {
      res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'Access denied',
        },
      });
      return;
    }

    const hasRole = allowedRoles.some((role) => user.roles.includes(role));

    if (!hasRole) {
      logger.warn('Access denied - insufficient role', {
        userId: user.userId,
        requiredRoles: allowedRoles,
        userRoles: user.roles,
      });

      res.status(403).json({
        success: false,
        error: {
          code: 'INSUFFICIENT_PERMISSIONS',
          message: 'You do not have permission to access this resource',
        },
      });
      return;
    }

    next();
  };
};

/**
 * Permission-Based Access Control Middleware
 */
export const requirePermission = (permission: string) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const user = (req as any).user;

    if (!user || !user.permissions) {
      res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'Access denied',
        },
      });
      return;
    }

    if (!user.permissions.includes(permission)) {
      logger.warn('Access denied - insufficient permission', {
        userId: user.userId,
        requiredPermission: permission,
        userPermissions: user.permissions,
      });

      res.status(403).json({
        success: false,
        error: {
          code: 'INSUFFICIENT_PERMISSIONS',
          message: 'You do not have permission to perform this action',
        },
      });
      return;
    }

    next();
  };
};
