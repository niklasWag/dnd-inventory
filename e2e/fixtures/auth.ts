/**
 * R8.4.d.i — Auth helper fixtures for E2E specs.
 *
 * `seedUserAndSession` bypasses the OTP round-trip via the test-mode
 * routes (`apps/server/src/test-mode/routes.ts`), which are only mounted
 * when the server has `E2E_TEST_MODE=true` — set by the compose file.
 *
 * `requestOtpAndReadCode` drives the real OTP flow end-to-end through
 * mailpit, for the specs that need to exercise the auth surface itself.
 */
import type { APIRequestContext } from '@playwright/test';

const API_URL = process.env.E2E_API_URL ?? 'http://localhost:3000';
const MAILPIT_URL = process.env.E2E_MAILPIT_URL ?? 'http://localhost:8025';

const OTP_POLL_INTERVAL_MS = 500;
const OTP_POLL_TIMEOUT_MS = 15_000;

interface SeedUserResponseBody {
  userId: string;
}

/**
 * Create a user + session via the test-mode helper routes. Returns the
 * session cookie in `<name>=<value>` form suitable for the `cookie`
 * header or `context.addCookies` (parsed).
 */
export async function seedUserAndSession(
  request: APIRequestContext,
  displayName: string,
): Promise<{ userId: string; cookie: string }> {
  const seedRes = await request.post(`${API_URL}/test/seed-user`, {
    data: { displayName },
  });
  if (!seedRes.ok()) {
    throw new Error(`seed-user failed: ${seedRes.status()} ${await seedRes.text()}`);
  }
  const body = (await seedRes.json()) as SeedUserResponseBody;
  const { userId } = body;

  const sessionRes = await request.post(`${API_URL}/test/seed-session`, {
    data: { userId },
  });
  if (!sessionRes.ok()) {
    throw new Error(`seed-session failed: ${sessionRes.status()} ${await sessionRes.text()}`);
  }
  // Playwright normalizes header names to lower-case.
  const setCookie = sessionRes.headers()['set-cookie'];
  if (!setCookie) {
    throw new Error('seed-session did not return a Set-Cookie header');
  }
  // Extract the `name=value` prefix (drop path/httponly/expires
  // attributes).
  const firstPart = setCookie.split(';')[0];
  if (!firstPart) {
    throw new Error(`unexpected Set-Cookie shape: ${setCookie}`);
  }
  const cookie = firstPart.trim();
  return { userId, cookie };
}

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
 * Trigger the OTP send flow, then poll mailpit for the delivered
 * message and extract the 8-digit code. Returns the OTP string.
 *
 * Poll cadence: 500ms up to a 15s ceiling. Longer than typical CI
 * message-delivery latency but tight enough that a stuck spec fails
 * fast rather than idling to Playwright's outer timeout.
 */
export async function requestOtpAndReadCode(
  request: APIRequestContext,
  email: string,
): Promise<string> {
  const requestRes = await request.post(`${API_URL}/auth/email/request-otp`, {
    data: { email },
  });
  if (!requestRes.ok()) {
    throw new Error(`request-otp failed: ${requestRes.status()} ${await requestRes.text()}`);
  }

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
          if (otp) return otp;
        }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, OTP_POLL_INTERVAL_MS));
  }

  throw new Error(`OTP not delivered to ${email} within ${OTP_POLL_TIMEOUT_MS}ms`);
}
