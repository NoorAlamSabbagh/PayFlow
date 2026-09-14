import http from 'http';
import { createApp } from './app';
import { config } from './config';
import { logger } from './config/logger';
import { checkDatabaseHealth, closeDatabase } from './database';
import { redisClient, checkRedisHealth, closeRedis } from './config/redis';

async function bootstrap(): Promise<void> {
  try {
    logger.info('Starting PayFlow Core Platform backend bootstrap...');

    // 1. Check PostgreSQL Database Connectivity
    const dbHealthy = await checkDatabaseHealth();
    if (!dbHealthy) {
      logger.warn('Initial PostgreSQL connection could not be established. Ensure Docker container is running.');
    } else {
      logger.info('PostgreSQL connection established successfully.');
    }

    // 2. Connect and Check Redis
    try {
      await redisClient.connect();
      const redisHealthy = await checkRedisHealth();
      if (redisHealthy) {
        logger.info('Redis client connected and responsive.');
      }
    } catch (redisErr) {
      logger.warn('Redis could not be reached on startup. Cache and fast-path locks will be unavailable.', {
        error: (redisErr as Error).message,
      });
    }

    // 3. Initialize Express App and HTTP Server
    const app = createApp();
    const server = http.createServer(app);

    server.listen(config.port, () => {
      logger.info(`🚀 PayFlow Core API running in [${config.env}] mode on port ${config.port}`);
      logger.info(`📖 Swagger documentation available at http://localhost:${config.port}/api-docs`);
      logger.info(`🩺 Health check available at http://localhost:${config.port}/health`);
    });

    // 4. Graceful Shutdown Signal Handling
    const shutdown = async (signal: string) => {
      logger.info(`Received ${signal}. Initiating graceful shutdown...`);

      server.close(async () => {
        logger.info('HTTP server closed, draining active connections...');
        try {
          await closeDatabase();
          await closeRedis();
          logger.info('All infrastructure connections closed cleanly. Exiting.');
          process.exit(0);
        } catch (err) {
          logger.error('Error during shutdown', { error: (err as Error).message });
          process.exit(1);
        }
      });

      // Force exit if graceful shutdown takes longer than 10s
      setTimeout(() => {
        logger.error('Graceful shutdown timed out. Forcing process exit.');
        process.exit(1);
      }, 10000);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  } catch (error) {
    logger.error('Fatal error during application startup', {
      error: (error as Error).message,
      stack: (error as Error).stack,
    });
    process.exit(1);
  }
}

bootstrap();
