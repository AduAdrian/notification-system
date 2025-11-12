import { Pool, PoolClient, PoolConfig, QueryResult } from 'pg';
import { createLogger } from './logger';

const logger = createLogger('database-optimized');

/**
 * Optimized Database Service with connection pooling, prepared statements,
 * and query optimization features
 */
export class DatabaseOptimizedService {
  private pool: Pool;
  private preparedStatements: Map<string, string> = new Map();

  constructor(config?: Partial<PoolConfig>) {
    const poolConfig: PoolConfig = {
      host: config?.host || process.env.DB_HOST || 'localhost',
      port: config?.port || Number(process.env.DB_PORT) || 5432,
      database: config?.database || process.env.DB_NAME || 'notifications',
      user: config?.user || process.env.DB_USER || 'postgres',
      password: config?.password || process.env.DB_PASSWORD || 'postgres',

      // Connection Pool Optimization
      max: config?.max || 25, // Maximum pool size
      min: config?.min || 5, // Minimum pool size (keep warm connections)
      idleTimeoutMillis: config?.idleTimeoutMillis || 30000, // Close idle connections after 30s
      connectionTimeoutMillis: config?.connectionTimeoutMillis || 3000, // Connection timeout
      maxUses: config?.maxUses || 7500, // Recycle connections after 7500 uses

      // Performance optimization
      allowExitOnIdle: false, // Keep process alive

      // Statement timeout to prevent long-running queries
      statement_timeout: 30000, // 30 seconds

      // Application name for monitoring
      application_name: config?.application_name || 'notification-system',
    };

    this.pool = new Pool(poolConfig);

    // Pool event listeners for monitoring
    this.pool.on('connect', (client) => {
      logger.debug('New client connected to database');
    });

    this.pool.on('acquire', (client) => {
      logger.debug('Client acquired from pool');
    });

    this.pool.on('remove', (client) => {
      logger.debug('Client removed from pool');
    });

    this.pool.on('error', (err, client) => {
      logger.error('Unexpected pool error', { error: err });
    });

    // Initialize prepared statements
    this.initPreparedStatements();
  }

  private initPreparedStatements(): void {
    // Define commonly used prepared statements
    this.preparedStatements.set(
      'getNotificationById',
      'SELECT * FROM notifications WHERE id = $1'
    );

    this.preparedStatements.set(
      'getUserNotifications',
      `SELECT * FROM notifications
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`
    );

    this.preparedStatements.set(
      'createNotification',
      `INSERT INTO notifications (
        id, user_id, channels, priority, status, subject, message, metadata, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`
    );

    this.preparedStatements.set(
      'updateNotificationStatus',
      'UPDATE notifications SET status = $1, updated_at = $2 WHERE id = $3'
    );

    this.preparedStatements.set(
      'getUserNotificationCount',
      'SELECT COUNT(*) as count FROM notifications WHERE user_id = $1'
    );

    this.preparedStatements.set(
      'getUnreadNotifications',
      `SELECT * FROM notifications
       WHERE user_id = $1 AND status = 'pending'
       ORDER BY created_at DESC
       LIMIT $2`
    );

    logger.info('Prepared statements initialized', { count: this.preparedStatements.size });
  }

  async connect(): Promise<void> {
    try {
      const client = await this.pool.connect();

      // Test connection and set optimization parameters
      await client.query('SELECT NOW()');

      // Set session-level optimizations
      await client.query('SET search_path TO public');
      await client.query('SET work_mem TO "16MB"'); // Increase work memory for sorts/joins
      await client.query('SET random_page_cost TO 1.1'); // Optimize for SSD

      client.release();
      logger.info('Database connected and optimized');
    } catch (error) {
      logger.error('Failed to connect to database', { error });
      throw error;
    }
  }

  /**
   * Execute query with automatic retry on transient failures
   */
  async query<T = any>(
    text: string,
    params?: any[],
    options?: { retry?: number; timeout?: number }
  ): Promise<QueryResult<T>> {
    const maxRetries = options?.retry || 3;
    let lastError: any;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const startTime = Date.now();
        const result = await this.pool.query<T>(text, params);
        const duration = Date.now() - startTime;

        logger.debug('Query executed', { duration, rows: result.rowCount });

        // Log slow queries
        if (duration > 1000) {
          logger.warn('Slow query detected', { duration, query: text.substring(0, 100) });
        }

        return result;
      } catch (error: any) {
        lastError = error;
        logger.error('Query failed', { error, attempt, maxRetries });

        // Retry on transient errors
        if (attempt < maxRetries && this.isTransientError(error)) {
          await this.delay(Math.min(100 * Math.pow(2, attempt), 1000));
          continue;
        }

        throw error;
      }
    }

    throw lastError;
  }

  /**
   * Execute prepared statement for better performance
   */
  async queryPrepared<T = any>(
    statementName: string,
    params: any[]
  ): Promise<QueryResult<T>> {
    const text = this.preparedStatements.get(statementName);

    if (!text) {
      throw new Error(`Prepared statement not found: ${statementName}`);
    }

    return this.query<T>(text, params);
  }

  /**
   * Batch insert with optimized multi-row insert
   */
  async batchInsert(
    table: string,
    columns: string[],
    rows: any[][],
    batchSize: number = 500
  ): Promise<number> {
    if (rows.length === 0) {
      return 0;
    }

    let totalInserted = 0;

    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);

      // Build multi-row insert query
      const valuePlaceholders = batch.map((_, rowIndex) => {
        const rowPlaceholders = columns.map((_, colIndex) =>
          `$${rowIndex * columns.length + colIndex + 1}`
        ).join(', ');
        return `(${rowPlaceholders})`;
      }).join(', ');

      const query = `
        INSERT INTO ${table} (${columns.join(', ')})
        VALUES ${valuePlaceholders}
      `;

      const values = batch.flat();

      try {
        const result = await this.query(query, values);
        totalInserted += result.rowCount || 0;
        logger.debug('Batch inserted', { batch: i / batchSize + 1, rows: batch.length });
      } catch (error) {
        logger.error('Batch insert failed', { error, batch: i / batchSize + 1 });
        throw error;
      }
    }

    logger.info('Batch insert completed', { total: totalInserted });
    return totalInserted;
  }

  /**
   * Execute transaction with automatic rollback
   */
  async transaction<T>(
    callback: (client: PoolClient) => Promise<T>
  ): Promise<T> {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      logger.debug('Transaction committed');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Transaction rolled back', { error });
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Cursor-based pagination for large result sets
   */
  async *cursorQuery<T = any>(
    query: string,
    params: any[],
    cursorName: string = 'data_cursor',
    fetchSize: number = 1000
  ): AsyncGenerator<T[], void, unknown> {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');
      await client.query(`DECLARE ${cursorName} CURSOR FOR ${query}`, params);

      while (true) {
        const result = await client.query<T>(
          `FETCH ${fetchSize} FROM ${cursorName}`
        );

        if (result.rows.length === 0) {
          break;
        }

        yield result.rows;

        if (result.rows.length < fetchSize) {
          break;
        }
      }

      await client.query(`CLOSE ${cursorName}`);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Cursor query failed', { error });
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get pool statistics for monitoring
   */
  getPoolStats() {
    return {
      total: this.pool.totalCount,
      idle: this.pool.idleCount,
      waiting: this.pool.waitingCount,
    };
  }

  /**
   * Execute EXPLAIN ANALYZE for query optimization
   */
  async explainQuery(query: string, params?: any[]): Promise<any[]> {
    try {
      const result = await this.query(
        `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query}`,
        params
      );
      return result.rows[0]['QUERY PLAN'];
    } catch (error) {
      logger.error('EXPLAIN query failed', { error });
      throw error;
    }
  }

  /**
   * Create index if not exists
   */
  async createIndex(
    indexName: string,
    tableName: string,
    columns: string[],
    options?: { unique?: boolean; where?: string; method?: string }
  ): Promise<void> {
    const unique = options?.unique ? 'UNIQUE' : '';
    const method = options?.method ? `USING ${options.method}` : '';
    const where = options?.where ? `WHERE ${options.where}` : '';

    const query = `
      CREATE ${unique} INDEX IF NOT EXISTS ${indexName}
      ON ${tableName} ${method} (${columns.join(', ')})
      ${where}
    `;

    try {
      await this.query(query);
      logger.info('Index created', { indexName, tableName, columns });
    } catch (error) {
      logger.error('Failed to create index', { error, indexName });
      throw error;
    }
  }

  /**
   * Vacuum and analyze table for optimization
   */
  async optimizeTable(tableName: string, full: boolean = false): Promise<void> {
    try {
      const vacuumType = full ? 'VACUUM FULL' : 'VACUUM';

      // Get a dedicated client for VACUUM (can't run in transaction)
      const client = await this.pool.connect();

      try {
        await client.query(`${vacuumType} ANALYZE ${tableName}`);
        logger.info('Table optimized', { tableName, full });
      } finally {
        client.release();
      }
    } catch (error) {
      logger.error('Failed to optimize table', { error, tableName });
      throw error;
    }
  }

  /**
   * Get table statistics
   */
  async getTableStats(tableName: string): Promise<{
    rowCount: number;
    totalSize: string;
    indexSize: string;
    deadTuples: number;
  }> {
    try {
      const result = await this.query(`
        SELECT
          n_live_tup as row_count,
          pg_size_pretty(pg_total_relation_size('${tableName}')) as total_size,
          pg_size_pretty(pg_indexes_size('${tableName}')) as index_size,
          n_dead_tup as dead_tuples
        FROM pg_stat_user_tables
        WHERE relname = '${tableName}'
      `);

      return result.rows[0] || {
        rowCount: 0,
        totalSize: '0 bytes',
        indexSize: '0 bytes',
        deadTuples: 0,
      };
    } catch (error) {
      logger.error('Failed to get table stats', { error, tableName });
      throw error;
    }
  }

  private isTransientError(error: any): boolean {
    // PostgreSQL error codes for transient errors
    const transientCodes = [
      '40001', // serialization_failure
      '40P01', // deadlock_detected
      '08006', // connection_failure
      '08003', // connection_does_not_exist
      '57P03', // cannot_connect_now
    ];

    return transientCodes.includes(error.code);
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async disconnect(): Promise<void> {
    await this.pool.end();
    logger.info('Database pool closed');
  }
}

export default DatabaseOptimizedService;
