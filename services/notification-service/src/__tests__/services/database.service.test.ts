import { Pool } from 'pg';
import { DatabaseService } from '../../services/database.service';
import {
  NotificationChannel,
  NotificationPriority,
  NotificationStatus,
  Notification,
} from '@notification-system/types';

// Mock pg module
jest.mock('pg', () => {
  const mPool = {
    connect: jest.fn(),
    query: jest.fn(),
    end: jest.fn(),
  };
  return { Pool: jest.fn(() => mPool) };
});

// Mock logger
jest.mock('@notification-system/utils', () => ({
  createLogger: jest.fn(() => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  })),
}));

describe('DatabaseService', () => {
  let service: DatabaseService;
  let mockPool: any;

  beforeEach(() => {
    service = new DatabaseService();
    mockPool = (Pool as jest.MockedClass<typeof Pool>).mock.results[0].value;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('connect', () => {
    it('should connect successfully', async () => {
      const mockClient = {
        release: jest.fn(),
      };
      mockPool.connect.mockResolvedValueOnce(mockClient);

      await service.connect();

      expect(mockPool.connect).toHaveBeenCalled();
      expect(mockClient.release).toHaveBeenCalled();
    });

    it('should throw error if connection fails', async () => {
      const error = new Error('Connection failed');
      mockPool.connect.mockRejectedValueOnce(error);

      await expect(service.connect()).rejects.toThrow('Connection failed');
    });
  });

  describe('createNotification', () => {
    it('should insert notification into database', async () => {
      const notification: Notification = {
        id: 'notif-123',
        userId: 'user-123',
        channels: [NotificationChannel.EMAIL, NotificationChannel.SMS],
        priority: NotificationPriority.HIGH,
        status: NotificationStatus.PENDING,
        subject: 'Test Subject',
        message: 'Test message',
        metadata: { customData: { key: 'value' } },
        createdAt: new Date('2025-01-01'),
        updatedAt: new Date('2025-01-01'),
      };

      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await service.createNotification(notification);

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO notifications'),
        [
          'notif-123',
          'user-123',
          JSON.stringify([NotificationChannel.EMAIL, NotificationChannel.SMS]),
          NotificationPriority.HIGH,
          NotificationStatus.PENDING,
          'Test Subject',
          'Test message',
          JSON.stringify({ customData: { key: 'value' } }),
          notification.createdAt,
          notification.updatedAt,
        ]
      );
    });

    it('should handle database errors', async () => {
      const notification: Notification = {
        id: 'notif-123',
        userId: 'user-123',
        channels: [NotificationChannel.EMAIL],
        priority: NotificationPriority.MEDIUM,
        status: NotificationStatus.PENDING,
        message: 'Test message',
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const error = new Error('Database error');
      mockPool.query.mockRejectedValueOnce(error);

      await expect(service.createNotification(notification)).rejects.toThrow(
        'Database error'
      );
    });
  });

  describe('getNotification', () => {
    it('should retrieve notification by id', async () => {
      const mockRow = {
        id: 'notif-123',
        user_id: 'user-123',
        channels: JSON.stringify([NotificationChannel.EMAIL]),
        priority: NotificationPriority.MEDIUM,
        status: NotificationStatus.SENT,
        subject: 'Test Subject',
        message: 'Test message',
        metadata: JSON.stringify({ key: 'value' }),
        created_at: new Date('2025-01-01'),
        updated_at: new Date('2025-01-01'),
      };

      mockPool.query.mockResolvedValueOnce({ rows: [mockRow] });

      const result = await service.getNotification('notif-123');

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM notifications WHERE id = $1'),
        ['notif-123']
      );

      expect(result).toEqual({
        id: 'notif-123',
        userId: 'user-123',
        channels: [NotificationChannel.EMAIL],
        priority: NotificationPriority.MEDIUM,
        status: NotificationStatus.SENT,
        subject: 'Test Subject',
        message: 'Test message',
        metadata: { key: 'value' },
        createdAt: mockRow.created_at,
        updatedAt: mockRow.updated_at,
      });
    });

    it('should return null if notification not found', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const result = await service.getNotification('non-existent');

      expect(result).toBeNull();
    });
  });

  describe('getUserNotifications', () => {
    it('should retrieve user notifications with pagination', async () => {
      const mockRows = [
        {
          id: 'notif-1',
          user_id: 'user-123',
          channels: JSON.stringify([NotificationChannel.EMAIL]),
          priority: NotificationPriority.MEDIUM,
          status: NotificationStatus.SENT,
          subject: 'Subject 1',
          message: 'Message 1',
          metadata: JSON.stringify({}),
          created_at: new Date('2025-01-02'),
          updated_at: new Date('2025-01-02'),
        },
        {
          id: 'notif-2',
          user_id: 'user-123',
          channels: JSON.stringify([NotificationChannel.SMS]),
          priority: NotificationPriority.HIGH,
          status: NotificationStatus.DELIVERED,
          subject: 'Subject 2',
          message: 'Message 2',
          metadata: JSON.stringify({}),
          created_at: new Date('2025-01-01'),
          updated_at: new Date('2025-01-01'),
        },
      ];

      mockPool.query.mockResolvedValueOnce({ rows: mockRows });

      const result = await service.getUserNotifications('user-123', 10, 0);

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE user_id = $1'),
        ['user-123', 10, 0]
      );

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('notif-1');
      expect(result[1].id).toBe('notif-2');
    });

    it('should apply limit and offset correctly', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await service.getUserNotifications('user-123', 20, 10);

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.any(String),
        ['user-123', 20, 10]
      );
    });
  });

  describe('updateNotificationStatus', () => {
    it('should update notification status', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await service.updateNotificationStatus('notif-123', NotificationStatus.DELIVERED);

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE notifications SET status = $1'),
        [NotificationStatus.DELIVERED, expect.any(Date), 'notif-123']
      );
    });

    it('should handle update errors', async () => {
      const error = new Error('Update failed');
      mockPool.query.mockRejectedValueOnce(error);

      await expect(
        service.updateNotificationStatus('notif-123', NotificationStatus.FAILED)
      ).rejects.toThrow('Update failed');
    });
  });

  describe('disconnect', () => {
    it('should close pool connection', async () => {
      mockPool.end.mockResolvedValueOnce(undefined);

      await service.disconnect();

      expect(mockPool.end).toHaveBeenCalled();
    });
  });
});
