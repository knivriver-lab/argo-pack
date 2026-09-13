/**
 * Where the tokens live, and what happens to them.
 *
 * Four claims are checked here, and they are the four the plank is worth having:
 *
 *   1. a token goes into `SecretStorage` and nowhere else,
 *   2. a token never appears in anything this plank would write to a log,
 *   3. a refresh rotates the lineage, and a dead lineage drops the session rather than leaving
 *      a bearer behind that will only ever earn a 401,
 *   4. a sign-out presents the refresh token to the revoke path *and* drops the session, and a
 *      grant that does not carry the role that was asked for is refused outright.
 */

import { describe, expect, it } from 'vitest';
import { CONSTRUCTOR_ROLE, defaultEndpoints } from '../src/oauth.js';
import {
  acceptGrant,
  clearSession,
  describeSession,
  isConstructor,
  isStale,
  readSession,
  RoleNotGrantedError,
  SECRET_KEY,
  SessionStore,
  sessionFromGrant,
  writeSession,
  type SessionsConfig,
  type StoredSession,
} from '../src/session.js';
import { BASE_URL, CLIENT_ID, MockSecretStorage, mockFabric } from './mock-fabric.js';

const endpoints = defaultEndpoints(BASE_URL);
const config: SessionsConfig = { endpoints, clientId: CLIENT_ID, accountLabel: "Mew'd fabric" };

const ACCESS = 'access-token-aaaaaaaaaaaaaaaaaaaa';
const REFRESH = 'refresh-token-bbbbbbbbbbbbbbbbbbbb';

function session(overrides: Partial<StoredSession> = {}): StoredSession {
  return {
    id: 'session-1',
    accessToken: ACCESS,
    refreshToken: REFRESH,
    expiresAt: null,
    scopes: [CONSTRUCTOR_ROLE],
    account: { id: 'mewd.fabric', label: "Mew'd fabric" },
    ...overrides,
  };
}

describe('the store', () => {
  it('writes the session under one key in SecretStorage and nowhere else', async () => {
    const secrets = new MockSecretStorage();
    await writeSession(secrets, session());
    expect(secrets.writes).toEqual([SECRET_KEY]);
    expect([...secrets.entries.keys()]).toEqual([SECRET_KEY]);
  });

  it('round-trips', async () => {
    const secrets = new MockSecretStorage();
    await writeSession(secrets, session());
    expect(await readSession(secrets)).toEqual(session());
  });

  it('reports nothing rather than half a session when the stored value is unreadable', async () => {
    const secrets = new MockSecretStorage();
    await secrets.store(SECRET_KEY, 'not json');
    expect(await readSession(secrets)).toBeNull();

    await secrets.store(SECRET_KEY, JSON.stringify({ id: 'x' }));
    expect(await readSession(secrets)).toBeNull();
  });

  it('forgets it on clear', async () => {
    const secrets = new MockSecretStorage();
    await writeSession(secrets, session());
    await clearSession(secrets);
    expect(secrets.deletes).toEqual([SECRET_KEY]);
    expect(await readSession(secrets)).toBeNull();
  });
});

describe('describing a session', () => {
  const text = describeSession(session({ expiresAt: 1_700_000_000_000 }));

  it('never carries the token', () => {
    expect(text).not.toContain(ACCESS);
    expect(text).not.toContain(REFRESH);
  });

  it('does not carry a prefix of one either — a prefix correlates two logs', () => {
    expect(text).not.toContain(ACCESS.slice(0, 8));
    expect(text).not.toContain(REFRESH.slice(0, 8));
  });

  it('says what it can say: scopes, expiry, and whether a lineage is held', () => {
    expect(text).toContain(CONSTRUCTOR_ROLE);
    expect(text).toContain('2023-11-14');
    expect(text).toContain('refresh lineage held');
  });

  it('says so when nothing was granted', () => {
    expect(describeSession(session({ scopes: [] }))).toContain('no scopes granted');
  });
});

describe('staleness', () => {
  it('is not stale when the fabric stated no expiry', () => {
    expect(isStale(session({ expiresAt: null }), 5_000)).toBe(false);
  });

  it('is stale inside the skew, not only after the deadline', () => {
    expect(isStale(session({ expiresAt: 100_000 }), 30_000)).toBe(false);
    expect(isStale(session({ expiresAt: 100_000 }), 50_000)).toBe(true);
  });
});

describe('silent refresh', () => {
  it('leaves a fresh session alone', async () => {
    const secrets = new MockSecretStorage();
    await writeSession(secrets, session({ expiresAt: 1_000_000 }));
    const fabric = mockFabric(() => ({ status: 500 }));

    const store = new SessionStore(secrets, config, fabric.fetch);
    expect((await store.current(0))?.accessToken).toBe(ACCESS);
    expect(fabric.requests).toEqual([]);
  });

  it('rotates the lineage and writes the whole grant back', async () => {
    const secrets = new MockSecretStorage();
    await writeSession(secrets, session({ expiresAt: 1_000 }));
    const fabric = mockFabric(() => ({
      body: { access_token: 'at-2', refresh_token: 'rt-2', expires_in: 3600, scope: CONSTRUCTOR_ROLE },
    }));

    const store = new SessionStore(secrets, config, fabric.fetch);
    const refreshed = await store.current(1_000_000);

    expect(fabric.to('/oauth/token')[0]?.form['refresh_token']).toBe(REFRESH);
    expect(refreshed?.accessToken).toBe('at-2');
    expect(refreshed?.refreshToken).toBe('rt-2');
    expect((await readSession(secrets))?.refreshToken).toBe('rt-2');
    // The token it presented is dead; keeping it would be keeping a key to a changed lock.
    expect(secrets.dump()).not.toContain(REFRESH);
  });

  it('spends one refresh token when four bands wake up together', async () => {
    const secrets = new MockSecretStorage();
    await writeSession(secrets, session({ expiresAt: 1_000 }));
    const fabric = mockFabric(() => ({
      body: { access_token: 'at-2', refresh_token: 'rt-2', expires_in: 3600, scope: CONSTRUCTOR_ROLE },
    }));

    const store = new SessionStore(secrets, config, fabric.fetch);
    const all = await Promise.all([
      store.current(1_000_000),
      store.current(1_000_000),
      store.current(1_000_000),
      store.current(1_000_000),
    ]);

    expect(fabric.to('/oauth/token')).toHaveLength(1);
    expect(all.every((s) => s?.accessToken === 'at-2')).toBe(true);
  });

  it('drops the session when the lineage is gone, rather than handing back a dead bearer', async () => {
    const secrets = new MockSecretStorage();
    await writeSession(secrets, session({ expiresAt: 1_000 }));
    const fabric = mockFabric(() => ({ status: 400, body: { error: 'invalid_grant' } }));

    const store = new SessionStore(secrets, config, fabric.fetch);
    await expect(store.current(1_000_000)).rejects.toMatchObject({ code: 'invalid_grant' });
    expect(await readSession(secrets)).toBeNull();
    expect(secrets.dump()).not.toContain(ACCESS);
  });

  it('drops a stale session that has no lineage to refresh from', async () => {
    const secrets = new MockSecretStorage();
    await writeSession(secrets, session({ expiresAt: 1_000, refreshToken: null }));
    const fabric = mockFabric(() => ({ status: 500 }));

    const store = new SessionStore(secrets, config, fabric.fetch);
    expect(await store.current(1_000_000)).toBeNull();
    expect(await readSession(secrets)).toBeNull();
  });
});

describe('matching what was asked for', () => {
  it('hands back the session when it carries the scope', async () => {
    const secrets = new MockSecretStorage();
    await writeSession(secrets, session());
    const store = new SessionStore(secrets, config, mockFabric(() => ({ status: 500 })).fetch);
    expect(await store.matching([CONSTRUCTOR_ROLE])).not.toBeNull();
  });

  it('hands back nothing when it does not', async () => {
    const secrets = new MockSecretStorage();
    await writeSession(secrets, session({ scopes: ['role:consult'] }));
    const store = new SessionStore(secrets, config, mockFabric(() => ({ status: 500 })).fetch);
    expect(await store.matching([CONSTRUCTOR_ROLE])).toBeNull();
  });
});

describe('signing out', () => {
  it('presents the refresh token to the revoke path, then drops the session', async () => {
    const secrets = new MockSecretStorage();
    await writeSession(secrets, session());
    const fabric = mockFabric(() => ({ status: 200 }));

    const store = new SessionStore(secrets, config, fabric.fetch);
    expect(await store.signOut()).toEqual({ revoked: true, hadSession: true });

    const revoke = fabric.to('/oauth/revoke')[0];
    expect(revoke?.form['token']).toBe(REFRESH);
    expect(revoke?.form['token_type_hint']).toBe('refresh_token');

    expect(await readSession(secrets)).toBeNull();
    expect(secrets.dump()).not.toContain(ACCESS);
  });

  it('drops the session even when the fabric could not be reached', async () => {
    const secrets = new MockSecretStorage();
    await writeSession(secrets, session());
    const fabric = mockFabric(() => ({ throws: 'ECONNREFUSED' }));

    const store = new SessionStore(secrets, config, fabric.fetch);
    expect(await store.signOut()).toEqual({ revoked: false, hadSession: true });
    expect(await readSession(secrets)).toBeNull();
  });

  it('says there was nothing to sign out of', async () => {
    const secrets = new MockSecretStorage();
    const fabric = mockFabric(() => ({ status: 200 }));
    expect(await new SessionStore(secrets, config, fabric.fetch).signOut()).toEqual({
      revoked: false,
      hadSession: false,
    });
    expect(fabric.requests).toEqual([]);
  });
});

/**
 * A seat cannot promote itself.
 *
 * The request asked for `role:constructor`. The fabric answered `role:consult`. What is stored
 * is nothing, what is returned is an error naming both, and the tokens that were issued are
 * revoked on the way out rather than left alive for a client that has decided not to use them.
 */
describe('a self-elevated role does not become one', () => {
  const consultGrant = {
    accessToken: 'at-consult',
    refreshToken: 'rt-consult',
    expiresAt: null,
    scopes: ['role:consult'],
    tokenType: 'Bearer',
  };

  it('refuses the grant, and says what was actually given', async () => {
    const secrets = new MockSecretStorage();
    const fabric = mockFabric(() => ({ status: 200 }));

    await expect(
      acceptGrant(secrets, config, fabric.fetch, consultGrant, [CONSTRUCTOR_ROLE], 'session-x'),
    ).rejects.toBeInstanceOf(RoleNotGrantedError);
  });

  it('stores nothing', async () => {
    const secrets = new MockSecretStorage();
    const fabric = mockFabric(() => ({ status: 200 }));

    await acceptGrant(secrets, config, fabric.fetch, consultGrant, [CONSTRUCTOR_ROLE], 'session-x').catch(
      () => undefined,
    );

    expect(await readSession(secrets)).toBeNull();
    expect(secrets.writes).toEqual([]);
  });

  it('revokes the lineage it is refusing', async () => {
    const secrets = new MockSecretStorage();
    const fabric = mockFabric(() => ({ status: 200 }));

    await acceptGrant(secrets, config, fabric.fetch, consultGrant, [CONSTRUCTOR_ROLE], 'session-x').catch(
      () => undefined,
    );

    expect(fabric.to('/oauth/revoke')[0]?.form['token']).toBe('rt-consult');
  });

  it('does not read a scope it never saw as a granted one', () => {
    const stored = sessionFromGrant(consultGrant, 'session-x', "Mew'd fabric");
    expect(isConstructor(stored)).toBe(false);
    expect(stored.scopes).toEqual(['role:consult']);
  });

  it('accepts the grant when the fabric really did give the role', async () => {
    const secrets = new MockSecretStorage();
    const fabric = mockFabric(() => ({ status: 200 }));

    const accepted = await acceptGrant(
      secrets,
      config,
      fabric.fetch,
      { ...consultGrant, scopes: [CONSTRUCTOR_ROLE] },
      [CONSTRUCTOR_ROLE],
      'session-x',
    );

    expect(isConstructor(accepted)).toBe(true);
    expect(await readSession(secrets)).toEqual(accepted);
    expect(fabric.to('/oauth/revoke')).toEqual([]);
  });
});
