import { Pool, PoolClient } from 'pg';
import { Notification, NotificationStatus } from '@notification-system/types';
import { createLogger } from '@notification-system/utils';

const logger = createLogger('database-service');

export class DatabaseService {
  private _pool: Pool;

  constructor() {
    this._pool = new Pool({
      host: process.env.DB_HOST || 'localhost',
      port: Number(process.env.DB_PORT) || 5432,
      database: process.env.DB_NAME || 'notifications',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres',
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });
  }

  get pool(): Pool {
    return this._pool;
  }

  async connect(): Promise<void> {
    try {
      const client = await this._pool.connect();
      client.release();
      logger.info('Database connected successfully');
    } catch (error) {
      logger.error('Failed to connect to database', { error });
      throw error;
    }
  }

  async isHealthy(): Promise<boolean> {
    try {
      const client = await this._pool.connect();
      client.release();
      return true;
    } catch {
      return false;
    }
  }

  async createNotification(notification: Notification): Promise<void> {
    const query = `
      INSERT INTO notifications (
        id, user_id, channels, priority, status, subject, message, metadata, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `;

    const values = [
      notification.id,
      notification.userId,
      JSON.stringify(notification.channels),
      notification.priority,
      notification.status,
      notification.subject,
      notification.message,
      JSON.stringify(notification.metadata),
      notification.createdAt,
      notification.updatedAt,
    ];

    try {
      await this._pool.query(query, values);
    } catch (error) {
      logger.error('Failed to create notification', { error, notificationId: notification.id });
      throw error;
    }
  }

  async getNotification(id: string): Promise<Notification | null> {
    const query = 'SELECT * FROM notifications WHERE id = $1';

    try {
      const result = await this._pool.query(query, [id]);
      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];
      return {
        id: row.id,
        userId: row.user_id,
        channels: JSON.parse(row.channels),
        priority: row.priority,
        status: row.status,
        subject: row.subject,
        message: row.message,
        metadata: JSON.parse(row.metadata),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    } catch (error) {
      logger.error('Failed to get notification', { error, id });
      throw error;
    }
  }

  async getUserNotifications(userId: string, limit: number, offset: number): Promise<Notification[]> {
    const query = `
      SELECT * FROM notifications
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3
    `;

    try {
      const result = await this._pool.query(query, [userId, limit, offset]);
      return result.rows.map(row => ({
        id: row.id,
        userId: row.user_id,
        channels: JSON.parse(row.channels),
        priority: row.priority,
        status: row.status,
        subject: row.subject,
        message: row.message,
        metadata: JSON.parse(row.metadata),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }));
    } catch (error) {
      logger.error('Failed to get user notifications', { error, userId });
      throw error;
    }
  }

  async updateNotificationStatus(id: string, status: NotificationStatus): Promise<void> {
    const query = 'UPDATE notifications SET status = $1, updated_at = $2 WHERE id = $3';

    try {
      await this._pool.query(query, [status, new Date(), id]);
    } catch (error) {
      logger.error('Failed to update notification status', { error, id, status });
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    await this._pool.end();
    logger.info('Database disconnected');
  }
}
