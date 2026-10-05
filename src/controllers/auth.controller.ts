import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { userRepository } from '../repositories/user.repository.js';
import { sessionRepository } from '../repositories/session.repository.js';
import { tokenRepository } from '../repositories/token.repository.js';
import { hashPassword, verifyPassword } from '../utils/password.js';
import {
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendSetPasswordEmail,
} from '../utils/emailService.js';
import { sendSuccess, sendCreated } from '../utils/responseHandler.js';
import { AppError } from '../utils/AppError.js';
import { SESSION_COOKIE_NAME } from '../middlewares/auth.middleware.js';
import { googleOAuthClient } from '../config/google.js';
import {
  getClientIp,
  recordFailedLogin,
  recordSuccessfulLogin,
} from '../middlewares/rateLimiter.js';

// Cookie options helper
function setSessionCookie(res: Response, sessionId: string): void {
  res.cookie(SESSION_COOKIE_NAME, sessionId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days in ms
  });
}

// Zod schemas for input validation
const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email('Invalid email address').max(255),
  password: z.string().min(8, 'Password must be at least 8 characters long').max(128),
  name: z.string().trim().max(100).optional(),
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

const tokenQuerySchema = z.object({
  token: z.string().min(10, 'Invalid token format'),
});

const emailOnlySchema = z.object({
  email: z.string().trim().toLowerCase().email('Invalid email address'),
});

const resetPasswordSchema = z.object({
  token: z.string().min(10, 'Invalid token format'),
  newPassword: z.string().min(8, 'Password must be at least 8 characters long').max(128),
});

const changePasswordSchema = z.object({
  oldPassword: z.string().min(1, 'Current password is required'),
  newPassword: z.string().min(8, 'New password must be at least 8 characters long').max(128),
});

const setPasswordSchema = z.object({
  token: z.string().min(10, 'Invalid token format'),
  newPassword: z.string().min(8, 'Password must be at least 8 characters long').max(128),
});

const googleIdTokenSchema = z.object({
  idToken: z.string().min(1, 'Google ID token is required'),
});

export class AuthController {
  /**
   * 1. Email & Password Signup (Database-backed with Unverified Overwrite)
   * - If email exists and is verified: returns 409 Conflict.
   * - If email exists and is unverified: updates credentials and issues fresh 24h verification token.
   * - If email does not exist: creates new unverified user in DB and sends verification token.
   */
  async register(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { email, password, name } = registerSchema.parse(req.body);

      const existingUser = await userRepository.findByEmail(email);

      if (existingUser) {
        if (existingUser.isEmailVerified) {
          throw new AppError(
            409,
            'An account with this email already exists and is verified.',
            'EMAIL_ALREADY_EXISTS'
          );
        }

        // Unverified email exists! Update credentials with new password/name and re-issue token
        const passwordHash = await hashPassword(password);
        const updatedUser = await userRepository.updateUnverifiedCredentials(
          existingUser.id,
          passwordHash,
          name ?? existingUser.name
        );

        // Generate fresh 24-hr verification token in Redis (replaces any previous token)
        const rawToken = await tokenRepository.createEmailVerifyToken(
          updatedUser.id,
          updatedUser.email
        );

        await sendVerificationEmail(updatedUser.email, rawToken);

        sendSuccess(
          res,
          'Unverified account updated. A fresh verification email has been sent.',
          { userId: updatedUser.id, email: updatedUser.email }
        );
        return;
      }

      // Brand new user registration
      const passwordHash = await hashPassword(password);
      const newUser = await userRepository.create({
        email,
        passwordHash,
        name: name ?? null,
        isEmailVerified: false,
      });

      const rawToken = await tokenRepository.createEmailVerifyToken(newUser.id, newUser.email);
      await sendVerificationEmail(newUser.email, rawToken);

      sendCreated(
        res,
        'Registration successful. Please check your email to verify your account.',
        {
          userId: newUser.id,
          email: newUser.email,
        }
      );
    } catch (err) {
      next(err);
    }
  }

  /**
   * 2. Email Verification
   * Consumes 24-hr token from Redis and marks user verified in PostgreSQL
   */
  async verifyEmail(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const rawToken = req.query.token || req.body.token;
      const { token } = tokenQuerySchema.parse({ token: rawToken });

      const payload = await tokenRepository.consumeEmailVerifyToken(token);
      if (!payload) {
        throw new AppError(400, 'Invalid or expired verification token.', 'INVALID_TOKEN');
      }

      await userRepository.markEmailVerified(payload.userId);
      const user = await userRepository.findById(payload.userId);
      if (!user) {
        throw new AppError(404, 'User account not found.', 'USER_NOT_FOUND');
      }

      // Create 7-day session on successful email verification
      const sessionId = await sessionRepository.createSession(user.id, user.email);
      setSessionCookie(res, sessionId);

      sendSuccess(res, 'Email verified successfully. You are now logged in.', {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          avatarUrl: user.avatarUrl,
          isEmailVerified: true,
          hasPassword: Boolean(user.passwordHash),
          googleId: user.googleId,
        },
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * 3. Password Login
   * Restricts login to verified users only and tracks failed attempts for rate limiting
   */
  async login(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const ip = getClientIp(req);
      const { email, password } = loginSchema.parse(req.body);

      const user = await userRepository.findByEmail(email);
      if (!user) {
        await recordFailedLogin(ip, email);
        throw new AppError(401, 'Invalid email or password.', 'INVALID_CREDENTIALS');
      }

      if (!user.passwordHash) {
        await recordFailedLogin(ip, email);
        throw new AppError(
          400,
          'This account was created with Google. Please sign in with Google or use Set Password.',
          'GOOGLE_ACCOUNT_ONLY'
        );
      }

      const isValidPassword = await verifyPassword(user.passwordHash, password);
      if (!isValidPassword) {
        await recordFailedLogin(ip, email);
        throw new AppError(401, 'Invalid email or password.', 'INVALID_CREDENTIALS');
      }

      if (!user.isEmailVerified) {
        await recordFailedLogin(ip, email);
        throw new AppError(
          403,
          'Your email address is not verified yet. Please check your inbox or register again to receive a fresh verification link.',
          'EMAIL_NOT_VERIFIED'
        );
      }

      // Successful login: reset failed attempt counter for this email and IP
      await recordSuccessfulLogin(ip, email);

      const sessionId = await sessionRepository.createSession(user.id, user.email);
      setSessionCookie(res, sessionId);

      sendSuccess(res, 'Logged in successfully.', {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          avatarUrl: user.avatarUrl,
          isEmailVerified: user.isEmailVerified,
          hasPassword: true,
          googleId: user.googleId,
        },
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * 4. Magic Link Request
   */
  async magicLinkRequest(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { email } = emailOnlySchema.parse(req.body);

      let user = await userRepository.findByEmail(email);
      if (!user) {
        user = await userRepository.create({
          email,
          passwordHash: null,
          isEmailVerified: false,
        });
      }

      const rawToken = await tokenRepository.createEmailVerifyToken(user.id, user.email);
      await sendVerificationEmail(user.email, rawToken);

      sendSuccess(res, 'A sign-in link has been sent to your email address.', null);
    } catch (err) {
      next(err);
    }
  }


  /**
   * 5. Forgot Password Request (20-min token)
   */
  async forgotPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { email } = emailOnlySchema.parse(req.body);

      const user = await userRepository.findByEmail(email);
      if (user) {
        const rawToken = await tokenRepository.createPasswordResetToken(user.id, user.email);
        await sendPasswordResetEmail(user.email, rawToken);
      }

      // Generic response to prevent email harvesting
      sendSuccess(res, 'If an account exists with that email, a password reset link has been sent.', null);
    } catch (err) {
      next(err);
    }
  }

  /**
   * 6. Reset Password via Token
   */
  async resetPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { token, newPassword } = resetPasswordSchema.parse(req.body);

      const payload = await tokenRepository.consumePasswordResetToken(token);
      if (!payload) {
        throw new AppError(400, 'Invalid or expired password reset token.', 'INVALID_TOKEN');
      }

      const passwordHash = await hashPassword(newPassword);
      await userRepository.updatePassword(payload.userId, passwordHash);
      await userRepository.markEmailVerified(payload.userId);

      // Invalidate existing sessions for security
      await sessionRepository.deleteAllUserSessions(payload.userId);

      sendSuccess(res, 'Password reset successfully. Please sign in with your new password.', null);
    } catch (err) {
      next(err);
    }
  }

  /**
   * 7. Change Password (Authenticated)
   */
  async changePassword(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { oldPassword, newPassword } = changePasswordSchema.parse(req.body);
      const currentUser = req.user!;

      const user = await userRepository.findById(currentUser.id);
      if (!user) {
        throw new AppError(404, 'User account not found.', 'USER_NOT_FOUND');
      }

      if (!user.passwordHash) {
        throw new AppError(
          400,
          'This account has no password set. Please use "Set Password" instead.',
          'NO_PASSWORD_SET'
        );
      }

      const isMatch = await verifyPassword(user.passwordHash, oldPassword);
      if (!isMatch) {
        throw new AppError(400, 'Current password does not match.', 'INVALID_PASSWORD');
      }

      const newHash = await hashPassword(newPassword);
      await userRepository.updatePassword(user.id, newHash);

      sendSuccess(res, 'Password changed successfully.', null);
    } catch (err) {
      next(err);
    }
  }

  /**
   * 8. Request Set Password (Authenticated Google users without password)
   */
  async requestSetPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const currentUser = req.user!;

      const user = await userRepository.findById(currentUser.id);
      if (!user) {
        throw new AppError(404, 'User not found.', 'USER_NOT_FOUND');
      }

      if (user.passwordHash) {
        throw new AppError(
          400,
          'Your account already has a password. Use "Change Password" instead.',
          'PASSWORD_ALREADY_EXISTS'
        );
      }

      // Generate 15-min token
      const rawToken = await tokenRepository.createSetPasswordToken(user.id, user.email);
      await sendSetPasswordEmail(user.email, rawToken);

      sendSuccess(res, 'A verification link has been sent to your email to set a password.', null);
    } catch (err) {
      next(err);
    }
  }

  /**
   * 9. Set Password via Token (Enables dual Google + Email/Password access)
   */
  async setPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { token, newPassword } = setPasswordSchema.parse(req.body);

      const payload = await tokenRepository.consumeSetPasswordToken(token);
      if (!payload) {
        throw new AppError(400, 'Invalid or expired set-password token.', 'INVALID_TOKEN');
      }

      const passwordHash = await hashPassword(newPassword);
      await userRepository.updatePassword(payload.userId, passwordHash);

      sendSuccess(
        res,
        'Password set successfully! You can now log in with either Google or your email and password.',
        null
      );
    } catch (err) {
      next(err);
    }
  }

  /**
   * 10. Generate Google OAuth URL
   */
  async getGoogleAuthUrl(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const url = googleOAuthClient.generateAuthUrl({
        access_type: 'offline',
        scope: ['openid', 'email', 'profile'],
        prompt: 'consent',
      });

      sendSuccess(res, 'Google OAuth URL generated.', { url });
    } catch (err) {
      next(err);
    }
  }

  /**
   * 11. Google OAuth Callback (Code exchange & Account Merging)
   */
  async googleCallback(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const code = req.query.code as string;
      if (!code) {
        throw new AppError(400, 'Authorization code missing in Google callback.', 'MISSING_CODE');
      }

      const { tokens } = await googleOAuthClient.getToken(code);
      if (!tokens.id_token) {
        throw new AppError(400, 'Failed to retrieve ID token from Google.', 'GOOGLE_AUTH_FAILED');
      }

      const ticket = await googleOAuthClient.verifyIdToken({
        idToken: tokens.id_token,
        audience: process.env.GOOGLE_CLIENT_ID,
      });

      const payload = ticket.getPayload();
      if (!payload || !payload.email) {
        throw new AppError(400, 'Invalid Google profile payload.', 'INVALID_GOOGLE_PAYLOAD');
      }

      const googleId = payload.sub;
      const email = payload.email.trim().toLowerCase();
      const name = payload.name ?? null;
      const avatarUrl = payload.picture ?? null;

      // Account Merging Logic:
      let user = await userRepository.findByGoogleId(googleId);

      if (!user) {
        const existingEmailUser = await userRepository.findByEmail(email);
        if (existingEmailUser) {
          // Merge: link googleId and mark email as verified
          await userRepository.linkGoogleAccount(existingEmailUser.id, googleId, name, avatarUrl);
          user = await userRepository.findById(existingEmailUser.id);
        } else {
          // New user created via Google
          user = await userRepository.create({
            email,
            googleId,
            name,
            avatarUrl,
            isEmailVerified: true,
            passwordHash: null,
          });
        }
      }

      if (!user) {
        throw new AppError(500, 'Failed to process user account.', 'INTERNAL_SERVER_ERROR');
      }

      // Invalidate any active verification token in Redis for this user
      await tokenRepository.invalidateUserVerificationToken(user.id);

      const sessionId = await sessionRepository.createSession(user.id, user.email);
      setSessionCookie(res, sessionId);

      const redirectUrl = process.env.APP_URL || 'http://localhost:3000';
      if (req.accepts('html')) {
        res.redirect(`${redirectUrl}/dashboard`);
      } else {
        sendSuccess(res, 'Google authentication successful.', {
          user: {
            id: user.id,
            email: user.email,
            name: user.name,
            avatarUrl: user.avatarUrl,
            isEmailVerified: user.isEmailVerified,
            hasPassword: Boolean(user.passwordHash),
            googleId: user.googleId,
          },
        });
      }
    } catch (err) {
      next(err);
    }
  }

  /**
   * 12. Google ID Token direct sign-in (for SPA / Mobile) with Account Merging
   */
  async googleIdTokenLogin(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { idToken } = googleIdTokenSchema.parse(req.body);

      const ticket = await googleOAuthClient.verifyIdToken({
        idToken,
        audience: process.env.GOOGLE_CLIENT_ID,
      });

      const payload = ticket.getPayload();
      if (!payload || !payload.email) {
        throw new AppError(400, 'Invalid Google ID token.', 'INVALID_GOOGLE_TOKEN');
      }

      const googleId = payload.sub;
      const email = payload.email.trim().toLowerCase();
      const name = payload.name ?? null;
      const avatarUrl = payload.picture ?? null;

      let user = await userRepository.findByGoogleId(googleId);

      if (!user) {
        const existingEmailUser = await userRepository.findByEmail(email);
        if (existingEmailUser) {
          await userRepository.linkGoogleAccount(existingEmailUser.id, googleId, name, avatarUrl);
          user = await userRepository.findById(existingEmailUser.id);
        } else {
          user = await userRepository.create({
            email,
            googleId,
            name,
            avatarUrl,
            isEmailVerified: true,
            passwordHash: null,
          });
        }
      }

      if (!user) {
        throw new AppError(500, 'Failed to authenticate user.', 'INTERNAL_SERVER_ERROR');
      }

      // Invalidate any active verification token in Redis for this user
      await tokenRepository.invalidateUserVerificationToken(user.id);

      const sessionId = await sessionRepository.createSession(user.id, user.email);
      setSessionCookie(res, sessionId);

      sendSuccess(res, 'Google sign-in successful.', {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          avatarUrl: user.avatarUrl,
          isEmailVerified: user.isEmailVerified,
          hasPassword: Boolean(user.passwordHash),
          googleId: user.googleId,
        },
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * 13. Current User Profile
   */
  async me(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      sendSuccess(res, 'User profile retrieved successfully.', {
        user: req.user,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * 14. Logout
   */
  async logout(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (req.sessionId) {
        await sessionRepository.deleteSession(req.sessionId);
      }
      res.clearCookie(SESSION_COOKIE_NAME);
      sendSuccess(res, 'Logged out successfully.', null);
    } catch (err) {
      next(err);
    }
  }
}

export const authController = new AuthController();
