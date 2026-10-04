import { Router } from 'express';
import { sendSuccess } from '../utils/responseHandler.js';

const router = Router();

router.get('/health', (req, res) => {
  sendSuccess(res, 'System is healthy');
});

export default router;
