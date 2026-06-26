/**
 * R3.2 — Wrap @auth/prisma-adapter to enforce SECURITY §1.1:
 *
 * > "Discord tokens are not persisted in the DB — only `discordId`,
 * > `displayName`, `avatarUrl` per §4 User."
 *
 * The adapter still creates the `Account` row (Auth.js needs it for provider
 * linkage and to surface "the user signed in via Discord" semantics to the
 * `events.signIn` callback), but the columns that would hold Discord-issued
 * credentials are written as NULL.
 *
 * This module is the SOLE place that touches token persistence. If a future
 * adapter API change introduces a new token field, audit this file and add
 * it to the strip list.
 */
import { PrismaAdapter } from '@auth/prisma-adapter';
import type { Adapter, AdapterAccount } from '@auth/core/adapters';

import type { PrismaClient } from '../../prisma/generated/prisma/client.js';

/**
 * Drop-in replacement for `PrismaAdapter(prisma)` that strips Discord
 * tokens before they hit the DB. Pass it as `adapter:` in `AuthConfig`.
 *
 * Implementation note: @auth/prisma-adapter's `Adapter` shape is widely
 * compatible (we accept any `PrismaClient` shape here). Cast on the inside
 * is contained to one line.
 */
export function makeAdapter(prisma: PrismaClient): Adapter {
  // Cast to `any` here is contained: @auth/prisma-adapter's peer-dep range
  // tops out at Prisma 5 (#TODO revisit when 7 is supported); pnpm's
  // peerDependencyRules in pnpm-workspace.yaml waives the constraint, and
  // this cast bridges the resulting type mismatch. The adapter uses only
  // stable PrismaClient methods (findUnique / create / update / delete /
  // $transaction) so the contract is safe in practice.
  const base = PrismaAdapter(prisma as Parameters<typeof PrismaAdapter>[0]);

  return {
    ...base,
    linkAccount: async (account: AdapterAccount) => {
      // Per SECURITY §1.1: never persist Discord-issued tokens. We DO
      // record provider + providerAccountId (the Discord snowflake) so
      // subsequent sign-ins resolve the same User row, and `type` so
      // the adapter's own internal queries still work.
      //
      // Why `null` and not `undefined` here:
      //   The AdapterAccount TS interface declares these fields as
      //   `T | undefined` (the JS "missing key" sentinel). But Prisma
      //   distinguishes the two on writes — `undefined` means "leave
      //   this column alone" (no-op), `null` means "write SQL NULL".
      //   We WANT SQL NULL on every linkAccount call so a re-link
      //   (e.g. on token rotation) actively wipes any value that might
      //   somehow have leaked in. Hence the deliberate `null`. The
      //   cast through `Record<string, unknown>` is what lets us
      //   write `null` against a typed-as-`T | undefined` field
      //   without TS complaining.
      const stripped = { ...account } as unknown as Record<string, unknown>;
      stripped['access_token'] = null;
      stripped['refresh_token'] = null;
      stripped['id_token'] = null;
      stripped['expires_at'] = null;
      stripped['session_state'] = null;
      if (!base.linkAccount) {
        throw new Error('makeAdapter: base PrismaAdapter is missing linkAccount');
      }
      // Auth.js's linkAccount signature returns void | Promise<void>
      // (the result isn't surfaced anywhere). We pass our stripped copy
      // through but explicitly discard the return value to satisfy
      // exactOptionalPropertyTypes.
      await base.linkAccount(stripped as unknown as AdapterAccount);
    },
  };
}
