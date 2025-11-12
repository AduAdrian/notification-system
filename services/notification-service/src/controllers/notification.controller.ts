import { Request, Response, NextFunction } from 'express';
import { NotificationRequest, NotificationChannel, NotificationPriority, NotificationStatus } from '@notification-system/types';
import { createLogger, uuid } from '@notification-system/utils';

const logger = createLogger('notification-controller');

export class NotificationController {
  async createNotification(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const notificationRequest: NotificationRequest = req.body;
      const { kafkaClient, dbService, redisService } = req.app.locals;

      // Generate notification ID
      const notificationId = uuid();

      // Create notification record
      const notification = {
        id: notificationId,
        userId: notificationRequest.userId,
        channels: notificationRequest.channels,
        priority: notificationRequest.priority || NotificationPriority.MEDIUM,
        status: NotificationStatus.PENDING,
        subject: notificationRequest.subject,
        message: notificationRequest.message,
        metadata: notificationRequest.metadata || {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Save to database
      await dbService.createNotification(notification);

      // Cache for quick access
      await redisService.cacheNotification(notificationId, notification);

      // Publish to Kafka
      await kafkaClient.publishEvent('notification.created', {
        type: 'notification.created',
        data: notification,
        timestamp: new Date(),
      });

      logger.info('Notification created', {
        notificationId,
        userId: notification.userId,
        channels: notification.channels,
      });

      res.status(201).json({
        success: true,
        data: {
          id: notificationId,
          status: NotificationStatus.PENDING,
          createdAt: notification.createdAt,
        },
        metadata: {
          requestId: req.headers['x-request-id'] as string,
          timestamp: new Date(),
        },
      });
    } catch (error) {
      logger.error('Failed to create notification', { error });
      next(error);
    }
  }

  async getNotification(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const { dbService, redisService } = req.app.locals;

      // Try cache first
      let notification = await redisService.getNotification(id);

      if (!notification) {
        // Fallback to database
        notification = await dbService.getNotification(id);
        if (notification) {
          await redisService.cacheNotification(id, notification);
        }
      }

      if (!notification) {
        res.status(404).json({
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'Notification not found',
          },
        });
        return;
      }

      res.json({
        success: true,
        data: notification,
      });
    } catch (error) {
      logger.error('Failed to get notification', { error, id: req.params.id });
      next(error);
    }
  }

  async getUserNotifications(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { userId } = req.params;
      const { limit = 50, offset = 0 } = req.query;
      const { dbService } = req.app.locals;

      const notifications = await dbService.getUserNotifications(
        userId,
        Number(limit),
        Number(offset)
      );

      res.json({
        success: true,
        data: notifications,
        metadata: {
          total: notifications.length,
          limit: Number(limit),
          offset: Number(offset),
        },
      });
    } catch (error) {
      logger.error('Failed to get user notifications', { error, userId: req.params.userId });
      next(error);
    }
  }

  async updateStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const { status } = req.body;
      const { dbService, redisService } = req.app.locals;

      await dbService.updateNotificationStatus(id, status);
      await redisService.deleteNotification(id); // Invalidate cache

      logger.info('Notification status updated', { id, status });

      res.json({
        success: true,
        data: { id, status },
      });
    } catch (error) {
      logger.error('Failed to update notification status', { error, id: req.params.id });
      next(error);
    }
  }
}
