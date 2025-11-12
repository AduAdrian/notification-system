import { Pool, PoolClient } from 'pg';
import { Notification, NotificationStatus } from '@notification-system/types';
import { createLogger } from '@notification-system/utils';

const logger = createLogger('database-service');

export class DatabaseService {
  private _pool: Pool;
  private poolStats = {
    totalConnects: 0,
    totalErrors: 0,
    totalAcquires: 0,
    totalReleases: 0,
  };

  constructor() {
    this._pool = new Pool({
      host: process.env.DB_HOST || 'localhost',
      port: Number(process.env.DB_PORT) || 5432,
      database: process.env.DB_NAME || 'notifications',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres',
      // 2025 best practices: min/max pool size based on typical load
      min: 5, // Maintain minimum 5 connections for fast response
      max: 25, // Increased from 20 for better concurrent handling
      // Connection lifecycle settings
      idleTimeoutMillis: 30000, // Close idle connections after 30s
      connectionTimeoutMillis: 3000, // Increased to 3s for better reliability
      // Query timeouts to prevent hanging queries
      statement_timeout: 10000, // 10s max for any single statement
      query_timeout: 10000, // 10s max for query execution
      // Connection settings
      allowExitOnIdle: false, // Keep pool alive even with no active connections
    });

    // Pool event monitoring for observability
    this._pool.on('connect', (client) => {
      this.poolStats.totalConnects++;
      logger.debug('New database connection established', {
        totalConnections: this._pool.totalCount,
        idleConnections: this._pool.idleCount,
        waitingClients: this._pool.waitingCount,
      });
    });

    this._pool.on('acquire', (client) => {
      this.poolStats.totalAcquires++;
      logger.debug('Database connection acquired from pool', {
        totalConnections: this._pool.totalCount,
        idleConnections: this._pool.idleCount,
      });
    });

    this._pool.on('remove', (client) => {
      logger.debug('Database connection removed from pool', {
        totalConnections: this._pool.totalCount,
        idleConnections: this._pool.idleCount,
      });
    });

    this._pool.on('error', (err, client) => {
      this.poolStats.totalErrors++;
      logger.error('Unexpected database pool error', {
        error: err.message,
        totalErrors: this.poolStats.totalErrors,
      });
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

  /**
   * Get connection pool statistics for monitoring and metrics
   * Returns real-time pool utilization data
   */
  getPoolStats() {
    return {
      totalCount: this._pool.totalCount, // Total connections in pool
      idleCount: this._pool.idleCount, // Available idle connections
      waitingCount: this._pool.waitingCount, // Clients waiting for connection
      maxSize: 25,
      minSize: 5,
      utilization: ((this._pool.totalCount - this._pool.idleCount) / 25) * 100,
      lifetime: {
        totalConnects: this.poolStats.totalConnects,
        totalErrors: this.poolStats.totalErrors,
        totalAcquires: this.poolStats.totalAcquires,
      },
    };
  }

  /**
   * Get detailed health check including pool metrics
   */
  async getDetailedHealth() {
    const isHealthy = await this.isHealthy();
    const poolStats = this.getPoolStats();

    return {
      status: isHealthy ? 'up' : 'down',
      responseTime: 0, // Will be set by caller
      poolStats,
      warnings: [
        poolStats.waitingCount > 5 ? 'High number of waiting clients' : null,
        poolStats.utilization > 80 ? 'Pool utilization above 80%' : null,
      ].filter(Boolean),
    };
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
