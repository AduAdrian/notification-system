import { Notification, NotificationStatus } from '@notification-system/types';

export class MockDatabaseService {
  private notifications: Map<string, Notification> = new Map();
  public connected = false;

  async connect(): Promise<void> {
    this.connected = true;
    return Promise.resolve();
  }

  async createNotification(notification: Notification): Promise<void> {
    this.notifications.set(notification.id, notification);
    return Promise.resolve();
  }

  async getNotification(id: string): Promise<Notification | null> {
    return this.notifications.get(id) || null;
  }

  async getUserNotifications(
    userId: string,
    limit: number,
    offset: number
  ): Promise<Notification[]> {
    const userNotifications = Array.from(this.notifications.values())
      .filter((n) => n.userId === userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(offset, offset + limit);

    return userNotifications;
  }

  async updateNotificationStatus(id: string, status: NotificationStatus): Promise<void> {
    const notification = this.notifications.get(id);
    if (notification) {
      notification.status = status;
      notification.updatedAt = new Date();
    }
    return Promise.resolve();
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    return Promise.resolve();
  }

  // Helper methods for testing
  reset(): void {
    this.notifications.clear();
    this.connected = false;
  }

  getAll(): Notification[] {
    return Array.from(this.notifications.values());
  }

  count(): number {
    return this.notifications.size;
  }
}

export const createMockDatabaseService = (): MockDatabaseService => {
  return new MockDatabaseService();
};
