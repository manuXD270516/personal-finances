# Diseño

## Contexto

Change 86 de docs/03 §7, consecuencia de D516 ([docs/79](../../../docs/79-ui-ux-modern-web-decisions.md)): el owner eligió servir el E2E por HTTPS después de que el spike de WebKit del change `refine-web-accessibility-foundations` (77, tarea 6.1) fallara. La pregunta, la evidencia de los dos spikes y la pregunta pendiente sobre el cierre del 77 están en [docs/84](../../../docs/84-webkit-e2e-questions.md).

Resultado del spike en Linux (2026-11-25, runner `ubuntu-latest`, Playwright 1.63.0, WebKit 26.6 y Chromium 153; rama descartable ya borrada). Servidor mínimo sin código de PFOS que emite `__Host-sec=1; Path=/; HttpOnly; Secure; SameSite=Lax` y una cookie sin `Secure`, y un flujo que imita el login (cookie `__Host-login` en `/login`, 302 al proveedor de identidad, 302 de vuelta a `/callback`):

| Caso | Chromium | WebKit |
|---|---|---|
| `http://localhost` y `http://127.0.0.1` | envía las dos cookies | envía solo la que no es `Secure` |
| `https://localhost` con certificado autofirmado e `ignoreHTTPSErrors` | envía las dos | envía las dos |
| Flujo de login: web `http`, proveedor `http` | `__Host-login` llega al callback | el callback llega **sin cookie** |
| Flujo de login: web `https`, proveedor `http` | llega | llega |
| Flujo de login: web `https`, proveedor `https` | llega | llega |

Conclusión: la restricción de WebKit es la misma en Linux que en Windows y la resuelve el esquema `https` del origen de la web, sin tocar la cookie.

Stack E2E as-built: `tests/e2e/src/stack.ts` genera un `.env` desechable desde `.env.example`, reescribe el primer dígito de cada `PF_*_PORT` con el prefijo de la corrida (4 por omisión) y levanta los perfiles `core` y `ml` del proyecto `PF_E2E_PROJECT` (por omisión `pfos-e2e`). Las URL públicas son `http://localhost:<puerto>` (web y Keycloak) y `http://127.0.0.1:<puerto>` (subida de archivos). El BFF habla con Keycloak (`OIDC_DISCOVERY_URL`) y con la API (`FINANCE_API_URL`) por la red de Compose. La cookie la arma `cookie()` en `apps/web/src/bff/bff.ts` (`__Host-`, `Path=/`, `HttpOnly`, `Secure`, `SameSite=Lax`) y no cambia. El job `e2e` dura hoy entre 15 y 17 minutos (corridas del 2026-11-25) con un límite de 40.

Capa afectada: ninguna de dominio. Cambian el stack de Compose, el harness de E2E, la configuración de Playwright y el workflow `pr.yml`.

## Objetivos / No objetivos

**Objetivos**
- Que la sesión real (cookie de producción) funcione en WebKit en el stack de E2E, en CI y en la PC del owner.
- Toda la suite E2E sobre un único esquema `https`, igual que producción (web, proveedor de identidad y archivos detrás de TLS).
- Ningún secreto versionado: la autoridad y el certificado nacen y mueren con el stack.
- WebKit con ≈ 5 specs dentro del job `e2e`, sin check obligatorio nuevo y dentro de 40 minutos.

**No objetivos**
- Tocar la cookie de sesión, sus atributos o `bff.ts` (D516).
- Cambiar el esquema del stack de desarrollo por omisión.
- Firefox en E2E, o WebKit en toda la suite.
- Cambiar la configuración de TLS de producción (Caddy con ACME, ADR-0027) o los checks obligatorios de `main`.

## Decisiones

1. **Toda la suite por HTTPS, no solo el proyecto `webkit`.** Con un `WEB_PUBLIC_URL` `https`, la CSP de `apps/web/src/security/csp.ts` agrega `upgrade-insecure-requests`: el navegador pasaría a `https` la subida directa a `http://127.0.0.1:<puerto>` y la rompería. Mantener dos stacks (uno `http` para Chromium y otro `https` para WebKit) duplicaría el tiempo de arranque. *Alternativa descartada:* un segundo origen `https` solo para WebKit sobre el mismo stack. El realm tiene un solo redirect URI por cliente y el BFF un solo `WEB_PUBLIC_URL`, así que no hay forma de servir dos esquemas a la vez sin otro cliente OIDC.

2. **Proxy TLS: servicio `tls-proxy` con la imagen de Caddy de producción.** Se agrega a `deploy/compose/compose.yaml` en un perfil nuevo `tls`, con la misma imagen y digest que `compose.prod.yaml` (`caddy:2.11.9-alpine@sha256:003a…`): Renovate la actualiza en los dos archivos a la vez. Configuración en `deploy/compose/caddy/Caddyfile.e2e` (archivo aparte: el `Caddyfile` de producción usa ACME y hostnames públicos):
   - Opciones globales: `local_certs` (autoridad interna de Caddy, sin ACME), `skip_install_trust` (no toca ningún almacén de confianza), `admin off` y sin `email`.
   - Tres sitios, uno por origen, cada uno escuchando dentro del contenedor en **el mismo número de puerto** que publica en el host, para que `Host` y los redirects coincidan sin reescrituras: `https://localhost:{$PF_WEB_TLS_PORT}` → `finance-web:3000`; `https://localhost:{$PF_KEYCLOAK_TLS_PORT}` → `keycloak:8080`; `https://localhost:{$PF_OBJECT_STORAGE_TLS_PORT}` → `object-storage:8333`. `reverse_proxy` conserva el `Host` original (necesario para la firma SigV4 de las URL presignadas, como en producción) y agrega `X-Forwarded-Proto: https`.
   - **Sin HSTS** (a diferencia de producción): un `Strict-Transport-Security` para `localhost` quedaría en el navegador del owner si abre la URL a mano y rompería su stack de desarrollo por `http`.
   - Las reglas de seguridad de borde del `Caddyfile` de producción (solo `PUT` y `OPTIONS` firmados hacia la cuarentena, consola de Keycloak bloqueada) no se replican: el E2E no las prueba hoy y ya están cubiertas por los TC de despliegue. Se anota como no objetivo.
   - `/data` y `/config` del contenedor en `tmpfs`: la autoridad y los certificados viven en memoria y desaparecen al bajar el stack. Sin volumen con nombre.
   - Puertos publicados en `${PF_BIND_ADDR}` (loopback), como el resto del stack. `depends_on` con `service_healthy` de `finance-web`, `keycloak` y `object-storage`; healthcheck con `wget --no-check-certificate` a `https://localhost:{$PF_WEB_TLS_PORT}/api/health/ready`.
   *Alternativa descartada:* generar el certificado con `openssl` en el harness. Agrega una dependencia de sistema que no está garantizada en Windows fuera de Git Bash, y obliga a montar archivos de clave desde el host. *Otra descartada:* TLS dentro de Next.js (`next start` con certificado). No existe en el servidor de producción de Next y cambiaría la imagen `finance-web`.

3. **Puertos nuevos en `.env.example`:** `PF_WEB_TLS_PORT=23443`, `PF_KEYCLOAK_TLS_PORT=28443` y `PF_OBJECT_STORAGE_TLS_PORT=29443`. No chocan con los existentes (`25432`, `29000`, `28025`, `21025`, `28081`, `28080`, `28082`, `23000`, `26379`, `28090`, `23001`, `24317`, `24318`). Como cumplen `^PF_[A-Z0-9_]+_PORT$`, el harness les aplica el prefijo de la corrida sin código nuevo (43443, 48443 y 49443 con prefijo 4; 33443, 38443 y 39443 con prefijo 3). Los puertos `http` actuales siguen publicados en loopback para diagnóstico y para los llamados de Node que no pasan por el navegador (por ejemplo Mailpit).

4. **URL públicas del `.env` desechable.** `createEnvFile()` agrega a `e2eOverrides`:
   - `WEB_PUBLIC_URL=https://localhost:${PF_WEB_TLS_PORT}` (y con él `APP_PUBLIC_URL` y `PF_WEB_PUBLIC_URL` del realm, que ya lo interpolan: redirect URI `…/api/bff/auth/callback` y `post.logout.redirect.uris` pasan a `https` sin tocar el JSON del realm).
   - `OIDC_PUBLIC_BASE_URL=https://localhost:${PF_KEYCLOAK_TLS_PORT}` (y con él `OIDC_ISSUER_URL` y `KC_HOSTNAME`). Keycloak 26 con `KC_HOSTNAME` como URL completa usa ese esquema para las URL del frontend y el `iss` de los tokens, aunque reciba la petición por `http` del proxy; `KC_HOSTNAME_BACKCHANNEL_DYNAMIC=true` (ya presente) deja que el BFF y la API lo llamen por `keycloak:8080`. La API valida `iss` contra `OIDC_ISSUER_URL`, que cambia en el mismo `.env`.
   - `OBJECT_STORAGE_PUBLIC_ENDPOINT=https://localhost:${PF_OBJECT_STORAGE_TLS_PORT}` y `OBJECT_STORAGE_CORS_ORIGINS=https://localhost:${PF_WEB_TLS_PORT}`. La CSP deriva `connect-src` de ese endpoint (`filesOriginOf`).
   - El harness pasa `--profile tls` a `stack:up` junto con `core` y `ml`.
   `.env.example` no cambia sus URL: el stack de desarrollo sigue por `http` (requirement «El stack de desarrollo sigue por http salvo que se pida TLS»).

5. **Confianza en el certificado.**
   - **Navegadores:** `use.ignoreHTTPSErrors: true` en `playwright.config.ts` para los tres proyectos. WebKit en Linux no permite agregar una autoridad sin tocar el sistema, y el spike mostró que con `ignoreHTTPSErrors` la cookie `Secure` viaja. Es configuración del cliente de pruebas, no de la aplicación.
   - **Node en los tests** (`createKeycloakUser` en `helpers.ts` y la revocación del refresh token en `auth.spec.ts`, que llaman a `OIDC_PUBLIC_BASE_URL`): el global setup copia la raíz de la autoridad efímera (`/data/caddy/pki/authorities/local/root.crt`) con `docker compose -p <proyecto E2E> cp` a la carpeta temporal del `.env` desechable y fija `process.env.NODE_EXTRA_CA_CERTS` antes de que Playwright lance los workers, que heredan `process.env` (como ya heredan `PF_E2E_ENV_FILE`). No se usa `NODE_TLS_REJECT_UNAUTHORIZED=0`. El archivo se borra con el resto de la carpeta en el teardown.
   - **Contenedores:** ninguno necesita confiar en la autoridad, porque todo el back-channel va por la red de Compose sin TLS.

6. **Prefijo de puertos 3 o 4.** `PORT_PREFIX` en `stack.ts` acepta hoy `^[35]$` (con 4 por omisión). Pasa a `^[34]$`, como pide `CLAUDE.md` (el prefijo 5 choca con otro stack en 55432 y 56379). Un valor fuera de ese conjunto **falla antes de tocar Docker** con un mensaje que nombra la variable, en lugar de caer en silencio al 4. Es una decisión derivada de una regla existente, no una decisión nueva del owner. `PF_E2E_PROJECT` mantiene su validación (`^pfos-e2e[a-z0-9-]*$`).

7. **Proyecto `webkit` de Playwright (la forma de D509).** `testMatch` con `app-shell`, `a11y`, `transactions`, `auth` y `content-security-policy`; `use: { browserName: 'webkit' }` y `devices['Desktop Safari']`; sin dependencia de `alerts`, para que no espere la cadena de notificaciones. Corre después de `chromium` en el mismo `playwright test` (un solo stack, `workers: 1`). Si alguno de esos specs usa una API exclusiva de Chromium (por ejemplo `page.emulateMedia({ forcedColors })` o CDP), el test se marca `test.skip(browserName === 'webkit', '<motivo>')` con el motivo en la tarea, no se saca el spec del subconjunto.

8. **Job `e2e` de `pr.yml`.** El paso de instalación pasa a `playwright install --with-deps chromium webkit`. El nombre del job (`e2e`) y su `timeout-minutes: 40` no cambian, así que el check obligatorio sigue siendo el mismo: un fallo en WebKit hace fallar `e2e` como cualquier otro spec. **Ningún check obligatorio nuevo** ni cambio en la protección de `main`. Se agrega un paso final que escribe en el resumen del job la duración de cada proyecto (del reporte JSON de Playwright). Si la duración total del job pasa de 35 minutos en las corridas del PR, se reduce el subconjunto y se anota en la tarea.

9. **Cómo se cierra el change 77.** El requirement «Cobertura de la interfaz en WebKit» y TC-PLATFORM-WEBUI-019 y -020 son del 77 y siguen ahí: este change los automatiza, pero no los mueve. La pregunta de si el 77 se archiva ya o espera a este change es P2 de docs/84. Recomendación: **archivarlo ya**, con 6.1 cerrada con el resultado de los dos spikes y 6.2 y 6.3 marcadas `[x]` como «diferidas por decisión del owner (D516) al change `add-e2e-https`». Los dos TC quedan `draft` en el catálogo (la trazabilidad lo admite: R1 y R2 solo piden que existan y que el requirement esté cubierto) y pasan a `automated` cuando este change los automatice. Con esa opción el requirement entra a `openspec/specs/platform/web-interface` al archivar el 77 y este change no depende del orden de archivado. Si el owner prefiere que el 77 espere, este change se archiva primero y después el 77, con 6.1 a 6.3 hechas.

## Contratos

Sin contratos de API ni de eventos. Variables de entorno nuevas (documentadas en `docs/config-reference.md`, `pnpm config:docs:check`):

| Variable | Dónde | Valor por omisión | Uso |
|---|---|---|---|
| `PF_WEB_TLS_PORT` | `.env.example` | `23443` | Puerto `https` de la web en el perfil `tls` |
| `PF_KEYCLOAK_TLS_PORT` | `.env.example` | `28443` | Puerto `https` de Keycloak en el perfil `tls` |
| `PF_OBJECT_STORAGE_TLS_PORT` | `.env.example` | `29443` | Puerto `https` de la subida directa en el perfil `tls` |
| `PF_E2E_PORT_PREFIX` | entorno del harness | `4` | Acepta solo `3` o `4`; otro valor falla antes de levantar el stack |

## Riesgos / Trade-offs

- **Una URL `http` olvidada.** Con `upgrade-insecure-requests`, cualquier `http://` absoluto que el navegador pida se pasa a `https` y falla. Mitigación: `content-security-policy.spec.ts` ya junta las violaciones de CSP y la suite completa corre dos veces en verde. Los specs que construyen URL con `http://` literal se buscan con `grep` en la tarea 4.3.
- **Keycloak detrás del proxy.** Si Keycloak tomara el esquema de la petición interna (`http`), el `iss` y los redirects no coincidirían con `OIDC_ISSUER_URL`. Mitigación: `KC_HOSTNAME` como URL completa (decisión 4) y `auth.spec.ts` verifica el issuer y el flujo PKCE en los dos navegadores.
- **Duración del job.** Estimado: +1 a 2 minutos por la instalación de WebKit con dependencias y +5 a 8 por el subconjunto, sobre ≈ 16 minutos actuales: ≈ 25 minutos, dentro de 40. Mitigación: umbral de 35 minutos (decisión 8).
- **WebKit en Windows sobre HTTPS no se probó.** El spike de Windows solo probó `http`. Mitigación: la tarea 1.2 lo prueba en la PC del owner antes de cerrar el grupo 5; si falla, el proyecto `webkit` se corre solo en CI y se anota.
- **Imagen de Caddy en el stack de E2E.** Suma una imagen más que descargar (≈ 50 MB) en cada corrida de CI. Es la misma de producción, fijada por digest; Renovate la mantiene.
- **Diferencias con el borde de producción.** El `Caddyfile.e2e` no replica las restricciones de método de la subida ni el bloqueo de la consola de Keycloak. Los TC de despliegue (`host-ops`) siguen siendo los que las prueban.

## Plan de migración

Sin migraciones de datos ni de contratos. El cambio afecta solo al stack de E2E y a CI; el stack de desarrollo y producción no cambian. Vuelta atrás: revertir el PR (el job `e2e` vuelve a `http` y a Chromium). Se puede partir en dos PR dentro de la misma rama de change: (1) proxy TLS, URL públicas y suite Chromium en verde por `https`; (2) proyecto `webkit` y job `e2e`.

## Preguntas abiertas

- **P2 de docs/84 (no bloquea este change; bloquea el archivado del 77):** si el change 77 se archiva ya con 6.1 a 6.3 diferidas a este change o si espera a que este change se fusione. Recomendación: archivarlo ya (decisión 9).
