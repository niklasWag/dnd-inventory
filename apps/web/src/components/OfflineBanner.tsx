import { type ReactElement, useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { WifiOff } from 'lucide-react';

import { isServerMode } from '@/lib/serverMode';
import { useStore } from '@/store';

/**
 * R4.4.d — offline banner for multi-member parties per OUTLINE §9.
 *
 * Renders a persistent alert bar when all three conditions hold:
 *   - Server mode (build-time `VITE_SERVER_URL` is set)
 *   - Browser is offline (`navigator.onLine === false`)
 *   - Party has 2+ distinct active members
 *
 * Solo parties are excluded per §9: "party-of-one works offline
 * indefinitely; uses local cache; syncs to server on next connection."
 * A banner in that mode would be misleading noise.
 *
 * Local mode never renders the banner — there is no network, no sync,
 * and offline is the normal state.
 *
 * Write-blocking (§9: "block writes; auto-resume on reconnect") ships
 * with M5's realtime layer. R4.4.d is banner-only — the sync queue
 * already handles fetch errors gracefully (keeps optimistic state,
 * surfaces a toast per queue.ts:275).
 */
export function OfflineBanner(): ReactElement | null {
  const isOnline = useOnline();
  const memberCount = useStore(
    useShallow((s) => {
      if (s.appState === null) return 0;
      return new Set(s.appState.memberships.filter((m) => m.leftAt === null).map((m) => m.userId))
        .size;
    }),
  );

  if (!isServerMode) return null;
  if (isOnline) return null;
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
        <span>changes may not sync until you reconnect.</span>
      </div>
    </div>
  );
}

/**
 * Subscribe to `navigator.onLine` + `online` / `offline` window events.
 * Returns the current online state; re-renders when it flips.
 */
function useOnline(): boolean {
  const [isOnline, setIsOnline] = useState<boolean>(() => navigator.onLine);
  useEffect(() => {
    function onOnline(): void {
      setIsOnline(true);
    }
    function onOffline(): void {
      setIsOnline(false);
    }
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);
  return isOnline;
}
