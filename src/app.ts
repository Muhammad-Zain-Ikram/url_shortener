import express, { Application } from 'express';
import cookieParser from 'cookie-parser';
import { errorHandler } from './middlewares/errorHandler.js';
import router from './routes/index.js';

const app: Application = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Mount routes
app.use('/', router);

// Global Error Handler must be the last middleware
app.use(errorHandler);

export default app;

