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
import { ApiError, listParties } from '@/lib/api';
import { isServerMode } from '@/lib/serverMode';
import { useStore } from '@/store';
import { seedCatalogIfNeeded } from '@/store/seed';
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
        onOpen={(id) => {
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
  onOpen: (characterId: string) => void;
}

function ExistingParties({
  localParty,
  serverParties,
  serverError,
  onOpen,
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
        {serverParties.map((p) => (
          <button
            type="button"
            key={p.id}
            className="flex w-full items-center justify-between rounded-md border bg-card px-4 py-3 text-left hover:bg-accent"
            onClick={() => {
              // R3.5: we don't know the user's character id without pulling
              // the full AppState; navigate to a per-party hub stub. Phase 4
              // wires the pull-then-navigate path. For now, attempt the
              // generic character navigation only if local store has one
              // matching this party.
              if (characterId !== null) onOpen(characterId);
            }}
          >
            <div>
              <p className="font-medium">{p.name}</p>
              <p className="text-xs text-muted-foreground">
                {p.roles.join(' + ')} • {p.memberCount} member{p.memberCount === 1 ? '' : 's'}
              </p>
            </div>
            {p.lastActivityAt !== null ? (
              <span className="text-xs text-muted-foreground">
                {new Date(p.lastActivityAt).toLocaleDateString()}
              </span>
            ) : null}
          </button>
        ))}
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
          if (characterId !== null) onOpen(characterId);
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
