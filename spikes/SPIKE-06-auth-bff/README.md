# SPIKE-06 — Auth: Keycloak + BFF Next.js + finance-api (NestJS)

> Código **descartable** (evidencia para ADR-0010 y ADR-0019). Fecha: 2026-10-01/02. Máquina: Windows 11, Docker Desktop 29.8, Node 22.23, pnpm 12.4.

## Pregunta

¿Podemos implementar el patrón de ADR-0010/0019 (OIDC Authorization Code + PKCE ejecutado por un BFF Next.js, tokens solo server-side, cookie httpOnly, proxy `/api/bff/*` con bearer hacia `finance-api`, validación JWT con JWKS y RBAC por workspace) con librerías estándar, sin que el navegador vea nunca el access token? ¿Cuánto cuesta Keycloak en local (arranque, RAM)? ¿Qué store de sesión y qué librería OIDC conviene? (Cierra la pregunta abierta 1 de docs/12 §17.)

## Qué se construyó

| Pieza | Versión | Detalle |
|---|---|---|
| Keycloak | `quay.io/keycloak/keycloak:26.8.0`, `start-dev --import-realm` | Realm `pfos` importado de [keycloak/pfos-realm.json](keycloak/pfos-realm.json): cliente confidencial `pfos-bff` (Code + **PKCE S256 obligatorio**, sin direct grants, `fullScopeAllowed=false`), mapper de **audience `finance-api`**, mapper `groups` (`/workspaces/ws-demo/{owner,editor,viewer}`), 4 usuarios de prueba (owner, editor, viewer, outsider) con IDs fijos, refresh token rotativo con `refreshTokenMaxReuse=0`. Dos clientes **solo E2E** (`pfos-e2e` con access token de 10 s y `pfos-e2e-noaud` sin audience) para probar la API directamente. |
| Session store | `valkey/valkey:9.1.2-alpine` | Sesiones BFF en Valkey (sin persistencia). |
| BFF | Next.js **16.3.8** (App Router, Turbopack, `next start`), React 19.3, **openid-client 6.8.8**, ioredis 6 | [web/](web/). Rutas `/api/bff/auth/{login,callback,logout}`, `/api/bff/session`, proxy `/api/bff/[...path]` → `API_URL/api/v1/...`, `proxy.ts` (ex-`middleware.ts`) para el redirect ligero de `/app`. |
| finance-api | NestJS **12.1.2** (ESM) + **jose 6.2.12**, ejecutado con tsx | [api/src/](api/src/). `JwtAuthGuard` global + `WorkspaceRoleGuard` con `@RequireRole()`; membership en memoria simulando `iam.workspace_membership`. |
| Tests | Playwright 1.63 (Chromium headless) | [e2e/](e2e/) — 8 tests, todos verdes. |

Puertos de host (todos en 127.0.0.1 salvo Next): Next **61600**, Nest **61680**, Keycloak **61681**, Valkey **61682**. Proyecto compose `pf-spike-06`.

### Diseño del BFF (lo que se validó)

- **Login**: `GET /api/bff/auth/login` genera `code_verifier`, `state`, `nonce`; los guarda en Valkey (cifrados, TTL 10 min, clave = sha256(state)) y redirige (303) a `/authorize` con `code_challenge_method=S256`.
- **Callback**: consumo **one-time** del state (`GETDEL`), `authorizationCodeGrant` (valida state, PKCE, `iss` de RFC 9207, firma/iss/aud/nonce/exp del id_token), **rotación de sesión** (borra sid previo), crea sesión y setea `__Host-pfos_sid` (`HttpOnly; Secure; SameSite=Lax; Path=/`, 256 bits opacos).
- **Sesión**: valor en Valkey = JSON **AES-256-GCM** (AAD = clave), clave Valkey = `sha256(sid)`; TTL idle 30 min deslizante + absoluto 12 h. En Valkey no hay ningún JWT en claro (verificado).
- **Proxy**: `/api/bff/<path>` → `finance-api /api/v1/<path>` con `Authorization: Bearer`; reenvía solo `content-type, accept, idempotency-key, if-match, traceparent`; devuelve solo `content-type, etag, location, retry-after` + `Cache-Control: no-store`. Refresh **transparente** si el access token expira en < 60 s y un reintento tras 401 del upstream.
- **Refresh single-flight** por sesión (Map de promesas en proceso) — imprescindible, ver hallazgo de reuse detection.
- **Logout** (POST + CSRF): revoca refresh token (RFC 7009), borra sesión y cookie, devuelve la URL de **RP-initiated logout** (`end_session_endpoint` con `id_token_hint` + `post_logout_redirect_uri`).
- **CSRF** (método no seguro), en este orden y **antes** de leer la sesión: (1) `Origin` == `APP_ORIGIN` (o, sin Origin, `Sec-Fetch-Site: same-origin`); (2) `Content-Type: application/json` (si no, 415); (3) sesión; (4) `X-CSRF-Token` = HMAC-SHA256(csrfSecret de la sesión, sid), comparado en tiempo constante. Más la capa del navegador: cookie `SameSite=Lax`. El JS obtiene el token CSRF de `GET /api/bff/session` (que nunca devuelve tokens OAuth).

### Validación JWT en finance-api (docs/12 §3.1)

`createRemoteJWKSet` (cache 10 min, cooldown 60 s ante `kid` desconocido) + `jwtVerify` con `issuer` exacto, `audience: finance-api`, `algorithms: [RS256, ES256]`, `clockTolerance: 30`, `requiredClaims: [exp, iat, sub]`; además `azp` en allowlist y `typ == Bearer` (rechaza id_tokens). Errores RFC 9457 con `code`/`reason`. El rol se resuelve **por request** desde la membership (no desde el token), como pide ADR-0010.

## Setup y comandos

```powershell
cd spikes/SPIKE-06-auth-bff
pnpm install                       # allowBuilds: esbuild
npx playwright install chromium
pnpm env:init                      # .env desde .env.example (valores SOLO dev, generados al azar)
pnpm deps:up                       # Keycloak + Valkey (docker compose -p pf-spike-06 ... up -d --wait)
pnpm web:build                     # next build web
pnpm test:e2e                      # levanta API (61680) y Next (61600) vía webServer y corre Playwright
pnpm measure:keycloak              # 3 arranques en frío: tiempo y memoria
node scripts/measure-keycloak.mjs --runs 2 --fargate-like                  # 0.5 vCPU / 1 GiB
$env:KC_MEM_LIMIT='512m'; node scripts/measure-keycloak.mjs --runs 1 --fargate-like
pnpm deps:down                     # docker compose -p pf-spike-06 down -v
```

Credenciales: los usuarios/clientes de prueba y sus contraseñas están **solo** en [keycloak/pfos-realm.json](keycloak/pfos-realm.json) y [.env.example](.env.example) (valores aleatorios con prefijo `dev-only-`, nunca reutilizables). `/api/bff/dev/*` y `/evil` solo existen con `BFF_DEV_ENDPOINTS=1`.

## Resultados (evidencia en [evidence/](evidence/))

Corrida final: **8/8 tests verdes** ([evidence/playwright-list-output.txt](evidence/playwright-list-output.txt), [evidence/playwright-results.json](evidence/playwright-results.json)).

### 1. Login end-to-end y fuga de tokens — [01-login-no-token-leak.json](evidence/01-login-no-token-leak.json)

| Verificación | Resultado |
|---|---|
| Request `/authorize` | `response_type=code`, `client_id=pfos-bff`, `code_challenge` 43 chars, `code_challenge_method=S256`, `state` y `nonce` presentes, sin `code_verifier` |
| Cookie | `__Host-pfos_sid`, `httpOnly: true`, `secure: true`, `sameSite: Lax`, `path: /`, cookie de sesión, 43 chars |
| `document.cookie` | `""` (la cookie httpOnly no es visible) |
| `localStorage` / `sessionStorage` | vacíos |
| Respuestas inspeccionadas por el navegador (URL + headers + body) | 24 (12 de la app, 12 de Keycloak): **0** contienen el access o refresh token; **0** JWT de cualquier tipo en respuestas de la app |
| HTML renderizado | sin JWT |
| Valor en Valkey | cifrado; no contiene `eyJ` |
| Access token | `aud=finance-api`, `azp=pfos-bff`, `typ=Bearer`, vida 300 s |
| Tiempo de login (navegación `/app` → Keycloak → callback → `/app`) | 0.7–1.0 s en caliente; 2.5 s primera vez tras arranque en frío de Keycloak |

### 2. RBAC por workspace vía BFF — [02-rbac-matrix.json](evidence/02-rbac-matrix.json)

| Usuario | GET accounts (VIEWER) | POST transactions (EDITOR) | POST periods/reopen (OWNER) |
|---|---|---|---|
| owner | 200 | 201 | 200 |
| editor | 200 | 201 | 403 `WORKSPACE_ROLE_INSUFFICIENT` |
| **viewer** | 200 | **403 `WORKSPACE_ROLE_INSUFFICIENT`** | 403 |
| outsider (dueño de otro workspace) | 403 `WORKSPACE_NOT_MEMBER` | 403 | 403 |

Lo mismo directamente contra la API sin BFF: viewer → `403 WORKSPACE_ROLE_INSUFFICIENT`; outsider → `403 WORKSPACE_NOT_MEMBER`.

### 3. CSRF — [03-csrf.json](evidence/03-csrf.json)

| Ataque | Resultado |
|---|---|
| Control positivo (mismo origen, JSON, token) | 201 |
| Sin `X-CSRF-Token` | 403 `CSRF_TOKEN_INVALID` |
| Cookie + token válidos pero `Origin: https://evil.example` (simula bypass de SameSite desde un subdominio hermano) | 403 `CSRF_ORIGIN_MISMATCH` |
| Sin `Origin` ni `Sec-Fetch-Site` (cliente no navegador) | 403 `CSRF_ORIGIN_MISSING` |
| `Content-Type: text/plain` | 415 `CSRF_CONTENT_TYPE` |
| **`<form>` real cross-site** desde `http://127.0.0.1:61600/evil` (otro *site*) con JSON disfrazado de `text/plain` | navegador envía `Sec-Fetch-Site: cross-site` y **no adjunta la cookie** (SameSite=Lax); BFF responde 403 `CSRF_ORIGIN_MISMATCH`; ninguna transacción del ataque llegó a la API |

**Enfoque recomendado** (ya implementado): SameSite=Lax + verificación `Origin`/`Sec-Fetch-Site` + solo `application/json` + *synchronizer token* derivado (HMAC del sid). No se usa double-submit cookie: el token derivado de la sesión server-side es más simple y no requiere una segunda cookie legible por JS.

### 4. Refresh y logout — [04a-refresh.json](evidence/04a-refresh.json), [04b-logout.json](evidence/04b-logout.json)

- Access token marcado como expirado + **5 peticiones concurrentes** → 5×200 y **un solo refresh** (`refreshCount=1`); access token nuevo, **refresh token rotado**, `iat` avanza.
- Reusar el refresh token viejo → `400 invalid_grant "Maximum allowed refresh token reuse exceeded"` **y Keycloak invalida la sesión completa**: el siguiente refresh con el token *vigente* falla y el BFF devuelve `401 SESSION_EXPIRED`. Conclusión: sin single-flight, dos pestañas refrescando a la vez **desloguean al usuario**.
- Logout: sesión borrada de Valkey, cookie eliminada, `/api/bff/session` → 401, refresh token revocado (`invalid_grant "Session not active"`), y volver a `/app` muestra el formulario de Keycloak (SSO cerrado, sin auto-login).
- El `id_token_hint` viaja en la URL de logout (visible en el navegador). Usado contra la API → **401** (`aud=pfos-bff`, `typ=ID`).
- El access token viejo **sigue siendo aceptado por la API hasta su `exp`** tras el logout (200): propiedad de JWT stateless. Mitigación: vida corta (5 min) y que nunca salga del servidor.

### 5. Validación JWT en la API — [05a-api-jwt-rejections.json](evidence/05a-api-jwt-rejections.json), [05b-api-jwt-expiry.json](evidence/05b-api-jwt-expiry.json)

| Caso | Resultado |
|---|---|
| Token válido | 200 |
| Sin header | 401 `AUTH_MISSING_BEARER` |
| Basura | 401 `ERR_JWS_INVALID` |
| `alg: none` | 401 `ERR_JOSE_ALG_NOT_ALLOWED` |
| HS256 (confusión de algoritmo) | 401 `ERR_JOSE_ALG_NOT_ALLOWED` |
| RS256 con clave del atacante / `kid` desconocido | 401 `ERR_JWKS_NO_MATCHING_KEY` |
| Payload manipulado (`sub` de otro) | 401 `ERR_JWS_SIGNATURE_VERIFICATION_FAILED` |
| Token real de Keycloak **sin** `aud=finance-api` | 401 `ERR_JWT_CLAIM_VALIDATION_FAILED` |
| Token de vida 10 s: en `exp+5s` (dentro del skew 30 s) | 200 |
| … en `exp+32s` | 401 `ERR_JWT_EXPIRED` |

### 6. Keycloak: arranque y memoria — [keycloak-startup*.json](evidence/)

`start-dev --import-realm`, imagen ya descargada, medido desde `docker compose up -d` hasta que `/.well-known/openid-configuration` responde 200:

| Límites | Corridas | Listo (host) | "started in" (log Quarkus) | RAM al estar listo | RAM idle +30 s |
|---|---|---|---|---|---|
| Sin límite (host 16 GB) | 3 | **28.5–38.2 s** (media 33.4 s) | 17.7–20.7 s | 759–798 MiB | 758–799 MiB |
| 0.5 vCPU / 1 GiB (tipo Fargate) | 2 | 77.9–88.7 s | 41.2–44.1 s | 554–581 MiB | 554–574 MiB |
| 0.5 vCPU / 512 MiB | 1 | 76.7 s | 40.4 s | 506 MiB (99 % del límite) | 502 MiB |

- Tras la suite E2E sin límites: Keycloak **908 MiB**, Valkey **4.8 MiB** ([docker-stats-after-e2e.txt](evidence/docker-stats-after-e2e.txt)).
- Con 512 MiB los tests de login/RBAC/refresh/logout **pasan** (sin OOM), pero el primer login tarda 27 s (JIT en frío con 0.5 vCPU). La JVM se adapta al límite del contenedor (heap ≈ % de RAM), por eso el consumo "sin límite" es mayor.
- `start-dev` incluye el *build/augmentation* de Quarkus en cada arranque; en producción `kc.sh build` + `start --optimized` lo elimina (no medido aquí).

### 7. Latencia del salto BFF — [05c-latency.json](evidence/05c-latency.json)

GET por BFF p50 15.3 ms / p95 16.3 ms vs API directa p50 15.2 ms / p95 15.7 ms (n=30). En este host ambas mediciones tienen un suelo de ~15 ms (probablemente del loopback/temporizador de Windows), así que **el overhead del BFF (lectura y descifrado de la sesión en Valkey y un fetch extra) no se distingue de ese suelo**. Hay que volver a medirlo en Linux/CI.

## Evaluación de librerías para el BFF (sin construir)

| Opción | Pros | Contras | Veredicto |
|---|---|---|---|
| **openid-client v6 directo** (usado aquí) | Certificado OpenID, mantenido por panva (autor de jose); API funcional pequeña (`discovery`, `buildAuthorizationUrl`, `authorizationCodeGrant`, `refreshTokenGrant`, `tokenRevocation`, `buildEndSessionUrl`); control total sobre sesión, cookie, CSRF y refresh; funciona igual con Keycloak y Cognito (OIDC estándar); **≈ 500 líneas** de BFF (lib + rutas + proxy) en este spike | Somos dueños de sesión, CSRF, single-flight y rotación de cookies (más código propio que revisar) | **Recomendado** |
| **Auth.js / NextAuth v5** (`next-auth@5.0.0-beta.32`) | Integración rápida con Next, providers listos (Keycloak, Cognito), adapter de sesión en BD | **v5 sigue en beta** (v4 estable no apunta a App Router moderno); su modelo por defecto es sesión JWT en cookie (JWE) — guardar tokens del IdP ahí infla la cookie y obliga a un adapter/callbacks para tenerlos server-side; refresh del token del IdP **no es nativo** (se implementa a mano en el callback `jwt`, con las mismas carreras); CSRF propio solo para sus rutas de auth, no para el proxy `/api/bff/*`; RP-initiated logout del IdP es manual; abstracción opaca para auditar | No recomendado para este caso |
| **`@auth/core`** (0.41.x, núcleo framework-agnóstico de Auth.js) | Mismo motor sin el acople a Next | Pre-1.0, menos documentado; hereda las limitaciones de arriba; sin ganancia frente a openid-client para un BFF con sesión server-side | No |
| iron-session (cookie cifrada stateless) en vez de Valkey | Sin dependencia extra | Con access + refresh + id_token de Keycloak la cookie se acerca al límite de ~4 KB (se trocea); sin revocación inmediata server-side; logout global/flush imposible | Solo como plan B sin Redis |

**Store de sesión (docs/12 §17.1)**: Valkey. Revocación inmediata, cookie mínima y tokens cifrados en reposo, a cambio de 5 MiB de RAM. Además Valkey ya existe por ADR-0008 (BullMQ).

## Camino Cognito para producción (sin construir)

- **Funciona con el mismo BFF**: Cognito expone discovery OIDC (`https://cognito-idp.<region>.amazonaws.com/<poolId>/.well-known/openid-configuration`), Code + PKCE, clientes confidenciales con secret y revocación (`/oauth2/revoke`) con refresh token rotation (feature más reciente de Cognito, a verificar en el plan elegido).
- **Diferencias que obligan a configuración por IdP**:
  - **Audience**: los access tokens de Cognito **no traen `aud`**; traen `client_id` y `scope`. Hay que validar `client_id` y un **custom scope de un resource server** (p. ej. `finance-api/pfos.api`) en vez de `aud`. Hay que hacer configurable la regla `aud` en el verificador de jose (o usar `aws-jwt-verify`).
  - **`azp`** no existe → usar `client_id`. **`typ`** no existe → distinguir id/access con `token_use=access`.
  - **Logout**: Cognito no implementa `end_session_endpoint` estándar; usa `/logout?client_id=…&logout_uri=…`, así que la construcción de la URL de logout tiene que ser por IdP.
  - **Grupos**: claim `cognito:groups` (no se usa: los roles viven en PFOS).
  - **Reuse detection** y semántica del refresh distintas a las de Keycloak: el single-flight sigue siendo necesario.
  - No corre en local → **paridad imperfecta**; smoke E2E en staging obligatorio (ya previsto en ADR-0010).
- Costo/operación: sin JVM que parchear ni ~0.6–0.9 GB de RAM. El costo por MAU queda por verificar en SPIKE-09.

## Recomendación

1. **Confirmar ADR-0010 y ADR-0019** con: openid-client v6 en Route Handlers de Next 16, sesión server-side en **Valkey** (AES-256-GCM, clave = hash del sid), cookie `__Host-` httpOnly/Secure/Lax, proxy `/api/bff/*`, `proxy.ts` solo para redirect ligero, jose + JWKS remoto en finance-api, rol por request desde la membership.
2. **No usar Auth.js** para el BFF.
3. CSRF: mantener las 4 capas tal como se probaron (SameSite, Origin/Sec-Fetch-Site, JSON-only, token HMAC). Logout por POST con CSRF.
4. Keycloak local en perfil `deps`/`auth` opcional (≈ 0.8 GB, 30–40 s de arranque). Para cloud con Fargate 0.5 vCPU, Keycloak arranca en ~80 s y queda al límite con 512 MiB: **1 GiB mínimo**, preferible 1 vCPU, y `start --optimized`. Esto inclina la balanza de costo/operación hacia Cognito si se acepta su menor paridad.
5. El verificador JWT debe estar **parametrizado por IdP** (aud vs client_id/scope; azp vs client_id; typ vs token_use) desde Phase 1.

## Riesgos

- **Carrera de refresh = logout forzado**: Keycloak invalida toda la sesión al detectar reuse. El single-flight del spike es **por proceso**; con más de una réplica del BFF hace falta un lock distribuido (`SET NX PX` en Valkey) o refresh por adelantado con lock.
- **id_token en la URL de logout** (historial/logs del IdP). La API lo rechaza (aud/typ); alternativa: logout con `client_id` y confirmación de Keycloak, o back-channel logout.
- **Access token válido hasta `exp` tras logout** (stateless). Mantener 5 min y evaluar introspección solo para operaciones críticas.
- **`allowInsecureRequests`** de openid-client solo en dev (issuer http). Hay que asegurarse de que no llegue a prod (ver config).
- **Secure cookies en http://localhost** funcionan en Chromium; Safari/WebKit puede comportarse distinto en http (no probado). Usar HTTPS local (Caddy/mkcert) si se prueba WebKit.
- **Cambio de host = cambio de *site***: `localhost` y `127.0.0.1` son sitios distintos (se aprovechó para la prueba CSRF). `APP_ORIGIN` debe coincidir exactamente con lo que usa el navegador.
- Nest 12 ESM ejecutado con tsx exige `@Inject()` explícito, porque esbuild no emite decorator metadata. En el producto se compila con tsc/SWC (ver SPIKE-04).
- El JWKS de jose **no** sirve claves "stale" hasta 24 h si el IdP cae (docs/12 §3.1): tras `cacheMaxAge`, un fallo de fetch rechaza tokens. Hace falta un wrapper propio.

## Gaps vs docs/12-security.md

| docs/12 | Estado en el spike |
|---|---|
| §3 state/nonce/verifier en store con TTL 10 min, one-time | ✔ (Valkey, `GETDEL`) |
| §3 cookie `__Host-`, HttpOnly, Secure, SameSite=Lax, sid 256 bits, rotación en login | ✔ (sin rotación por "elevación de privilegio": no hay step-up) |
| §3 tokens cifrados AES-256-GCM, clave en Secrets Manager | ✔ cifrado; clave en `.env` (dev). **Falta** el key ring para rotar la clave sin invalidar sesiones |
| §3 TTL absoluto e idle | ✔ 12 h / 30 min |
| §3 CSRF synchronizer + Origin/Sec-Fetch-Site + solo JSON | ✔ probado |
| §3 logout: borrar sesión, revocar refresh, RP-initiated | ✔ |
| §3 re-autenticación reciente (`auth_time`/`max_age`) para acciones sensibles | ✘ no implementado |
| §3 `private_key_jwt` en cloud | ✘ (client_secret_post en dev) |
| §3.1 alg allowlist, iss exacto, aud, exp/nbf/iat skew 30 s, azp | ✔ (azp con allowlist que incluye el cliente E2E; en prod solo `pfos-bff`) |
| §3.1 JWKS cache 10 min + refetch rate-limited | ✔ (`cacheMaxAge` + `cooldownDuration` 60 s; no se midió el rate limit) |
| §3.1 fallback a claves cacheadas 24 h | ✘ (jose no lo soporta de serie) |
| §3.1 scope `pfos.api` requerido | ✘ (se usa mapper de audience directo en el cliente; falta client scope `pfos.api`) |
| §3.1 `sub` → `iam.user` JIT + `email_verified` requerido | ✘ (membership en memoria; `email_verified` no se exige) |
| §4 matriz rol × operación, membership por request | ✔ para 3 operaciones + no-miembro |
| §5 RLS como defense-in-depth / "RLS devuelve 0 filas" (ADR-0010 Validación) | ✘ fuera de alcance (sin PostgreSQL; ver SPIKE-02) |
| §12 CSP con nonce, HSTS, COOP/CORP | Parcial: `frame-ancestors`, `form-action`, `base-uri`, `object-src`, nosniff, COOP, Permissions-Policy. **Falta** CSP con nonce en `proxy.ts`, HSTS (requiere HTTPS) |
| MFA obligatorio para OWNER | ✘ no configurado en el realm |
| Lock distribuido de refresh (multi-réplica) | ✘ solo en proceso |

## Impacto en ADRs

- ADR-0010 y ADR-0019: sección "Resultado del spike (SPIKE-06, 2026-10-01)" añadida; siguen en **Propuesto**.
- docs/12 §17.1 queda respondida a favor de Valkey. §3.1 debería mencionar la variante Cognito (`client_id`/`token_use`/scope en vez de `aud`/`azp`/`typ`).
