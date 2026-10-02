import 'server-only';
import * as client from 'openid-client';
import { env } from './env';

let configPromise: Promise<client.Configuration> | undefined;

/** Discovery cacheado (openid-client v6, certificado OpenID). */
export function oidc(): Promise<client.Configuration> {
  configPromise ??= client
    .discovery(new URL(env.issuer), env.clientId, env.clientSecret, undefined, {
      // Solo dev: Keycloak local en http. En prod se elimina (HTTPS obligatorio).
      execute: env.issuer.startsWith('http://') ? [client.allowInsecureRequests] : [],
    })
    .catch((e) => {
      configPromise = undefined;
      throw e;
    });
  return configPromise;
}

export { client };
