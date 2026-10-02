import 'server-only';

const req = (k: string): string => {
  const v = process.env[k];
  if (!v) throw new Error(`Falta variable ${k}`);
  return v;
};

export const env = {
  get appOrigin() { return req('APP_ORIGIN'); },
  get issuer() { return req('OIDC_ISSUER'); },
  get clientId() { return req('OIDC_CLIENT_ID'); },
  get clientSecret() { return req('OIDC_CLIENT_SECRET'); },
  get redirectUri() { return req('OIDC_REDIRECT_URI'); },
  get postLogoutRedirectUri() { return req('OIDC_POST_LOGOUT_REDIRECT_URI'); },
  get scope() { return req('OIDC_SCOPE'); },
  get sessionKey() { return Buffer.from(req('SESSION_ENC_KEY'), 'base64'); },
  get valkeyUrl() { return req('VALKEY_URL'); },
  get apiUrl() { return req('API_URL'); },
  get devEndpoints() { return process.env.BFF_DEV_ENDPOINTS === '1'; },
};

/** `__Host-`: obliga Secure + Path=/ + sin Domain. Chromium acepta Secure en http://localhost. */
export const SESSION_COOKIE = '__Host-pfos_sid';
export const SESSION_IDLE_TTL_S = 30 * 60; // idle
export const SESSION_ABSOLUTE_TTL_MS = 12 * 60 * 60 * 1000; // absoluto
export const REFRESH_SKEW_MS = 60_000; // refresh si el access token expira en < 60 s
