import { useState, type ReactElement } from 'react';
import { Navigate } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { Boxes, Scale } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { AddItemModal } from '@/components/stash/AddItemModal';
import { CurrencyRow, type BankerContext } from '@/components/stash/CurrencyRow';
import { InventoryPanel } from '@/components/stash/InventoryPanel';
import { useStore } from '@/store';

/**
 * Party Stash + Recovered Loot (R9.5).
 *
 * Party-wide shared-pool screens reached from the sidebar at
 * `/party/:partyId/party-stash` and `/party/:partyId/recovered-loot`.
 * They replace the R9.3 `StashPlaceholder` and the pre-R9.3 Character-Sheet
 * "Party Stash" / "Recovered Loot" tabs. Both reuse the shared
 * `CurrencyRow` (with Banker context) + `InventoryPanel` (no `characterId`
 * → no equip/attune), matching the Inventory / Storage screens.
 *
 * R4.2.e banker context (rebuilt from the pre-R9.3 CharacterSheet selector):
 * banker is derived from `Party.bankerUserId` (never a membership row);
 * §3.14 bars the DM from being the Banker so the two flags are mutually
 * exclusive. Only Party Stash gets the Split-Evenly affordance (R4.2.d).
 * When a Banker is active, non-Banker/non-DM users are gated from the pool
 * (view-only currency); players still claim ITEMS via the row Move action
 * (the reducer enforces §8.1 server-side).
 */

interface SharedPoolScreenProps {
  scope: 'party' | 'recovered-loot';
  title: string;
  icon: ReactElement;
}

function SharedPoolScreen({ scope, title, icon }: SharedPoolScreenProps): ReactElement {
  const view = useStore(
    useShallow((s) => {
      const app = s.appState;
      if (app === null) return null;
      const stash =
        scope === 'party'
          ? app.stashes.find((st) => st.scope === 'party')
          : app.stashes.find((st) => st.id === app.party.recoveredLootStashId);
      if (stash === undefined) return null;

      // R4.2.e — resolve Banker + DM context up-front (OUTLINE §3.14).
      const myUserId = app.user.id;
      const bankerActive = app.party.bankerUserId !== null;
      const userIsBanker = bankerActive && app.party.bankerUserId === myUserId;
      const userIsDm = app.memberships.some(
        (m) => m.userId === myUserId && m.role === 'dm' && m.leftAt === null,
      );
      return { stashId: stash.id, bankerActive, userIsBanker, userIsDm };
    }),
  );

  const [adding, setAdding] = useState(false);

  if (view === null) return <Navigate to="/" replace />;
  const { stashId, bankerActive, userIsBanker, userIsDm } = view;

  // R4.2.e — CurrencyRow banker context. Split Evenly is Party-Stash-only
  // (R4.2.d). DM-with-Banker gets the Drain affordance + hidden withdraw;
  // a non-Banker/non-DM user is gated (view-only) while a Banker is active.
  const bankerContext: BankerContext = {
    userIsBanker,
    userIsDmWithBankerActive: bankerActive && userIsDm && !userIsBanker,
    userIsGatedFromPool: bankerActive && !userIsBanker && !userIsDm,
    isPartyStash: scope === 'party',
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8">
      <header className="flex items-center gap-2">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
          {icon}
        </span>
        <h1 className="font-display text-3xl font-bold tracking-tight">{title}</h1>
      </header>

      <CurrencyRow stashId={stashId} bankerContext={bankerContext} />

      <InventoryPanel
        stashId={stashId}
        title={title}
        action={
          <Button
            type="button"
            size="sm"
            onClick={() => {
              setAdding(true);
            }}
          >
            Add item
          </Button>
        }
      />

      <AddItemModal open={adding} onOpenChange={setAdding} stashId={stashId} stashLabel={title} />
    </div>
  );
}

export function PartyStash(): ReactElement {
  return (
    <SharedPoolScreen
      scope="party"
      title="Party Stash"
      icon={<Boxes className="h-5 w-5" aria-hidden="true" />}
    />
  );
}

export function RecoveredLoot(): ReactElement {
  return (
    <SharedPoolScreen
      scope="recovered-loot"
      title="Recovered Loot"
      icon={<Scale className="h-5 w-5" aria-hidden="true" />}
    />
  );
}
