import 'server-only';
import { oidc, client } from './oidc';
import { REFRESH_SKEW_MS } from './env';
import { saveSession, type SessionData } from './session';

// Single-flight por sesión: Keycloak rota el refresh token con detección de reutilización
// (refreshTokenMaxReuse=0), así que dos refresh concurrentes con el mismo token invalidarían la sesión.
// Limitación: el lock es por proceso. Con >1 réplica del BFF hace falta un lock en Valkey (SET NX PX).
const inflight = new Map<string, Promise<SessionData>>();

export class SessionExpired extends Error {}

export async function refresh(sid: string, s: SessionData): Promise<SessionData> {
  const running = inflight.get(sid);
  if (running) return running;
  const p = (async () => {
    if (!s.refreshToken) throw new SessionExpired('sin refresh token');
    try {
      const t = await client.refreshTokenGrant(await oidc(), s.refreshToken);
      const next: SessionData = {
        ...s,
        accessToken: t.access_token,
        accessTokenExpiresAt: Date.now() + (t.expires_in ?? 60) * 1000,
        refreshToken: t.refresh_token ?? s.refreshToken,
        idToken: t.id_token ?? s.idToken,
        refreshCount: s.refreshCount + 1,
      };
      await saveSession(sid, next);
      return next;
    } catch (e) {
      throw new SessionExpired(e instanceof Error ? e.message : 'refresh falló');
    }
  })().finally(() => inflight.delete(sid));
  inflight.set(sid, p);
  return p;
}

/** Devuelve una sesión con access token válido al menos REFRESH_SKEW_MS más. */
export async function ensureFreshAccessToken(sid: string, s: SessionData): Promise<SessionData> {
  if (s.accessTokenExpiresAt - Date.now() > REFRESH_SKEW_MS) return s;
  return refresh(sid, s);
}
