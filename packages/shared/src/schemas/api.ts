import { z } from 'zod';

import { appStateSchema } from './appState';
import { transactionLogEntrySchema } from './transactionLog';

/**
 * R3.5 — HTTP API response Zods shared between the web client (`apiFetch`)
 * and the Fastify route handlers. Co-locating the schemas keeps the two
 * sides from drifting and gives us one canonical definition for typed
 * `apiFetch<T>(..., { schema })` consumers.
 *
 * Conventions:
 *   - All non-2xx responses use the `apiErrorSchema` shape `{ error, ... }`.
 *     Per-endpoint Zods only cover happy paths; the HTTP client maps
 *     non-2xx to a typed `ApiError` directly from the body.
 *   - Optional fields are `.optional()` rather than `.nullable()` whenever
 *     the server omits the field on absence. We follow Auth.js's
 *     loose-shape convention for the session payload: a logged-out user
 *     gets `{}`, a logged-in user gets `{ user, expires }`.
 */

/**
 * Common error envelope. Servers may add endpoint-specific fields (e.g.
 * `retryAfter`, `issues`); callers parse those off the body separately,
 * not via this schema.
 */
export const apiErrorSchema = z
  .object({
    error: z.string().min(1),
  })
  .passthrough();

export type ApiErrorBody = z.infer<typeof apiErrorSchema>;

/**
 * Session-user shape returned by `GET /auth/session` (logged-in branch).
 * Auth.js's standard `Session.user` carries optional `name`, `email`,
 * `image`; we extend with our app-specific fields. The decorator
 * `app.getSession` on the server attaches the `User` row directly so the
 * extra fields land.
 */
export const sessionUserSchema = z
  .object({
    id: z.string().min(1),
    displayName: z.string(),
    email: z.string().email().nullable().optional(),
    avatarUrl: z.string().url().nullable().optional(),
    discordId: z.string().nullable().optional(),
    needsDisplayName: z.boolean(),
  })
  .passthrough();

export type SessionUser = z.infer<typeof sessionUserSchema>;

/**
 * `GET /auth/session` returns either:
 *   - an empty object `{}` (Fastify-route anonymous response),
 *   - the JSON literal `null` (Auth.js's default anonymous response — Auth.js
 *     v5 returns `null` when there is no session token; the Fastify route
 *     for /auth/session delegates to Auth.js so this lands on the wire),
 *   - or `{ user, expires }` for an authenticated session.
 *
 * We accept `null` as equivalent to `{}` via a `union`; callers branch on
 * `response.user !== undefined`. Without this branch, the legitimate
 * anonymous payload `null` would fail the parse with `expected: object`
 * and surface to the user as a console error.
 */
const sessionResponseObjectSchema = z
  .object({
    user: sessionUserSchema.optional(),
    expires: z.string().datetime().optional(),
  })
  .passthrough();

export const sessionResponseSchema = z.union([
  sessionResponseObjectSchema,
  // The `as z.infer<...>` cast is load-bearing: without it the union
  // widens to `{} | SessionResponseObject`, and downstream `.user?` /
  // `.expires?` accessors break in the web app. ESLint's
  // no-unnecessary-type-assertion flags this as redundant, but removing
  // it fails apps/web typecheck.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  z.null().transform(() => ({}) as z.infer<typeof sessionResponseObjectSchema>),
]);

export type SessionResponse = z.infer<typeof sessionResponseSchema>;

/**
 * `POST /auth/email/verify-otp` happy-path body.
 */
export const verifyOtpResponseSchema = z.object({
  user: sessionUserSchema,
  expires: z.string().datetime(),
});

export type VerifyOtpResponse = z.infer<typeof verifyOtpResponseSchema>;

/**
 * `POST /auth/email/set-display-name` happy-path body.
 */
export const setDisplayNameResponseSchema = z.object({
  user: sessionUserSchema,
});

export type SetDisplayNameResponse = z.infer<typeof setDisplayNameResponseSchema>;

/**
 * `POST /auth/email/request-otp` happy-path body.
 */
export const requestOtpResponseSchema = z.object({
  status: z.literal('sent'),
});

export type RequestOtpResponse = z.infer<typeof requestOtpResponseSchema>;

/**
 * `POST /auth/email/link/verify-otp` happy-path body.
 */
export const linkEmailResponseSchema = z.object({
  user: sessionUserSchema,
});

export type LinkEmailResponse = z.infer<typeof linkEmailResponseSchema>;

/**
 * R10.1 — change-email dual-OTP flow response bodies.
 * `start` returns the pending-change token the client threads through the
 * two verify steps. `verify-current` re-sends (code to the new address).
 * `verify-new` commits and returns the updated session user. `abort` acks.
 */
export const emailChangeStartResponseSchema = z.object({
  status: z.literal('sent'),
  token: z.string().min(1),
});

export type EmailChangeStartResponse = z.infer<typeof emailChangeStartResponseSchema>;

export const emailChangeSentResponseSchema = z.object({
  status: z.literal('sent'),
});

export type EmailChangeSentResponse = z.infer<typeof emailChangeSentResponseSchema>;

export const emailChangeCommitResponseSchema = z.object({
  user: sessionUserSchema,
});

export type EmailChangeCommitResponse = z.infer<typeof emailChangeCommitResponseSchema>;

export const emailChangeAbortResponseSchema = z.object({
  status: z.literal('aborted'),
});

export type EmailChangeAbortResponse = z.infer<typeof emailChangeAbortResponseSchema>;

/**
 * Per-row shape for `GET /sync/parties`. `roles` is an array because the
 * same user may hold both `dm` and `player` rows in a single party
 * (party-of-one is exactly that case).
 *
 * R4.1 — `isSoloShortcut` removed. UI derives the "solo" badge from
 * `memberCount === 1` (OUTLINE §4 amendment 2026-06-24).
 *
 * R10.3 — `itemCount` (total ItemInstance quantity across ALL the party's
 * stashes — character inventories + Storage + Party Stash + Recovered Loot,
 * excluding shop stock) and `totalCp` (integer copper-equivalent of every
 * stash's CurrencyHolding) are Hub-card glance stats. `totalCp` is integer
 * CP on the wire per SECURITY §3.2 (CP-integer only); the client divides to
 * gp for display. Server computes them in `GET /sync/parties`; local mode
 * computes them from the keyed Dexie AppState blob.
 */
export const partyListItemSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  roles: z.array(z.enum(['dm', 'player'])).min(1),
  memberCount: z.number().int().min(1),
  lastActivityAt: z.string().datetime().nullable(),
  itemCount: z.number().int().nonnegative(),
  totalCp: z.number().int().nonnegative(),
});

export type PartyListItem = z.infer<typeof partyListItemSchema>;

export const partiesListResponseSchema = z.object({
  parties: z.array(partyListItemSchema),
});

export type PartiesListResponse = z.infer<typeof partiesListResponseSchema>;

/**
 * R4.1.e — `POST /parties/join` request + response.
 *
 * Request: `{ inviteCode }`. Server resolves the party from the code,
 * verifies the user isn't already a member, dispatches a `join-party`
 * action authoritatively, and returns the party id + name so the
 * client can navigate to it.
 */
export const joinPartyRequestSchema = z.object({
  inviteCode: z.string().min(1),
});

export type JoinPartyRequest = z.infer<typeof joinPartyRequestSchema>;

export const joinPartyResponseSchema = z.object({
  partyId: z.string().min(1),
  partyName: z.string().min(1),
});

export type JoinPartyResponse = z.infer<typeof joinPartyResponseSchema>;

/**
 * R4.1.e — `POST /parties/:partyId/invite/rotate` response.
 *
 * DM-only. Generates a fresh invite code via `generateInviteCode()` and
 * stores it on `Party.inviteCode`. The old code becomes invalid
 * immediately (any in-flight join attempts get `invalid_invite`).
 */
export const rotateInviteResponseSchema = z.object({
  inviteCode: z.string().min(1),
});

export type RotateInviteResponse = z.infer<typeof rotateInviteResponseSchema>;

/**
 * R4.1.e — `POST /parties/:partyId/leave` response.
 *
 * Empty `{}` on success. `archived: true` is set when the leaver was
 * the last active member and the party was archived as a side effect
 * (per OUTLINE §8.3). Clients that see `archived: true` should redirect
 * to the Hub since the party will no longer appear in `/sync/parties`.
 */
export const leavePartyResponseSchema = z.object({
  archived: z.boolean(),
});

export type LeavePartyResponse = z.infer<typeof leavePartyResponseSchema>;

/**
 * R4.1.e — `POST /parties/:partyId/kick` request + response.
 *
 * DM-only. Targets must be an active non-DM member of the party.
 */
export const kickPlayerRequestSchema = z.object({
  kickedUserId: z.string().min(1),
});

export type KickPlayerRequest = z.infer<typeof kickPlayerRequestSchema>;

export const kickPlayerResponseSchema = z.object({});

export type KickPlayerResponse = z.infer<typeof kickPlayerResponseSchema>;

/**
 * R4.1.e — `GET /parties/:partyId/members` response. Used by the
 * PartySettings screen to render the member list with role badges.
 * Active members only (`leftAt: null`). One row per `(userId, role)`
 * tuple — the same user with `dm + player` rows surfaces as two rows.
 */
export const partyMemberItemSchema = z.object({
  userId: z.string().min(1),
  displayName: z.string(),
  role: z.enum(['dm', 'player']),
  characterId: z.string().min(1).nullable(),
  characterName: z.string().nullable(),
  joinedAt: z.string().datetime(),
});

export type PartyMemberItem = z.infer<typeof partyMemberItemSchema>;

export const partyMembersResponseSchema = z.object({
  partyId: z.string().min(1),
  inviteCode: z.string().min(1),
  members: z.array(partyMemberItemSchema),
});

export type PartyMembersResponse = z.infer<typeof partyMembersResponseSchema>;

/**
 * `GET /sync/state` happy-path body.
 */
export const pullStateResponseSchema = z.object({
  state: appStateSchema,
  serverTime: z.string().datetime(),
});

export type PullStateResponse = z.infer<typeof pullStateResponseSchema>;

/**
 * `POST /sync/actions` happy-path body. The rejection path (422)
 * carries `{ rejected: { index, code, message } }` — that's surfaced as
 * a typed `BatchRejectedError` in the sync client, not as a Zod schema.
 */
export const pushActionsResponseSchema = z.object({
  applied: z.array(transactionLogEntrySchema),
  serverTime: z.string().datetime(),
});

export type PushActionsResponse = z.infer<typeof pushActionsResponseSchema>;

/**
 * `POST /sync/actions` 422 body — used by the sync client to construct
 * typed `BatchRejectedError`. Defined here so server + web stay aligned.
 */
export const batchRejectedResponseSchema = z.object({
  rejected: z.object({
    index: z.number().int().min(0),
    code: z.string().min(1),
    message: z.string(),
  }),
});

export type BatchRejectedResponse = z.infer<typeof batchRejectedResponseSchema>;

/**
 * `GET /auth/methods` — unauthenticated probe used by the Login screen to
 * decide which sign-in buttons to render. Mirrors the server-side
 * `isDiscordAuthEnabled` / `isEmailAuthEnabled` sentinels. The same
 * disabled-state surfaces as 503 from the per-flow routes; this endpoint
 * just lets the client know in advance.
 */
export const authMethodsResponseSchema = z.object({
  discord: z.boolean(),
  email: z.boolean(),
});

export type AuthMethodsResponse = z.infer<typeof authMethodsResponseSchema>;
