import { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/AppError.js';
import { sessionRepository, SLIDING_WINDOW_MS } from '../repositories/session.repository.js';
import { userRepository } from '../repositories/user.repository.js';

export const SESSION_COOKIE_NAME = 'sessionId';

/**
 * Extracts session ID from cookies or Authorization header
 */
function extractSessionId(req: Request): string | null {
  if (req.cookies && req.cookies[SESSION_COOKIE_NAME]) {
    return req.cookies[SESSION_COOKIE_NAME];
  }

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7).trim();
  }

  return null;
}

/**
 * Middleware requiring active authenticated session
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const sessionId = extractSessionId(req);
    if (!sessionId) {
      throw new AppError(401, 'Authentication required. Please sign in.', 'UNAUTHORIZED');
    }

    const session = await sessionRepository.getSession(sessionId);
    if (!session) {
      // Clear invalid cookie if present
      res.clearCookie(SESSION_COOKIE_NAME);
      throw new AppError(401, 'Session expired or invalid. Please sign in again.', 'INVALID_SESSION');
    }

    // 5-day sliding window refresh
    const elapsedSinceRefresh = Date.now() - session.lastRefreshedAt;
    if (elapsedSinceRefresh > SLIDING_WINDOW_MS) {
      await sessionRepository.refreshSessionTtl(sessionId, session);
    }

    // Retrieve fresh user from database
    const user = await userRepository.findById(session.userId);
    if (!user) {
      await sessionRepository.deleteSession(sessionId);
      res.clearCookie(SESSION_COOKIE_NAME);
      throw new AppError(401, 'User account no longer exists.', 'USER_NOT_FOUND');
    }

    req.user = {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
      isEmailVerified: user.isEmailVerified,
      hasPassword: Boolean(user.passwordHash),
      googleId: user.googleId,
    };
    req.sessionId = sessionId;

    next();
  } catch (err) {
    next(err);
  }
}
