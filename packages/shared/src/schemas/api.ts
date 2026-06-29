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
 * Per-row shape for `GET /sync/parties`. `roles` is an array because the
 * same user may hold both `dm` and `player` rows in a single party
 * (party-of-one is exactly that case).
 */
export const partyListItemSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  roles: z.array(z.enum(['dm', 'player'])).min(1),
  memberCount: z.number().int().min(1),
  isSoloShortcut: z.boolean(),
  lastActivityAt: z.string().datetime().nullable(),
});

export type PartyListItem = z.infer<typeof partyListItemSchema>;

export const partiesListResponseSchema = z.object({
  parties: z.array(partyListItemSchema),
});

export type PartiesListResponse = z.infer<typeof partiesListResponseSchema>;

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
