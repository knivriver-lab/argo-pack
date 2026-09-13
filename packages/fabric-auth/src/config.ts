/**
 * The two settings, and what counts as a usable value for each.
 *
 * `mewd.fabric.baseUrl` and `mewd.fabric.clientId` are the operator's to fill in. Neither has a
 * default, and no host, address or client id appears anywhere in this repository — argo-pack is
 * public, and a default would be either a lie or a leak.
 *
 * An unset setting is reported as a plain sentence the operator can act on, not as a stack
 * trace and not as a silent no-op.
 */

export const CONFIG_SECTION = 'mewd.fabric';
export const BASE_URL_SETTING = `${CONFIG_SECTION}.baseUrl`;
export const CLIENT_ID_SETTING = `${CONFIG_SECTION}.clientId`;

export interface FabricConfig {
  /** Absolute, no trailing slash. */
  readonly baseUrl: string;
  readonly clientId: string;
}

export type ConfigResult = { ok: true; config: FabricConfig } | { ok: false; problem: string };

/** Over TLS, or over loopback. OAuth 2.1 permits the second and requires the first. */
function isAcceptableOrigin(url: URL): boolean {
  if (url.protocol === 'https:') return true;
  if (url.protocol !== 'http:') return false;
  return url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
}

export function readFabricConfig(baseUrlRaw: unknown, clientIdRaw: unknown): ConfigResult {
  const baseUrl = typeof baseUrlRaw === 'string' ? baseUrlRaw.trim() : '';
  const clientId = typeof clientIdRaw === 'string' ? clientIdRaw.trim() : '';

  if (baseUrl === '') {
    return { ok: false, problem: `${BASE_URL_SETTING} is not set — point it at your fabric.` };
  }
  if (clientId === '') {
    return {
      ok: false,
      problem: `${CLIENT_ID_SETTING} is not set — put the public client id your fabric issued for this editor there. This plank does not register itself, so there is no id for it to invent.`,
    };
  }

  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return { ok: false, problem: `${BASE_URL_SETTING} is not an absolute URL: ${JSON.stringify(baseUrl)}` };
  }
  if (!isAcceptableOrigin(url)) {
    return {
      ok: false,
      problem: `${BASE_URL_SETTING} must be an https URL, or http on loopback — found ${JSON.stringify(url.protocol)}. Tokens do not travel in clear over somebody else's network.`,
    };
  }

  return { ok: true, config: { baseUrl: baseUrl.replace(/\/+$/, ''), clientId } };
}
