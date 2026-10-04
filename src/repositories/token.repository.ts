import { redisClient } from '../config/redis.js';
import { generateToken, hashToken } from '../utils/token.js';

export interface TokenPayload {
  userId: string;
  email: string;
}

const EMAIL_VERIFY_TTL = 24 * 60 * 60; // 24 hours (86400s)
const PASSWORD_RESET_TTL = 20 * 60; // 20 minutes (1200s)
const SET_PASSWORD_TTL = 15 * 60; // 15 minutes (900s)

export class TokenRepository {
  private getEmailVerifyKey(tokenHash: string): string {
    return `email_verify:${tokenHash}`;
  }

  private getUserVerifyTokenKey(userId: string): string {
    return `user_verify_token:${userId}`;
  }

  /**
   * Creates an Email Verification / Magic Link token in Redis with 24-hr TTL
   * Invalidates any previously active verification token for this userId.
   */
  async createEmailVerifyToken(userId: string, email: string): Promise<string> {
    const userTokenKey = this.getUserVerifyTokenKey(userId);

    // Invalidate old verification token if one was already issued
    const oldTokenHash = await redisClient.get(userTokenKey);
    if (oldTokenHash) {
      await redisClient.del(this.getEmailVerifyKey(oldTokenHash));
    }

    const rawToken = generateToken();
    const tokenHash = hashToken(rawToken);
    const verifyKey = this.getEmailVerifyKey(tokenHash);
    const payload: TokenPayload = { userId, email: email.trim().toLowerCase() };

    const pipeline = redisClient.pipeline();
    pipeline.set(verifyKey, JSON.stringify(payload), 'EX', EMAIL_VERIFY_TTL);
    pipeline.set(userTokenKey, tokenHash, 'EX', EMAIL_VERIFY_TTL);
    await pipeline.exec();

    return rawToken;
  }

  /**
   * Verifies and atomically consumes an Email Verification token
   */
  async consumeEmailVerifyToken(rawToken: string): Promise<TokenPayload | null> {
    const tokenHash = hashToken(rawToken);
    const verifyKey = this.getEmailVerifyKey(tokenHash);

    const raw = await redisClient.get(verifyKey);
    if (!raw) return null;

    let payload: TokenPayload;
    try {
      payload = JSON.parse(raw) as TokenPayload;
    } catch {
      await redisClient.del(verifyKey);
      return null;
    }

    const userTokenKey = this.getUserVerifyTokenKey(payload.userId);
    const pipeline = redisClient.pipeline();
    pipeline.del(verifyKey);
    pipeline.del(userTokenKey);
    await pipeline.exec();

    return payload;
  }

  /**
   * Invalidates any active email verification token for a user
   */
  async invalidateUserVerificationToken(userId: string): Promise<void> {
    const userTokenKey = this.getUserVerifyTokenKey(userId);
    const tokenHash = await redisClient.get(userTokenKey);
    if (tokenHash) {
      const pipeline = redisClient.pipeline();
      pipeline.del(this.getEmailVerifyKey(tokenHash));
      pipeline.del(userTokenKey);
      await pipeline.exec();
    }
  }

  /**
   * Creates a Password Reset token in Redis with 20-min TTL
   */
  async createPasswordResetToken(userId: string, email: string): Promise<string> {
    const rawToken = generateToken();
    const tokenHash = hashToken(rawToken);
    const key = `password_reset:${tokenHash}`;
    const payload: TokenPayload = { userId, email: email.trim().toLowerCase() };

    await redisClient.set(key, JSON.stringify(payload), 'EX', PASSWORD_RESET_TTL);
    return rawToken;
  }

  /**
   * Verifies and atomically consumes a Password Reset token
   */
  async consumePasswordResetToken(rawToken: string): Promise<TokenPayload | null> {
    const tokenHash = hashToken(rawToken);
    const key = `password_reset:${tokenHash}`;
    return this.consumeToken(key);
  }

  /**
   * Creates a Set Password token (for Google users) in Redis with 15-min TTL
   */
  async createSetPasswordToken(userId: string, email: string): Promise<string> {
    const rawToken = generateToken();
    const tokenHash = hashToken(rawToken);
    const key = `set_password:${tokenHash}`;
    const payload: TokenPayload = { userId, email: email.trim().toLowerCase() };

    await redisClient.set(key, JSON.stringify(payload), 'EX', SET_PASSWORD_TTL);
    return rawToken;
  }

  /**
   * Verifies and atomically consumes a Set Password token
   */
  async consumeSetPasswordToken(rawToken: string): Promise<TokenPayload | null> {
    const tokenHash = hashToken(rawToken);
    const key = `set_password:${tokenHash}`;
    return this.consumeToken(key);
  }

  /**
   * Private helper to atomically get and delete single-use token from Redis
   */
  private async consumeToken(key: string): Promise<TokenPayload | null> {
    const raw = await redisClient.get(key);
    if (!raw) return null;

    await redisClient.del(key);
    try {
      return JSON.parse(raw) as TokenPayload;
    } catch {
      return null;
    }
  }
}

export const tokenRepository = new TokenRepository();
