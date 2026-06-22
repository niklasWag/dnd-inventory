import { useState, type ReactElement } from 'react';

import { Layout } from '@/components/Layout';
import { Welcome } from '@/screens/Welcome';
import { Settings } from '@/screens/Settings';
import { wipeAll } from '@/db/wipe';
import type { Route } from '@/router/route';

export function App(): ReactElement {
  const [route, setRoute] = useState<Route>('welcome');

  async function handleWipe(): Promise<void> {
    await wipeAll();
  }

  return (
    <Layout route={route} onNavigate={setRoute}>
      {route === 'welcome' && <Welcome onNavigate={setRoute} />}
      {route === 'settings' && <Settings onWipe={handleWipe} />}
    </Layout>
  );
}
