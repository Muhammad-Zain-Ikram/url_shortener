import { redisClient } from '../config/redis.js';
import { generateSessionId } from '../utils/token.js';

export interface SessionData {
  userId: string;
  email: string;
  createdAt: number;
  lastRefreshedAt: number;
}

export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days (604800s)
export const SLIDING_WINDOW_MS = 5 * 24 * 60 * 60 * 1000; // 5 days (432,000,000ms)

export class SessionRepository {
  private getSessionKey(sessionId: string): string {
    return `session:${sessionId}`;
  }

  private getUserSessionsKey(userId: string): string {
    return `user_sessions:${userId}`;
  }

  /**
   * Creates a new 7-day session in Redis
   */
  async createSession(userId: string, email: string): Promise<string> {
    const sessionId = generateSessionId();
    const now = Date.now();
    const sessionData: SessionData = {
      userId,
      email,
      createdAt: now,
      lastRefreshedAt: now,
    };

    const sessionKey = this.getSessionKey(sessionId);
    const userSessionsKey = this.getUserSessionsKey(userId);

    const pipeline = redisClient.pipeline();
    pipeline.set(sessionKey, JSON.stringify(sessionData), 'EX', SESSION_TTL_SECONDS);
    pipeline.sadd(userSessionsKey, sessionId);
    pipeline.expire(userSessionsKey, SESSION_TTL_SECONDS);
    await pipeline.exec();

    return sessionId;
  }

  /**
   * Retrieves session data by sessionId
   */
  async getSession(sessionId: string): Promise<SessionData | null> {
    const raw = await redisClient.get(this.getSessionKey(sessionId));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as SessionData;
    } catch {
      return null;
    }
  }

  /**
   * Extends the session back to 7 days and updates lastRefreshedAt
   */
  async refreshSessionTtl(sessionId: string, sessionData: SessionData): Promise<void> {
    sessionData.lastRefreshedAt = Date.now();
    const sessionKey = this.getSessionKey(sessionId);
    const userSessionsKey = this.getUserSessionsKey(sessionData.userId);

    const pipeline = redisClient.pipeline();
    pipeline.set(sessionKey, JSON.stringify(sessionData), 'EX', SESSION_TTL_SECONDS);
    pipeline.expire(userSessionsKey, SESSION_TTL_SECONDS);
    await pipeline.exec();
  }

  /**
   * Deletes a single session (e.g., on logout)
   */
  async deleteSession(sessionId: string): Promise<void> {
    const session = await this.getSession(sessionId);
    const sessionKey = this.getSessionKey(sessionId);

    const pipeline = redisClient.pipeline();
    pipeline.del(sessionKey);
    if (session) {
      pipeline.srem(this.getUserSessionsKey(session.userId), sessionId);
    }
    await pipeline.exec();
  }

  /**
   * Deletes all active sessions for a user (e.g., on password reset)
   */
  async deleteAllUserSessions(userId: string): Promise<void> {
    const userSessionsKey = this.getUserSessionsKey(userId);
    const sessionIds = await redisClient.smembers(userSessionsKey);

    if (sessionIds.length > 0) {
      const pipeline = redisClient.pipeline();
      for (const id of sessionIds) {
        pipeline.del(this.getSessionKey(id));
      }
      pipeline.del(userSessionsKey);
      await pipeline.exec();
    } else {
      await redisClient.del(userSessionsKey);
    }
  }
}

export const sessionRepository = new SessionRepository();
