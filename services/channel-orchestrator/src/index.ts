// IMPORTANT: Initialize tracing FIRST, before any other imports
import { initTracing } from '@notification-system/utils';
initTracing({
  serviceName: 'channel-orchestrator',
  environment: process.env.NODE_ENV || 'development',
});

import dotenv from 'dotenv';
import express from 'express';
import { createLogger, KafkaClient, MetricsCollector, correlationMiddleware } from '@notification-system/utils';
import { NotificationChannel } from '@notification-system/types';
import { ChannelOrchestrator } from './orchestrator';

dotenv.config();

const logger = createLogger('channel-orchestrator');
const metrics = new MetricsCollector('channel-orchestrator');

// Setup HTTP server for health checks and metrics
const app = express();
app.use(express.json());
app.use(correlationMiddleware);
const METRICS_PORT = process.env.METRICS_PORT || 3001;

let kafkaClient: KafkaClient;
let orchestrator: ChannelOrchestrator;
let isReady = false;

// Liveness probe - Simple, fast check if process is running
app.get('/health/live', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// Readiness probe - Checks if service can handle requests
app.get('/health/ready', async (req, res) => {
  const startTime = Date.now();

  try {
    const responseTime = Date.now() - startTime;

    if (isReady && kafkaClient) {
      res.status(200).json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        responseTime: `${responseTime}ms`,
        checks: {
          kafka: 'up',
          orchestrator: 'up',
        },
        uptime: process.uptime(),
      });
    } else {
      res.status(503).json({
        status: 'degraded',
        timestamp: new Date().toISOString(),
        responseTime: `${responseTime}ms`,
        checks: {
          kafka: kafkaClient ? 'up' : 'down',
          orchestrator: isReady ? 'up' : 'down',
        },
      });
    }
  } catch (error) {
    const responseTime = Date.now() - startTime;
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      responseTime: `${responseTime}ms`,
      error: 'Readiness check failed',
    });
  }
});

// Startup probe - Allows slow initialization
app.get('/health/startup', (req, res) => {
  if (isReady) {
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
});

// Legacy health endpoint
app.get('/health', (req, res) => {
  res.status(isReady ? 200 : 503).json({
    status: isReady ? 'healthy' : 'degraded',
    service: 'channel-orchestrator',
    timestamp: new Date().toISOString(),
    checks: {
      kafka: kafkaClient ? 'up' : 'down',
      orchestrator: isReady ? 'up' : 'down',
    },
    uptime: process.uptime(),
  });
});

// Metrics endpoint
app.get('/metrics', async (req, res) => {
  try {
    res.set('Content-Type', metrics.getRegistry().contentType);
    res.end(await metrics.getMetrics());
  } catch (error) {
    logger.error('Failed to collect metrics', { error });
    res.status(500).end();
  }
});

async function start() {
  try {
    // Start metrics server first
    app.listen(METRICS_PORT, () => {
      logger.info(`Channel Orchestrator health checks available on port ${METRICS_PORT}`);
    });

    kafkaClient = new KafkaClient(
      (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
      'channel-orchestrator'
    );

    orchestrator = new ChannelOrchestrator(kafkaClient);
    await orchestrator.start();

    isReady = true;
    metrics.updateKafkaConnectionStatus(true);
    logger.info('Channel Orchestrator started successfully');
  } catch (error) {
    logger.error('Failed to start Channel Orchestrator', { error });
    isReady = false;
    metrics.updateKafkaConnectionStatus(false);
    process.exit(1);
  }
}

process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully');
  isReady = false;
  metrics.updateKafkaConnectionStatus(false);
  if (kafkaClient) {
    await kafkaClient.disconnect();
  }
  process.exit(0);
});

start();
