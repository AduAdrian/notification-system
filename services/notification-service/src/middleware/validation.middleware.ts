import { Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import { NotificationChannel, NotificationPriority } from '@notification-system/types';

const notificationSchema = Joi.object({
  userId: Joi.string().required(),
  channels: Joi.array()
    .items(Joi.string().valid(...Object.values(NotificationChannel)))
    .min(1)
    .required(),
  priority: Joi.string().valid(...Object.values(NotificationPriority)).optional(),
  subject: Joi.string().max(200).optional(),
  message: Joi.string().required().max(5000),
  metadata: Joi.object({
    templateId: Joi.string().optional(),
    tags: Joi.array().items(Joi.string()).optional(),
    customData: Joi.object().optional(),
    scheduledAt: Joi.date().optional(),
    expiresAt: Joi.date().optional(),
  }).optional(),
});

export const validateNotification = (req: Request, res: Response, next: NextFunction): void => {
  const { error } = notificationSchema.validate(req.body);

  if (error) {
    res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: error.details[0].message,
      },
    });
    return;
  }

  next();
};
