import type { ReactElement } from 'react';
import { RouterProvider } from 'react-router-dom';

import { Toaster } from '@/components/ui/sonner';
import { router } from '@/router';

/**
 * Top-level app — hands off to the data router and mounts the global
 * `<Toaster />` as a sibling so toasts survive route transitions without
 * remounting. Toast UX shipped in M2.5 (Item Detail "saved" confirmation).
 */
export function App(): ReactElement {
  return (
    <>
      <RouterProvider router={router} />
      <Toaster richColors closeButton position="top-right" />
    </>
  );
}
