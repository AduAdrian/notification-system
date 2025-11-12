import express, { Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { createLogger, KafkaClient, MetricsCollector, metricsMiddleware } from '@notification-system/utils';
import { notificationRoutes } from './routes/notification.routes';
import { errorHandler } from './middleware/error.middleware';
import { DatabaseService } from './services/database.service';
import { RedisService } from './services/redis.service';

dotenv.config();

const logger = createLogger('notification-service');
const app: Application = express();
const PORT = process.env.PORT || 3000;

// Initialize metrics collector
const metrics = new MetricsCollector('notification-service');

// Middleware
app.use(helmet());
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

// Routes
app.use('/api/v1/notifications', notificationRoutes);

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    // Check database connection
    const dbHealthy = await dbService.isHealthy();
    // Check Redis connection
    const redisHealthy = await redisService.isHealthy();

    const isHealthy = dbHealthy && redisHealthy;

    res.status(isHealthy ? 200 : 503).json({
      status: isHealthy ? 'healthy' : 'unhealthy',
      service: 'notification-service',
      timestamp: new Date().toISOString(),
      checks: {
        database: dbHealthy ? 'up' : 'down',
        redis: redisHealthy ? 'up' : 'down',
        kafka: 'up', // Simplified - should add actual check
      },
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

// Readiness check endpoint (Kubernetes)
app.get('/ready', async (req, res) => {
  try {
    const dbHealthy = await dbService.isHealthy();
    const redisHealthy = await redisService.isHealthy();

    if (dbHealthy && redisHealthy) {
      res.status(200).json({ status: 'ready' });
    } else {
      res.status(503).json({ status: 'not ready' });
    }
  } catch (error) {
    res.status(503).json({ status: 'not ready' });
  }
});

// Liveness check endpoint (Kubernetes)
app.get('/live', (req, res) => {
  res.status(200).json({ status: 'alive' });
});

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
