import { Request, Response, NextFunction } from 'express';
import { createLogger } from '@notification-system/utils';

const logger = createLogger('ratelimit-middleware');

export const rateLimiter = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { redisService } = req.app.locals;
    const userId = (req as any).user?.userId || req.ip;

    const allowed = await redisService.checkRateLimit(userId, 150, 3600); // 150 per hour

    if (!allowed) {
      res.status(429).json({
        success: false,
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many requests, please try again later',
        },
      });
      return;
    }

    next();
  } catch (error) {
    logger.error('Rate limit check failed', { error });
    next(); // Fail open
  }
};
