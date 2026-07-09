/**
 * R8.4.d — Party Settings page object (Playwright-idiomatic POM).
 *
 * Covers `/party/:partyId/settings`: the members list, invite code,
 * the "Create your character" CTA (joiner path), and the leave/kick
 * flows with their confirm dialogs. Locators use role/label/section
 * queries; the members-list scoping uses the section's aria-label.
 */
import type { Locator, Page } from '@playwright/test';

export class PartySettingsPage {
  readonly membersSection: Locator;
  readonly inviteCode: Locator;
  readonly createCharacterButton: Locator;
  readonly leavePartyButton: Locator;
  readonly confirmLeaveButton: Locator;
  readonly kickButton: Locator;
  readonly confirmKickButton: Locator;

  constructor(private readonly page: Page) {
    this.membersSection = page.locator('section[aria-label="Members"]');
    this.inviteCode = page.locator('section[aria-label="Invite code"] code');
    this.createCharacterButton = page.getByRole('button', { name: /create character/i });
    this.leavePartyButton = page.getByRole('button', { name: /^leave party$/i });
    this.confirmLeaveButton = page.getByRole('button', { name: /yes, leave party/i });
    this.kickButton = page.getByRole('button', { name: /^kick$/i });
    this.confirmKickButton = page.getByRole('button', { name: /yes, kick/i });
  }

  async goto(partyId: string): Promise<void> {
    await this.page.goto(`/party/${partyId}/settings`);
  }

  /** A member row located by the member's display name, scoped to the members list. */
  member(displayName: string): Locator {
    return this.membersSection.getByText(displayName);
  }

  async confirmLeave(): Promise<void> {
    await this.leavePartyButton.click();
    await this.confirmLeaveButton.click();
  }

  async confirmKick(): Promise<void> {
    await this.kickButton.click();
    await this.confirmKickButton.click();
  }
}
