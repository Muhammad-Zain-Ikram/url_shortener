import { Router } from 'express';
import { sendSuccess } from '../utils/responseHandler.js';
import authRoutes from './auth.routes.js';

const router = Router();

router.get('/health', (req, res) => {
  sendSuccess(res, 'System is healthy');
});

router.use('/auth', authRoutes);

export default router;

