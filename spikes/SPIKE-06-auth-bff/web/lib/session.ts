import 'server-only';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { Redis } from 'ioredis';
import { env, SESSION_ABSOLUTE_TTL_MS, SESSION_IDLE_TTL_S } from './env';

/**
 * Session store server-side en Valkey. La cookie solo lleva un sid opaco de 256 bits.
 * - Clave en Valkey = sha256(sid): un volcado del store no permite reconstruir cookies.
 * - Valor = JSON cifrado AES-256-GCM (AAD = clave), así los tokens no quedan en claro en Valkey.
 */
export interface SessionData {
  sub: string;
  name?: string;
  email?: string;
  accessToken: string;
  accessTokenExpiresAt: number;
  refreshToken?: string;
  idToken?: string;
  csrfSecret: string;
  createdAt: number;
  absoluteExpiresAt: number;
  refreshCount: number;
}

const g = globalThis as unknown as { __pfosValkey?: Redis };
export const valkey = (): Redis => (g.__pfosValkey ??= new Redis(env.valkeyUrl, { lazyConnect: false, maxRetriesPerRequest: 2 }));

const keyOf = (sid: string) => `pfos:sess:${createHash('sha256').update(sid).digest('base64url')}`;
const pendingKey = (state: string) => `pfos:auth:${createHash('sha256').update(state).digest('base64url')}`;

function encrypt(plain: string, aad: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', env.sessionKey, iv);
  c.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64url'), ct.toString('base64url'), c.getAuthTag().toString('base64url')].join('.');
}

function decrypt(blob: string, aad: string): string {
  const [v, iv, ct, tag] = blob.split('.');
  if (v !== 'v1' || !iv || !ct || !tag) throw new Error('formato de sesión inválido');
  const d = createDecipheriv('aes-256-gcm', env.sessionKey, Buffer.from(iv, 'base64url'));
  d.setAAD(Buffer.from(aad));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8');
}

export async function createSession(data: Omit<SessionData, 'csrfSecret' | 'createdAt' | 'absoluteExpiresAt' | 'refreshCount'>): Promise<string> {
  const sid = randomBytes(32).toString('base64url');
  const now = Date.now();
  const full: SessionData = { ...data, csrfSecret: randomBytes(32).toString('base64url'), createdAt: now, absoluteExpiresAt: now + SESSION_ABSOLUTE_TTL_MS, refreshCount: 0 };
  await saveSession(sid, full);
  return sid;
}

export async function saveSession(sid: string, data: SessionData): Promise<void> {
  const k = keyOf(sid);
  await valkey().set(k, encrypt(JSON.stringify(data), k), 'EX', SESSION_IDLE_TTL_S);
}

export async function getSession(sid: string | undefined): Promise<SessionData | null> {
  if (!sid || sid.length > 100) return null;
  const k = keyOf(sid);
  const blob = await valkey().get(k);
  if (!blob) return null;
  let data: SessionData;
  try {
    data = JSON.parse(decrypt(blob, k)) as SessionData;
  } catch {
    await valkey().del(k);
    return null;
  }
  if (Date.now() > data.absoluteExpiresAt) {
    await valkey().del(k);
    return null;
  }
  await valkey().expire(k, SESSION_IDLE_TTL_S); // idle TTL deslizante
  return data;
}

export async function destroySession(sid: string | undefined): Promise<void> {
  if (sid) await valkey().del(keyOf(sid));
}

/** Estado transitorio de la autorización (state, nonce, code_verifier), one-time, TTL 10 min. */
export interface PendingAuth { codeVerifier: string; nonce: string; returnTo: string }

export async function savePendingAuth(state: string, p: PendingAuth): Promise<void> {
  const k = pendingKey(state);
  await valkey().set(k, encrypt(JSON.stringify(p), k), 'EX', 600);
}

export async function consumePendingAuth(state: string): Promise<PendingAuth | null> {
  const k = pendingKey(state);
  const blob = await valkey().getdel(k); // consumo atómico: un state no se puede reutilizar
  if (!blob) return null;
  return JSON.parse(decrypt(blob, k)) as PendingAuth;
}
