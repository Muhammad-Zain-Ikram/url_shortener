import { Request, Response, NextFunction } from 'express';
import { redisClient } from '../config/redis.js';
import { AppError } from '../utils/AppError.js';

/**
 * Centralized Rate Limit Configuration
 */
export const RATE_LIMIT_CONFIG = {
  // Global app-wide limit
  GLOBAL: {
    max: 100,
    windowSec: 60, // 100 requests per minute per IP
  },
  // Public route limits
  LOGIN: {
    maxFailuresPerIp: 10,
    maxFailuresPerEmail: 5,
    windowSec: 15 * 60, // 15 minutes (900s)
  },
  REGISTER: {
    max: 10,
    windowSec: 60 * 60, // 10 requests per hour per IP (3600s)
  },
  MAGIC_LINK: {
    cooldownSec: 60, // 60-second cooldown per email
    maxPerEmail: 3, // max 3 requests per hour per email
    windowEmailSec: 60 * 60,
    maxPerIp: 10, // max 10 requests per hour per IP
    windowIpSec: 60 * 60,
  },
  FORGOT_PASSWORD: {
    cooldownSec: 60, // 60-second cooldown per email
    maxPerEmail: 3, // max 3 requests per hour per email
    windowEmailSec: 60 * 60,
    maxPerIp: 10, // max 10 requests per hour per IP
    windowIpSec: 60 * 60,
  },
  VERIFY_EMAIL: {
    max: 30,
    windowSec: 15 * 60, // 30 requests per 15 minutes per IP
  },
  RESET_PASSWORD: {
    max: 15,
    windowSec: 15 * 60, // 15 requests per 15 minutes per IP
  },
  SET_PASSWORD: {
    max: 15,
    windowSec: 15 * 60, // 15 requests per 15 minutes per IP
  },
  // Authenticated route limits
  USER_GENERAL: {
    max: 200,
    windowSec: 60, // 200 requests per minute per user
  },
  CHANGE_PASSWORD: {
    max: 5,
    windowSec: 15 * 60, // 5 attempts per 15 minutes per user
  },
  REQUEST_SET_PASSWORD: {
    cooldownSec: 60, // 60-second cooldown per user
    max: 3,
    windowSec: 60 * 60, // 3 requests per hour per user
  },
} as const;

/**
 * Extracts normalized client IP address
 */
export function getClientIp(req: Request): string {
  if (req.ip) return req.ip.trim();
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    return forwarded.split(',')[0].trim();
  }
  return (req.socket.remoteAddress || '127.0.0.1').trim();
}

/**
 * Safely extracts normalized email from request body
 */
function extractNormalizedEmail(req: Request): string | null {
  const rawEmail = req.body?.email;
  if (typeof rawEmail === 'string' && rawEmail.trim().length > 0) {
    return rawEmail.trim().toLowerCase();
  }
  return null;
}

/**
 * Throws 429 Too Many Requests AppError and sets Retry-After header
 */
function throwRateLimitError(
  res: Response,
  message: string,
  retryAfterSec: number,
  details: unknown = null
): never {
  const retryAfter = Math.max(1, Math.ceil(retryAfterSec));
  res.setHeader('Retry-After', String(retryAfter));
  throw new AppError(429, message, 'TOO_MANY_REQUESTS', details ?? { retryAfter });
}

interface RateLimitCheckResult {
  allowed: boolean;
  current: number;
  limit: number;
  retryAfterSec: number;
}

/**
 * Atomic Redis increment with window expiration
 */
export async function checkRateLimit(
  key: string,
  limit: number,
  windowSec: number
): Promise<RateLimitCheckResult> {
  try {
    const pipeline = redisClient.pipeline();
    pipeline.incr(key);
    pipeline.ttl(key);
    const results = await pipeline.exec();

    if (!results) {
      return { allowed: true, current: 1, limit, retryAfterSec: 0 };
    }

    const [incrErr, incrRes] = results[0];
    const [ttlErr, ttlRes] = results[1];

    if (incrErr) {
      console.error('Redis rate limit error:', incrErr);
      return { allowed: true, current: 1, limit, retryAfterSec: 0 };
    }

    const current = typeof incrRes === 'number' ? incrRes : Number(incrRes);
    let ttl = typeof ttlRes === 'number' ? ttlRes : Number(ttlRes);

    if (current === 1 || ttl === -1) {
      await redisClient.expire(key, windowSec);
      ttl = windowSec;
    }

    const retryAfterSec = ttl > 0 ? ttl : windowSec;
    const allowed = current <= limit;

    return { allowed, current, limit, retryAfterSec };
  } catch (err) {
    console.error('Redis checkRateLimit exception:', err);
    // Fail-open on transient Redis errors to avoid taking down APIs
    return { allowed: true, current: 1, limit, retryAfterSec: 0 };
  }
}

/**
 * Checks if a cooldown period is still active
 */
export async function checkCooldown(
  key: string,
  cooldownSec: number
): Promise<{ allowed: boolean; retryAfterSec: number }> {
  try {
    const ttl = await redisClient.ttl(key);
    if (ttl > 0) {
      return { allowed: false, retryAfterSec: ttl };
    }
    return { allowed: true, retryAfterSec: 0 };
  } catch (err) {
    console.error('Redis checkCooldown exception:', err);
    return { allowed: true, retryAfterSec: 0 };
  }
}

/**
 * Sets a cooldown key in Redis
 */
export async function setCooldown(key: string, cooldownSec: number): Promise<void> {
  try {
    await redisClient.set(key, '1', 'EX', cooldownSec);
  } catch (err) {
    console.error('Redis setCooldown exception:', err);
  }
}

/* ==========================================================================
   PUBLIC ROUTE RATE LIMITERS
   ========================================================================== */

/**
 * Global rate limiter: 100 requests per minute per IP
 */
export async function globalRateLimiter(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ip = getClientIp(req);
    const key = `rl:global:ip:${ip}`;
    const result = await checkRateLimit(
      key,
      RATE_LIMIT_CONFIG.GLOBAL.max,
      RATE_LIMIT_CONFIG.GLOBAL.windowSec
    );

    if (!result.allowed) {
      throwRateLimitError(
        res,
        'Too many requests to this server. Please slow down and try again later.',
        result.retryAfterSec
      );
    }

    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Login rate limiter: Checks failed attempt threshold before processing login
 * (10 failures per 15 min per IP, 5 failures per 15 min per email)
 */
export async function loginRateLimiter(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ip = getClientIp(req);
    const ipKey = `rl:fail:login:ip:${ip}`;

    const ipFailuresRaw = await redisClient.get(ipKey);
    const ipFailures = ipFailuresRaw ? Number(ipFailuresRaw) : 0;

    if (ipFailures >= RATE_LIMIT_CONFIG.LOGIN.maxFailuresPerIp) {
      const ttl = await redisClient.ttl(ipKey);
      throwRateLimitError(
        res,
        'Too many failed login attempts from this IP address. Please try again later.',
        ttl > 0 ? ttl : RATE_LIMIT_CONFIG.LOGIN.windowSec
      );
    }

    const email = extractNormalizedEmail(req);
    if (email) {
      const emailKey = `rl:fail:login:email:${email}`;
      const emailFailuresRaw = await redisClient.get(emailKey);
      const emailFailures = emailFailuresRaw ? Number(emailFailuresRaw) : 0;

      if (emailFailures >= RATE_LIMIT_CONFIG.LOGIN.maxFailuresPerEmail) {
        const ttl = await redisClient.ttl(emailKey);
        throwRateLimitError(
          res,
          'Too many failed login attempts for this account. Please try again later.',
          ttl > 0 ? ttl : RATE_LIMIT_CONFIG.LOGIN.windowSec
        );
      }
    }

    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Records a failed login attempt for IP and email
 */
export async function recordFailedLogin(ip: string, email?: string): Promise<void> {
  try {
    const windowSec = RATE_LIMIT_CONFIG.LOGIN.windowSec;
    const ipKey = `rl:fail:login:ip:${ip}`;

    const pipeline = redisClient.pipeline();
    pipeline.incr(ipKey);
    pipeline.ttl(ipKey);

    if (email && email.trim()) {
      const emailKey = `rl:fail:login:email:${email.trim().toLowerCase()}`;
      pipeline.incr(emailKey);
      pipeline.ttl(emailKey);
    }

    const results = await pipeline.exec();
    if (!results) return;

    const ipIncrRes = Number(results[0][1]);
    const ipTtlRes = Number(results[1][1]);
    if (ipIncrRes === 1 || ipTtlRes === -1) {
      await redisClient.expire(ipKey, windowSec);
    }

    if (email && email.trim() && results.length >= 4) {
      const emailKey = `rl:fail:login:email:${email.trim().toLowerCase()}`;
      const emailIncrRes = Number(results[2][1]);
      const emailTtlRes = Number(results[3][1]);
      if (emailIncrRes === 1 || emailTtlRes === -1) {
        await redisClient.expire(emailKey, windowSec);
      }
    }
  } catch (err) {
    console.error('Failed to record failed login counter in Redis:', err);
  }
}

/**
 * Resets failed login counters on successful authentication
 */
export async function recordSuccessfulLogin(ip: string, email: string): Promise<void> {
  try {
    const emailKey = `rl:fail:login:email:${email.trim().toLowerCase()}`;
    const ipKey = `rl:fail:login:ip:${ip}`;
    await redisClient.del(emailKey, ipKey);
  } catch (err) {
    console.error('Failed to reset login rate limit counters:', err);
  }
}

/**
 * Registration rate limiter: max 10 requests per hour per IP
 */
export async function registerRateLimiter(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ip = getClientIp(req);
    const key = `rl:register:ip:${ip}`;
    const result = await checkRateLimit(
      key,
      RATE_LIMIT_CONFIG.REGISTER.max,
      RATE_LIMIT_CONFIG.REGISTER.windowSec
    );

    if (!result.allowed) {
      throwRateLimitError(
        res,
        'Too many registration requests from this IP address. Please try again later.',
        result.retryAfterSec
      );
    }

    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Magic Link rate limiter: 60s cooldown per email, 3 req/hr per email, 10 req/hr per IP
 */
export async function magicLinkRateLimiter(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ip = getClientIp(req);
    const ipKey = `rl:magic:ip:${ip}`;
    const ipResult = await checkRateLimit(
      ipKey,
      RATE_LIMIT_CONFIG.MAGIC_LINK.maxPerIp,
      RATE_LIMIT_CONFIG.MAGIC_LINK.windowIpSec
    );

    if (!ipResult.allowed) {
      throwRateLimitError(
        res,
        'Too many magic link requests from this IP address. Please try again later.',
        ipResult.retryAfterSec
      );
    }

    const email = extractNormalizedEmail(req);
    if (email) {
      const cooldownKey = `rl:magic:cooldown:${email}`;
      const cooldown = await checkCooldown(cooldownKey, RATE_LIMIT_CONFIG.MAGIC_LINK.cooldownSec);
      if (!cooldown.allowed) {
        throwRateLimitError(
          res,
          `Please wait ${cooldown.retryAfterSec} seconds before requesting another magic link.`,
          cooldown.retryAfterSec
        );
      }

      const emailKey = `rl:magic:email:${email}`;
      const emailResult = await checkRateLimit(
        emailKey,
        RATE_LIMIT_CONFIG.MAGIC_LINK.maxPerEmail,
        RATE_LIMIT_CONFIG.MAGIC_LINK.windowEmailSec
      );

      if (!emailResult.allowed) {
        throwRateLimitError(
          res,
          'Too many magic link requests for this email address. Please try again later.',
          emailResult.retryAfterSec
        );
      }

      await setCooldown(cooldownKey, RATE_LIMIT_CONFIG.MAGIC_LINK.cooldownSec);
    }

    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Forgot Password rate limiter: 60s cooldown per email, 3 req/hr per email, 10 req/hr per IP
 */
export async function forgotPasswordRateLimiter(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ip = getClientIp(req);
    const ipKey = `rl:forgot:ip:${ip}`;
    const ipResult = await checkRateLimit(
      ipKey,
      RATE_LIMIT_CONFIG.FORGOT_PASSWORD.maxPerIp,
      RATE_LIMIT_CONFIG.FORGOT_PASSWORD.windowIpSec
    );

    if (!ipResult.allowed) {
      throwRateLimitError(
        res,
        'Too many password reset requests from this IP address. Please try again later.',
        ipResult.retryAfterSec
      );
    }

    const email = extractNormalizedEmail(req);
    if (email) {
      const cooldownKey = `rl:forgot:cooldown:${email}`;
      const cooldown = await checkCooldown(cooldownKey, RATE_LIMIT_CONFIG.FORGOT_PASSWORD.cooldownSec);
      if (!cooldown.allowed) {
        throwRateLimitError(
          res,
          `Please wait ${cooldown.retryAfterSec} seconds before requesting another password reset link.`,
          cooldown.retryAfterSec
        );
      }

      const emailKey = `rl:forgot:email:${email}`;
      const emailResult = await checkRateLimit(
        emailKey,
        RATE_LIMIT_CONFIG.FORGOT_PASSWORD.maxPerEmail,
        RATE_LIMIT_CONFIG.FORGOT_PASSWORD.windowEmailSec
      );

      if (!emailResult.allowed) {
        throwRateLimitError(
          res,
          'Too many password reset requests for this email address. Please try again later.',
          emailResult.retryAfterSec
        );
      }

      await setCooldown(cooldownKey, RATE_LIMIT_CONFIG.FORGOT_PASSWORD.cooldownSec);
    }

    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Verify Email rate limiter: light IP-based limit (30 per 15 min)
 */
export async function verifyEmailRateLimiter(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ip = getClientIp(req);
    const key = `rl:verify:ip:${ip}`;
    const result = await checkRateLimit(
      key,
      RATE_LIMIT_CONFIG.VERIFY_EMAIL.max,
      RATE_LIMIT_CONFIG.VERIFY_EMAIL.windowSec
    );

    if (!result.allowed) {
      throwRateLimitError(
        res,
        'Too many email verification attempts. Please try again later.',
        result.retryAfterSec
      );
    }

    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Reset Password rate limiter: light IP-based limit (15 per 15 min)
 */
export async function resetPasswordRateLimiter(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ip = getClientIp(req);
    const key = `rl:reset_pwd:ip:${ip}`;
    const result = await checkRateLimit(
      key,
      RATE_LIMIT_CONFIG.RESET_PASSWORD.max,
      RATE_LIMIT_CONFIG.RESET_PASSWORD.windowSec
    );

    if (!result.allowed) {
      throwRateLimitError(
        res,
        'Too many password reset submissions. Please try again later.',
        result.retryAfterSec
      );
    }

    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Set Password rate limiter: light IP-based limit (15 per 15 min)
 */
export async function setPasswordRateLimiter(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ip = getClientIp(req);
    const key = `rl:set_pwd:ip:${ip}`;
    const result = await checkRateLimit(
      key,
      RATE_LIMIT_CONFIG.SET_PASSWORD.max,
      RATE_LIMIT_CONFIG.SET_PASSWORD.windowSec
    );

    if (!result.allowed) {
      throwRateLimitError(
        res,
        'Too many set-password requests. Please try again later.',
        result.retryAfterSec
      );
    }

    next();
  } catch (err) {
    next(err);
  }
}

/* ==========================================================================
   AUTHENTICATED (USER-BASED) RATE LIMITERS
   ========================================================================== */

/**
 * General authenticated route limiter: 200 requests per minute per user ID
 */
export async function userGeneralRateLimiter(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return next();
    }

    const key = `rl:user:general:${userId}`;
    const result = await checkRateLimit(
      key,
      RATE_LIMIT_CONFIG.USER_GENERAL.max,
      RATE_LIMIT_CONFIG.USER_GENERAL.windowSec
    );

    if (!result.allowed) {
      throwRateLimitError(
        res,
        'User rate limit exceeded. Please slow down and try again later.',
        result.retryAfterSec
      );
    }

    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Sensitive action limiter: Change Password (5 requests per 15 min per user)
 */
export async function changePasswordRateLimiter(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return next();
    }

    const key = `rl:user:change_pwd:${userId}`;
    const result = await checkRateLimit(
      key,
      RATE_LIMIT_CONFIG.CHANGE_PASSWORD.max,
      RATE_LIMIT_CONFIG.CHANGE_PASSWORD.windowSec
    );

    if (!result.allowed) {
      throwRateLimitError(
        res,
        'Too many password change attempts. Please try again later.',
        result.retryAfterSec
      );
    }

    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Sensitive action limiter: Request Set Password email (60s cooldown, max 3/hour per user)
 */
export async function requestSetPasswordRateLimiter(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return next();
    }

    const cooldownKey = `rl:user:req_set_pwd:cooldown:${userId}`;
    const cooldown = await checkCooldown(cooldownKey, RATE_LIMIT_CONFIG.REQUEST_SET_PASSWORD.cooldownSec);
    if (!cooldown.allowed) {
      throwRateLimitError(
        res,
        `Please wait ${cooldown.retryAfterSec} seconds before requesting another set-password email.`,
        cooldown.retryAfterSec
      );
    }

    const key = `rl:user:req_set_pwd:${userId}`;
    const result = await checkRateLimit(
      key,
      RATE_LIMIT_CONFIG.REQUEST_SET_PASSWORD.max,
      RATE_LIMIT_CONFIG.REQUEST_SET_PASSWORD.windowSec
    );

    if (!result.allowed) {
      throwRateLimitError(
        res,
        'Too many set-password email requests. Please try again later.',
        result.retryAfterSec
      );
    }

    await setCooldown(cooldownKey, RATE_LIMIT_CONFIG.REQUEST_SET_PASSWORD.cooldownSec);
    next();
  } catch (err) {
    next(err);
  }
}
