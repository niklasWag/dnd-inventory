/**
 * R8.4.d — Auth flow (email OTP end-to-end).
 *
 * A new visitor signs in with an email one-time code and lands on the
 * Hub. This is the widest single reach in the suite: it exercises the
 * SMTP → Auth.js → verify-otp → session-cookie chain through the real
 * SPA. A failure here usually points at an integration seam (mail,
 * cookies, redirects) rather than a unit-level defect.
 *
 * The `loginViaOtp` step encapsulates the whole journey; the spec reads
 * as a two-line narrative.
 */
import { test } from '@playwright/test';

import { purgeMailpitInbox } from '../fixtures/mailpit';
import { expectOnHub, loginViaOtp } from '../steps/auth.steps';

test.beforeEach(async ({ request }) => {
  await purgeMailpitInbox(request);
});

test('a new visitor signs in via email OTP and lands on the Hub', async ({ page, request }) => {
  const email = `otp-user-${Date.now()}@e2e.local`;

  await loginViaOtp(page, request, email, 'OTP User');
  await expectOnHub(page);
});
