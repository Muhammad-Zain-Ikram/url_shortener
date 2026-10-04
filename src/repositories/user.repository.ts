import { and, eq, lt } from 'drizzle-orm';
import { db } from '../config/db.js';
import { users, User, NewUser } from '../models/user.model.js';

export class UserRepository {
  async findByEmail(email: string): Promise<User | null> {
    const normalizedEmail = email.trim().toLowerCase();
    const result = await db.select().from(users).where(eq(users.email, normalizedEmail)).limit(1);
    return result[0] ?? null;
  }

  async findById(id: string): Promise<User | null> {
    const result = await db.select().from(users).where(eq(users.id, id)).limit(1);
    return result[0] ?? null;
  }

  async findByGoogleId(googleId: string): Promise<User | null> {
    const result = await db.select().from(users).where(eq(users.googleId, googleId)).limit(1);
    return result[0] ?? null;
  }

  async create(data: NewUser): Promise<User> {
    const normalizedData = {
      ...data,
      email: data.email.trim().toLowerCase(),
    };
    const result = await db.insert(users).values(normalizedData).returning();
    return result[0];
  }

  async updatePassword(id: string, passwordHash: string): Promise<void> {
    await db
      .update(users)
      .set({ passwordHash, updatedAt: new Date() })
      .where(eq(users.id, id));
  }

  async updateUnverifiedCredentials(
    id: string,
    passwordHash: string,
    name?: string | null
  ): Promise<User> {
    const updatePayload: Partial<NewUser> = {
      passwordHash,
      updatedAt: new Date(),
    };
    if (name !== undefined) {
      updatePayload.name = name;
    }
    const result = await db
      .update(users)
      .set(updatePayload)
      .where(eq(users.id, id))
      .returning();
    return result[0];
  }

  async markEmailVerified(id: string): Promise<void> {
    await db
      .update(users)
      .set({ isEmailVerified: true, updatedAt: new Date() })
      .where(eq(users.id, id));
  }

  async linkGoogleAccount(
    id: string,
    googleId: string,
    name?: string | null,
    avatarUrl?: string | null
  ): Promise<void> {
    const updatePayload: Partial<NewUser> = {
      googleId,
      isEmailVerified: true,
      updatedAt: new Date(),
    };
    if (name) updatePayload.name = name;
    if (avatarUrl) updatePayload.avatarUrl = avatarUrl;

    await db.update(users).set(updatePayload).where(eq(users.id, id));
  }

  /**
   * Deletes unverified user accounts where updatedAt is older than the specified days (e.g. 7 days)
   */
  async deleteStaleUnverifiedUsers(days: number = 7): Promise<number> {
    const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const result = await db
      .delete(users)
      .where(
        and(
          eq(users.isEmailVerified, false),
          lt(users.updatedAt, cutoffDate)
        )
      )
      .returning({ id: users.id });

    return result.length;
  }
}

export const userRepository = new UserRepository();
