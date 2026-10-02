import { createRemoteJWKSet, jwtVerify, errors, type JWTPayload } from 'jose';
import { config } from './config.js';

// JWKS remoto cacheado: jose guarda las claves `cacheMaxAge` y solo hace refetch ante un `kid`
// desconocido respetando `cooldownDuration` (rate limit contra DoS por kids aleatorios).
const jwksUri = new URL(`${config.issuer}/protocol/openid-connect/certs`);
export const JWKS = createRemoteJWKSet(jwksUri, {
  cacheMaxAge: config.jwksCacheMaxAgeMs,
  cooldownDuration: config.jwksCooldownMs,
});

export interface AccessTokenClaims extends JWTPayload {
  sub: string;
  azp?: string;
  typ?: string;
  email?: string;
  email_verified?: boolean;
  groups?: string[];
}

export class TokenRejected extends Error {
  constructor(public readonly reason: string) {
    super(reason);
  }
}

export async function verifyAccessToken(token: string): Promise<AccessTokenClaims> {
  try {
    const { payload } = await jwtVerify<AccessTokenClaims>(token, JWKS, {
      issuer: config.issuer, // exacto
      audience: config.audience, // aud debe contener finance-api
      algorithms: ['RS256', 'ES256'], // allowlist: none / HS* rechazados
      clockTolerance: config.clockToleranceSec, // exp / nbf / iat con skew de 30 s
      requiredClaims: ['exp', 'iat', 'sub'],
    });
    if (!payload.azp || !config.allowedAzp.includes(payload.azp)) throw new TokenRejected('ERR_AZP_NOT_ALLOWED');
    // Keycloak marca typ=Bearer en access tokens; un id_token (typ=ID) no debe servir contra la API.
    if (payload.typ !== undefined && payload.typ !== 'Bearer') throw new TokenRejected('ERR_TYP_NOT_BEARER');
    return payload;
  } catch (e) {
    if (e instanceof TokenRejected) throw e;
    if (e instanceof errors.JOSEError) throw new TokenRejected(e.code);
    throw new TokenRejected('ERR_INVALID_TOKEN');
  }
}
