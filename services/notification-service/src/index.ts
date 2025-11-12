// IMPORTANT: Initialize tracing FIRST, before any other imports
import { initTracing } from '@notification-system/utils';
initTracing({
  serviceName: 'notification-service',
  environment: process.env.NODE_ENV || 'development',
});

import express, { Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import swaggerUi from 'swagger-ui-express';
import { createLogger, KafkaClient, MetricsCollector, metricsMiddleware } from '@notification-system/utils';
import { notificationRoutes } from './routes/notification.routes';
import { errorHandler } from './middleware/error.middleware';
import { DatabaseService } from './services/database.service';
import { RedisService } from './services/redis.service';
import { swaggerSpec, swaggerUiOptions } from './config/swagger.config';

dotenv.config();

const logger = createLogger('notification-service');
const app: Application = express();
const PORT = process.env.PORT || 3000;

// Initialize metrics collector
const metrics = new MetricsCollector('notification-service');

// Middleware
app.use(helmet({
  contentSecurityPolicy: false, // Disable CSP for Swagger UI
}));
app.use(cors());
app.use(express.json());
app.use(metricsMiddleware(metrics));

// Initialize services
const kafkaClient = new KafkaClient(
  (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
  'notification-service'
);

const dbService = new DatabaseService();
const redisService = new RedisService();

// Make services available to routes
app.locals.kafkaClient = kafkaClient;
app.locals.dbService = dbService;
app.locals.redisService = redisService;
app.locals.metrics = metrics;

// API Documentation
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, swaggerUiOptions));

// Raw OpenAPI spec endpoint
app.get('/api-docs.json', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.send(swaggerSpec);
});

// Routes
app.use('/api/v1/notifications', notificationRoutes);

// Liveness probe - Simple, fast check if process is running
// This should NEVER check external dependencies
app.get('/health/live', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// Readiness probe - Checks if service can handle requests
// Verifies all critical dependencies are available
app.get('/health/ready', async (req, res) => {
  const startTime = Date.now();

  try {
    // Check database connection
    const dbHealthy = await dbService.isHealthy();
    // Check Redis connection
    const redisHealthy = await redisService.isHealthy();

    const allHealthy = dbHealthy && redisHealthy;
    const responseTime = Date.now() - startTime;

    const status = allHealthy ? 'healthy' : 'degraded';

    res.status(allHealthy ? 200 : 503).json({
      status,
      timestamp: new Date().toISOString(),
      responseTime: `${responseTime}ms`,
      checks: {
        database: dbHealthy ? 'up' : 'down',
        redis: redisHealthy ? 'up' : 'down',
        kafka: 'up', // Kafka is async, don't block on it
      },
      uptime: process.uptime(),
    });
  } catch (error) {
    const responseTime = Date.now() - startTime;
    logger.error('Readiness check failed', { error });
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      responseTime: `${responseTime}ms`,
      error: 'Readiness check failed',
    });
  }
});

// Startup probe - Allows slow initialization
// More lenient than readiness probe for initial startup
app.get('/health/startup', async (req, res) => {
  try {
    const dbHealthy = await dbService.isHealthy();
    const redisHealthy = await redisService.isHealthy();

    if (dbHealthy && redisHealthy) {
      res.status(200).json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
      });
    } else {
      res.status(503).json({
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        message: 'Service still initializing',
      });
    }
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
    });
  }
});

// Legacy health endpoint - kept for backward compatibility
app.get('/health', async (req, res) => {
  const startTime = Date.now();

  try {
    const dbHealth = await dbService.getDetailedHealth();
    const redisHealthy = await redisService.isHealthy();
    const responseTime = Date.now() - startTime;

    const allHealthy = dbHealth.status === 'up' && redisHealthy;

    res.status(allHealthy ? 200 : 503).json({
      status: allHealthy ? 'healthy' : 'degraded',
      service: 'notification-service',
      timestamp: new Date().toISOString(),
      responseTime: `${responseTime}ms`,
      checks: {
        database: dbHealth.status,
        redis: redisHealthy ? 'up' : 'down',
        kafka: 'up',
      },
      poolStats: dbHealth.poolStats,
      uptime: process.uptime(),
      memory: process.memoryUsage(),
    });
  } catch (error) {
    logger.error('Health check failed', { error });
    res.status(503).json({
      status: 'unhealthy',
      service: 'notification-service',
      timestamp: new Date().toISOString(),
      error: 'Health check failed',
    });
  }
});

// Backward compatibility aliases
app.get('/ready', (req, res) => res.redirect(308, '/health/ready'));
app.get('/live', (req, res) => res.redirect(308, '/health/live'));

// Prometheus metrics endpoint
app.get('/metrics', async (req, res) => {
  try {
    res.set('Content-Type', metrics.getRegistry().contentType);
    res.end(await metrics.getMetrics());
  } catch (error) {
    logger.error('Failed to collect metrics', { error });
    res.status(500).end();
  }
});

// Error handling
app.use(errorHandler);

// Start server
async function start() {
  try {
    await dbService.connect();
    await redisService.connect();
    logger.info('Database and Redis connected');

    app.listen(PORT, () => {
      logger.info(`Notification Service listening on port ${PORT}`);
    });
  } catch (error) {
    logger.error('Failed to start service', { error });
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully');
  await kafkaClient.disconnect();
  await dbService.disconnect();
  await redisService.disconnect();
  process.exit(0);
});

start();
