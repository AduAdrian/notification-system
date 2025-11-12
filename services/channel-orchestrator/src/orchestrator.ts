import { KafkaClient, createLogger } from '@notification-system/utils';
import {
  NotificationCreatedEvent,
  NotificationChannel,
  EmailPayload,
  SMSPayload,
  PushPayload,
  InAppPayload,
} from '@notification-system/types';

const logger = createLogger('orchestrator');

export class ChannelOrchestrator {
  constructor(private kafkaClient: KafkaClient) {}

  async start(): Promise<void> {
    // Subscribe to notification.created events
    await this.kafkaClient.subscribe(
      'channel-orchestrator-group',
      ['notification.created'],
      this.handleNotificationCreated.bind(this)
    );

    logger.info('Subscribed to notification events');
  }

  private async handleNotificationCreated(event: any): Promise<void> {
    const notificationEvent = event as NotificationCreatedEvent;
    const { data: notification } = notificationEvent;

    logger.info('Processing notification', {
      notificationId: notification.id,
      channels: notification.channels,
    });

    // Route to appropriate channels
    for (const channel of notification.channels) {
      try {
        await this.routeToChannel(channel, notification);
      } catch (error) {
        logger.error('Failed to route to channel', {
          notificationId: notification.id,
          channel,
          error,
        });
      }
    }
  }

  private async routeToChannel(channel: NotificationChannel, notification: any): Promise<void> {
    switch (channel) {
      case NotificationChannel.EMAIL:
        await this.routeToEmail(notification);
        break;
      case NotificationChannel.SMS:
        await this.routeToSMS(notification);
        break;
      case NotificationChannel.PUSH:
        await this.routeToPush(notification);
        break;
      case NotificationChannel.IN_APP:
        await this.routeToInApp(notification);
        break;
      default:
        logger.warn('Unknown channel', { channel });
    }
  }

  private async routeToEmail(notification: any): Promise<void> {
    // TODO: Fetch user email from user service
    const emailPayload: EmailPayload = {
      to: 'user@example.com', // Replace with actual user email
      from: process.env.EMAIL_FROM || 'noreply@notification-system.com',
      subject: notification.subject || 'New Notification',
      html: `<p>${notification.message}</p>`,
      text: notification.message,
    };

    await this.kafkaClient.publishEvent('channel.email.queued', {
      type: 'channel.email.queued',
      data: {
        notificationId: notification.id,
        channel: NotificationChannel.EMAIL,
        payload: emailPayload,
      },
      timestamp: new Date(),
    });

    logger.info('Routed to email channel', { notificationId: notification.id });
  }

  private async routeToSMS(notification: any): Promise<void> {
    const smsPayload: SMSPayload = {
      to: '+1234567890', // Replace with actual user phone
      from: process.env.SMS_FROM || '+1987654321',
      message: notification.message,
    };

    await this.kafkaClient.publishEvent('channel.sms.queued', {
      type: 'channel.sms.queued',
      data: {
        notificationId: notification.id,
        channel: NotificationChannel.SMS,
        payload: smsPayload,
      },
      timestamp: new Date(),
    });

    logger.info('Routed to SMS channel', { notificationId: notification.id });
  }

  private async routeToPush(notification: any): Promise<void> {
    const pushPayload: PushPayload = {
      token: 'device-token', // Replace with actual device token
      title: notification.subject || 'Notification',
      body: notification.message,
      data: notification.metadata?.customData,
    };

    await this.kafkaClient.publishEvent('channel.push.queued', {
      type: 'channel.push.queued',
      data: {
        notificationId: notification.id,
        channel: NotificationChannel.PUSH,
        payload: pushPayload,
      },
      timestamp: new Date(),
    });

    logger.info('Routed to push channel', { notificationId: notification.id });
  }

  private async routeToInApp(notification: any): Promise<void> {
    const inAppPayload: InAppPayload = {
      userId: notification.userId,
      title: notification.subject || 'Notification',
      message: notification.message,
      actionUrl: notification.metadata?.actionUrl,
    };

    await this.kafkaClient.publishEvent('channel.inapp.queued', {
      type: 'channel.inapp.queued',
      data: {
        notificationId: notification.id,
        channel: NotificationChannel.IN_APP,
        payload: inAppPayload,
      },
      timestamp: new Date(),
    });

    logger.info('Routed to in-app channel', { notificationId: notification.id });
  }
}
