import { type ReactElement } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { WifiOff } from 'lucide-react';

import { isServerMode } from '@/lib/serverMode';
import { activeMemberCount, useStore } from '@/store';

/**
 * R4.4.d — offline banner for multi-member parties per OUTLINE §9.
 * R5.1.d — extended message when the write-block is active + reads
 * `online` from the store instead of a component-local hook so all
 * connectivity-aware surfaces (banner, `useCanDispatch`, store's
 * `dispatch` guard) derive from a single source.
 *
 * Renders a persistent alert bar when all three conditions hold:
 *   - Server mode (build-time `VITE_SERVER_URL` is set)
 *   - Browser is offline (`store.online === false`)
 *   - Party has 2+ distinct active members
 *
 * Solo parties are excluded per §9: "party-of-one works offline
 * indefinitely; uses local cache; syncs to server on next connection."
 * A banner in that mode would be misleading noise.
 *
 * Local mode never renders the banner — there is no network, no sync,
 * and offline is the normal state.
 *
 * R5.1.d ships the write-block itself in `store.dispatch` +
 * `useCanDispatch`. This banner surfaces the reason to the user.
 */
export function OfflineBanner(): ReactElement | null {
  const { online, memberCount } = useStore(
    useShallow((s) => ({
      online: s.online,
      memberCount: activeMemberCount(s.appState),
    })),
  );

  if (!isServerMode) return null;
  if (online) return null;
  if (memberCount < 2) return null;

  return (
    <div
      role="alert"
      aria-live="polite"
      className="border-b border-destructive/40 bg-destructive/10 text-destructive"
    >
      <div className="container flex items-center gap-2 py-2 text-sm">
        <WifiOff className="h-4 w-4" aria-hidden />
        <span className="font-medium">Offline —</span>
        <span>changes are disabled until you reconnect.</span>
      </div>
    </div>
  );
}
