/**
 * R8.4.d — Mailpit inbox helpers (test infrastructure, not a user step).
 *
 * The e2e stack routes all outgoing mail to a mailpit sink. These
 * helpers let a spec read the OTP the SPA triggered and clear the inbox
 * between runs. They talk to mailpit's HTTP API directly over the
 * compose network — they are NOT user actions, so they live in
 * fixtures rather than steps.
 */
import type { APIRequestContext } from '@playwright/test';

const MAILPIT_URL = process.env.E2E_MAILPIT_URL ?? 'http://localhost:8025';

const OTP_POLL_INTERVAL_MS = 500;
const OTP_POLL_TIMEOUT_MS = 15_000;

interface MailpitMessagesResponse {
  messages?: Array<{
    ID: string;
    To?: Array<{ Address?: string }>;
  }>;
}

interface MailpitMessage {
  Text?: string;
  HTML?: string;
}

/**
 * Poll mailpit until a message addressed to `email` arrives, then
 * extract the 8-digit OTP from the message body. The SPA is expected
 * to have already triggered the send (the user clicked "Send code");
 * this only READS the delivered message.
 */
export async function readOtpFromMailpit(
  request: APIRequestContext,
  email: string,
): Promise<string> {
  const deadline = Date.now() + OTP_POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const listRes = await request.get(`${MAILPIT_URL}/api/v1/messages`);
    if (listRes.ok()) {
      const body = (await listRes.json()) as MailpitMessagesResponse;
      const messages = body.messages ?? [];
      const match = messages.find((m) => m.To?.some((t) => t.Address === email));
      if (match) {
        const detailRes = await request.get(`${MAILPIT_URL}/api/v1/message/${match.ID}`);
        if (detailRes.ok()) {
          const detail = (await detailRes.json()) as MailpitMessage;
          const haystack = detail.Text ?? detail.HTML ?? '';
          const otp = /\b(\d{8})\b/.exec(haystack)?.[1];
          if (otp !== undefined) return otp;
        }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, OTP_POLL_INTERVAL_MS));
  }

  throw new Error(`OTP not delivered to ${email} within ${OTP_POLL_TIMEOUT_MS}ms`);
}

/**
 * Purge every message in the mailpit inbox. Call from `beforeEach` on
 * any spec that reads OTPs so a message from an earlier test doesn't
 * mask the one the current test is waiting for.
 */
export async function purgeMailpitInbox(request: APIRequestContext): Promise<void> {
  const res = await request.delete(`${MAILPIT_URL}/api/v1/messages`);
  if (!res.ok()) {
    throw new Error(`mailpit purge failed: ${res.status()} ${await res.text()}`);
  }
}
