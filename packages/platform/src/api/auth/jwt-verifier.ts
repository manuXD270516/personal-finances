import {
  createLocalJWKSet,
  createRemoteJWKSet,
  errors as joseErrors,
  jwtVerify,
  type JSONWebKeySet,
  type JWTPayload,
  type JWTVerifyGetKey,
} from 'jose';
import { ApiProblem } from '../errors/problem.js';

/**
 * Validación de access tokens JWT (docs/12 §3.1, ADR-0010, SPIKE-06) como adapter de infraestructura sin framework.
 * Allowlist de algoritmos asimétricos (nunca `none`/HS*), `iss`, `aud`, `exp`/`nbf` con tolerancia de reloj,
 * `typ` de access token, `azp` opcional y scope requerido. JWKS remoto con caché (10 min), refetch limitado
 * (cooldown) por `kid` desconocido. Cualquier fallo ⇒ 401 `UNAUTHENTICATED` sin revelar qué validación falló.
 */
export interface JwtVerifierOptions {
  readonly issuer: string;
  readonly audience: string;
  /** Scope que el token debe incluir (claim `scope`, separado por espacios). Vacío ⇒ no se exige. */
  readonly requiredScope?: string;
  /** Clientes autorizados (`azp`); vacío ⇒ no se restringe. */
  readonly authorizedParties?: readonly string[];
  /** Tolerancia de reloj para `exp`/`nbf` en segundos (por defecto 30). */
  readonly clockSkewSeconds?: number;
  readonly algorithms?: readonly string[];
  /** `typ` aceptados en la cabecera; los id tokens (`typ: ID`) se rechazan por el claim `typ` de Keycloak. */
  readonly acceptedTypes?: readonly string[];
  /** Fuente de claves: URL del JWKS (cacheado) o un JWKS local (tests). */
  readonly jwks: URL | JSONWebKeySet;
  /** Caché del JWKS remoto en ms (por defecto 10 min). */
  readonly jwksCacheMaxAgeMs?: number;
  /** Intervalo mínimo entre refetch del JWKS por `kid` desconocido en ms (por defecto 30 s). */
  readonly jwksCooldownMs?: number;
  /** Reloj inyectable (tests). */
  readonly now?: () => Date;
}

export interface VerifiedAccessToken {
  readonly issuer: string;
  readonly subject: string;
  readonly email: string | null;
  readonly displayName: string | null;
  readonly claims: JWTPayload;
}

export const DEFAULT_JWT_ALGORITHMS = ['RS256', 'PS256', 'ES256'] as const;

const unauthenticated = () => new ApiProblem('UNAUTHENTICATED', 'a valid access token is required');

export class JwtVerifier {
  private readonly keys: JWTVerifyGetKey;

  constructor(private readonly options: JwtVerifierOptions) {
    this.keys =
      options.jwks instanceof URL
        ? createRemoteJWKSet(options.jwks, {
            cacheMaxAge: options.jwksCacheMaxAgeMs ?? 10 * 60_000,
            cooldownDuration: options.jwksCooldownMs ?? 30_000,
          })
        : createLocalJWKSet(options.jwks);
  }

  /** Extrae el bearer de `Authorization` (`undefined` si no hay uno bien formado). */
  static bearer(header: string | undefined): string | undefined {
    const m = /^Bearer ([A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]*)$/.exec(header?.trim() ?? '');
    return m?.[1];
  }

  async verify(token: string | undefined): Promise<VerifiedAccessToken> {
    if (!token) throw unauthenticated();
    const o = this.options;
    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(token, this.keys, {
        issuer: o.issuer,
        audience: o.audience,
        algorithms: [...(o.algorithms ?? DEFAULT_JWT_ALGORITHMS)],
        clockTolerance: o.clockSkewSeconds ?? 30,
        requiredClaims: ['sub', 'exp', 'iat'],
        ...(o.now ? { currentDate: o.now() } : {}),
      }));
    } catch (err) {
      if (err instanceof joseErrors.JOSEError || err instanceof TypeError) throw unauthenticated();
      throw err;
    }
    // Keycloak marca el tipo de token en el claim `typ` (`Bearer` = access token, `ID` = id token).
    const typ = payload['typ'];
    const accepted = o.acceptedTypes ?? ['Bearer', 'at+jwt'];
    if (typ !== undefined && (typeof typ !== 'string' || !accepted.includes(typ))) throw unauthenticated();
    if (o.authorizedParties && o.authorizedParties.length > 0) {
      const azp = payload['azp'];
      if (typeof azp !== 'string' || !o.authorizedParties.includes(azp)) throw unauthenticated();
    }
    if (o.requiredScope) {
      const scope = payload['scope'];
      const scopes = typeof scope === 'string' ? scope.split(' ') : [];
      if (!scopes.includes(o.requiredScope)) throw unauthenticated();
    }
    const str = (v: unknown) => (typeof v === 'string' && v.length > 0 ? v : null);
    return {
      issuer: o.issuer,
      subject: payload.sub as string,
      email: str(payload['email']),
      displayName: str(payload['name']) ?? str(payload['preferred_username']),
      claims: payload,
    };
  }
}
