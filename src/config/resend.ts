import { Resend } from 'resend';

const resendApiKey = process.env.RESEND_API_KEY;

if (!resendApiKey) {
  console.warn('RESEND_API_KEY is not set in environment variables. Email sending may fail.');
}

export const resend = new Resend(resendApiKey || 're_placeholder');
