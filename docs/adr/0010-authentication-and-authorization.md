# ADR-0010: Autenticación y autorización — OIDC (Code + PKCE vía BFF), RBAC por workspace, RLS como defense-in-depth

- Estado: Aceptado (2026-10-02, tras SPIKE-06, con enmienda; decisión del owner)
- Fecha: 2026-10-01
- Decisores: Owner (Product/Tech Lead)
- Relacionado: docs/ARCHITECTURE.md §5, §8, §9, §10; ADR-0013, ADR-0019, ADR-0022, ADR-0023; OpenSpec capabilities `identity/authentication`, `identity/workspace-membership`, `security/access-control`; SPIKE-06

## Contexto y problema

PFOS contiene datos financieros altamente sensibles. Aunque arranca con un usuario, el modelo es multi-usuario/multi-workspace (compartir finanzas con pareja/familia con roles distintos). Necesitamos:

- **AuthN** robusta (MFA, recuperación, sesiones, eventualmente passkeys) sin construir criptografía propia.
- **AuthZ** a nivel de workspace (`OWNER`, `EDITOR`, `VIEWER`) aplicada en API y reforzada en BD.
- Que el token de acceso **nunca llegue al JavaScript del navegador** (mitigar robo de tokens por XSS).
- Paridad local ↔ cloud y bajo costo.

## Drivers de decisión

- Seguridad (estándares OIDC/OAuth 2.1, MFA, sin manejo de passwords propio).
- Costo a escala 1–100 usuarios.
- Operación por 1 persona.
- Paridad local (Docker) ↔ cloud.
- Portabilidad (evitar lock-in fuerte del proveedor de identidad).
- Learning value y control.

## Opciones consideradas

**Proveedor de identidad (IdP):**
1. **Keycloak** (self-hosted).
2. **Amazon Cognito**.
3. **Auth0 / Clerk** (SaaS).
4. **Zitadel** (self-hosted o cloud).
5. **Authentik** (self-hosted).
6. **Auth propia** (passwords + sesiones en `finance-api`) — **rechazada**.

**Patrón de token en el frontend:** BFF con cookie httpOnly (elegida) vs SPA con tokens en memoria/localStorage.

**AuthZ:** RBAC por workspace en aplicación + RLS (elegida) vs motor de políticas externo (OpenFGA/Cerbos/OPA).

## Decisión

- **Protocolo:** OIDC/OAuth2 **Authorization Code + PKCE ejecutado por el BFF** (Next.js server, ADR-0019). La sesión del navegador es una **cookie httpOnly, Secure, SameSite=Lax** con ID de sesión opaco; tokens (access/refresh) guardados server-side (sesión cifrada). El BFF llama a `finance-api` con `Authorization: Bearer <access_token>`.
- **`finance-api`** valida JWT (firma vía JWKS cacheado, `iss`, `aud`, `exp`, `nbf`), mapea `sub` → `iam.user` (provisioning JIT en primer login) y resuelve membership del `workspaceId` de la ruta.
- **IdP local:** **Keycloak** en Compose (realm de desarrollo importado, usuarios de prueba desde seed, Mailpit como SMTP).
- **IdP cloud:** decisión ligada a ADR-0013. Con ECS/Fargate (recomendado), candidatos: **Cognito** (costo/operación mínima) vs **Keycloak gestionado/self-hosted**. La API depende solo de OIDC estándar, de modo que el cambio de IdP es configuración + migración de usuarios.
- **AuthZ:** RBAC por workspace (`OWNER`, `EDITOR`, `VIEWER`) almacenado en `iam.workspace_membership` (no en claims del IdP: el IdP autentica, PFOS autoriza). Guards en `interface` + verificación en application services; **PostgreSQL RLS** (ADR-0023) como defense-in-depth.
- MFA obligatorio para `OWNER` en producción (configurado en IdP).
- Auth propia: **rechazada** (ver análisis).

## Análisis de opciones

### 1. Keycloak
- **Pros:** OIDC completo y certificado; MFA, WebAuthn/passkeys, federación social; Apache 2.0; misma herramienta local y cloud → paridad total; gran learning value; realm export versionable.
- **Contras:** JVM pesada (~0.5–1 GB RAM); upgrades frecuentes (release cada pocos meses) y temas de UI; en cloud = un contenedor más + su BD (puede compartir la instancia PG con DB separada); responsabilidad de parches de seguridad.
- **Costo:** licencia 0; cloud ~USD 15–35/mes adicionales (task Fargate 0.5 vCPU/1 GB) — ver docs/21.
- **Complejidad operativa:** media-alta.

### 2. Amazon Cognito
- **Pros:** gestionado, sin parches; tier gratuito generoso para pocos usuarios (planes Lite/Essentials); MFA, passkeys en Essentials; integración IAM/ALB.
- **Contras:** lock-in AWS; personalización de Managed Login limitada; migración de usuarios fuera de Cognito sin hashes exportables; no corre localmente → **paridad imperfecta** (Keycloak local vs Cognito cloud: diferencias en claims, logout, refresh).
- **Costo:** ~USD 0 para < 10k MAU en tiers básicos (a verificar en SPIKE-09).
- **Complejidad operativa:** baja.

### 3. Auth0 / Clerk
- **Pros:** DX excelente (Clerk especialmente con Next.js), UI lista, MFA, passkeys, organizaciones.
- **Contras:** SaaS de terceros con datos de identidad; precios escalan rápido por features (MFA, organizations); Clerk favorece su propio modelo de sesión frontal (menos alineado con BFF puro); lock-in alto; sin versión local real.
- **Costo:** tier gratis limitado; planes de pago USD 25+/mes al necesitar features. **Complejidad:** baja.

### 4. Zitadel
- **Pros:** moderno (Go), multi-tenant nativo, eventos/auditoría, passkeys, más ligero que Keycloak; cloud gestionado opcional.
- **Contras:** comunidad menor; **relicenciado a AGPL-3.0 en v3 (2025)** — sin impacto para uso no modificado, pero a considerar; cambios de API entre majors.
- **Costo:** self-host 0; cloud con tier gratis. **Complejidad:** media.

### 5. Authentik
- **Pros:** UI amigable, flows configurables, popular en homelab.
- **Contras:** orientado a SSO de infraestructura; requiere PG + Redis propios; menos usado como IdP de producto; partes enterprise con licencia aparte.
- **Costo:** 0 self-host. **Complejidad:** media.

### 6. Auth propia (rechazada)
- **Pros:** control total, sin dependencias.
- **Contras:** hashing, rotación, reset de password, MFA, rate limiting, detección de credential stuffing, WebAuthn, gestión de sesiones: superficie de seguridad enorme para datos financieros; contradice "no construir criptografía propia".
- **Costo:** tiempo muy alto + riesgo. **Complejidad:** alta. **Rechazada.**

### BFF vs tokens en SPA
- BFF: tokens fuera del alcance de XSS, refresh server-side, CSRF mitigado con SameSite + token anti-CSRF en mutaciones. Contra: estado de sesión server-side en Next.js.
- SPA con tokens: más simple, pero tokens accesibles a JS; patrón desaconsejado por el borrador "OAuth 2.0 for Browser-Based Apps" para datos sensibles.

### RBAC + RLS vs motor externo
- Tres roles por workspace no justifican OpenFGA/Cerbos; se reevaluará si aparecen permisos por cuenta/objeto (p. ej. compartir solo ciertas cuentas).

## Consecuencias

**Positivas**
- Sin passwords en PFOS; IdP intercambiable por configuración.
- Tokens inaccesibles a JS del navegador.
- Doble barrera de aislamiento (guards + RLS).

**Negativas**
- Keycloak añade peso al entorno local (perfil `deps`).
- Si cloud usa Cognito, paridad local imperfecta → smoke E2E en staging obligatorio.

**Riesgos**
- Divergencia de claims entre IdPs. *Mitigación:* la API solo usa `sub`, `iss`, `aud`, `email` (+ `email_verified`); el resto de autorización vive en PFOS.
- Sesiones BFF filtradas. *Mitigación:* cookie httpOnly/Secure/SameSite, rotación de session ID en login, TTL absoluto e idle.

## Validación

- **SPIKE-06 (2 d):** Keycloak local + Next.js BFF (PKCE, cookie httpOnly, refresh) + Nest validando JWT y resolviendo roles por workspace; prueba de que `document.cookie` no expone tokens y que una petición con token de otro workspace devuelve 403 y RLS devuelve 0 filas.
- Tests E2E (Playwright) de login/logout/expiración.
- Architecture test: ningún token aparece en respuestas JSON al navegador.

## Notas

- Verificado 2026-10-01: Keycloak 26.x sigue activo (26.8.0 publicado 2026-10-01), Apache 2.0.
- Verificado 2026-10-01: Zitadel v3 (marzo 2025) relicenció su core a AGPL-3.0 (SDKs/APIs Apache 2.0).
- Verificado 2026-10-01: Next.js 16 renombra `middleware.ts` a `proxy.ts` (Node.js runtime) — relevante para la implementación del BFF (ADR-0019).
- Precios actuales de Cognito (Lite/Essentials/Plus) y Auth0/Clerk: a verificar en SPIKE-09.

## Resultado del spike (SPIKE-06, 2026-10-01)

Informe completo y evidencia: [spikes/SPIKE-06-auth-bff/README.md](../../spikes/SPIKE-06-auth-bff/README.md). Estado del ADR: sigue **Propuesto** (lo acepta el owner).

- **Validado (8/8 tests Playwright, Chromium headless)** con Keycloak 26.8.0 (`start-dev`, realm `pfos` importado), BFF Next.js 16.3.8 + openid-client 6.8.8 y finance-api NestJS 12.1.2 + jose 6.2.12:
  - Code + PKCE S256 con state/nonce one-time server-side; cookie `__Host-pfos_sid` (HttpOnly, Secure, SameSite=Lax, 256 bits).
  - En 24 respuestas inspeccionadas, `document.cookie`, `localStorage`/`sessionStorage` y el HTML no aparece **ningún** access o refresh token. En Valkey los tokens están cifrados con AES-256-GCM.
  - La API rechaza con 401: sin token, `alg:none`, HS256, `kid` desconocido, payload manipulado, sin `aud=finance-api`, id_token (`typ=ID`) y token expirado más allá del skew de 30 s. Dentro del skew lo acepta.
  - RBAC por membership resuelta por request: VIEWER recibe **403** en la mutación, EDITOR 403 en la operación de OWNER, no-miembro 403 en todo.
- **Hallazgos que ajustan la decisión**:
  - Con `refreshTokenMaxReuse=0`, Keycloak **invalida toda la sesión** al detectar reuse de un refresh token. Por eso el refresh del BFF debe ser *single-flight*, con lock distribuido en Valkey si hay más de una réplica.
  - Tras el logout, el access token sigue siendo válido contra la API hasta su `exp` (JWT stateless). Hay que mantener una vida de 5 min.
  - El `id_token_hint` del RP-initiated logout queda expuesto en la URL. La API lo rechaza.
- **Store de sesión**: **Valkey** (cierra docs/12 §17.1). Ocupa 4.8 MiB y permite revocación inmediata.
- **Keycloak**: arranque en frío listo en 28–38 s y 0.76–0.91 GB de RAM sin límites. Con 0.5 vCPU / 1 GiB tarda ~78–89 s y usa ~0.56 GB. Con 512 MiB funciona al 99 % del límite y el primer login tarda 27 s. En cloud harían falta ≥ 1 GiB y `start --optimized`.
- **Cognito**: compatible con el mismo BFF, pero con diferencias. Los access tokens no traen `aud` (se valida `client_id` + scope de un resource server). Usa `token_use` en vez de `typ`/`azp`, y su logout no es el `end_session_endpoint` estándar. El verificador JWT y la URL de logout deben parametrizarse por IdP. La mitigación de riesgos de este ADR ("la API solo usa `sub`, `iss`, `aud`…") debe matizarse.
- **Gaps abiertos**: no se probó RLS (0 filas cross-workspace), no hubo JIT provisioning de `iam.user` ni scope `pfos.api`, faltan MFA para OWNER, re-autenticación reciente y `private_key_jwt`, y falta el fallback de JWKS 24 h, que jose no trae de serie.

## Enmienda de aceptación (2026-10-02)

- BFF con **`openid-client`** directo (Auth.js descartado: v5 en beta).
- **Session store en PostgreSQL** (tabla `iam.bff_session`, datos cifrados) porque Redis/Valkey dejó de ser obligatorio (ADR-0008); Valkey queda como alternativa (`SESSION_STORE=postgres|valkey`).
- **Refresh con lock distribuido** (advisory lock de PostgreSQL por sesión): reutilizar un refresh token rotado provoca que Keycloak invalide toda la sesión (SPIKE-06).
- El access token sigue siendo válido tras logout hasta su expiración: access tokens de vida corta (≤ 5 min).
- Keycloak local necesita ≥ 1 GiB de RAM; la validación de tokens y el logout son configurables por IdP para habilitar Cognito.
