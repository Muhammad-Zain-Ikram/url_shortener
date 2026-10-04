import crypto from 'node:crypto';

/**
 * Generates a 32-byte CSPRNG token (hex-encoded, 64 chars)
 */
export function generateToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Computes SHA-256 hex digest of a token
 */
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Generates a random session ID using base64url encoding
 */
export function generateSessionId(): string {
  return crypto.randomBytes(32).toString('base64url');
}
