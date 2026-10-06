import express, { Application, Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { errorHandler } from './middlewares/errorHandler.js';
import { globalRateLimiter } from './middlewares/rateLimiter.js';
import { AppError } from './utils/AppError.js';
import router from './routes/index.js';

const app: Application = express();

// Trust reverse proxy (e.g. Render, Railway, Nginx, Cloudflare) so req.ip reflects real client IP
app.set('trust proxy', 1);

// Security Headers via Helmet
app.use(helmet());

// CORS configuration: exact frontend origin from environment variable, credentials enabled (no wildcard)
const frontendOrigin =
  process.env.FRONTEND_URL || process.env.CLIENT_URL || process.env.APP_URL || 'http://localhost:3000';

app.use(
  cors({
    origin: frontendOrigin,
    credentials: true,
  })
);

// Body parsing with strict 10kb size limits
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));
app.use(cookieParser());

// Global Rate Limiter: 100 requests per minute per IP across the whole app
app.use(globalRateLimiter);

// Mount main application routes
app.use('/api', router);

// 404 Handler - Catch-all for undefined routes
app.use((req: Request, res: Response, next: NextFunction) => {
  next(new AppError(404, `Route ${req.method} ${req.originalUrl} not found`, 'NOT_FOUND'));
});

// Global Error Handler must be the last middleware
app.use(errorHandler);

export default app;
