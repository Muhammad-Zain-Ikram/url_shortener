import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as userSchema from '../models/user.model.js';

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error('DATABASE_URL is not set in environment variables.');
}

// Create a Neon serverless SQL connection
export const sql = neon(databaseUrl);

// Initialize Drizzle with the SQL connection and schema
export const db = drizzle(sql, {
  schema: { ...userSchema },
});

