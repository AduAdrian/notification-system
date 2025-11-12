// Notification Types
export enum NotificationChannel {
  EMAIL = 'email',
  SMS = 'sms',
  PUSH = 'push',
  IN_APP = 'in_app'
}

export enum NotificationPriority {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  URGENT = 'urgent'
}

export enum NotificationStatus {
  PENDING = 'pending',
  QUEUED = 'queued',
  SENT = 'sent',
  DELIVERED = 'delivered',
  FAILED = 'failed',
  BOUNCED = 'bounced'
}

export interface NotificationMetadata {
  templateId?: string;
  tags?: string[];
  customData?: Record<string, any>;
  scheduledAt?: Date;
  expiresAt?: Date;
}

export interface Notification {
  id: string;
  userId: string;
  channels: NotificationChannel[];
  priority: NotificationPriority;
  status: NotificationStatus;
  subject?: string;
  message: string;
  metadata: NotificationMetadata;
  createdAt: Date;
  updatedAt: Date;
}

export interface NotificationRequest {
  userId: string;
  channels: NotificationChannel[];
  priority?: NotificationPriority;
  subject?: string;
  message: string;
  metadata?: NotificationMetadata;
}

// User Types
export interface UserPreferences {
  userId: string;
  enabledChannels: NotificationChannel[];
  emailAddress?: string;
  phoneNumber?: string;
  pushTokens?: string[];
  quietHours?: {
    start: string; // HH:mm format
    end: string;
  };
  timezone?: string;
}

export interface User {
  id: string;
  email?: string;
  phone?: string;
  preferences: UserPreferences;
  createdAt: Date;
  updatedAt: Date;
}

// Channel-specific Types
export interface EmailPayload {
  to: string;
  from: string;
  subject: string;
  html: string;
  text?: string;
  attachments?: Array<{
    filename: string;
    content: Buffer | string;
    contentType: string;
  }>;
}

export interface SMSPayload {
  to: string;
  from: string;
  message: string;
}

export interface PushPayload {
  token: string;
  title: string;
  body: string;
  data?: Record<string, string>;
  badge?: number;
  sound?: string;
}

export interface InAppPayload {
  userId: string;
  title: string;
  message: string;
  actionUrl?: string;
  iconUrl?: string;
}

// Kafka Event Types
export interface NotificationCreatedEvent {
  type: 'notification.created';
  data: Notification;
  timestamp: Date;
}

export interface ChannelQueuedEvent {
  type: 'channel.email.queued' | 'channel.sms.queued' | 'channel.push.queued' | 'channel.inapp.queued';
  data: {
    notificationId: string;
    channel: NotificationChannel;
    payload: EmailPayload | SMSPayload | PushPayload | InAppPayload;
  };
  timestamp: Date;
}

export interface ChannelSentEvent {
  type: 'channel.email.sent' | 'channel.sms.sent' | 'channel.push.sent' | 'channel.inapp.sent';
  data: {
    notificationId: string;
    channel: NotificationChannel;
    providerId?: string;
  };
  timestamp: Date;
}

export interface DeliveryEvent {
  type: 'delivery.delivered' | 'delivery.failed' | 'delivery.bounced';
  data: {
    notificationId: string;
    channel: NotificationChannel;
    error?: string;
    metadata?: Record<string, any>;
  };
  timestamp: Date;
}

export type KafkaEvent = NotificationCreatedEvent | ChannelQueuedEvent | ChannelSentEvent | DeliveryEvent;

// API Response Types
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
  metadata?: {
    requestId: string;
    timestamp: Date;
  };
}

// Database Models
export interface NotificationRecord {
  id: string;
  user_id: string;
  channels: string[];
  priority: string;
  status: string;
  subject: string | null;
  message: string;
  metadata: any;
  created_at: Date;
  updated_at: Date;
}

export interface DeliveryLogRecord {
  id: string;
  notification_id: string;
  channel: string;
  status: string;
  provider_id: string | null;
  error_message: string | null;
  delivered_at: Date | null;
  created_at: Date;
}
