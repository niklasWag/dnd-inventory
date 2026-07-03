import { useParams } from 'react-router-dom';

/**
 * RH4.1 — URL-scoped `partyId` reader.
 *
 * Reads `partyId` from `useParams<{ partyId: string }>()`. Throws when
 * absent — the throw is a design signal that a caller mounted this hook
 * outside the `/party/:partyId/*` subtree. Every party-scoped screen
 * lives inside that subtree post-RH4.1, so a missing param is a bug in
 * the router, not a runtime state a screen should tolerate.
 *
 * **Why a helper and not raw `useParams`.** Two reasons:
 *   1. The `useParams` return type is `{ partyId?: string | undefined }`
 *      — TypeScript can't prove the URL matched a `:partyId` route.
 *      The helper narrows to `string`.
 *   2. A single throw site is easier to grep + evolve than 15 optional-
 *      chained reads scattered across screens.
 *
 * Companion: `useCurrentPartyIdOrNull` for surfaces that mount BOTH
 * inside and outside the party subtree (Layout.tsx nav bar is the sole
 * caller today). Everyone else uses the strict throw variant.
 *
 * Prior art: this mirrors the RH2.1a `deriveActorRoleForSlice` pattern —
 * a small pure helper that centralises a derivation used across many
 * components.
 */
export function useCurrentPartyId(): string {
  const { partyId } = useParams<{ partyId: string }>();
  if (partyId === undefined || partyId === '') {
    throw new Error(
      'useCurrentPartyId: no :partyId in route params. This hook must be called from a component mounted inside the /party/:partyId/* subtree.',
    );
  }
  return partyId;
}

/**
 * RH4.1 — soft variant. Returns the URL's `:partyId` if present,
 * otherwise `null`. Used by surfaces that render both inside and
 * outside the party subtree — the nav bar in Layout.tsx being the sole
 * legitimate caller in R4. Prefer `useCurrentPartyId()` everywhere
 * else.
 */
export function useCurrentPartyIdOrNull(): string | null {
  const { partyId } = useParams<{ partyId: string }>();
  if (partyId === undefined || partyId === '') return null;
  return partyId;
}
