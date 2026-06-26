/**
 * R3.5 — Thin HTTP client wrapping `fetch` for every web↔server call.
 *
 * Responsibilities:
 *   1. Prepend the configured `SERVER_URL` so callers use server-relative
 *      paths (e.g. `/auth/session`, `/sync/state`).
 *   2. Carry session cookies (`credentials: 'include'`).
 *   3. Normalize JSON serialization on the way out and Zod parsing on the
 *      way in.
 *   4. Map non-2xx responses to a typed `ApiError` whose `.code` is the
 *      server's stable enum (`unauthenticated`, `display_name_required`,
 *      `rate_limited`, `discord_already_linked`, …) so callers branch on
 *      `code` rather than status numbers.
 *
 * Callers MUST guard with `isServerMode` before invoking — `apiFetch`
 * throws synchronously if `SERVER_URL` is null. Server-mode-only screens
 * (Login, Hub, LinkedAccounts) already render conditionally on
 * `isServerMode`, so the guard is structural, not defensive.
 */
import { z, type ZodType } from 'zod';

import {
  apiErrorSchema,
  partiesListResponseSchema,
  pullStateResponseSchema,
  pushActionsResponseSchema,
  requestOtpResponseSchema,
  sessionResponseSchema,
  setDisplayNameResponseSchema,
  verifyOtpResponseSchema,
  linkEmailResponseSchema,
  batchRejectedResponseSchema,
  type PartiesListResponse,
  type PullStateResponse,
  type PushActionsResponse,
  type RequestOtpResponse,
  type SessionResponse,
  type SetDisplayNameResponse,
  type VerifyOtpResponse,
  type LinkEmailResponse,
  type BatchRejectedResponse,
} from '@app/shared';

import { SERVER_URL } from './serverMode';

/**
 * Typed error raised by `apiFetch` on any non-2xx response. `code`
 * mirrors the server's `{ error: '<code>' }` body string — stable across
 * versions. `status` is the raw HTTP status. `retryAfter` (when set) is
 * the server-supplied ISO timestamp for `429` responses.
 *
 * `body` carries the entire parsed JSON body (or `undefined` if the body
 * wasn't JSON) so callers that need supplementary fields (e.g. `issues`
 * from a Zod 400) can read them without an `as` cast.
 */
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryAfter?: string;
  readonly body: unknown;

  constructor(args: {
    code: string;
    status: number;
    message: string;
    retryAfter?: string;
    body: unknown;
  }) {
    super(args.message);
    this.name = 'ApiError';
    this.code = args.code;
    this.status = args.status;
    if (args.retryAfter !== undefined) this.retryAfter = args.retryAfter;
    this.body = args.body;
  }
}

/**
 * Subclass for `/sync/actions` 422 — carries `index`, `code`, `message`
 * so the sync queue can pinpoint which action in the batch was rejected
 * and surface a human-readable toast.
 */
export class BatchRejectedError extends ApiError {
  readonly index: number;
  readonly rejectedCode: string;
  readonly rejectedMessage: string;

  constructor(rejected: BatchRejectedResponse['rejected']) {
    super({
      code: 'batch_rejected',
      status: 422,
      message: `Action ${rejected.index}: ${rejected.code} — ${rejected.message}`,
      body: { rejected },
    });
    this.name = 'BatchRejectedError';
    this.index = rejected.index;
    this.rejectedCode = rejected.code;
    this.rejectedMessage = rejected.message;
  }
}

interface ApiFetchOptions<TOut> {
  method?: 'GET' | 'POST';
  body?: unknown;
  schema: ZodType<TOut>;
  /**
   * Optional Zod for the 422 body (defaults to `batchRejectedResponseSchema`
   * for `/sync/actions`). The caller can omit this and `ApiError` will be
   * thrown the normal way.
   */
  on422?: ZodType<unknown>;
}

/**
 * Resolve a server-relative path against `SERVER_URL`. Throws if the
 * caller forgot to guard with `isServerMode` — never let a stray
 * `apiFetch` call fire in local mode.
 */
function resolve(path: string): string {
  if (SERVER_URL === null) {
    throw new Error('apiFetch called in local mode — guard with isServerMode');
  }
  if (!path.startsWith('/')) {
    throw new Error(`apiFetch path must start with "/": ${path}`);
  }
  return `${SERVER_URL}${path}`;
}

async function readJsonSafe(res: Response): Promise<unknown> {
  // 204 / empty bodies surface as `{}` so the error pathway always has a
  // stable shape to inspect. We don't trust Content-Type because some
  // proxies strip it; instead we try once and fall back.
  const text = await res.text();
  if (text === '') return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function parseErrorBody(body: unknown): { code: string; message: string } {
  const parsed = apiErrorSchema.safeParse(body);
  if (parsed.success) {
    return { code: parsed.data.error, message: parsed.data.error };
  }
  return { code: 'malformed_response', message: 'Server returned an unexpected error shape' };
}

export async function apiFetch<TOut>(path: string, options: ApiFetchOptions<TOut>): Promise<TOut> {
  const url = resolve(path);
  const init: RequestInit = {
    method: options.method ?? 'GET',
    credentials: 'include',
  };
  if (options.body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(options.body);
  }

  const res = await fetch(url, init);
  const body = await readJsonSafe(res);

  if (!res.ok) {
    if (res.status === 422 && options.on422 !== undefined) {
      const rejected = batchRejectedResponseSchema.safeParse(body);
      if (rejected.success) {
        throw new BatchRejectedError(rejected.data.rejected);
      }
    }
    const { code, message } = parseErrorBody(body);
    const retryAfter = readRetryAfter(body);
    throw new ApiError({
      code,
      status: res.status,
      message: `${path} → ${res.status} ${code}: ${message}`,
      ...(retryAfter !== undefined ? { retryAfter } : {}),
      body,
    });
  }

  const parsed = options.schema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError({
      code: 'malformed_response',
      status: res.status,
      message: `${path} → malformed response: ${parsed.error.message}`,
      body,
    });
  }
  return parsed.data;
}

function readRetryAfter(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const ra = (body as Record<string, unknown>)['retryAfter'];
  return typeof ra === 'string' ? ra : undefined;
}

// ----- Typed helpers (one per endpoint) --------------------------------

export function getSessionMe(): Promise<SessionResponse> {
  return apiFetch('/auth/session', { schema: sessionResponseSchema });
}

const emptySchema = z.object({}).passthrough();

export function signOut(): Promise<unknown> {
  // Auth.js's /auth/signout returns a flexible shape (JSON or empty).
  return apiFetch('/auth/signout', { method: 'POST', body: {}, schema: emptySchema });
}

export function requestEmailOtp(email: string): Promise<RequestOtpResponse> {
  return apiFetch('/auth/email/request-otp', {
    method: 'POST',
    body: { email },
    schema: requestOtpResponseSchema,
  });
}

export function verifyEmailOtp(email: string, otp: string): Promise<VerifyOtpResponse> {
  return apiFetch('/auth/email/verify-otp', {
    method: 'POST',
    body: { email, otp },
    schema: verifyOtpResponseSchema,
  });
}

export function setDisplayName(displayName: string): Promise<SetDisplayNameResponse> {
  return apiFetch('/auth/email/set-display-name', {
    method: 'POST',
    body: { displayName },
    schema: setDisplayNameResponseSchema,
  });
}

export function requestLinkEmailOtp(email: string): Promise<RequestOtpResponse> {
  return apiFetch('/auth/email/link/request-otp', {
    method: 'POST',
    body: { email },
    schema: requestOtpResponseSchema,
  });
}

export function verifyLinkEmailOtp(email: string, otp: string): Promise<LinkEmailResponse> {
  return apiFetch('/auth/email/link/verify-otp', {
    method: 'POST',
    body: { email, otp },
    schema: linkEmailResponseSchema,
  });
}

export function listParties(): Promise<PartiesListResponse> {
  return apiFetch('/sync/parties', { schema: partiesListResponseSchema });
}

export function pullState(partyId: string): Promise<PullStateResponse> {
  // partyId is server-validated; we URI-encode defensively so a stray
  // path-character can't escape the query string.
  return apiFetch(`/sync/state?partyId=${encodeURIComponent(partyId)}`, {
    schema: pullStateResponseSchema,
  });
}

export function pushActions(partyId: string, actions: unknown[]): Promise<PushActionsResponse> {
  return apiFetch('/sync/actions', {
    method: 'POST',
    body: { partyId, actions },
    schema: pushActionsResponseSchema,
    on422: batchRejectedResponseSchema,
  });
}
