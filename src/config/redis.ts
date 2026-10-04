import { Redis } from 'ioredis';

const redisUrl = process.env.REDIS_URL;

if (!redisUrl) {
  console.warn('REDIS_URL is not set in environment variables. Redis client might fail to connect.');
}

// Upstash and ioredis integration
// ioredis accepts the standard rediss:// URL format which Upstash provides
export const redisClient = new Redis(redisUrl || '', {
  // Common Upstash configurations if needed, though the URL usually handles connection details
  lazyConnect: true,
  maxRetriesPerRequest: 3,
});

redisClient.on('error', (err) => {
  console.error('Redis connection error:', err);
});

redisClient.on('connect', () => {
  console.log('Successfully connected to Redis (Upstash).');
});
