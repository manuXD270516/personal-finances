# Diseño

## Contexto

C13 de [cambios-de-codigo.md](../../../docs/despliegue/cambios-de-codigo.md) (brecha B14). Lo que hay hoy:

- **Caddy** (`deploy/compose/caddy/Caddyfile`, snippet `security_headers`) agrega HSTS, `X-Content-Type-Options`, `Referrer-Policy` y quita `Server` en los tres hostnames. No hay CSP.
- **`apps/web`** es Next.js 16.4 (App Router, salida `standalone`) con `next-intl` 4.14 y React 19.3. `proxy.ts` (el `middleware.ts` de Next 16) hace el chequeo ligero de la cookie de sesión y la negociación de locale; su `matcher` excluye `/api`, `/_next` y los archivos con extensión. `next.config.ts` no declara cabeceras.
- **Scripts:** solo los de Next (runtime, chunks y los `self.__next_f.push(...)` en línea del payload RSC). No hay `next/script`, `dangerouslySetInnerHTML`, `eval`, `next/font`, service worker ni manifest (no hay PWA: `public/` está vacío), ni scripts de terceros. La instrumentación OpenTelemetry es solo del servidor.
- **Estilos:** `globals.css` es una hoja estática (su comentario ya apunta a `style-src 'self'`). Pero hay ≈ 3 400 props `style={…}` en 172 archivos de `src/ui`, que React serializa como atributos `style="…"` en el HTML del servidor, y 11 componentes con un elemento `<style>{CSS}</style>` en línea.
- **Red del navegador:** el BFF es del mismo origen (`/api/bff/...`). La subida de documentos hace `PUT` con `XMLHttpRequest` a la URL presignada del hostname `PF_DOMAIN_FILES` (`src/ui/documents/logic.ts`); en la API esa URL sale de `OBJECT_STORAGE_PUBLIC_ENDPOINT` (`https://${PF_DOMAIN_FILES}` en producción).
- **Keycloak** vive en otro hostname (`PF_DOMAIN_AUTH`). El login es una redirección 303 del `proxy.ts` al BFF y del BFF al IdP; el logout es un `fetch` POST al BFF y luego `window.location` a la URL de RP-initiated logout. Ninguno es un envío de `<form>` nativo hacia el IdP.
- **E2E:** Playwright contra el stack desechable `pfos-e2e` con imágenes de producción y Keycloak real, **sin Caddy** delante de la web.

Decisiones vigentes: NFR-SEC-008 (CSP estricta sin `unsafe-inline` en scripts, con nonces, y `frame-ancestors 'none'`); docs/12 §12 (política de referencia, `Report-Only` primero en staging); ADR-0019 (CSP con nonce generado en `proxy.ts`); ADR-0027 nota 2026-10-29 (el origen de `PF_DOMAIN_FILES` en `connect-src`).

## Objetivos / No objetivos

**Objetivos**
- CSP aplicada (no solo informativa) en todas las páginas HTML de la web desde el primer deploy de producción.
- Scripts solo con nonce por petición, sin `unsafe-inline` ni `unsafe-eval` en producción.
- `frame-ancestors 'none'` en toda respuesta de los hostnames de la app y de archivos, pase o no por `proxy.ts`.
- La suite E2E existente ejercita la CSP real y una spec nueva falla ante cualquier violación.

**No objetivos**
- CSP de Keycloak: el tema de login y la consola los sirve Keycloak con su propia cabecera; tocarla exige un tema propio.
- Endpoint de reportes (`report-to`/`report-uri`): no hay staging en N1 ni un colector; las violaciones se ven en la consola del navegador y en los E2E.
- Reescribir los estilos en línea de React como clases (ver decisión 4).
- HSTS de dos años con `preload` (docs/12 §12): cambia la política del dominio y no es parte de C13.

## Decisiones

1. **La CSP vive en `apps/web/proxy.ts`, no en Caddy.** Tres razones:
   - **El nonce lo tiene que conocer Next al renderizar.** Next extrae el nonce de la cabecera `Content-Security-Policy` de la **petición** y lo aplica a sus scripts, chunks y estilos generados ([guía de CSP de Next.js](https://nextjs.org/docs/app/guides/content-security-policy), «How nonces work»). Caddy no puede generar un nonce que Next use; tendría que reescribir el HTML.
   - **Los E2E la ejercitan sin cambios de infraestructura.** El stack `pfos-e2e` sirve `finance-web` directo, sin Caddy: si la CSP estuviera en Caddy, ningún E2E la probaría y el primer navegador en verla sería el del owner en producción.
   - **Es lo que ya decidieron ADR-0019 y docs/12 §12** («nonce por request generado en `middleware.ts`», hoy `proxy.ts`).

   *Alternativa descartada:* CSP estática en `next.config.ts` (`headers()`) o en Caddy con `script-src 'self' 'unsafe-inline'`: es la opción «sin nonces» de la guía de Next y contradice NFR-SEC-008. *Alternativa descartada:* hashes con SRI experimental (`experimental.sri`): solo cubre los archivos JS con `integrity`, no los `self.__next_f.push(...)` en línea del payload RSC, y está marcada experimental en la misma guía.

2. **Nonce por petición y renderizado dinámico de todas las páginas.** `proxy.ts` genera 128 bits aleatorios (`crypto.getRandomValues`, base64) por petición HTML, arma la política y la pone en la cabecera de la **petición** reenviada (para que Next la lea) y en la de la **respuesta**. Con nonce, la guía de Next exige renderizado dinámico («all pages must be dynamically rendered»): las páginas prerenderizadas en el build no tienen nonce y sus scripts quedarían bloqueados. `app/[locale]/layout.tsx` llama a `await connection()` (de `next/server`) y deja de usar `generateStaticParams` para forzarlo en todo el árbol. Costo: las páginas protegidas ya son dinámicas (leen la cookie de sesión); solo cambian las de `auth`. No hay CDN delante, así que no se pierde caché.
   - **Composición con `next-intl`:** el middleware de `next-intl` devuelve su propia respuesta (rewrite o redirect). La petición que recibe tiene que llevar ya la cabecera de CSP para que el rewrite la reenvíe a Next; si `next-intl` no propaga las cabeceras de la petición, `proxy.ts` las fija con el mecanismo de `NextResponse.next({ request: { headers } })` sobre la respuesta de `next-intl`. Cuál de los dos funciona lo decide un test (TC-SECURITY-CSP-001: el nonce de los `<script>` del HTML es el de la cabecera de la respuesta).
   - **Redirecciones del `proxy.ts`** (303 al login) no llevan CSP: no tienen cuerpo HTML.
   - **Prefetch de RSC** (`next-router-prefetch`): la respuesta no es HTML; puede llevar la cabecera o no, sin efecto. Se mantiene el `matcher` actual para no tocar el chequeo de sesión.

3. **Política de producción** (una línea, en este orden):

   ```http
   Content-Security-Policy: default-src 'self'; script-src 'self' 'nonce-{N}' 'strict-dynamic';
     style-src 'self' 'nonce-{N}'; style-src-attr 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self';
     connect-src 'self' {ORIGEN_ARCHIVOS}; object-src 'none'; base-uri 'none'; form-action 'self';
     frame-ancestors 'none'; upgrade-insecure-requests
   ```

   - `'strict-dynamic'` deja que los chunks que carga el runtime de Next (con nonce) carguen otros; con él los navegadores CSP3 ignoran `'self'` en `script-src` (queda por compatibilidad).
   - `{ORIGEN_ARCHIVOS}`: el **origen** (esquema, host y puerto, sin ruta) de `OBJECT_STORAGE_PUBLIC_ENDPOINT`. La variable ya existe en el contrato de configuración (la usa la API para firmar); se suma a la lista de `finance-web` en `packages/platform/src/config/variables.ts`, obligatoria con `PFOS_ENV=staging|production` y opcional en local/ci (sin ella, `connect-src 'self'`). En `compose.prod.yaml` ya vale `https://${PF_DOMAIN_FILES}` en `pfos.env`; se pasa también a `finance-web`. Así hay una sola fuente para la firma y para la CSP, y una diferencia entre ambas no puede existir.
   - `form-action 'self'`: ningún formulario hace un envío nativo fuera del origen (el logout navega por JS). docs/12 §12 sumaba el IdP; no hace falta y cerrar es más seguro. Si un E2E muestra lo contrario, se agrega `{ORIGEN_AUTH}` y se anota.
   - `base-uri 'none'` (docs/12 §12) en lugar del `'self'` de la guía de Next: la app no usa `<base>`.
   - `upgrade-insecure-requests` solo si `WEB_PUBLIC_URL` es `https:`; en el stack E2E (`http://localhost`) no se emite.
   - **Desarrollo** (`NODE_ENV=development`): se suma `'unsafe-eval'` a `script-src` (React lo usa para reconstruir las pilas de error del servidor, según la guía de Next) y `ws:` a `connect-src` para el HMR. Nunca en la imagen de producción: un test unitario lo comprueba.

4. **Estilos (pregunta 1 de docs/73).**
   - **Elementos `<style>` y hojas** (`style-src`): `'self'` y el nonce. Los 11 `<style>{CSS}</style>` de componentes pasan a hojas estáticas importadas (CSS global por vista o CSS Modules), igual que `globals.css`. No se les pasa el nonce: una hoja estática no depende de la petición.
   - **Atributos `style`** (`style-src-attr 'unsafe-inline'`): React serializa las props `style` como atributos en el HTML del servidor, y la directiva los bloquea si no están permitidos ([MDN, `style-src-attr`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/style-src-attr)); los nonces no aplican a atributos y `'unsafe-hashes'` no sirve para valores calculados (anchos de barras, colores por serie). La hidratación no vuelve a aplicar un atributo bloqueado, así que la pantalla quedaría sin estilos. Los cambios de estilo que React hace después en el cliente usan propiedades del CSSOM (`el.style.x = …`), que la CSP no bloquea. Es compatible con NFR-SEC-008, que prohíbe `unsafe-inline` solo en scripts. El soporte es general desde diciembre de 2022 (MDN: Baseline).
   - *Alternativa:* reescribir ≈ 3 400 props en 172 archivos como clases: meses de trabajo para un riesgo bajo (inyectar un atributo exige una inyección de HTML que React ya escapa). Queda como opción B de la pregunta 1.

5. **Caddy como red de seguridad, sin pisar la de la web.** En los bloques de `{$PF_DOMAIN_APP}` y `{$PF_DOMAIN_FILES}`:

   ```caddyfile
   header ?Content-Security-Policy "default-src 'none'; frame-ancestors 'none'"
   ```

   El prefijo `?` escribe la cabecera **solo si la respuesta no la trae**, y activa `defer` para evaluarlo después de que `reverse_proxy` escriba las cabeceras de la web ([directiva `header` de Caddy](https://caddyserver.com/docs/caddyfile/directives/header)). Cubre lo que `proxy.ts` no ve: `/api/*` (JSON del BFF), `/_next/static/*`, los 404 de rutas con extensión y todo el hostname de archivos. La descarga de documentos ya trae `sandbox; default-src 'none'` (ADR-0030) y no se toca. No va en el snippet común porque se aplicaría a `PF_DOMAIN_AUTH`, donde una página de Keycloak sin cabecera propia quedaría sin estilos.

   En `{$PF_DOMAIN_APP}` se suman `Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=(), usb=()"` y `Cross-Origin-Opener-Policy "same-origin"` (docs/12 §12). COOP no rompe el login porque es por redirección, no por ventana emergente. `Cross-Origin-Resource-Policy` queda fuera: la web no sirve recursos a otros orígenes y su valor no cambia nada medible.

6. **Aplicada desde el primer deploy, con interruptor de emergencia (pregunta 2).** docs/12 §12 pedía `Report-Only` en staging antes de aplicar; N1 no tiene staging y no hay colector de reportes. La suite E2E completa (≈ 50 specs con imágenes de producción) hace ese papel. Recomendación: la variable `WEB_CSP_REPORT_ONLY` (booleana, por omisión `false`) cambia el nombre de la cabecera a `Content-Security-Policy-Report-Only` sin cambiar la política, para salir de un bloqueo en producción con un redeploy sin código. Si el owner prefiere no tenerla, se quita del grupo 3 de tareas.

7. **Prueba de que no hay violaciones.** Una spec E2E nueva (`tests/e2e/specs/content-security-policy.spec.ts`):
   - registra con `page.addInitScript` un oyente de `securitypolicyviolation` y junta también los mensajes de consola «Refused to …»;
   - recorre todas las rutas de `NAV_ITEMS` en `es`, una en `en` y `pt`, y las páginas de `auth`;
   - sube un documento (el `PUT` al origen de archivos) y abre un reporte con gráfico;
   - comprueba la cabecera (nonce distinto en dos cargas, `frame-ancestors 'none'`, el origen de archivos en `connect-src`) y que la lista de violaciones queda vacía.

   Además, la suite completa corre con la CSP aplicada: cualquier script bloqueado rompe la pantalla y la spec que la usa.

## Riesgos / Trade-offs

- **Una ruta que los E2E no visitan** puede traer un script o `<style>` sin nonce → pantalla rota. Mitigación: la spec recorre la navegación completa; `WEB_CSP_REPORT_ONLY` para salir sin código; comprobación 9 de la fase 6.
- **`next-intl` y las cabeceras de la petición:** si el rewrite no las reenvía, Next no ve el nonce y bloquea todo. TC-SECURITY-CSP-001 lo detecta en el test de integración antes del E2E.
- **Renderizado dinámico de `auth`:** unos milisegundos por petición; sin efecto con un usuario.
- **`style-src-attr 'unsafe-inline'`:** permite estilos por atributo inyectados. Bajo con React (escapa atributos) y sin `dangerouslySetInnerHTML` en la web.
- **Cabecera grande:** ≈ 450 bytes por respuesta HTML; sin efecto.

## Plan de migración

Sin datos. El orden de despliegue es el normal: un PR con `proxy.ts`, el layout, las hojas estáticas, la variable y el Caddyfile; `deploy.yml` lo lleva al host. Vuelta atrás: `WEB_CSP_REPORT_ONLY=true` en `/etc/pfos/pfos.env` y redeploy del mismo SHA (si el owner aprueba la decisión 6), o `pfos-deploy.sh rollback`.

## Contratos

- **OpenAPI y eventos:** sin cambios.
- **Configuración** (`packages/platform/src/config/variables.ts`, `docs/config-reference.md`, `pnpm config:docs:check`):
  - `OBJECT_STORAGE_PUBLIC_ENDPOINT`: se agrega a la lista de `web`; obligatoria en `web` con `PFOS_ENV=staging|production`. Descripción: suma «En finance-web, su origen va en `connect-src` de la CSP».
  - `WEB_CSP_REPORT_ONLY` (nueva, grupo «BFF (finance-web)», booleana, por omisión `false`, solo `web`), sujeta a la pregunta 2.
- **Cabeceras HTTP** de las respuestas HTML de `finance-web`: `Content-Security-Policy` según la decisión 3. Caddy: `Content-Security-Policy` por omisión, `Permissions-Policy` y `Cross-Origin-Opener-Policy` según la decisión 5.

## Preguntas abiertas

Resueltas el 2026-11-24 ([docs/74](../../../docs/74-despliegue-n1-specs-decisions.md), con la recomendación; preguntas en [docs/73](../../../docs/73-despliegue-n1-specs-questions.md)):

- **Pregunta 1 (D457):** `style-src-attr 'unsafe-inline'`; los estilos en línea de React no se reescriben.
- **Pregunta 2 (D458):** aplicada desde el primer deploy, con `WEB_CSP_REPORT_ONLY` como interruptor.

**As-built (2026-11-24):** la ruta `/es/…` sin página se resuelve con `app/[locale]/[...rest]/page.tsx` y `app/[locale]/not-found.tsx` (404 propio con i18n y por petición): el `/_not-found` que Next prerenderiza en el build no tiene nonce y trae un `<style>` en línea. `next-intl` arma el rewrite con las cabeceras de la petición que recibe, así que `proxy.ts` le pasa una petición que ya lleva la política (la rama «`NextResponse.next({ request })` sobre la respuesta de `next-intl`» no hizo falta); lo prueba `proxy.test.ts` y el E2E compara los nonces. `vitest.config.ts` de la web integra `next-intl` en línea para poder probar `proxy.ts`. Los compose no cambian: `finance-web` ya recibe `OBJECT_STORAGE_PUBLIC_ENDPOINT` por su `env_file`.
