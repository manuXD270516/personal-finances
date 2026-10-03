import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { ApiProblem } from '../errors/problem.js';
import { canonicalJson } from '../idempotency/request-hash.js';

/** Clave de firma de cursores con identificador para rotación. */
export interface CursorKey {
  readonly kid: string;
  readonly secret: string;
}

/** Ámbito en el que un cursor es válido: recurso, workspace y filtros + orden canónicos (docs/10 §5.1). */
export interface CursorScope {
  readonly resource: string;
  /** Workspace de la ruta (o el usuario en colecciones sin workspace). */
  readonly workspaceId: string;
  /** Filtros y `sort` efectivos de la petición (sin `cursor` ni `limit`). */
  readonly filters: Readonly<Record<string, unknown>>;
}

/** Posición keyset: valores de las claves de orden y, al final, el `id` (UUIDv7) como desempate. */
export type CursorPosition = readonly (string | number | boolean | null)[];

interface Payload {
  readonly v: 1;
  readonly kid: string;
  readonly r: string;
  readonly w: string;
  readonly f: string;
  readonly k: CursorPosition;
}

const MIN_SECRET_LENGTH = 32;
const KID = /^[A-Za-z0-9_-]{1,32}$/;

const b64url = (buf: Buffer) => buf.toString('base64url');

/**
 * `CURSOR_SIGNING_KEY` = `kid:secreto[,kid:secreto…]`: la primera firma; todas verifican (rotación por `kid`).
 * Secreto ≥ 32 caracteres.
 */
export function parseCursorKeys(value: string): CursorKey[] {
  const keys = value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const sep = part.indexOf(':');
      const kid = sep > 0 ? part.slice(0, sep) : '';
      const secret = sep > 0 ? part.slice(sep + 1) : '';
      if (!KID.test(kid) || secret.length < MIN_SECRET_LENGTH) {
        throw new Error(
          `clave de cursor inválida: formato kid:secreto con secreto de ≥ ${MIN_SECRET_LENGTH} caracteres`,
        );
      }
      return { kid, secret };
    });
  if (keys.length === 0) throw new Error('se requiere al menos una clave de cursor');
  if (new Set(keys.map((k) => k.kid)).size !== keys.length) throw new Error('kid de cursor duplicado');
  return keys;
}

/** Clave efímera para local/ci sin `CURSOR_SIGNING_KEY` (los cursores dejan de valer al reiniciar). */
export const ephemeralCursorKey = (): CursorKey => ({ kid: 'eph', secret: randomBytes(32).toString('hex') });

/**
 * Codec de cursores opacos firmados (design §5):
 * `base64url(JSON{v, kid, r, w, f, k}) "." base64url(HMAC-SHA256(secret[kid], payload))`.
 * Firma inválida, `kid` desconocido, versión desconocida o `r`/`w`/`f` distintos ⇒ 400 `INVALID_CURSOR`.
 */
export class CursorCodec {
  private readonly signing: CursorKey;
  private readonly byKid: ReadonlyMap<string, CursorKey>;

  constructor(keys: readonly CursorKey[]) {
    const [first] = keys;
    if (!first) throw new Error('CursorCodec requiere al menos una clave');
    this.signing = first;
    this.byKid = new Map(keys.map((k) => [k.kid, k]));
  }

  static filtersHash(filters: Readonly<Record<string, unknown>>): string {
    return createHash('sha256').update(canonicalJson(filters)).digest('base64url');
  }

  encode(scope: CursorScope, position: CursorPosition): string {
    const payload: Payload = {
      v: 1,
      kid: this.signing.kid,
      r: scope.resource,
      w: scope.workspaceId,
      f: CursorCodec.filtersHash(scope.filters),
      k: position,
    };
    const body = b64url(Buffer.from(JSON.stringify(payload), 'utf8'));
    return `${body}.${this.sign(this.signing, body)}`;
  }

  decode(cursor: string, scope: CursorScope): CursorPosition {
    const invalid = () =>
      new ApiProblem('INVALID_CURSOR', 'cursor is invalid for this resource, workspace, filters or sort');
    const parts = cursor.split('.');
    if (parts.length !== 2 || !parts[0] || !parts[1]) throw invalid();
    const [body, signature] = parts as [string, string];
    let payload: Payload;
    try {
      payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Payload;
    } catch {
      throw invalid();
    }
    const key = typeof payload?.kid === 'string' ? this.byKid.get(payload.kid) : undefined;
    if (!key) throw invalid();
    const expected = Buffer.from(this.sign(key, body), 'base64url');
    const given = Buffer.from(signature, 'base64url');
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) throw invalid();
    if (
      payload.v !== 1 ||
      payload.r !== scope.resource ||
      payload.w !== scope.workspaceId ||
      payload.f !== CursorCodec.filtersHash(scope.filters) ||
      !Array.isArray(payload.k) ||
      payload.k.length === 0
    ) {
      throw invalid();
    }
    return payload.k;
  }

  private sign(key: CursorKey, body: string): string {
    return b64url(createHmac('sha256', key.secret).update(body).digest());
  }
}

/** Página de colección (`components.schemas.PageInfo`). */
export interface PageInfo {
  readonly limit: number;
  readonly hasMore: boolean;
  readonly nextCursor: string | null;
}

export interface Page<T> {
  readonly data: readonly T[];
  readonly page: PageInfo;
}

export const DEFAULT_PAGE_LIMIT = 50;
export const MAX_PAGE_LIMIT = 200;

/**
 * Arma la página a partir de `limit + 1` filas ya ordenadas por keyset (la fila extra solo indica `hasMore`).
 * `positionOf` devuelve las claves de orden + `id` del último elemento devuelto.
 */
export function buildPage<T>(
  rows: readonly T[],
  limit: number,
  positionOf: (row: T) => CursorPosition,
  encode: (position: CursorPosition) => string,
): Page<T> {
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  const last = data.at(-1);
  return {
    data,
    page: { limit, hasMore, nextCursor: hasMore && last !== undefined ? encode(positionOf(last)) : null },
  };
}
