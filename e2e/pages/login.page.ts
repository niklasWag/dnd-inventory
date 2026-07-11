/**
 * R8.4.d — Login page object (Playwright-idiomatic POM).
 *
 * Locators are `readonly` fields assigned once in the constructor;
 * action methods drive them. Covers the auth screens (`/login`,
 * `/login/email`, `/login/email/verify`, `/login/display-name`). No
 * assertions here — the steps layer owns web-first `expect(...)`.
 */
import type { Locator, Page } from '@playwright/test';

export class LoginPage {
  readonly emailMethodButton: Locator;
  readonly emailInput: Locator;
  readonly sendCodeButton: Locator;
  readonly otpInput: Locator;
  readonly verifyCodeButton: Locator;
  readonly displayNameInput: Locator;
  readonly continueButton: Locator;

  constructor(private readonly page: Page) {
    this.emailMethodButton = page.getByRole('button', { name: /sign in with email/i });
    this.emailInput = page.getByLabel('Email');
    this.sendCodeButton = page.getByRole('button', { name: /send code/i });
    this.otpInput = page.getByLabel('Code');
    this.verifyCodeButton = page.getByRole('button', { name: /verify code/i });
    this.displayNameInput = page.getByLabel('Display name');
    this.continueButton = page.getByRole('button', { name: /continue/i });
  }

  async goto(): Promise<void> {
    await this.page.goto('/login');
  }

  async chooseEmailMethod(): Promise<void> {
    await this.emailMethodButton.click();
  }

  async submitEmail(email: string): Promise<void> {
    await this.emailInput.fill(email);
    await this.sendCodeButton.click();
  }

  async submitOtp(otp: string): Promise<void> {
    await this.otpInput.fill(otp);
    await this.verifyCodeButton.click();
  }

  async submitDisplayName(displayName: string): Promise<void> {
    await this.displayNameInput.fill(displayName);
    await this.continueButton.click();
  }
}
