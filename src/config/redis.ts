import { Redis } from 'ioredis';

const redisUrl = process.env.REDIS_URL;

if (!redisUrl) {
  console.warn('REDIS_URL is not set in environment variables. Redis client might fail to connect.');
}

const isPlaceholder = !redisUrl || redisUrl.includes('your-upstash-endpoint');

// Upstash and ioredis integration
export const redisClient = new Redis(redisUrl || '', {
  lazyConnect: true,
  maxRetriesPerRequest: 1,
  retryStrategy(times) {
    // Avoid reconnect storms if user has not yet configured their real Upstash URL
    if (isPlaceholder) {
      return null;
    }
    return Math.min(times * 200, 2000);
  },
  tls: redisUrl?.startsWith('rediss://')
    ? {
        rejectUnauthorized: false,
      }
    : undefined,
});

redisClient.on('error', (err) => {
  if (!isPlaceholder) {
    console.error('Redis connection error:', err);
  }
});

redisClient.on('connect', () => {
  console.log('Successfully connected to Redis (Upstash).');
});
