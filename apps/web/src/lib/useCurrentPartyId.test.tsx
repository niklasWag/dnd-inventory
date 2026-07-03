import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { useCurrentPartyId, useCurrentPartyIdOrNull } from './useCurrentPartyId';

/**
 * RH4.1 — useCurrentPartyId / useCurrentPartyIdOrNull tests.
 *
 * Renders a fake child inside a MemoryRouter to exercise the hook
 * under the same conditions the app would (route matches vs doesn't).
 */

function PartyIdDisplay(): React.ReactElement {
  const partyId = useCurrentPartyId();
  return <span data-testid="party-id">{partyId}</span>;
}

function PartyIdNullableDisplay(): React.ReactElement {
  const partyId = useCurrentPartyIdOrNull();
  return <span data-testid="party-id">{partyId ?? 'null'}</span>;
}

describe('useCurrentPartyId — RH4.1', () => {
  it('returns the :partyId from useParams when mounted under a matching route', () => {
    const { getByTestId } = render(
      <MemoryRouter initialEntries={['/party/abc-123/settings']}>
        <Routes>
          <Route path="/party/:partyId/settings" element={<PartyIdDisplay />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(getByTestId('party-id').textContent).toBe('abc-123');
  });

  it('throws when mounted outside the /party/:partyId/* subtree', () => {
    // Suppress the React error-boundary noise for this negative-path test.
    const consoleError = console.error;
    console.error = () => {};
    try {
      expect(() =>
        render(
          <MemoryRouter initialEntries={['/hub']}>
            <Routes>
              <Route path="/hub" element={<PartyIdDisplay />} />
            </Routes>
          </MemoryRouter>,
        ),
      ).toThrow(/useCurrentPartyId: no :partyId in route params/);
    } finally {
      console.error = consoleError;
    }
  });
});

describe('useCurrentPartyIdOrNull — RH4.1', () => {
  it('returns the :partyId when present', () => {
    const { getByTestId } = render(
      <MemoryRouter initialEntries={['/party/abc-123/settings']}>
        <Routes>
          <Route path="/party/:partyId/settings" element={<PartyIdNullableDisplay />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(getByTestId('party-id').textContent).toBe('abc-123');
  });

  it('returns null when mounted outside the /party/:partyId/* subtree', () => {
    const { getByTestId } = render(
      <MemoryRouter initialEntries={['/hub']}>
        <Routes>
          <Route path="/hub" element={<PartyIdNullableDisplay />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(getByTestId('party-id').textContent).toBe('null');
  });
});
