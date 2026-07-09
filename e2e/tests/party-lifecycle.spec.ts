/**
 * R8.4.d — Party lifecycle (multi-user).
 *
 * Two players run a campaign together, driven entirely through the SPA
 * in two isolated browser contexts (separate cookie jars, like two
 * people on two laptops):
 *
 *   1. The DM signs in and creates a party with their own character.
 *   2. A player signs in, joins via the invite code, adds their
 *      character, and the DM sees them in the roster.
 *   3. The player leaves.
 *   4. The player rejoins with the same code.
 *   5. The DM removes the player.
 *
 * Because this journey covers join → leave → rejoin (soft-deleted
 * membership rebind) and kick of a character-owning member (cascade to
 * Recovered Loot), it doubles as the living regression fence for the
 * two defects those paths produced historically — but the spec's
 * subject is the user journey, not the bug numbers.
 */
import { test } from '@playwright/test';

import { purgeMailpitInbox } from '../fixtures/mailpit';
import { expectOnHub, loginViaOtp } from '../steps/auth.steps';
import { createPartyWithCharacter, joinPartyByCode } from '../steps/hub.steps';
import {
  createCharacterFromSettings,
  expectMemberVisible,
  expectOnPartySettings,
  kickMember,
  leaveParty,
  readInviteCode,
} from '../steps/partySettings.steps';

test.beforeEach(async ({ request }) => {
  await purgeMailpitInbox(request);
});

test('two players form a party, one leaves, rejoins, and is removed by the DM', async ({
  browser,
  request,
}) => {
  const stamp = Date.now();
  const dmEmail = `dm-${stamp}@e2e.local`;
  const playerEmail = `player-${stamp}@e2e.local`;

  const dmContext = await browser.newContext();
  const playerContext = await browser.newContext();
  const dm = await dmContext.newPage();
  const player = await playerContext.newPage();

  try {
    // The DM signs in and creates a party with their character.
    await loginViaOtp(dm, request, dmEmail, 'The DM');
    await expectOnHub(dm);
    const partyId = await createPartyWithCharacter(dm, 'The Adventurers', {
      name: 'Aldric',
      species: 'Human',
      class: 'Paladin',
    });
    const inviteCode = await readInviteCode(dm, partyId);

    // A player signs in and joins with the invite code, then adds their
    // own character.
    await loginViaOtp(player, request, playerEmail, 'The Player');
    await expectOnHub(player);
    await joinPartyByCode(player, partyId, inviteCode);
    await createCharacterFromSettings(player, {
      name: 'Brynn',
      species: 'Elf',
      class: 'Ranger',
    });

    // The DM sees the new member in the roster.
    await expectMemberVisible(dm, partyId, 'Brynn');

    // The player leaves, then rejoins with the same code.
    await leaveParty(player, partyId);
    await expectOnHub(player);
    await joinPartyByCode(player, partyId, inviteCode);
    await expectOnPartySettings(player, partyId);

    // The DM removes the player.
    await kickMember(dm, partyId, 'The Player');
  } finally {
    await dmContext.close();
    await playerContext.close();
  }
});
