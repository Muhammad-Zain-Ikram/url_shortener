import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error('DATABASE_URL is not set in environment variables.');
}

// Create a Neon serverless SQL connection
const sql = neon(databaseUrl);

// Initialize Drizzle with the SQL connection
export const db = drizzle(sql);
