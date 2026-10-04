import cron from 'node-cron';
import { userRepository } from '../repositories/user.repository.js';

/**
 * Scheduled job to remove unverified user accounts from PostgreSQL after 7 days.
 * Runs daily at midnight (00:00:00).
 */
export function startCleanupCronJob(): void {
  // Cron expression: At 00:00 every day ('0 0 * * *')
  cron.schedule('0 0 * * *', async () => {
    try {
      console.log('[Cron Job] Running scheduled cleanup of unverified users older than 7 days...');
      const deletedCount = await userRepository.deleteStaleUnverifiedUsers(7);
      console.log(`[Cron Job] Successfully removed ${deletedCount} unverified user accounts.`);
    } catch (err) {
      console.error('[Cron Job Error] Failed to clean up stale unverified users:', err);
    }
  });

  console.log('[Cron Service] Cleanup job scheduled: Stale unverified users (>7 days) will be purged daily at midnight.');
}
