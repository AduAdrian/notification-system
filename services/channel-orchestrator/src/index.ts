// IMPORTANT: Initialize tracing FIRST, before any other imports
import { initTracing } from '@notification-system/utils';
initTracing({
  serviceName: 'channel-orchestrator',
  environment: process.env.NODE_ENV || 'development',
});

import dotenv from 'dotenv';
import { createLogger, KafkaClient } from '@notification-system/utils';
import { NotificationChannel } from '@notification-system/types';
import { ChannelOrchestrator } from './orchestrator';

dotenv.config();

const logger = createLogger('channel-orchestrator');

async function start() {
  try {
    const kafkaClient = new KafkaClient(
      (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
      'channel-orchestrator'
    );

    const orchestrator = new ChannelOrchestrator(kafkaClient);
    await orchestrator.start();

    logger.info('Channel Orchestrator started successfully');
  } catch (error) {
    logger.error('Failed to start Channel Orchestrator', { error });
    process.exit(1);
  }
}

process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

start();
