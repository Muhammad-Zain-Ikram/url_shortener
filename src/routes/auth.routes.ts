import { Router } from 'express';
import { authController } from '../controllers/auth.controller.js';
import { requireAuth } from '../middlewares/auth.middleware.js';

const router = Router();

// Public Authentication Endpoints
router.post('/register', (req, res, next) => authController.register(req, res, next));
router.post('/login', (req, res, next) => authController.login(req, res, next));
router.get('/verify-email', (req, res, next) => authController.verifyEmail(req, res, next));
router.post('/verify-email', (req, res, next) => authController.verifyEmail(req, res, next));
router.post('/magic-link', (req, res, next) => authController.magicLinkRequest(req, res, next));
router.post('/forgot-password', (req, res, next) => authController.forgotPassword(req, res, next));
router.post('/reset-password', (req, res, next) => authController.resetPassword(req, res, next));
router.post('/set-password', (req, res, next) => authController.setPassword(req, res, next));

// Google OAuth Endpoints
router.get('/google', (req, res, next) => authController.getGoogleAuthUrl(req, res, next));
router.get('/google/callback', (req, res, next) => authController.googleCallback(req, res, next));
router.post('/google', (req, res, next) => authController.googleIdTokenLogin(req, res, next));

// Protected Endpoints
router.get('/me', requireAuth, (req, res, next) => authController.me(req, res, next));
router.post('/change-password', requireAuth, (req, res, next) => authController.changePassword(req, res, next));
router.post('/request-set-password', requireAuth, (req, res, next) => authController.requestSetPassword(req, res, next));
router.post('/logout', requireAuth, (req, res, next) => authController.logout(req, res, next));

export default router;
