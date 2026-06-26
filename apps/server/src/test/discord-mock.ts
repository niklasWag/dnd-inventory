/**
 * R3.2 — msw (Mock Service Worker) fixture for Discord OAuth endpoints.
 *
 * Intercepts the outbound fetch() calls that @auth/core makes during the
 * authorization-code exchange:
 *   - `POST https://discord.com/api/oauth2/token` — exchanges the `code`
 *     for an access token.
 *   - `GET https://discord.com/api/users/@me` — fetches the user profile.
 *
 * msw 2.x intercepts via undici's request interceptor in Node. Auth.js
 * uses native fetch (which is undici under the hood), so the interception
 * is transparent.
 *
 * Usage in tests:
 * ```ts
 * import { setupDiscordMock } from '../test/discord-mock.js';
 * const discord = setupDiscordMock();
 * beforeAll(() => discord.server.listen({ onUnhandledRequest: 'bypass' }));
 * afterEach(() => discord.server.resetHandlers());
 * afterAll(() => discord.server.close());
 *
 * discord.withUser({ id: '123', username: 'gandalf', global_name: 'Gandalf', avatar: 'hash' });
 * ```
 *
 * Reusable in R3.3 (SMTP), R5+ (websocket) — anywhere we need to fake an
 * outbound HTTP call without standing up the real service.
 */
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

export interface DiscordMockProfile {
  id: string;
  username: string;
  global_name?: string | null;
  avatar?: string | null;
  discriminator?: string;
  email?: string | null;
}

const DEFAULT_PROFILE: DiscordMockProfile = {
  id: '123456789012345678',
  username: 'mock-user',
  global_name: 'Mock User',
  avatar: 'aabbccddeeff00112233445566778899',
  discriminator: '0',
};

export interface DiscordMock {
  server: ReturnType<typeof setupServer>;
  /**
   * Update the profile that GET /users/@me returns. Lets tests verify
   * the displayName / avatarUrl resync behavior per profile change.
   */
  withUser: (profile: Partial<DiscordMockProfile>) => void;
}

export function setupDiscordMock(): DiscordMock {
  let profile: DiscordMockProfile = { ...DEFAULT_PROFILE };

  const handlers = [
    http.post('https://discord.com/api/oauth2/token', () => {
      // Auth.js POSTs application/x-www-form-urlencoded with grant_type=
      // authorization_code + client_id + client_secret + code +
      // redirect_uri + code_verifier (PKCE). The body content isn't part
      // of what we assert against — we only need a valid token response.
      return HttpResponse.json({
        access_token: 'mock-access-token-' + crypto.randomUUID(),
        token_type: 'Bearer',
        expires_in: 604800,
        refresh_token: 'mock-refresh-token-' + crypto.randomUUID(),
        scope: 'identify',
      });
    }),
    http.get('https://discord.com/api/users/@me', () => {
      return HttpResponse.json(profile);
    }),
  ];

  const server = setupServer(...handlers);

  return {
    server,
    withUser(p: Partial<DiscordMockProfile>) {
      profile = { ...DEFAULT_PROFILE, ...p };
    },
  };
}
