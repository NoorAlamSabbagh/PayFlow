import Redis from 'ioredis';
import { config } from './index';
import { logger } from './logger';

export const redisClient = new Redis({
  host: config.redis.host,
  port: config.redis.port,
  password: config.redis.password,
  lazyConnect: true,
  maxRetriesPerRequest: 3,
  retryStrategy(times) {
    const delay = Math.min(times * 200, 2000);
    logger.warn(`Redis connection retry attempt ${times}, delaying ${delay}ms`);
    return delay;
  },
});

redisClient.on('connect', () => {
  logger.info('Connected to Redis');
});

redisClient.on('ready', () => {
  logger.info('Redis client ready to accept commands');
});

redisClient.on('error', (err: Error) => {
  logger.error('Redis connection error', { error: err.message });
});

redisClient.on('close', () => {
  logger.warn('Redis connection closed');
});

/**
 * Health check to verify Redis connectivity
 */
export async function checkRedisHealth(): Promise<boolean> {
  try {
    const pong = await redisClient.ping();
    return pong === 'PONG';
  } catch (err) {
    logger.error('Redis health check failed', { error: (err as Error).message });
    return false;
  }
}

/**
 * Graceful shutdown hook
 */
export async function closeRedis(): Promise<void> {
  logger.info('Disconnecting Redis client...');
  try {
    await redisClient.quit();
    logger.info('Redis client disconnected cleanly');
  } catch {
    redisClient.disconnect();
  }
}
