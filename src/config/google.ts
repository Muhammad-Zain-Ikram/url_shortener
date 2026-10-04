import { OAuth2Client } from 'google-auth-library';

const clientId = process.env.GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
const redirectUri = process.env.GOOGLE_REDIRECT_URI || `${process.env.APP_URL || 'http://localhost:3000'}/auth/google/callback`;

if (!clientId || !clientSecret) {
  console.warn('GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET not set in environment variables.');
}

export const googleOAuthClient = new OAuth2Client(
  clientId,
  clientSecret,
  redirectUri
);
