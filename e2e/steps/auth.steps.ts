/**
 * R8.4.d — Auth steps (grouped by the auth/login module).
 *
 * Descriptive user actions + verifications, each wrapped in
 * `test.step()` so the HTML report shows a labelled tree. Steps call
 * the page objects and assert with web-first `expect(...)`. The one
 * non-UI touch (reading the OTP from mailpit) delegates to the mailpit
 * fixture.
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

import { readOtpFromMailpit } from '../fixtures/mailpit';
import { HubPage } from '../pages/hub.page';
import { LoginPage } from '../pages/login.page';

/**
 * Drive the full SPA email-OTP login for a fresh user and leave the
 * page on `/hub`. New users hit the display-name onboarding step first.
 */
export async function loginViaOtp(
  page: Page,
  request: APIRequestContext,
  email: string,
  displayName: string,
): Promise<void> {
  await test.step(`log in as "${displayName}" via email OTP`, async () => {
    const login = new LoginPage(page);

    await login.goto();
    await login.chooseEmailMethod();
    await expect(page).toHaveURL(/\/login\/email$/);

    await login.submitEmail(email);
    await expect(page).toHaveURL(/\/login\/email\/verify/);

    const otp = await readOtpFromMailpit(request, email);
    await login.submitOtp(otp);

    // New user → display-name onboarding before Hub.
    await expect(page).toHaveURL(/\/login\/display-name$/);
    await login.submitDisplayName(displayName);

    await expect(page).toHaveURL(/\/hub$/);
  });
}

/** Verify the user is on the Hub (party picker). */
export async function expectOnHub(page: Page): Promise<void> {
  await test.step('I see the Hub', async () => {
    await expect(page).toHaveURL(/\/hub$/);
    await expect(new HubPage(page).heading).toBeVisible();
  });
}
