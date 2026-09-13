/**
 * The OAuth client, against a fabric that exists only here.
 *
 * The test that matters most is the last block. Everything else checks that a correct exchange
 * produces a correct grant; `grantedScopes` checks that an *incorrect* one — a client asking for
 * a role it was not given — does not.
 */

import { describe, expect, it } from 'vitest';
import {
  authorizationUrl,
  CONSTRUCTOR_ROLE,
  defaultEndpoints,
  discoverEndpoints,
  exchangeCode,
  grantedScopes,
  hasRole,
  METADATA_PATH,
  OAuthError,
  refreshGrant,
  revokeGrant,
  satisfies,
} from '../src/oauth.js';
import { BASE_URL, CLIENT_ID, mockFabric, REDIRECT_URI } from './mock-fabric.js';

const endpoints = defaultEndpoints(BASE_URL);

describe('endpoints', () => {
  it('falls back to the conventional paths', () => {
    expect(defaultEndpoints(BASE_URL)).toEqual({
      authorization: `${BASE_URL}/oauth/authorize`,
      token: `${BASE_URL}/oauth/token`,
      revocation: `${BASE_URL}/oauth/revoke`,
    });
  });

  it('does not double the slash when the setting has a trailing one', () => {
    expect(defaultEndpoints(`${BASE_URL}/`).token).toBe(`${BASE_URL}/oauth/token`);
  });

  it('prefers what the fabric publishes', async () => {
    const fabric = mockFabric(() => ({
      body: {
        issuer: BASE_URL,
        authorization_endpoint: `${BASE_URL}/authorize`,
        token_endpoint: `${BASE_URL}/token`,
        revocation_endpoint: `${BASE_URL}/revoke`,
      },
    }));
    expect(await discoverEndpoints(BASE_URL, fabric.fetch)).toEqual({
      authorization: `${BASE_URL}/authorize`,
      token: `${BASE_URL}/token`,
      revocation: `${BASE_URL}/revoke`,
    });
    expect(fabric.requests[0]?.url).toBe(`${BASE_URL}${METADATA_PATH}`);
  });

  it('falls back per-endpoint when the metadata only answers some of it', async () => {
    const fabric = mockFabric(() => ({ body: { token_endpoint: `${BASE_URL}/token` } }));
    const found = await discoverEndpoints(BASE_URL, fabric.fetch);
    expect(found.token).toBe(`${BASE_URL}/token`);
    expect(found.authorization).toBe(`${BASE_URL}/oauth/authorize`);
  });

  it('falls back when there is no metadata, or when the host cannot be reached', async () => {
    const missing = mockFabric(() => ({ status: 404 }));
    expect(await discoverEndpoints(BASE_URL, missing.fetch)).toEqual(endpoints);

    const unreachable = mockFabric(() => ({ throws: 'ENOTFOUND' }));
    expect(await discoverEndpoints(BASE_URL, unreachable.fetch)).toEqual(endpoints);
  });
});

describe('the authorization request', () => {
  const url = new URL(
    authorizationUrl({
      endpoints,
      clientId: CLIENT_ID,
      redirectUri: REDIRECT_URI,
      challenge: 'a-challenge',
      state: 'a-state',
      scopes: [CONSTRUCTOR_ROLE],
    }),
  );

  it('is a code flow with an S256 challenge', () => {
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('code_challenge')).toBe('a-challenge');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  });

  it('names the public client and the editor’s own redirect', () => {
    expect(url.searchParams.get('client_id')).toBe(CLIENT_ID);
    expect(url.searchParams.get('redirect_uri')).toBe(REDIRECT_URI);
  });

  it('asks for the constructor role and carries a state', () => {
    expect(url.searchParams.get('scope')).toBe(CONSTRUCTOR_ROLE);
    expect(url.searchParams.get('state')).toBe('a-state');
  });

  it('carries no secret — there is not one to carry', () => {
    expect(url.search).not.toMatch(/client_secret/);
  });
});

describe('exchanging the code', () => {
  it('sends the verifier and the client id, and no secret', async () => {
    const fabric = mockFabric(() => ({
      body: { access_token: 'at-1', refresh_token: 'rt-1', expires_in: 3600, scope: CONSTRUCTOR_ROLE },
    }));

    const grant = await exchangeCode(
      { endpoints, clientId: CLIENT_ID, redirectUri: REDIRECT_URI, code: 'the-code', verifier: 'the-verifier' },
      fabric.fetch,
      1_000_000,
    );

    const request = fabric.to('/oauth/token')[0];
    expect(request?.form).toEqual({
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      code: 'the-code',
      code_verifier: 'the-verifier',
    });
    expect(request?.body).not.toMatch(/client_secret/);

    expect(grant.accessToken).toBe('at-1');
    expect(grant.refreshToken).toBe('rt-1');
    expect(grant.expiresAt).toBe(1_000_000 + 3_600_000);
    expect(grant.scopes).toEqual([CONSTRUCTOR_ROLE]);
  });

  it('reports the error the fabric named', async () => {
    const fabric = mockFabric(() => ({
      status: 400,
      body: { error: 'invalid_grant', error_description: 'that code has been used' },
    }));
    await expect(
      exchangeCode(
        { endpoints, clientId: CLIENT_ID, redirectUri: REDIRECT_URI, code: 'x', verifier: 'y' },
        fabric.fetch,
      ),
    ).rejects.toMatchObject({ name: 'OAuthError', code: 'invalid_grant' });
  });

  it('refuses a 200 that carried no access token', async () => {
    const fabric = mockFabric(() => ({ body: { scope: CONSTRUCTOR_ROLE } }));
    await expect(
      exchangeCode(
        { endpoints, clientId: CLIENT_ID, redirectUri: REDIRECT_URI, code: 'x', verifier: 'y' },
        fabric.fetch,
      ),
    ).rejects.toBeInstanceOf(OAuthError);
  });
});

describe('refreshing', () => {
  it('presents the refresh token and takes back the rotated one', async () => {
    const fabric = mockFabric(() => ({
      body: { access_token: 'at-2', refresh_token: 'rt-2', expires_in: 60, scope: CONSTRUCTOR_ROLE },
    }));

    const grant = await refreshGrant({ endpoints, clientId: CLIENT_ID, refreshToken: 'rt-1' }, fabric.fetch, 0);

    expect(fabric.to('/oauth/token')[0]?.form).toEqual({
      grant_type: 'refresh_token',
      client_id: CLIENT_ID,
      refresh_token: 'rt-1',
    });
    expect(grant.accessToken).toBe('at-2');
    expect(grant.refreshToken).toBe('rt-2');
    expect(grant.refreshToken).not.toBe('rt-1');
  });

  it('raises rather than returning a grant when the lineage is gone', async () => {
    const fabric = mockFabric(() => ({ status: 400, body: { error: 'invalid_grant' } }));
    await expect(
      refreshGrant({ endpoints, clientId: CLIENT_ID, refreshToken: 'rt-dead' }, fabric.fetch),
    ).rejects.toMatchObject({ code: 'invalid_grant' });
  });
});

describe('revoking', () => {
  it('presents the refresh token, hinted as one, so the family goes with it', async () => {
    const fabric = mockFabric(() => ({ status: 200 }));
    expect(await revokeGrant({ endpoints, clientId: CLIENT_ID, refreshToken: 'rt-1' }, fabric.fetch)).toBe(true);

    const request = fabric.to('/oauth/revoke')[0];
    expect(request?.method).toBe('POST');
    expect(request?.form).toEqual({
      client_id: CLIENT_ID,
      token: 'rt-1',
      token_type_hint: 'refresh_token',
    });
  });

  it('says so, rather than throwing, when the fabric cannot be reached', async () => {
    const fabric = mockFabric(() => ({ throws: 'ECONNREFUSED' }));
    expect(await revokeGrant({ endpoints, clientId: CLIENT_ID, refreshToken: 'rt-1' }, fabric.fetch)).toBe(false);
  });
});

/**
 * Server-authoritative roles, per 0070.
 *
 * This is the whole of the defence against a client that decides what it is. The scope it asked
 * for is in the request; the scope it holds is in the response; these are never the same value
 * read twice.
 */
describe('the role is the fabric’s to give', () => {
  it('takes the granted scopes from the response', () => {
    expect(grantedScopes({ scope: 'role:consult openid' })).toEqual(['role:consult', 'openid']);
  });

  it('does not read a requested role back as a granted one', async () => {
    const fabric = mockFabric(() => ({
      // The seat asked for role:constructor. The fabric is answering role:consult.
      body: { access_token: 'at-consult', refresh_token: 'rt-consult', scope: 'role:consult' },
    }));

    const grant = await exchangeCode(
      { endpoints, clientId: CLIENT_ID, redirectUri: REDIRECT_URI, code: 'c', verifier: 'v' },
      fabric.fetch,
    );

    expect(fabric.to('/oauth/token')[0]?.form['code']).toBe('c');
    expect(grant.scopes).toEqual(['role:consult']);
    expect(hasRole(grant.scopes, CONSTRUCTOR_ROLE)).toBe(false);
    expect(satisfies(grant.scopes, [CONSTRUCTOR_ROLE])).toBe(false);
  });

  it('claims nothing at all when the response does not say what it granted', async () => {
    const fabric = mockFabric(() => ({ body: { access_token: 'at-quiet' } }));
    const grant = await exchangeCode(
      { endpoints, clientId: CLIENT_ID, redirectUri: REDIRECT_URI, code: 'c', verifier: 'v' },
      fabric.fetch,
    );
    expect(grant.scopes).toEqual([]);
    expect(hasRole(grant.scopes, CONSTRUCTOR_ROLE)).toBe(false);
  });

  it('holds a role only when the fabric named it', () => {
    expect(satisfies(['role:constructor', 'openid'], [CONSTRUCTOR_ROLE])).toBe(true);
    expect(satisfies(['role:constructor'], [CONSTRUCTOR_ROLE, 'role:mayor'])).toBe(false);
  });
});
