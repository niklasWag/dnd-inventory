import { useState, type ReactElement } from 'react';
import { Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

// Build-time injected by Vite via the env variable in vite.config (defaults from package.json version).
const APP_VERSION = '0.0.0';

interface SettingsProps {
  onWipe: () => Promise<void> | void;
}

/**
 * MVP §7 screen 9 (Settings): app version, wipe data (with confirm).
 * Export/Import and Character/Party rename land in later milestones.
 */
export function Settings({ onWipe }: SettingsProps): ReactElement {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [wiping, setWiping] = useState(false);

  async function handleConfirmWipe(): Promise<void> {
    setWiping(true);
    try {
      await onWipe();
      setConfirmOpen(false);
    } finally {
      setWiping(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <header>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-sm text-muted-foreground">App version {APP_VERSION}</p>
      </header>

      <section className="space-y-3 rounded-lg border border-border p-4">
        <div>
          <h2 className="font-semibold">Wipe data</h2>
          <p className="text-sm text-muted-foreground">
            Erase all locally stored data. This cannot be undone.
          </p>
        </div>
        <Button variant="destructive" onClick={() => setConfirmOpen(true)}>
          <Trash2 className="h-4 w-4" />
          Wipe all data
        </Button>
      </section>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Wipe all data?</DialogTitle>
            <DialogDescription>
              This will permanently erase your local app state. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={wiping}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                void handleConfirmWipe();
              }}
              disabled={wiping}
            >
              {wiping ? 'Wiping…' : 'Wipe'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
