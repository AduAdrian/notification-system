import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { createLogger } from '@notification-system/utils';
import { RedisService } from './redis.service';
import { jwtConfig } from '../config/security.config';

const logger = createLogger('token-service');

export interface TokenPayload {
  userId: string;
  email?: string;
  roles?: string[];
  permissions?: string[];
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  refreshExpiresIn: number;
}

export interface RefreshTokenData {
  userId: string;
  tokenId: string;
  family: string;
  createdAt: Date;
  expiresAt: Date;
}

export class TokenService {
  private redisService: RedisService;
  private accessTokenSecret: string;
  private refreshTokenSecret: string;

  constructor(redisService: RedisService) {
    this.redisService = redisService;
    this.accessTokenSecret = process.env.JWT_SECRET || 'change-this-secret';
    this.refreshTokenSecret = process.env.JWT_REFRESH_SECRET || 'change-this-refresh-secret';
  }

  /**
   * Generate access and refresh token pair
   * Implements refresh token rotation for enhanced security
   */
  async generateTokenPair(payload: TokenPayload): Promise<TokenPair> {
    try {
      // Generate unique token ID and family ID for rotation tracking
      const tokenId = crypto.randomUUID();
      const familyId = crypto.randomUUID();

      // Create access token (short-lived)
      const accessToken = jwt.sign(
        {
          ...payload,
          type: 'access',
          jti: tokenId,
        },
        this.accessTokenSecret,
        {
          expiresIn: jwtConfig.accessToken.expiresIn,
          algorithm: jwtConfig.accessToken.algorithm,
          issuer: jwtConfig.issuer,
          audience: jwtConfig.audience,
        }
      );

      // Create refresh token (longer-lived)
      const refreshToken = jwt.sign(
        {
          userId: payload.userId,
          type: 'refresh',
          jti: tokenId,
          family: familyId,
        },
        this.refreshTokenSecret,
        {
          expiresIn: jwtConfig.refreshToken.expiresIn,
          algorithm: jwtConfig.refreshToken.algorithm,
          issuer: jwtConfig.issuer,
          audience: jwtConfig.audience,
        }
      );

      // Store refresh token metadata in Redis for validation
      const refreshTokenData: RefreshTokenData = {
        userId: payload.userId,
        tokenId,
        family: familyId,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      };

      await this.storeRefreshToken(tokenId, refreshTokenData);

      logger.info('Token pair generated', { userId: payload.userId, tokenId });

      return {
        accessToken,
        refreshToken,
        expiresIn: 15 * 60, // 15 minutes in seconds
        refreshExpiresIn: 7 * 24 * 60 * 60, // 7 days in seconds
      };
    } catch (error) {
      logger.error('Failed to generate token pair', { error });
      throw error;
    }
  }

  /**
   * Refresh access token using refresh token
   * Implements automatic token rotation
   */
  async refreshAccessToken(refreshToken: string): Promise<TokenPair> {
    try {
      // Verify refresh token
      const decoded = jwt.verify(refreshToken, this.refreshTokenSecret, {
        issuer: jwtConfig.issuer,
        audience: jwtConfig.audience,
      }) as any;

      if (decoded.type !== 'refresh') {
        throw new Error('Invalid token type');
      }

      // Check if refresh token exists and is valid
      const storedToken = await this.getRefreshToken(decoded.jti);

      if (!storedToken) {
        logger.warn('Refresh token not found or revoked', { tokenId: decoded.jti });
        throw new Error('Invalid refresh token');
      }

      // Check for token reuse (possible security breach)
      const isRevoked = await this.isTokenRevoked(decoded.jti);
      if (isRevoked) {
        logger.error('Refresh token reuse detected - revoking entire family', {
          tokenId: decoded.jti,
          family: decoded.family,
          userId: decoded.userId,
        });

        // Revoke all tokens in this family (token rotation security)
        await this.revokeTokenFamily(decoded.family);
        throw new Error('Token reuse detected - all tokens revoked');
      }

      // Revoke the old refresh token (rotation)
      await this.revokeRefreshToken(decoded.jti);

      // Generate new token pair
      const payload: TokenPayload = {
        userId: storedToken.userId,
      };

      const newTokenPair = await this.generateTokenPair(payload);

      // Maintain the token family for tracking
      const newDecoded = jwt.verify(newTokenPair.refreshToken, this.refreshTokenSecret) as any;
      await this.updateTokenFamily(newDecoded.jti, decoded.family);

      logger.info('Access token refreshed', {
        userId: storedToken.userId,
        oldTokenId: decoded.jti,
        newTokenId: newDecoded.jti,
      });

      return newTokenPair;
    } catch (error) {
      logger.error('Failed to refresh access token', { error });
      throw error;
    }
  }

  /**
   * Validate access token
   */
  async validateAccessToken(token: string): Promise<TokenPayload | null> {
    try {
      const decoded = jwt.verify(token, this.accessTokenSecret, {
        issuer: jwtConfig.issuer,
        audience: jwtConfig.audience,
      }) as any;

      if (decoded.type !== 'access') {
        return null;
      }

      // Check if token is blacklisted
      const isBlacklisted = await this.isTokenBlacklisted(decoded.jti);
      if (isBlacklisted) {
        logger.warn('Blacklisted token used', { tokenId: decoded.jti });
        return null;
      }

      return {
        userId: decoded.userId,
        email: decoded.email,
        roles: decoded.roles,
        permissions: decoded.permissions,
      };
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        logger.debug('Token expired', { error: error.message });
      } else {
        logger.warn('Token validation failed', { error });
      }
      return null;
    }
  }

  /**
   * Revoke a specific refresh token
   */
  async revokeRefreshToken(tokenId: string): Promise<void> {
    try {
      await this.redisService.client?.del(`refresh_token:${tokenId}`);
      await this.redisService.client?.setEx(`revoked_token:${tokenId}`, 7 * 24 * 60 * 60, '1');
      logger.info('Refresh token revoked', { tokenId });
    } catch (error) {
      logger.error('Failed to revoke refresh token', { error, tokenId });
      throw error;
    }
  }

  /**
   * Revoke all tokens for a user (logout from all devices)
   */
  async revokeUserTokens(userId: string): Promise<void> {
    try {
      const pattern = `refresh_token:*`;
      const keys = await this.redisService.client?.keys(pattern);

      if (!keys || keys.length === 0) {
        return;
      }

      for (const key of keys) {
        const data = await this.redisService.client?.get(key);
        if (data) {
          const tokenData = JSON.parse(data) as RefreshTokenData;
          if (tokenData.userId === userId) {
            await this.redisService.client?.del(key);
          }
        }
      }

      logger.info('All user tokens revoked', { userId });
    } catch (error) {
      logger.error('Failed to revoke user tokens', { error, userId });
      throw error;
    }
  }

  /**
   * Blacklist an access token (for immediate logout)
   */
  async blacklistAccessToken(token: string): Promise<void> {
    try {
      const decoded = jwt.decode(token) as any;
      if (!decoded || !decoded.jti || !decoded.exp) {
        throw new Error('Invalid token');
      }

      // Calculate TTL (time until token expires)
      const ttl = decoded.exp - Math.floor(Date.now() / 1000);

      if (ttl > 0) {
        await this.redisService.client?.setEx(`blacklist:${decoded.jti}`, ttl, '1');
        logger.info('Access token blacklisted', { tokenId: decoded.jti, ttl });
      }
    } catch (error) {
      logger.error('Failed to blacklist access token', { error });
      throw error;
    }
  }

  /**
   * Private helper methods
   */
  private async storeRefreshToken(tokenId: string, data: RefreshTokenData): Promise<void> {
    const ttl = 7 * 24 * 60 * 60; // 7 days in seconds
    await this.redisService.client?.setEx(
      `refresh_token:${tokenId}`,
      ttl,
      JSON.stringify(data)
    );
  }

  private async getRefreshToken(tokenId: string): Promise<RefreshTokenData | null> {
    const data = await this.redisService.client?.get(`refresh_token:${tokenId}`);
    return data ? JSON.parse(data) : null;
  }

  private async isTokenRevoked(tokenId: string): Promise<boolean> {
    const result = await this.redisService.client?.exists(`revoked_token:${tokenId}`);
    return result === 1;
  }

  private async isTokenBlacklisted(tokenId: string): Promise<boolean> {
    const result = await this.redisService.client?.exists(`blacklist:${tokenId}`);
    return result === 1;
  }

  private async revokeTokenFamily(familyId: string): Promise<void> {
    const pattern = `refresh_token:*`;
    const keys = await this.redisService.client?.keys(pattern);

    if (!keys || keys.length === 0) {
      return;
    }

    for (const key of keys) {
      const data = await this.redisService.client?.get(key);
      if (data) {
        const tokenData = JSON.parse(data) as RefreshTokenData;
        if (tokenData.family === familyId) {
          await this.redisService.client?.del(key);
          await this.redisService.client?.setEx(
            `revoked_token:${tokenData.tokenId}`,
            7 * 24 * 60 * 60,
            '1'
          );
        }
      }
    }

    logger.warn('Token family revoked', { familyId });
  }

  private async updateTokenFamily(tokenId: string, familyId: string): Promise<void> {
    const tokenData = await this.getRefreshToken(tokenId);
    if (tokenData) {
      tokenData.family = familyId;
      await this.storeRefreshToken(tokenId, tokenData);
    }
  }
}
