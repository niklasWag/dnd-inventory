/**
 * R8.4.d — Hub steps (grouped by the Hub module).
 *
 * Create-party (with the DM's own character) and join-party user
 * actions, wrapped in `test.step()`. Each returns after the SPA has
 * navigated to the resulting screen so the caller can assert on it.
 */
import { expect, test, type Page } from '@playwright/test';

import { CharacterFormPage, type CharacterInput } from '../pages/characterForm.page';
import { HubPage } from '../pages/hub.page';

/**
 * Create a party where the creator also plays a character. Walks the
 * 3-step wizard (name → "yes, play a character" → character form) and
 * returns the new party's id, extracted from the resulting character-
 * sheet URL.
 */
export async function createPartyWithCharacter(
  page: Page,
  partyName: string,
  character: CharacterInput,
): Promise<string> {
  return test.step(`create party "${partyName}" with character "${character.name}"`, async () => {
    const hub = new HubPage(page);
    await hub.startCreatePartyWizard(partyName);
    await hub.yesCreateCharacterButton.click();

    await new CharacterFormPage(page).fillAndSubmit(character);

    // Lands on the creator's character sheet inside the new party.
    await expect(page).toHaveURL(/\/party\/[^/]+\/character\/[^/]+$/);
    const partyId = /\/party\/([^/]+)\//.exec(page.url())?.[1];
    expect(partyId, 'could not extract partyId from character-sheet URL').toBeTruthy();
    return partyId!;
  });
}

/**
 * Redeem an invite code from the Hub's join dialog. The joiner has no
 * character yet, so the SPA lands them on Party Settings (the "create
 * your character" CTA).
 */
export async function joinPartyByCode(page: Page, partyId: string, code: string): Promise<void> {
  await test.step(`join party via invite code`, async () => {
    const hub = new HubPage(page);
    await hub.openJoinDialog();
    await hub.submitInviteCode(code);
    await expect(page).toHaveURL(new RegExp(`/party/${partyId}/settings$`));
  });
}
