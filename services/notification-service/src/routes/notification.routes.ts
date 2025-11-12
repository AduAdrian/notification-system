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

/**
 * @swagger
 * /api/v1/notifications:
 *   post:
 *     tags:
 *       - Notifications
 *     summary: Create a new notification
 *     description: Creates a new notification for delivery across one or more channels
 *     security:
 *       - BearerAuth: []
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/NotificationRequest'
 *     responses:
 *       201:
 *         description: Notification created successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/NotificationResponse'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 */
notificationRoutes.post(
  '/',
  validateNotification,
  (req: Request, res: Response, next: NextFunction) =>
    controller.createNotification(req, res, next)
);

/**
 * @swagger
 * /api/v1/notifications/{id}:
 *   get:
 *     tags:
 *       - Notifications
 *     summary: Get notification by ID
 *     description: Retrieves detailed information about a specific notification
 *     security:
 *       - BearerAuth: []
 *       - ApiKeyAuth: []
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *         description: Notification ID
 *     responses:
 *       200:
 *         description: Notification found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponse'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
notificationRoutes.get(
  '/:id',
  (req: Request, res: Response, next: NextFunction) =>
    controller.getNotification(req, res, next)
);

/**
 * @swagger
 * /api/v1/notifications/user/{userId}:
 *   get:
 *     tags:
 *       - Notifications
 *     summary: Get user notifications
 *     description: Retrieves a paginated list of notifications for a specific user
 *     security:
 *       - BearerAuth: []
 *       - ApiKeyAuth: []
 *     parameters:
 *       - name: userId
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *         description: User ID
 *       - name: limit
 *         in: query
 *         schema:
 *           type: integer
 *           default: 50
 *           minimum: 1
 *           maximum: 100
 *       - name: offset
 *         in: query
 *         schema:
 *           type: integer
 *           default: 0
 *           minimum: 0
 *     responses:
 *       200:
 *         description: List of user notifications
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponse'
 */
notificationRoutes.get(
  '/user/:userId',
  (req: Request, res: Response, next: NextFunction) =>
    controller.getUserNotifications(req, res, next)
);

/**
 * @swagger
 * /api/v1/notifications/{id}/status:
 *   patch:
 *     tags:
 *       - Notifications
 *     summary: Update notification status
 *     description: Updates the status of an existing notification
 *     security:
 *       - BearerAuth: []
 *       - ApiKeyAuth: []
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *         description: Notification ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - status
 *             properties:
 *               status:
 *                 $ref: '#/components/schemas/NotificationStatus'
 *     responses:
 *       200:
 *         description: Status updated successfully
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
notificationRoutes.patch(
  '/:id/status',
  (req: Request, res: Response, next: NextFunction) =>
    controller.updateStatus(req, res, next)
);
