import {
  EmailPayload,
  SMSPayload,
  PushPayload,
  InAppPayload,
} from '@notification-system/types';

export const testEmailPayload: EmailPayload = {
  to: 'test@example.com',
  from: 'noreply@notification-system.com',
  subject: 'Test Email',
  html: '<h1>Test Email</h1><p>This is a test email.</p>',
  text: 'Test Email\n\nThis is a test email.',
};

export const testSMSPayload: SMSPayload = {
  to: '+1234567890',
  from: '+1987654321',
  message: 'Test SMS message',
};

export const testPushPayload: PushPayload = {
  token: 'test-device-token-abc123',
  title: 'Test Push Notification',
  body: 'This is a test push notification',
  data: {
    type: 'test',
    action: 'open_app',
  },
  badge: 1,
  sound: 'default',
};

export const testInAppPayload: InAppPayload = {
  userId: 'test-user-123',
  title: 'Test In-App Notification',
  message: 'This is a test in-app notification',
  actionUrl: 'https://example.com/action',
  iconUrl: 'https://example.com/icon.png',
};

export const createEmailPayload = (overrides?: Partial<EmailPayload>): EmailPayload => ({
  ...testEmailPayload,
  ...overrides,
});

export const createSMSPayload = (overrides?: Partial<SMSPayload>): SMSPayload => ({
  ...testSMSPayload,
  ...overrides,
});

export const createPushPayload = (overrides?: Partial<PushPayload>): PushPayload => ({
  ...testPushPayload,
  ...overrides,
});

export const createInAppPayload = (overrides?: Partial<InAppPayload>): InAppPayload => ({
  ...testInAppPayload,
  ...overrides,
});
