import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error('DATABASE_URL is not set in environment variables.');
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/models/**/*.ts',
  out: './drizzle',
  dbCredentials: {
    url: databaseUrl,
  },
});
