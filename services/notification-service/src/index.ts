import express, { Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { createLogger, KafkaClient } from '@notification-system/utils';
import { notificationRoutes } from './routes/notification.routes';
import { errorHandler } from './middleware/error.middleware';
import { DatabaseService } from './services/database.service';
import { RedisService } from './services/redis.service';

dotenv.config();

const logger = createLogger('notification-service');
const app: Application = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());

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

// Routes
app.use('/api/v1/notifications', notificationRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'notification-service',
    timestamp: new Date().toISOString(),
  });
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
