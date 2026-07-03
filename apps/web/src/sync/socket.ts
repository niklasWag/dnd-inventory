/**
 * R5.1.b — Client-side Socket.IO consumer.
 * R5.1.c — Reconnect drain wired into `socket.on('connect')`.
 *
 * In server mode, boot wires this to `main.tsx`: the socket connects
 * to `/socket.io`, receives `applied` broadcasts from other party
 * members' actions, and hands each broadcast to `applyBroadcast` for
 * reconciliation. On every (re-)connect, kicks off `drainOutbox()` to
 * replay any log entries missed during the disconnect window + drain
 * any buffered writes from the Dexie outbox.
 *
 * Auth uses the same session cookie as HTTP (`withCredentials: true`);
 * server middleware in `apps/server/src/realtime/io.ts` reuses
 * `getSession()` and rejects unauth upgrades.
 *
 * `applyBroadcast` is extracted to its own module to avoid a circular
 * import between `socket.ts` and `reconnect.ts`.
 */
import { io as ioClient, type Socket } from 'socket.io-client';

import { useStore } from '@/store';

import { applyBroadcast } from './applyBroadcast';
import { drainOutbox } from './reconnect';

// Re-export so tests + external callers can still reach the helper via
// the socket module (backwards-compat with R5.1.b's export surface).
export { applyBroadcast };

const env = import.meta.env as { VITE_SERVER_URL?: string };

// Module-scope singleton — one connection per browser tab. `main.tsx`
// wires the connect on boot in server mode.
let socket: Socket | null = null;

/**
 * Build the Socket.IO client. Returns null in local mode (no server
 * to connect to). Caller invokes `.connect()` when ready.
 */
export function connectSocket(): Socket | null {
  const serverUrl = env.VITE_SERVER_URL;
  if (serverUrl === undefined || serverUrl.length === 0) return null;

  socket = ioClient(serverUrl, {
    path: '/socket.io',
    withCredentials: true,
    autoConnect: false,
    // Socket.IO's own reconnect handles transient network drops.
    // Bounded retry + outbox drain for HTTP writes live in
    // `queue.ts` + `reconnect.ts`.
    reconnection: true,
    reconnectionDelay: 500,
    reconnectionDelayMax: 8000,
    reconnectionAttempts: Infinity,
  });

  socket.on('applied', applyBroadcast);
  socket.on('connect', () => {
    useStore.setState({ socketConnected: true });
    // R5.1.c — fire-and-forget drain. Runs on every connect (initial +
    // reconnect); a no-op when the store isn't hydrated to a party
    // yet (Hub view) or the outbox is empty.
    void drainOutbox();
  });
  socket.on('disconnect', () => {
    useStore.setState({ socketConnected: false });
  });
  socket.on('connect_error', (err: Error) => {
    console.warn('[socket] connect_error:', err.message);
  });

  return socket;
}

/**
 * Testing seam: force-close the module-scope singleton. Idempotent.
 */
export function resetSocket(): void {
  if (socket !== null) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
}

/**
 * Read-only accessor for the current socket. Returns null if
 * `connectSocket()` hasn't been called (or in local mode).
 */
export function getSocket(): Socket | null {
  return socket;
}
