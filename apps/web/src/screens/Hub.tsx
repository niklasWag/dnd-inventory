import { useEffect, useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { UserPlus, Users, Link as LinkIcon } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { toast } from 'sonner';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { CharacterForm, type CharacterFormOutput } from '@/components/CharacterForm';
import { setCurrentPartyId } from '@/db/meta';
import { ApiError, listParties } from '@/lib/api';
import { isServerMode } from '@/lib/serverMode';
import { useStore } from '@/store';
import { seedCatalogIfNeeded } from '@/store/seed';
import { pullState } from '@/sync/client';
import type { PartyListItem } from '@app/shared';

/**
 * R3.5 — Hub screen. Universal front door per OUTLINE §3.1.
 *
 * Renders existing parties (server mode → `GET /sync/parties`; local mode
 * → the single local AppState party, if any) plus three action cards:
 *
 *   - **Create solo (party-of-one)** — character form, single
 *     `create-character` dispatch.
 *   - **Create party** — same form but creates a regular party (the
 *     reducer marks `isSoloShortcut: false` based on the action). The
 *     "do you also play a character?" toggle is post-R3.5 (the reducer
 *     today always mints a character).
 *   - **Join party** — hidden in R3.5 with "Coming in R4" caption.
 *
 * Login chrome is server-mode-only. In local mode the Hub looks like a
 * front door for the local-only flow and never references auth.
 */
export function Hub(): ReactElement {
  const navigate = useNavigate();
  const localParty = useStore(
    useShallow((s) => {
      if (s.appState === null) return null;
      return { id: s.appState.party.id, name: s.appState.party.name };
    }),
  );
  const dispatch = useStore((s) => s.dispatch);

  const [serverParties, setServerParties] = useState<PartyListItem[] | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [openingPartyId, setOpeningPartyId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<'create-solo' | 'create-party' | null>(null);

  useEffect(() => {
    if (!isServerMode) {
      setServerParties(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await listParties();
        if (!cancelled) setServerParties(res.parties);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.code === 'display_name_required') {
          void navigate('/login/display-name', { replace: true });
          return;
        }
        if (err instanceof ApiError && err.code === 'unauthenticated') {
          void navigate('/login', { replace: true });
          return;
        }
        setServerError('Could not load your parties.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  /**
   * Open a server-mode party: persist the choice (so reload boots straight
   * back into it via `main.tsx`), pull its canonical AppState, hydrate
   * the store, then navigate to the user's character sheet.
   *
   * R3.5 — picks `characters[0]` from the pulled AppState. For a solo
   * party that's the user's only character; for a multi-member party
   * the server returns the party's full character list and the first
   * one is still a sensible default landing for now (a future
   * "switch character" picker is on the post-R5 roadmap).
   */
  async function openServerParty(partyId: string): Promise<void> {
    if (openingPartyId !== null) return;
    setOpeningPartyId(partyId);
    try {
      await setCurrentPartyId(partyId);
      const pulled = await pullState(partyId);
      useStore.getState().hydrate({ appState: pulled.state, log: pulled.state.log });
      const firstCharacterId = pulled.state.characters[0]?.id;
      if (firstCharacterId === undefined) {
        // A server party with zero characters is an invariant violation
        // for R3.5 (the Hub flow always creates one on party creation).
        // Surface it instead of stranding the user on a blank screen.
        toast.error('This party has no characters yet.');
        return;
      }
      void navigate(`/character/${firstCharacterId}`);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'unauthenticated') {
        void navigate('/login', { replace: true });
        return;
      }
      if (err instanceof ApiError && err.code === 'display_name_required') {
        void navigate('/login/display-name', { replace: true });
        return;
      }
      toast.error(err instanceof Error ? err.message : 'Could not open this party.');
    } finally {
      setOpeningPartyId(null);
    }
  }

  function handleCreateSubmit(values: CharacterFormOutput): void {
    try {
      dispatch({ type: 'create-character', payload: values });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not create character');
      return;
    }
    // Local mode dispatch is synchronous against the reducer; server
    // mode goes through the queue (R3.5 Phase 4 wires this — see
    // `apps/web/src/sync/queue.ts`). Either way we now have a local
    // character id in the store.
    seedCatalogIfNeeded();
    const id = useStore.getState().appState?.characters[0]?.id;
    if (id !== undefined) {
      void navigate(`/character/${id}`, { replace: true });
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8 py-10">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">Your parties</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose a party to open, or start something new.
        </p>
      </header>

      <ExistingParties
        localParty={localParty}
        serverParties={serverParties}
        serverError={serverError}
        openingPartyId={openingPartyId}
        onOpenServer={(id) => {
          void openServerParty(id);
        }}
        onOpenLocal={(id) => {
          void navigate(`/character/${id}`);
        }}
      />

      <section aria-label="New party">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Start something new
        </h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <ActionCard
            icon={<UserPlus className="h-5 w-5" />}
            title="Solo"
            description="Start a party-of-one — just you and your character."
            onClick={() => setDialog('create-solo')}
          />
          <ActionCard
            icon={<Users className="h-5 w-5" />}
            title="Create party"
            description="Start a party others can join later."
            onClick={() => setDialog('create-party')}
          />
          <ActionCard
            icon={<LinkIcon className="h-5 w-5" />}
            title="Join party"
            description="Coming in a future release."
            disabled
          />
        </div>
      </section>

      <Dialog open={dialog !== null} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {dialog === 'create-solo' ? 'Create a solo party' : 'Create a party'}
            </DialogTitle>
            <DialogDescription>
              Enter your character&apos;s basics. You can change everything except size and species
              later.
            </DialogDescription>
          </DialogHeader>
          <CharacterForm
            onSubmit={(values) => {
              handleCreateSubmit(values);
              setDialog(null);
            }}
            onCancel={() => setDialog(null)}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface ExistingPartiesProps {
  localParty: { id: string; name: string } | null;
  serverParties: PartyListItem[] | null;
  serverError: string | null;
  /** Non-null while a server-mode party is being opened. */
  openingPartyId: string | null;
  /** Server-mode click — receives the party id and owns the pull+navigate. */
  onOpenServer: (partyId: string) => void;
  /** Local-mode click — receives the (only) local character id. */
  onOpenLocal: (characterId: string) => void;
}

function ExistingParties({
  localParty,
  serverParties,
  serverError,
  openingPartyId,
  onOpenServer,
  onOpenLocal,
}: ExistingPartiesProps): ReactElement | null {
  const characterId = useStore(
    useShallow((s) => (s.appState ? (s.appState.characters[0]?.id ?? null) : null)),
  );

  // Server mode: render the server's parties list. Local fallback:
  // render whatever's in the local AppState.
  if (isServerMode) {
    if (serverError !== null) {
      return (
        <section aria-label="Existing parties">
          <p className="text-sm text-destructive">{serverError}</p>
        </section>
      );
    }
    if (serverParties === null) {
      return (
        <section aria-label="Existing parties" className="text-sm text-muted-foreground">
          Loading…
        </section>
      );
    }
    if (serverParties.length === 0) return null;
    return (
      <section aria-label="Existing parties" className="space-y-2">
        {serverParties.map((p) => {
          const isOpening = openingPartyId === p.id;
          const anyOpening = openingPartyId !== null;
          return (
            <button
              type="button"
              key={p.id}
              disabled={anyOpening}
              className="flex w-full items-center justify-between rounded-md border bg-card px-4 py-3 text-left transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
              onClick={() => onOpenServer(p.id)}
            >
              <div>
                <p className="font-medium">{p.name}</p>
                <p className="text-xs text-muted-foreground">
                  {p.roles.join(' + ')} • {p.memberCount} member{p.memberCount === 1 ? '' : 's'}
                </p>
              </div>
              {isOpening ? (
                <span className="text-xs text-muted-foreground">Opening…</span>
              ) : p.lastActivityAt !== null ? (
                <span className="text-xs text-muted-foreground">
                  {new Date(p.lastActivityAt).toLocaleDateString()}
                </span>
              ) : null}
            </button>
          );
        })}
      </section>
    );
  }

  // Local mode: a single local party may exist.
  if (localParty === null) return null;
  return (
    <section aria-label="Existing parties" className="space-y-2">
      <button
        type="button"
        className="flex w-full items-center justify-between rounded-md border bg-card px-4 py-3 text-left hover:bg-accent"
        onClick={() => {
          if (characterId !== null) onOpenLocal(characterId);
        }}
      >
        <div>
          <p className="font-medium">{localParty.name}</p>
          <p className="text-xs text-muted-foreground">Local party</p>
        </div>
      </button>
    </section>
  );
}

interface ActionCardProps {
  icon: ReactElement;
  title: string;
  description: string;
  onClick?: () => void;
  disabled?: boolean;
}

function ActionCard({
  icon,
  title,
  description,
  onClick,
  disabled,
}: ActionCardProps): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex flex-col gap-2 rounded-md border bg-card p-4 text-left transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
    >
      <div className="flex items-center gap-2 text-sm font-semibold">
        {icon}
        {title}
      </div>
      <p className="text-xs text-muted-foreground">{description}</p>
    </button>
  );
}
