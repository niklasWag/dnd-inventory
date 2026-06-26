/**
 * R3.3 — In-memory MailService fixture for integration tests.
 *
 * R3.2's `discord-mock.ts` uses msw to intercept outbound HTTP — that works
 * because Auth.js's Discord calls go through `fetch()`. SMTP is not HTTP,
 * so msw can't help; the cleanest seam is the `MailService` interface
 * itself.
 *
 * Route handlers receive a `MailService` via dependency injection (passed
 * through `registerAuthRoutes`). Integration tests build a fake that
 * captures every `sendOtp` call into an in-memory array, lets the test
 * assert on what was sent, and never opens a real SMTP connection.
 *
 * Pattern mirrors `discord-mock.ts`'s shape — `setupMailerMock()` returns
 * `{ mail, reset() }` so a single fixture handles both "what got sent"
 * inspection and "wipe state between tests" lifecycle.
 *
 * The wider `vi.mock('nodemailer', ...)` approach (used in `smtp.test.ts`)
 * is reserved for tests of `smtp.ts` itself. For route-level tests we
 * never instantiate `buildMailService`; we hand the routes this mock
 * directly.
 */
import type { MailService } from '../auth/email/smtp.js';

export interface SentMail {
  to: string;
  code: string;
}

export interface MailerMock {
  /** The MailService instance to pass into `registerAuthRoutes`. */
  service: MailService;
  /** Every successful `sendOtp` call, in the order they were made. */
  sent: SentMail[];
  /** Clear the `sent` array. Call between tests. */
  reset(): void;
}

export function setupMailerMock(): MailerMock {
  const sent: SentMail[] = [];
  const service: MailService = {
    sendOtp(to, code) {
      sent.push({ to, code });
      // Declared as Promise-returning rather than `async`: no await is
      // needed in the body, and an empty async function trips
      // @typescript-eslint/require-await.
      return Promise.resolve();
    },
  };
  return {
    service,
    sent,
    reset() {
      sent.length = 0;
    },
  };
}
