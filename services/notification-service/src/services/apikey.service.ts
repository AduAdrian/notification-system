import crypto from 'crypto';
import { Pool } from 'pg';
import { createLogger } from '@notification-system/utils';
import { apiKeyConfig } from '../config/security.config';

const logger = createLogger('apikey-service');

export interface ApiKey {
  id: string;
  userId: string;
  keyHash: string;
  prefix: string;
  name: string;
  status: 'active' | 'rotating' | 'revoked';
  expiresAt: Date;
  createdAt: Date;
  lastUsedAt?: Date;
  rotationScheduledAt?: Date;
}

export class ApiKeyService {
  private pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  /**
   * Generate a new API key
   * Returns: { key: string, keyHash: string, prefix: string }
   */
  private generateApiKey(): { key: string; keyHash: string; prefix: string } {
    // Generate cryptographically secure random bytes
    const randomBytes = crypto.randomBytes(apiKeyConfig.keyLength);
    const key = randomBytes.toString('base64url');

    // Create full API key with prefix
    const fullKey = `${apiKeyConfig.keyPrefix}${key}`;

    // Hash the key for storage (never store plain keys)
    const keyHash = crypto
      .createHash(apiKeyConfig.hashAlgorithm)
      .update(fullKey)
      .digest('hex');

    // Extract prefix for identification
    const prefix = fullKey.substring(0, 10);

    return { key: fullKey, keyHash, prefix };
  }

  /**
   * Create a new API key for a user
   */
  async createApiKey(userId: string, name: string): Promise<{ key: string; apiKey: ApiKey }> {
    try {
      const { key, keyHash, prefix } = this.generateApiKey();

      // Calculate expiration date
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + apiKeyConfig.rotationPeriodDays);

      // Calculate rotation reminder date (7 days before expiration)
      const rotationScheduledAt = new Date(expiresAt);
      rotationScheduledAt.setDate(rotationScheduledAt.getDate() - apiKeyConfig.gracePeriodDays);

      const query = `
        INSERT INTO api_keys (
          id, user_id, key_hash, prefix, name, status, expires_at, rotation_scheduled_at, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING *
      `;

      const id = crypto.randomUUID();
      const values = [
        id,
        userId,
        keyHash,
        prefix,
        name,
        'active',
        expiresAt,
        rotationScheduledAt,
        new Date(),
      ];

      const result = await this.pool.query(query, values);
      const apiKey = this.mapRowToApiKey(result.rows[0]);

      logger.info('API key created', { userId, keyId: id, prefix });

      // Return the plain key only once (it won't be stored)
      return { key, apiKey };
    } catch (error) {
      logger.error('Failed to create API key', { error, userId });
      throw error;
    }
  }

  /**
   * Validate an API key and return associated user ID
   */
  async validateApiKey(key: string): Promise<{ valid: boolean; userId?: string; keyId?: string }> {
    try {
      // Hash the provided key
      const keyHash = crypto
        .createHash(apiKeyConfig.hashAlgorithm)
        .update(key)
        .digest('hex');

      // Look up key in database
      const query = `
        SELECT * FROM api_keys
        WHERE key_hash = $1 AND status = 'active' AND expires_at > NOW()
      `;

      const result = await this.pool.query(query, [keyHash]);

      if (result.rows.length === 0) {
        logger.warn('Invalid API key attempt', { keyHash: keyHash.substring(0, 10) });
        return { valid: false };
      }

      const apiKey = result.rows[0];

      // Update last used timestamp
      await this.updateLastUsed(apiKey.id);

      logger.debug('API key validated', { keyId: apiKey.id, userId: apiKey.user_id });

      return {
        valid: true,
        userId: apiKey.user_id,
        keyId: apiKey.id,
      };
    } catch (error) {
      logger.error('API key validation failed', { error });
      return { valid: false };
    }
  }

  /**
   * Rotate an API key (create new one and mark old one for deletion)
   */
  async rotateApiKey(keyId: string): Promise<{ key: string; apiKey: ApiKey }> {
    try {
      // Get the existing key
      const existingKey = await this.getApiKey(keyId);

      if (!existingKey) {
        throw new Error('API key not found');
      }

      // Mark old key as rotating (will be revoked after grace period)
      await this.pool.query(
        `UPDATE api_keys SET status = 'rotating', rotation_scheduled_at = $1 WHERE id = $2`,
        [new Date(Date.now() + apiKeyConfig.gracePeriodDays * 24 * 60 * 60 * 1000), keyId]
      );

      // Create new key with same name
      const newKey = await this.createApiKey(existingKey.userId, existingKey.name);

      logger.info('API key rotated', {
        oldKeyId: keyId,
        newKeyId: newKey.apiKey.id,
        userId: existingKey.userId,
      });

      return newKey;
    } catch (error) {
      logger.error('Failed to rotate API key', { error, keyId });
      throw error;
    }
  }

  /**
   * Revoke an API key immediately
   */
  async revokeApiKey(keyId: string): Promise<void> {
    try {
      const query = `UPDATE api_keys SET status = 'revoked' WHERE id = $1`;
      await this.pool.query(query, [keyId]);

      logger.info('API key revoked', { keyId });
    } catch (error) {
      logger.error('Failed to revoke API key', { error, keyId });
      throw error;
    }
  }

  /**
   * Get all API keys for a user
   */
  async getUserApiKeys(userId: string): Promise<ApiKey[]> {
    try {
      const query = `
        SELECT * FROM api_keys
        WHERE user_id = $1
        ORDER BY created_at DESC
      `;

      const result = await this.pool.query(query, [userId]);
      return result.rows.map(this.mapRowToApiKey);
    } catch (error) {
      logger.error('Failed to get user API keys', { error, userId });
      throw error;
    }
  }

  /**
   * Get API keys that need rotation
   */
  async getKeysNeedingRotation(): Promise<ApiKey[]> {
    try {
      const query = `
        SELECT * FROM api_keys
        WHERE status = 'active'
        AND rotation_scheduled_at <= NOW()
        ORDER BY rotation_scheduled_at ASC
      `;

      const result = await this.pool.query(query);
      return result.rows.map(this.mapRowToApiKey);
    } catch (error) {
      logger.error('Failed to get keys needing rotation', { error });
      throw error;
    }
  }

  /**
   * Cleanup expired and rotating keys
   */
  async cleanupExpiredKeys(): Promise<number> {
    try {
      // Revoke keys that have been in 'rotating' status past grace period
      const revokeQuery = `
        UPDATE api_keys
        SET status = 'revoked'
        WHERE status = 'rotating' AND rotation_scheduled_at < NOW()
      `;

      const revokeResult = await this.pool.query(revokeQuery);

      // Delete revoked keys older than 90 days
      const deleteQuery = `
        DELETE FROM api_keys
        WHERE status = 'revoked'
        AND created_at < NOW() - INTERVAL '90 days'
      `;

      const deleteResult = await this.pool.query(deleteQuery);

      const totalCleaned = revokeResult.rowCount + deleteResult.rowCount;

      logger.info('API keys cleaned up', {
        revoked: revokeResult.rowCount,
        deleted: deleteResult.rowCount,
        total: totalCleaned,
      });

      return totalCleaned;
    } catch (error) {
      logger.error('Failed to cleanup expired keys', { error });
      throw error;
    }
  }

  /**
   * Private helper methods
   */
  private async getApiKey(keyId: string): Promise<ApiKey | null> {
    const query = `SELECT * FROM api_keys WHERE id = $1`;
    const result = await this.pool.query(query, [keyId]);

    if (result.rows.length === 0) {
      return null;
    }

    return this.mapRowToApiKey(result.rows[0]);
  }

  private async updateLastUsed(keyId: string): Promise<void> {
    const query = `UPDATE api_keys SET last_used_at = $1 WHERE id = $2`;
    await this.pool.query(query, [new Date(), keyId]);
  }

  private mapRowToApiKey(row: any): ApiKey {
    return {
      id: row.id,
      userId: row.user_id,
      keyHash: row.key_hash,
      prefix: row.prefix,
      name: row.name,
      status: row.status,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
      lastUsedAt: row.last_used_at,
      rotationScheduledAt: row.rotation_scheduled_at,
    };
  }
}

/**
 * SQL Migration for API Keys Table
 *
 * Run this migration to create the api_keys table:
 *
 * CREATE TABLE IF NOT EXISTS api_keys (
 *   id UUID PRIMARY KEY,
 *   user_id VARCHAR(255) NOT NULL,
 *   key_hash VARCHAR(64) NOT NULL UNIQUE,
 *   prefix VARCHAR(20) NOT NULL,
 *   name VARCHAR(255) NOT NULL,
 *   status VARCHAR(20) NOT NULL CHECK (status IN ('active', 'rotating', 'revoked')),
 *   expires_at TIMESTAMP NOT NULL,
 *   created_at TIMESTAMP NOT NULL DEFAULT NOW(),
 *   last_used_at TIMESTAMP,
 *   rotation_scheduled_at TIMESTAMP,
 *   INDEX idx_api_keys_user_id (user_id),
 *   INDEX idx_api_keys_key_hash (key_hash),
 *   INDEX idx_api_keys_status (status),
 *   INDEX idx_api_keys_rotation (rotation_scheduled_at)
 * );
 */
