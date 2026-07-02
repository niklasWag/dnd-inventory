import { v7 as uuidV7, validate as uuidValidate, version as uuidVersion } from 'uuid';

/**
 * RH1 — Client-authoritative UUID v7 ids.
 *
 * All entity ids in OUTLINE §4 (`User.id`, `Party.id`, `Character.id`,
 * `Stash.id`, `ItemInstance.id`, `ItemDefinition.id`, `CurrencyHolding.id`,
 * `Session.id`, `TransactionLog.id`) are UUID v7 minted by the **client** at
 * action-dispatch time and carried in the action payload. The server's role
 * is validate + persist, not mint.
 *
 * Why UUID v7:
 *   - Time-ordered (RFC 9562 §5.7): leading 48 bits carry a Unix ms
 *     timestamp, so lex-sort matches mint order — helpful for log +
 *     DB-inspection debugging.
 *   - Collision-safe: 74 bits of random entropy per millisecond.
 *   - Structurally compatible with existing UUID v4 columns; no DB
 *     migration needed. Legacy rows minted under the pre-RH1 dual-authority
 *     regime keep working.
 *
 * Why client-minted:
 *   - Optimistic dispatch (the reducer runs on the client first for sub-
 *     100 ms UI feedback) needs an id the moment the action is created.
 *   - The server runs the same reducer authoritatively (per SECURITY §2 /
 *     §3.1) and persists using the client's id.
 *   - The TransactionLog becomes a single source of truth — client and
 *     server log entries describe the same action with the same ids.
 *   - Retires the dual-authority patch (post-flush `GET /sync/state`
 *     re-pull driven by an `ID_MINTING_ACTION_TYPES` set — see BUG-004,
 *     RH1 postmortem).
 *
 * Security implication:
 *   - Client-minting looks like "the client controls the id namespace,"
 *     but the server still controls every other invariant: permission
 *     (§8.1 guard map), state mutation legality (§3.4 stash/character
 *     invariants, §3.2 currency math), and collision (Prisma unique
 *     constraint catches forged reuse). The client only chooses *which*
 *     new UUID v7 to use; the server still decides *whether* to accept
 *     it. Three new guard rejection codes cover the validation surface:
 *     `id_malformed`, `id_clock_skew`, `id_already_exists`.
 *
 * Implementation:
 *   - `uuid` package (14.x) — battle-tested RFC 9562 implementation.
 *     Avoids re-implementing the bit layout in-tree.
 *   - `timestampFromUuidV7` is written here because `uuid` doesn't expose
 *     the embedded-timestamp extractor directly. Six-byte read out of the
 *     first octets per §5.7.
 */

/**
 * Tolerance window for the `id_clock_skew` guard: the client-supplied id's
 * embedded timestamp must land within ±5 minutes of the server's wall
 * clock. Wide enough to absorb a misconfigured client, narrow enough that
 * backdated forgeries can't poison the log.
 */
export const CLOCK_SKEW_TOLERANCE_MS = 5 * 60 * 1000;

/** Mint a fresh UUID v7 at the current wall-clock ms. */
export function newUuidV7(): string {
  return uuidV7();
}

/**
 * Structural validation: the input is a 36-char canonical UUID string AND
 * its version nibble is `7`. Case-insensitive per RFC 9562.
 *
 * Does NOT validate clock-skew — that's a separate guard (see
 * `timestampFromUuidV7` + `CLOCK_SKEW_TOLERANCE_MS`).
 */
export function isValidUuidV7(candidate: string): boolean {
  return uuidValidate(candidate) && uuidVersion(candidate) === 7;
}

/**
 * Extract the embedded Unix-ms timestamp from a UUID v7 (RFC 9562 §5.7).
 *
 * The first 48 bits — i.e. the first 12 hex digits (bytes 0..5, big-endian)
 * — are a Unix millisecond timestamp. `uuid@14` doesn't expose this
 * extractor, so it's implemented here.
 *
 * @throws if `id` is not a valid UUID v7. Callers validate first.
 */
export function timestampFromUuidV7(id: string): number {
  if (!isValidUuidV7(id)) {
    throw new Error(`not a valid UUID v7: ${id}`);
  }
  // Canonical layout is `xxxxxxxx-xxxx-Mxxx-...`. The first 8 hex chars
  // (bytes 0..3) + the 4 chars in group 2 (bytes 4..5) = 12 hex chars =
  // the 48-bit timestamp. Strip the dash and parse as base-16.
  const hex = id.slice(0, 8) + id.slice(9, 13);
  return Number.parseInt(hex, 16);
}
