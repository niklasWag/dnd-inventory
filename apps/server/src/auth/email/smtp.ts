/**
 * R3.3 — SMTP transport for the email OTP flow.
 *
 * Thin wrapper around Nodemailer so route handlers depend on the
 * `MailService` interface (testable via `vi.mock`), NOT on Nodemailer's
 * concrete types. Same pattern as `discord-mock.ts` for tests.
 *
 * `buildMailService(env)` MUST only be called after `isEmailAuthEnabled(env)`
 * returns true — otherwise the `!`-asserted env fields below would be
 * undefined. The route layer enforces this gating; the function itself
 * crashes hard (`Cannot read properties of undefined`) on misuse rather
 * than silently degrading.
 */
import nodemailer, { type Transporter } from 'nodemailer';

import type { Env } from '../../config/env.js';

import { renderOtpEmail } from './templates/otp.js';

export interface MailService {
  /**
   * Send the OTP email to the given address. Resolves when the SMTP
   * server has accepted the message; rejects on connection failure or
   * SMTP-side rejection. Route handlers await this in the OTP request
   * flow so the constant-time bound holds (see SECURITY §1.2).
   */
  sendOtp(to: string, code: string): Promise<void>;
}

export function buildMailService(env: Env): MailService {
  // All five env fields are guaranteed by the caller-side
  // isEmailAuthEnabled check; the bangs are documented contractually.
  const port = env.SMTP_PORT!;
  const transport: Transporter = nodemailer.createTransport({
    host: env.SMTP_HOST!,
    port,
    // Port 465 is implicit-TLS SMTP submission; everything else (587
    // STARTTLS, 25 plain) starts on plaintext and upgrades via STARTTLS
    // if the server advertises it. Nodemailer handles this when
    // `secure` is correctly set.
    secure: port === 465,
    auth: { user: env.SMTP_USER!, pass: env.SMTP_PASS! },
  });

  return {
    async sendOtp(to, code) {
      const { subject, text, html } = renderOtpEmail(code);
      await transport.sendMail({
        from: env.SMTP_FROM!,
        to,
        subject,
        text,
        html,
      });
    },
  };
}
