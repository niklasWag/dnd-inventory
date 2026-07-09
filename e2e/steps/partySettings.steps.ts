/**
 * R8.4.d — Party Settings steps (grouped by the Party Settings module).
 *
 * User actions + verifications for member management: reading the
 * invite code, a joiner creating their character, leaving, kicking, and
 * asserting who is (or isn't) in the members list. All wrapped in
 * `test.step()`; all assertions are web-first.
 */
import { expect, test, type Page } from '@playwright/test';

import { CharacterFormPage, type CharacterInput } from '../pages/characterForm.page';
import { PartySettingsPage } from '../pages/partySettings.page';

/** Open Party Settings and read the current invite code from the DOM. */
export async function readInviteCode(page: Page, partyId: string): Promise<string> {
  return test.step('read the invite code from Party Settings', async () => {
    const settings = new PartySettingsPage(page);
    await settings.goto(partyId);
    await expect(settings.inviteCode).toBeVisible();
    const code = (await settings.inviteCode.textContent())?.trim();
    expect(code, 'invite code was empty').toBeTruthy();
    return code!;
  });
}

/**
 * Joiner path: create the caller's character from the "Create your
 * character" CTA on Party Settings (they land here after joining).
 */
export async function createCharacterFromSettings(
  page: Page,
  character: CharacterInput,
): Promise<void> {
  await test.step(`create character "${character.name}" from Party Settings`, async () => {
    const settings = new PartySettingsPage(page);
    await settings.createCharacterButton.click();
    await new CharacterFormPage(page).fillAndSubmit(character);
  });
}

/** Leave the party from Party Settings; the SPA returns to the Hub. */
export async function leaveParty(page: Page, partyId: string): Promise<void> {
  await test.step('leave the party', async () => {
    const settings = new PartySettingsPage(page);
    await settings.goto(partyId);
    await settings.confirmLeave();
    await expect(page).toHaveURL(/\/hub$/);
  });
}

/** Kick a member from Party Settings (DM action). */
export async function kickMember(page: Page, partyId: string, displayName: string): Promise<void> {
  await test.step(`kick "${displayName}"`, async () => {
    const settings = new PartySettingsPage(page);
    await settings.goto(partyId);
    await expect(settings.member(displayName)).toBeVisible();
    await settings.confirmKick();
    await expect(settings.member(displayName)).toHaveCount(0);
  });
}

/** Verify a member appears in the members list (reloads to pick up server state). */
export async function expectMemberVisible(
  page: Page,
  partyId: string,
  displayName: string,
): Promise<void> {
  await test.step(`I see "${displayName}" in the members list`, async () => {
    const settings = new PartySettingsPage(page);
    await settings.goto(partyId);
    await expect(settings.member(displayName)).toBeVisible();
  });
}

/** Verify the joiner landed on Party Settings (post-join, pre-character). */
export async function expectOnPartySettings(page: Page, partyId: string): Promise<void> {
  await test.step('I see Party Settings', async () => {
    await expect(page).toHaveURL(new RegExp(`/party/${partyId}/settings$`));
  });
}
