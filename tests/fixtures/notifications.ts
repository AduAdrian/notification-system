import {
  NotificationChannel,
  NotificationPriority,
  NotificationStatus,
  Notification,
  NotificationRequest,
} from '@notification-system/types';

export const testNotification: Notification = {
  id: 'test-notif-123',
  userId: 'test-user-123',
  channels: [NotificationChannel.EMAIL],
  priority: NotificationPriority.MEDIUM,
  status: NotificationStatus.PENDING,
  subject: 'Test Notification',
  message: 'This is a test notification message',
  metadata: {
    tags: ['test', 'automated'],
    customData: { environment: 'test' },
  },
  createdAt: new Date('2024-01-01T12:00:00Z'),
  updatedAt: new Date('2024-01-01T12:00:00Z'),
};

export const urgentNotification: Notification = {
  id: 'urgent-notif-456',
  userId: 'test-user-456',
  channels: [NotificationChannel.SMS, NotificationChannel.PUSH],
  priority: NotificationPriority.URGENT,
  status: NotificationStatus.PENDING,
  message: 'Urgent notification - immediate action required!',
  metadata: {
    tags: ['urgent', 'security'],
  },
  createdAt: new Date('2024-01-01T12:00:00Z'),
  updatedAt: new Date('2024-01-01T12:00:00Z'),
};

export const multiChannelNotification: Notification = {
  id: 'multi-notif-789',
  userId: 'test-user-789',
  channels: [
    NotificationChannel.EMAIL,
    NotificationChannel.SMS,
    NotificationChannel.PUSH,
    NotificationChannel.IN_APP,
  ],
  priority: NotificationPriority.HIGH,
  status: NotificationStatus.QUEUED,
  subject: 'Multi-channel Announcement',
  message: 'This notification will be sent via all channels',
  metadata: {
    tags: ['announcement', 'broadcast'],
    customData: {
      campaign: 'summer-2024',
      actionUrl: 'https://example.com/promo',
    },
  },
  createdAt: new Date('2024-01-01T12:00:00Z'),
  updatedAt: new Date('2024-01-01T12:00:00Z'),
};

export const testNotificationRequest: NotificationRequest = {
  userId: 'test-user-request',
  channels: [NotificationChannel.EMAIL],
  priority: NotificationPriority.MEDIUM,
  subject: 'Test Request',
  message: 'Test notification request message',
  metadata: {
    tags: ['test'],
  },
};

export const minimalNotificationRequest: NotificationRequest = {
  userId: 'minimal-user',
  channels: [NotificationChannel.IN_APP],
  message: 'Minimal notification - only required fields',
};

export const createTestNotification = (overrides?: Partial<Notification>): Notification => ({
  ...testNotification,
  ...overrides,
  id: overrides?.id || `test-${Date.now()}`,
  createdAt: overrides?.createdAt || new Date(),
  updatedAt: overrides?.updatedAt || new Date(),
});

export const createNotificationRequest = (
  overrides?: Partial<NotificationRequest>
): NotificationRequest => ({
  ...testNotificationRequest,
  ...overrides,
});
