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
 * Field mapping: the Auth.js `AdapterUser` contract uses `name` and `image`;
 * our schema (per OUTLINE §4) uses `displayName` and `avatarUrl`. Every
 * user-touching adapter method is overridden to translate at the boundary so
 * Auth.js sees `{ name, image }` and Prisma stores `{ displayName, avatarUrl }`.
 *
 * This module is the SOLE place that touches token persistence. If a future
 * adapter API change introduces a new token field, audit this file and add
 * it to the strip list.
 */
import { PrismaAdapter } from '@auth/prisma-adapter';
import type { Adapter, AdapterAccount, AdapterUser } from '@auth/core/adapters';

import type { PrismaClient } from '../../prisma/generated/prisma/client.js';

/**
 * Shape of a User row as stored in our schema. Subset of the Prisma `User`
 * model — only the fields the adapter touches.
 */
interface DbUserRow {
  id: string;
  displayName: string;
  email: string | null;
  emailVerified: Date | null;
  avatarUrl: string | null;
  needsDisplayName?: boolean;
  discordId?: string | null;
}

function dbToAdapterUser(row: DbUserRow): AdapterUser {
  // We return BOTH the AdapterUser fields (name/image/email/emailVerified
  // — what @auth/core consumers read) AND the raw schema columns
  // (displayName/needsDisplayName/avatarUrl/discordId — what our
  // `callbacks.session` projects onto the public session payload). The
  // two field-name sets don't collide, so attaching both keeps Auth.js
  // happy while letting our callback project the schema-side values.
  return {
    id: row.id,
    name: row.displayName,
    // Preserve SQL NULL. Discord uses scope `identify` only (SECURITY §1.1),
    // so Discord-only users legitimately have no email. The public session
    // schema (`sessionUserSchema.email`) is `z.string().email().nullable()`
    // — coercing null → '' here would fail Zod email-format validation on
    // the client and trip the `/auth/session` malformed-response branch.
    email: row.email,
    emailVerified: row.emailVerified,
    image: row.avatarUrl,
    displayName: row.displayName,
    needsDisplayName: row.needsDisplayName ?? false,
    avatarUrl: row.avatarUrl,
    discordId: (row as { discordId?: string | null }).discordId ?? null,
  } as unknown as AdapterUser;
}

function adapterToDbUser(
  data: Partial<AdapterUser> & Record<string, unknown>,
): Record<string, unknown> {
  // Translate AdapterUser fields → schema columns. Auth.js's `createUser`
  // contract guarantees `email` and `emailVerified` are present (possibly
  // null); `name`/`image` are optional. Discord profile callbacks will
  // fill `name` via `events.signIn` even when it lands here empty.
  const out: Record<string, unknown> = { ...data };
  if ('name' in out) {
    out['displayName'] = out['name'] ?? '';
    delete out['name'];
  } else if (out['displayName'] === undefined) {
    // Fallback for first-time createUser without a name. The signIn event
    // overwrites this moments later for Discord; for any other flow the
    // §8.1 guard layer's needsDisplayName check gates protected routes.
    out['displayName'] = '';
  }
  if ('image' in out) {
    out['avatarUrl'] = out['image'] ?? null;
    delete out['image'];
  }
  return out;
}

/**
 * Drop-in replacement for `PrismaAdapter(prisma)` that strips Discord
 * tokens before they hit the DB AND maps the AdapterUser `name`/`image`
 * shape onto our `displayName`/`avatarUrl` columns. Pass it as
 * `adapter:` in `AuthConfig`.
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

  // Bypass base for every method that touches the User row — base would
  // send AdapterUser-shape writes against schema columns that don't exist
  // (`name` vs `displayName`, `image` vs `avatarUrl`). We mirror base's
  // behavior with the field mapping in place. A single cast captures the
  // minimal surface we need; the @prisma/client type machinery is too
  // expensive to import into this file's signatures.
  const p = prisma as unknown as {
    user: {
      create: (args: { data: Record<string, unknown> }) => Promise<DbUserRow>;
      update: (args: {
        where: { id: string };
        data: Record<string, unknown>;
      }) => Promise<DbUserRow>;
      findUnique: (args: { where: { id?: string; email?: string } }) => Promise<DbUserRow | null>;
      delete: (args: { where: { id: string } }) => Promise<DbUserRow>;
    };
    account: {
      findUnique: (args: {
        where: { provider_providerAccountId: { provider: string; providerAccountId: string } };
        include: { user: true };
      }) => Promise<{ user: DbUserRow } | null>;
    };
    session: {
      findUnique: (args: {
        where: { sessionToken: string };
        include: { user: true };
      }) => Promise<({ user: DbUserRow } & Record<string, unknown>) | null>;
    };
  };

  return {
    ...base,
    createUser: async (data) => {
      // `data.id` arrives as the provider's external user id (Auth.js
      // spreads the OAuth `profile` into createUser, and Discord's profile
      // function returns `id: <snowflake>`). The base adapter destructures
      // `id` away so Prisma can mint its own cuid. We DO need the snowflake
      // — it satisfies the `User_auth_present_check` constraint
      // (discordId IS NOT NULL OR emailVerified IS NOT NULL) at INSERT time,
      // before Auth.js's separate linkAccount + events.signIn calls fire.
      // The constraint would otherwise trip because Discord's `identify`
      // scope returns no email and Auth.js calls createUser with
      // `emailVerified: null` on the OAuth-new-user path
      // (@auth/core/lib/actions/callback/handle-login.js:259).
      //
      // Currently this app's only OAuth provider is Discord. If another
      // provider is added later, route on the provider id instead of
      // blindly assigning the snowflake to discordId.
      const { id: providerSnowflake, ...rest } = data as { id?: string } & Partial<AdapterUser>;
      const writeData: Record<string, unknown> = adapterToDbUser(rest);
      if (providerSnowflake !== undefined && writeData['discordId'] === undefined) {
        writeData['discordId'] = providerSnowflake;
        // Discord supplies a displayName via profile.global_name/username;
        // events.signIn keeps it fresh on every login. We treat the Discord
        // signup as not needing the OTP-flow display-name gate
        // (apps/server/prisma/schema.prisma:124-125).
        writeData['needsDisplayName'] = false;
      }
      const created = await p.user.create({ data: writeData });
      return dbToAdapterUser(created);
    },
    updateUser: async (data) => {
      const { id, ...rest } = data;
      const updated = await p.user.update({
        where: { id },
        data: adapterToDbUser(rest),
      });
      return dbToAdapterUser(updated);
    },
    getUser: async (id) => {
      const row = await p.user.findUnique({ where: { id } });
      return row ? dbToAdapterUser(row) : null;
    },
    getUserByEmail: async (email) => {
      const row = await p.user.findUnique({ where: { email } });
      return row ? dbToAdapterUser(row) : null;
    },
    getUserByAccount: async (provider_providerAccountId) => {
      const account = await p.account.findUnique({
        where: { provider_providerAccountId },
        include: { user: true },
      });
      return account?.user ? dbToAdapterUser(account.user) : null;
    },
    deleteUser: async (id) => {
      const row = await p.user.delete({ where: { id } });
      return dbToAdapterUser(row);
    },
    getSessionAndUser: async (sessionToken) => {
      const userAndSession = await p.session.findUnique({
        where: { sessionToken },
        include: { user: true },
      });
      if (!userAndSession) return null;
      const { user, ...session } = userAndSession;
      return {
        user: dbToAdapterUser(user),
        session,
      } as unknown as NonNullable<Awaited<ReturnType<NonNullable<Adapter['getSessionAndUser']>>>>;
    },
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
