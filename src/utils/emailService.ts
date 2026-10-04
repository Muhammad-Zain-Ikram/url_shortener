import { resend } from '../config/resend.js';

const appUrl = process.env.APP_URL || 'http://localhost:3000';
const emailFrom = process.env.EMAIL_FROM || 'onboarding@resend.dev';

interface EmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Base email layout wrapper with modern, clean styling
 */
function wrapEmailHtml(title: string, bodyContent: string): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f4f5f7; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f5f7; padding: 40px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 560px; background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05); overflow: hidden; border: 1px solid #e2e8f0;">
          <tr>
            <td style="padding: 32px 40px 24px 40px; background-color: #0f172a; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 700; letter-spacing: -0.5px;">URL Shortener</h1>
            </td>
          </tr>
          <tr>
            <td style="padding: 40px;">
              ${bodyContent}
              <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 32px 0 24px 0;" />
              <p style="margin: 0; font-size: 13px; color: #64748b; line-height: 1.5;">
                If you did not request this email, you can safely ignore it. Your account remains secure.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding: 20px 40px; background-color: #f8fafc; text-align: center; font-size: 12px; color: #94a3b8; border-top: 1px solid #e2e8f0;">
              &copy; ${new Date().getFullYear()} URL Shortener. All rights reserved.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

/**
 * 1. Email Verification / Magic Link
 */
export async function sendVerificationEmail(email: string, token: string): Promise<EmailResult> {
  const verificationUrl = `${appUrl}/auth/verify-email?token=${token}`;
  const title = 'Verify Your Email Address';

  const bodyContent = `
    <h2 style="margin: 0 0 16px 0; font-size: 20px; font-weight: 600; color: #0f172a;">Verify Your Email</h2>
    <p style="margin: 0 0 24px 0; font-size: 15px; line-height: 1.6; color: #334155;">
      Welcome to URL Shortener! Please confirm your email address or use this link to sign in directly.
    </p>
    <div style="text-align: center; margin: 32px 0;">
      <a href="${verificationUrl}" style="background-color: #2563eb; color: #ffffff; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-weight: 600; font-size: 15px; display: inline-block;">
        Verify Email & Sign In
      </a>
    </div>
    <p style="margin: 24px 0 0 0; font-size: 13px; color: #64748b; line-height: 1.5;">
      This link will expire in <strong>24 hours</strong>. If the button above does not work, copy and paste this link into your browser:
      <br />
      <a href="${verificationUrl}" style="color: #2563eb; word-break: break-all;">${verificationUrl}</a>
    </p>
  `;

  return sendEmail({
    to: email,
    subject: 'Confirm your email address - URL Shortener',
    html: wrapEmailHtml(title, bodyContent),
  });
}

/**
 * 2. Password Reset Request
 */
export async function sendPasswordResetEmail(email: string, token: string): Promise<EmailResult> {
  const resetUrl = `${appUrl}/auth/reset-password?token=${token}`;
  const title = 'Reset Your Password';

  const bodyContent = `
    <h2 style="margin: 0 0 16px 0; font-size: 20px; font-weight: 600; color: #0f172a;">Password Reset Request</h2>
    <p style="margin: 0 0 24px 0; font-size: 15px; line-height: 1.6; color: #334155;">
      We received a request to reset the password for your account. Click the button below to choose a new password.
    </p>
    <div style="text-align: center; margin: 32px 0;">
      <a href="${resetUrl}" style="background-color: #dc2626; color: #ffffff; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-weight: 600; font-size: 15px; display: inline-block;">
        Reset My Password
      </a>
    </div>
    <p style="margin: 24px 0 0 0; font-size: 13px; color: #64748b; line-height: 1.5;">
      For security reasons, this link expires in <strong>20 minutes</strong>. If you did not make this request, please review your account.
      <br />
      <a href="${resetUrl}" style="color: #dc2626; word-break: break-all;">${resetUrl}</a>
    </p>
  `;

  return sendEmail({
    to: email,
    subject: 'Password Reset Request - URL Shortener',
    html: wrapEmailHtml(title, bodyContent),
  });
}

/**
 * 3. Set Password for Google-Authenticated Users
 */
export async function sendSetPasswordEmail(email: string, token: string): Promise<EmailResult> {
  const setPasswordUrl = `${appUrl}/auth/set-password?token=${token}`;
  const title = 'Set a Password for Your Account';

  const bodyContent = `
    <h2 style="margin: 0 0 16px 0; font-size: 20px; font-weight: 600; color: #0f172a;">Set Up Account Password</h2>
    <p style="margin: 0 0 24px 0; font-size: 15px; line-height: 1.6; color: #334155;">
      You currently sign in using your Google account. You requested to add a password so you can also log in with email and password.
    </p>
    <div style="text-align: center; margin: 32px 0;">
      <a href="${setPasswordUrl}" style="background-color: #059669; color: #ffffff; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-weight: 600; font-size: 15px; display: inline-block;">
        Set My Password
      </a>
    </div>
    <p style="margin: 24px 0 0 0; font-size: 13px; color: #64748b; line-height: 1.5;">
      This security link expires in <strong>15 minutes</strong>. After setting your password, you will be able to log in with either Google or your email and password.
      <br />
      <a href="${setPasswordUrl}" style="color: #059669; word-break: break-all;">${setPasswordUrl}</a>
    </p>
  `;

  return sendEmail({
    to: email,
    subject: 'Set up password for your account - URL Shortener',
    html: wrapEmailHtml(title, bodyContent),
  });
}

/**
 * Low-level dispatch function with fallback to console logging in development
 */
async function sendEmail({
  to,
  subject,
  html,
}: {
  to: string;
  subject: string;
  html: string;
}): Promise<EmailResult> {
  try {
    if (!process.env.RESEND_API_KEY || process.env.RESEND_API_KEY === 're_placeholder') {
      console.log(`[Email Dispatch Simulation - No RESEND_API_KEY set]`);
      console.log(`To: ${to}`);
      console.log(`Subject: ${subject}`);
      return { success: true, messageId: 'simulated_dev_id' };
    }

    const { data, error } = await resend.emails.send({
      from: emailFrom,
      to,
      subject,
      html,
    });

    if (error) {
      console.error('Failed to send email via Resend:', error);
      return { success: false, error: error.message };
    }

    return { success: true, messageId: data?.id };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown email dispatch error';
    console.error('Email dispatch exception:', errorMsg);
    return { success: false, error: errorMsg };
  }
}
