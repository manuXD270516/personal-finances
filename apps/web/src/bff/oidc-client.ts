import * as client from 'openid-client';

/** Respuesta del token endpoint reducida a lo que guarda la sesión. */
export interface OidcTokens {
  readonly accessToken: string;
  /** Segundos de vida del access token (`expires_in`). */
  readonly expiresIn: number | undefined;
  readonly refreshToken: string | undefined;
  readonly idToken: string | undefined;
}

/** El IdP rechazó el grant (p. ej. `invalid_grant` por refresh revocado o reusado): la sesión está muerta. */
export class OidcGrantRejected extends Error {
  override readonly name = 'OidcGrantRejected';
}

/**
 * Operaciones OIDC del BFF (Authorization Code + PKCE S256, refresh, revocación y RP-initiated logout). Puerto para
 * que los tests usen un IdP falso; la implementación real es `openid-client` 6 (ADR-0010).
 */
export interface OidcClient {
  authorizationUrl(input: {
    readonly redirectUri: string;
    readonly scope: string;
    readonly state: string;
    readonly nonce: string;
    readonly codeChallenge: string;
  }): Promise<URL>;
  /** Canjea el `code` validando `state`, `nonce`, PKCE y el id token (firma, `iss`, `aud`, `exp`). */
  exchangeCode(
    callbackUrl: URL,
    checks: { readonly state: string; readonly nonce: string; readonly codeVerifier: string },
  ): Promise<OidcTokens>;
  refresh(refreshToken: string): Promise<OidcTokens>;
  revoke(refreshToken: string): Promise<void>;
  endSessionUrl(input: { readonly idToken?: string; readonly postLogoutRedirectUri: string }): Promise<URL>;
}

export interface OpenIdClientOptions {
  /** Emisor público (`iss`), tal como lo ve el navegador. */
  readonly issuer: string;
  /** Base alternativa (back-channel) para el discovery; el `issuer` del documento debe ser `issuer`. */
  readonly discoveryUrl?: string;
  readonly clientId: string;
  readonly clientSecret: string;
  /** Solo local/ci: Keycloak de desarrollo en http. En staging/production se exige https. */
  readonly allowHttp: boolean;
}

const toTokens = (t: client.TokenEndpointResponse): OidcTokens => ({
  accessToken: t.access_token,
  expiresIn: t.expires_in,
  refreshToken: t.refresh_token,
  idToken: t.id_token,
});

const rejected = (err: unknown): boolean =>
  err instanceof client.ResponseBodyError || err instanceof client.AuthorizationResponseError;

/** `openid-client` 6 con discovery perezoso y cacheado (se reintenta si falla). */
export function createOpenIdClient(options: OpenIdClientOptions): OidcClient {
  let configuration: Promise<client.Configuration> | undefined;
  const issuer = options.issuer.replace(/\/+$/, '');

  async function discover(): Promise<client.Configuration> {
    const auth = client.ClientSecretBasic(options.clientSecret);
    let config: client.Configuration;
    if (options.discoveryUrl) {
      // El contenedor no alcanza la URL pública del IdP: se lee el documento por el back-channel y se exige que
      // declare el emisor público (los endpoints de back-channel del documento apuntan a la red interna).
      const base = options.discoveryUrl.replace(/\/+$/, '');
      const res = await fetch(`${base}/.well-known/openid-configuration`, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) throw new Error(`discovery OIDC falló (${res.status})`);
      const metadata = (await res.json()) as client.ServerMetadata;
      if (metadata.issuer !== issuer)
        throw new Error('discovery OIDC: el issuer no coincide con OIDC_ISSUER_URL');
      config = new client.Configuration(metadata, options.clientId, undefined, auth);
    } else {
      config = await client.discovery(
        new URL(issuer),
        options.clientId,
        undefined,
        auth,
        options.allowHttp ? { execute: [client.allowInsecureRequests] } : undefined,
      );
    }
    if (options.allowHttp) client.allowInsecureRequests(config);
    return config;
  }

  const config = (): Promise<client.Configuration> => {
    configuration ??= discover().catch((err: unknown) => {
      configuration = undefined;
      throw err;
    });
    return configuration;
  };

  return {
    async authorizationUrl(input) {
      return client.buildAuthorizationUrl(await config(), {
        redirect_uri: input.redirectUri,
        scope: input.scope,
        response_type: 'code',
        code_challenge: input.codeChallenge,
        code_challenge_method: 'S256',
        state: input.state,
        nonce: input.nonce,
      });
    },
    async exchangeCode(callbackUrl, checks) {
      try {
        const tokens = await client.authorizationCodeGrant(await config(), callbackUrl, {
          pkceCodeVerifier: checks.codeVerifier,
          expectedState: checks.state,
          expectedNonce: checks.nonce,
          idTokenExpected: true,
        });
        return toTokens(tokens);
      } catch (err) {
        if (rejected(err)) throw new OidcGrantRejected('authorization code rejected', { cause: err });
        throw err;
      }
    },
    async refresh(refreshToken) {
      try {
        return toTokens(await client.refreshTokenGrant(await config(), refreshToken));
      } catch (err) {
        if (rejected(err)) throw new OidcGrantRejected('refresh token rejected', { cause: err });
        throw err;
      }
    },
    async revoke(refreshToken) {
      await client.tokenRevocation(await config(), refreshToken, { token_type_hint: 'refresh_token' });
    },
    async endSessionUrl(input) {
      return client.buildEndSessionUrl(await config(), {
        // `id_token_hint` evita la pantalla de confirmación del IdP. La API rechaza id tokens (`typ`).
        ...(input.idToken ? { id_token_hint: input.idToken } : { client_id: options.clientId }),
        post_logout_redirect_uri: input.postLogoutRedirectUri,
      });
    },
  };
}

export const pkce = {
  verifier: (): string => client.randomPKCECodeVerifier(),
  challenge: (verifier: string): Promise<string> => client.calculatePKCECodeChallenge(verifier),
  state: (): string => client.randomState(),
  nonce: (): string => client.randomNonce(),
};
