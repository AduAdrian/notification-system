import { Request, Response, NextFunction } from 'express';
import { validateNotification } from '../../middleware/validation.middleware';
import { NotificationChannel } from '@notification-system/types';

describe('Validation Middleware', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
    mockReq = {
      body: {},
    };
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    mockNext = jest.fn();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('validateNotification', () => {
    it('should pass validation with valid notification request', () => {
      mockReq.body = {
        userId: 'user-123',
        channels: [NotificationChannel.EMAIL],
        message: 'Test message',
      };

      validateNotification(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
    });

    it('should reject request without userId', () => {
      mockReq.body = {
        channels: [NotificationChannel.EMAIL],
        message: 'Test message',
      };

      validateNotification(mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({
            code: 'VALIDATION_ERROR',
          }),
        })
      );
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should reject request without channels', () => {
      mockReq.body = {
        userId: 'user-123',
        message: 'Test message',
      };

      validateNotification(mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should reject request without message', () => {
      mockReq.body = {
        userId: 'user-123',
        channels: [NotificationChannel.EMAIL],
      };

      validateNotification(mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should reject request with empty channels array', () => {
      mockReq.body = {
        userId: 'user-123',
        channels: [],
        message: 'Test message',
      };

      validateNotification(mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should reject request with invalid channel', () => {
      mockReq.body = {
        userId: 'user-123',
        channels: ['invalid_channel'],
        message: 'Test message',
      };

      validateNotification(mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should accept request with optional subject', () => {
      mockReq.body = {
        userId: 'user-123',
        channels: [NotificationChannel.EMAIL],
        message: 'Test message',
        subject: 'Test subject',
      };

      validateNotification(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });

    it('should accept request with optional metadata', () => {
      mockReq.body = {
        userId: 'user-123',
        channels: [NotificationChannel.EMAIL],
        message: 'Test message',
        metadata: {
          tags: ['test'],
          customData: { key: 'value' },
        },
      };

      validateNotification(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });

    it('should accept multiple valid channels', () => {
      mockReq.body = {
        userId: 'user-123',
        channels: [
          NotificationChannel.EMAIL,
          NotificationChannel.SMS,
          NotificationChannel.PUSH,
        ],
        message: 'Test message',
      };

      validateNotification(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });
  });
});
