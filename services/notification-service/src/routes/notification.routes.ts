import { Router, Request, Response, NextFunction } from 'express';
import { NotificationController } from '../controllers/notification.controller';
import { validateNotification } from '../middleware/validation.middleware';
import { authMiddleware } from '../middleware/auth.middleware';
import { rateLimiter } from '../middleware/ratelimit.middleware';

export const notificationRoutes = Router();
const controller = new NotificationController();

// Apply auth and rate limiting to all routes
notificationRoutes.use(authMiddleware);
notificationRoutes.use(rateLimiter);

// Create notification
notificationRoutes.post(
  '/',
  validateNotification,
  (req: Request, res: Response, next: NextFunction) =>
    controller.createNotification(req, res, next)
);

// Get notification by ID
notificationRoutes.get(
  '/:id',
  (req: Request, res: Response, next: NextFunction) =>
    controller.getNotification(req, res, next)
);

// Get user notifications
notificationRoutes.get(
  '/user/:userId',
  (req: Request, res: Response, next: NextFunction) =>
    controller.getUserNotifications(req, res, next)
);

// Update notification status
notificationRoutes.patch(
  '/:id/status',
  (req: Request, res: Response, next: NextFunction) =>
    controller.updateStatus(req, res, next)
);
