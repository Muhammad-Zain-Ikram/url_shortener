import { Router } from 'express';
import { authController } from '../controllers/auth.controller.js';
import { requireAuth } from '../middlewares/auth.middleware.js';
import {
  registerRateLimiter,
  loginRateLimiter,
  magicLinkRateLimiter,
  forgotPasswordRateLimiter,
  verifyEmailRateLimiter,
  resetPasswordRateLimiter,
  setPasswordRateLimiter,
  userGeneralRateLimiter,
  changePasswordRateLimiter,
  requestSetPasswordRateLimiter,
} from '../middlewares/rateLimiter.js';

const router = Router();

// Public Authentication Endpoints with specific rate limits
router.post('/register', registerRateLimiter, (req, res, next) => authController.register(req, res, next));
router.post('/login', loginRateLimiter, (req, res, next) => authController.login(req, res, next));
router.get('/verify-email', verifyEmailRateLimiter, (req, res, next) => authController.verifyEmail(req, res, next));
router.post('/verify-email', verifyEmailRateLimiter, (req, res, next) => authController.verifyEmail(req, res, next));
router.post('/magic-link', magicLinkRateLimiter, (req, res, next) => authController.magicLinkRequest(req, res, next));
router.post('/forgot-password', forgotPasswordRateLimiter, (req, res, next) => authController.forgotPassword(req, res, next));
router.post('/reset-password', resetPasswordRateLimiter, (req, res, next) => authController.resetPassword(req, res, next));
router.post('/set-password', setPasswordRateLimiter, (req, res, next) => authController.setPassword(req, res, next));

// Google OAuth Endpoints
router.get('/google', (req, res, next) => authController.getGoogleAuthUrl(req, res, next));
router.get('/google/callback', (req, res, next) => authController.googleCallback(req, res, next));
router.post('/google', (req, res, next) => authController.googleIdTokenLogin(req, res, next));

// Protected Endpoints (with user-based rate limiting)
router.get('/me', requireAuth, userGeneralRateLimiter, (req, res, next) => authController.me(req, res, next));
router.post('/change-password', requireAuth, userGeneralRateLimiter, changePasswordRateLimiter, (req, res, next) =>
  authController.changePassword(req, res, next)
);
router.post('/request-set-password', requireAuth, userGeneralRateLimiter, requestSetPasswordRateLimiter, (req, res, next) =>
  authController.requestSetPassword(req, res, next)
);
router.post('/logout', requireAuth, userGeneralRateLimiter, (req, res, next) => authController.logout(req, res, next));

export default router;
