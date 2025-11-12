import express, { Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { createLogger, KafkaClient } from '@notification-system/utils';
import { notificationRoutes } from './routes/notification.routes';
import { errorHandler } from './middleware/error.middleware';
import { DatabaseService } from './services/database.service';
import { RedisService } from './services/redis.service';
import { TokenService } from './services/token.service';
import { ApiKeyService } from './services/apikey.service';

// Import enhanced security configurations
import {
  corsOptions,
  helmetOptions,
  additionalSecurityHeaders,
} from './config/security.config';

// Import security middleware
import { sanitizeInput } from './middleware/sanitization.middleware';
import { sqlInjectionProtection } from './middleware/sql-security.middleware';

dotenv.config();

const logger = createLogger('notification-service');
const app: Application = express();
const PORT = process.env.PORT || 3000;

// Validate required environment variables
const requiredEnvVars = [
  'JWT_SECRET',
  'JWT_REFRESH_SECRET',
  'DB_PASSWORD',
  'REDIS_URL',
];

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    logger.error(`Missing required environment variable: ${envVar}`);
    process.exit(1);
  }
}

// ============================================================================
// SECURITY MIDDLEWARE (Order matters!)
// ============================================================================

// 1. Helmet.js - Security headers (should be first)
app.use(helmet(helmetOptions));

// 2. CORS - Cross-Origin Resource Sharing
app.use(cors(corsOptions));

// 3. Body parser with size limits
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// 4. Additional security headers
app.use((req, res, next) => {
  Object.entries(additionalSecurityHeaders).forEach(([key, value]) => {
    res.setHeader(key, value);
  });
  next();
});

// 5. Request sanitization (XSS, SQL injection, etc.)
app.use(
  sanitizeInput({
    xss: true,
    sql: true,
    nosql: true,
    path: true,
    command: true,
  })
);

// 6. SQL injection detection
app.use(sqlInjectionProtection);

// 7. Request logging
app.use((req, res, next) => {
  const requestId = req.headers['x-request-id'] ||
    `${Date.now()}-${Math.random().toString(36).substring(7)}`;

  (req as any).requestId = requestId;
  res.setHeader('X-Request-ID', requestId);

  logger.info('Incoming request', {
    requestId,
    method: req.method,
    path: req.path,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  });

  next();
});

// ============================================================================
// INITIALIZE SERVICES
// ============================================================================

const kafkaClient = new KafkaClient(
  (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
  'notification-service'
);

const dbService = new DatabaseService();
const redisService = new RedisService();
const tokenService = new TokenService(redisService);
const apiKeyService = new ApiKeyService(dbService.pool);

// Make services available to routes
app.locals.kafkaClient = kafkaClient;
app.locals.dbService = dbService;
app.locals.redisService = redisService;
app.locals.tokenService = tokenService;
app.locals.apiKeyService = apiKeyService;

// ============================================================================
// HEALTH CHECK (No authentication required)
// ============================================================================

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'notification-service',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0',
  });
});

// Security health check (authenticated)
app.get('/health/security', async (req, res) => {
  try {
    const checks = {
      helmet: !!helmet,
      cors: !!cors,
      sanitization: true,
      sqlProtection: true,
      rateLimit: !!redisService.client,
      jwtRotation: true,
      apiKeyRotation: true,
    };

    const allHealthy = Object.values(checks).every((check) => check === true);

    res.status(allHealthy ? 200 : 503).json({
      status: allHealthy ? 'healthy' : 'degraded',
      checks,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Security health check failed', { error });
    res.status(503).json({
      status: 'unhealthy',
      error: 'Security health check failed',
    });
  }
});

// ============================================================================
// API ROUTES
// ============================================================================

app.use('/api/v1/notifications', notificationRoutes);

// ============================================================================
// AUTHENTICATION ROUTES (New)
// ============================================================================

import { refreshTokenHandler, logoutHandler } from './middleware/jwt.middleware';

app.post('/api/v1/auth/refresh', refreshTokenHandler(tokenService));
app.post('/api/v1/auth/logout', logoutHandler(tokenService));

// ============================================================================
// API KEY MANAGEMENT ROUTES (New)
// ============================================================================

import { jwtAuth } from './middleware/jwt.middleware';

app.post('/api/v1/apikeys', jwtAuth(tokenService), async (req, res) => {
  try {
    const { name } = req.body;
    const userId = (req as any).user.userId;

    if (!name) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Name is required' },
      });
    }

    const result = await apiKeyService.createApiKey(userId, name);

    res.status(201).json({
      success: true,
      data: {
        key: result.key, // Only shown once!
        id: result.apiKey.id,
        name: result.apiKey.name,
        expiresAt: result.apiKey.expiresAt,
        createdAt: result.apiKey.createdAt,
      },
      message: 'API key created. Save it securely - it will not be shown again.',
    });
  } catch (error) {
    logger.error('Failed to create API key', { error });
    res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Failed to create API key' },
    });
  }
});

app.get('/api/v1/apikeys', jwtAuth(tokenService), async (req, res) => {
  try {
    const userId = (req as any).user.userId;
    const keys = await apiKeyService.getUserApiKeys(userId);

    res.json({
      success: true,
      data: keys.map((key) => ({
        id: key.id,
        name: key.name,
        prefix: key.prefix,
        status: key.status,
        expiresAt: key.expiresAt,
        lastUsedAt: key.lastUsedAt,
        createdAt: key.createdAt,
      })),
    });
  } catch (error) {
    logger.error('Failed to get API keys', { error });
    res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Failed to retrieve API keys' },
    });
  }
});

app.post('/api/v1/apikeys/:keyId/rotate', jwtAuth(tokenService), async (req, res) => {
  try {
    const { keyId } = req.params;
    const result = await apiKeyService.rotateApiKey(keyId);

    res.json({
      success: true,
      data: {
        key: result.key, // Only shown once!
        id: result.apiKey.id,
        name: result.apiKey.name,
        expiresAt: result.apiKey.expiresAt,
      },
      message: 'API key rotated. Save the new key securely.',
    });
  } catch (error) {
    logger.error('Failed to rotate API key', { error });
    res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Failed to rotate API key' },
    });
  }
});

app.delete('/api/v1/apikeys/:keyId', jwtAuth(tokenService), async (req, res) => {
  try {
    const { keyId } = req.params;
    await apiKeyService.revokeApiKey(keyId);

    res.json({
      success: true,
      message: 'API key revoked successfully',
    });
  } catch (error) {
    logger.error('Failed to revoke API key', { error });
    res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Failed to revoke API key' },
    });
  }
});

// ============================================================================
// 404 HANDLER
// ============================================================================

app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: 'The requested resource was not found',
    },
  });
});

// ============================================================================
// ERROR HANDLING (Should be last)
// ============================================================================

app.use(errorHandler);

// ============================================================================
// START SERVER
// ============================================================================

async function start() {
  try {
    // Connect to database
    await dbService.connect();
    logger.info('Database connected');

    // Connect to Redis
    await redisService.connect();
    logger.info('Redis connected');

    // Connect to Kafka
    await kafkaClient.connect();
    logger.info('Kafka connected');

    // Start HTTP server
    app.listen(PORT, () => {
      logger.info(`Notification Service listening on port ${PORT}`);
      logger.info('Security features enabled:', {
        helmet: true,
        cors: true,
        sanitization: true,
        sqlInjectionProtection: true,
        rateLimiting: true,
        jwtAuth: true,
        apiKeyAuth: true,
        tokenRotation: true,
      });
    });

    // Schedule periodic cleanup tasks
    scheduleSecurityTasks();
  } catch (error) {
    logger.error('Failed to start service', { error });
    process.exit(1);
  }
}

// ============================================================================
// SCHEDULED SECURITY TASKS
// ============================================================================

function scheduleSecurityTasks() {
  // Cleanup expired API keys daily at 2 AM
  const cleanupInterval = 24 * 60 * 60 * 1000; // 24 hours
  setInterval(async () => {
    try {
      const cleaned = await apiKeyService.cleanupExpiredKeys();
      logger.info('Scheduled API key cleanup completed', { cleaned });
    } catch (error) {
      logger.error('Scheduled API key cleanup failed', { error });
    }
  }, cleanupInterval);

  // Check for keys needing rotation daily
  setInterval(async () => {
    try {
      const keys = await apiKeyService.getKeysNeedingRotation();
      if (keys.length > 0) {
        logger.warn('API keys need rotation', {
          count: keys.length,
          keys: keys.map((k) => ({ id: k.id, userId: k.userId, name: k.name })),
        });
        // Send notification to users about upcoming expiration
      }
    } catch (error) {
      logger.error('Failed to check keys needing rotation', { error });
    }
  }, cleanupInterval);
}

// ============================================================================
// GRACEFUL SHUTDOWN
// ============================================================================

const shutdown = async (signal: string) => {
  logger.info(`${signal} received, shutting down gracefully`);

  try {
    // Stop accepting new requests
    // server.close();

    // Disconnect from services
    await kafkaClient.disconnect();
    await dbService.disconnect();
    await redisService.disconnect();

    logger.info('Shutdown completed successfully');
    process.exit(0);
  } catch (error) {
    logger.error('Error during shutdown', { error });
    process.exit(1);
  }
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Handle unhandled rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection', { reason, promise });
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception', { error });
  process.exit(1);
});

// Start the application
start();
