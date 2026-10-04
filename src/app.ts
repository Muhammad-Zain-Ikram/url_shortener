import express, { Application } from 'express';
import { errorHandler } from './middlewares/errorHandler.js';
import router from './routes/index.js';

const app: Application = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Mount routes
app.use('/', router);

// Global Error Handler must be the last middleware
app.use(errorHandler);

export default app;
