/**
 * R8.4.d — Hub page object (Playwright-idiomatic POM).
 *
 * Locators are `readonly` fields assigned once in the constructor;
 * action methods drive them. No assertions live here — the steps layer
 * owns web-first `expect(...)` verifications. Locators use role/label
 * queries (never XPath / CSS-by-structure) so they survive markup
 * churn.
 */
import type { Locator, Page } from '@playwright/test';

export class HubPage {
  readonly heading: Locator;
  readonly createPartyCard: Locator;
  readonly partyNameInput: Locator;
  readonly nextButton: Locator;
  readonly yesCreateCharacterButton: Locator;
  readonly joinPartyCard: Locator;
  readonly inviteCodeInput: Locator;
  readonly joinButton: Locator;

  constructor(private readonly page: Page) {
    // R9.11b — the Hub heading is mode-dependent: server mode (the e2e
    // path, where the user is signed in) shows the "Ready to play?" hero;
    // local mode shows "Your parties". Match either so the POM survives
    // both.
    this.heading = page.getByRole('heading', { name: /ready to play\?|your parties/i });
    this.createPartyCard = page.getByRole('button', { name: /create party/i });
    this.partyNameInput = page.getByLabel('Party name');
    this.nextButton = page.getByRole('button', { name: /next/i });
    this.yesCreateCharacterButton = page.getByRole('button', {
      name: /yes, create my character/i,
    });
    this.joinPartyCard = page.getByRole('button', { name: /join party/i });
    this.inviteCodeInput = page.getByLabel('Invite code');
    this.joinButton = page.getByRole('button', { name: /^join$/i });
  }

  async startCreatePartyWizard(partyName: string): Promise<void> {
    await this.createPartyCard.click();
    await this.partyNameInput.fill(partyName);
    await this.nextButton.click();
  }

  async openJoinDialog(): Promise<void> {
    await this.joinPartyCard.click();
  }

  async submitInviteCode(code: string): Promise<void> {
    await this.inviteCodeInput.fill(code);
    await this.joinButton.click();
  }
}
