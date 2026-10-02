# ADR-0019: Arquitectura frontend — Next.js (App Router) como UI y BFF

- Estado: Aceptado (2026-10-02, tras SPIKE-06; decisión del owner)
- Fecha: 2026-10-01
- Decisores: Owner (Product/Tech Lead)
- Relacionado: docs/ARCHITECTURE.md §5, §8; docs/28-ui-ux-design-system.md; ADR-0010, ADR-0011, ADR-0018, ADR-0020, ADR-0022; OpenSpec capabilities `identity/authentication`, `reporting/dashboard`; SPIKE-06

## Contexto y problema

La UI de PFOS es una aplicación de datos intensiva (tablas de transacciones con filtros, edición en bloque, dashboards con gráficos, formularios de conversiones con preview de montos), usada mayoritariamente autenticada. Además, por seguridad (ADR-0010), **el access token nunca debe llegar al JavaScript del navegador**: se necesita un **Backend-for-Frontend** que ejecute el flujo OIDC y mantenga la sesión con cookie httpOnly, proxyeando las llamadas a `finance-api`.

Hay que elegir el framework/arquitectura de frontend y cómo se implementa el BFF.

## Drivers de decisión

- Seguridad: BFF con tokens server-side.
- DX y productividad (componentes, tipado, ecosistema).
- Rendimiento percibido en vistas de datos.
- Complejidad de despliegue (un contenedor Node).
- Learning value y empleabilidad.
- Estabilidad del framework (frecuencia de cambios disruptivos).

## Opciones consideradas

1. **Next.js (App Router)** como UI + BFF integrado (elegida).
2. **Vite SPA** (React + TanStack Router + TanStack Query) + BFF separado (p. ej. Fastify/Hono o el propio `finance-api` sirviendo sesiones).
3. **React Router v7 (ex-Remix)** framework mode, con loaders/actions server-side como BFF.

## Decisión

- **Next.js (App Router) + TypeScript + Tailwind CSS + shadcn/ui + TanStack Query + ECharts**, desplegado como contenedor Node (`output: 'standalone'`) — imagen `finance-web`.
- **BFF dentro de Next.js:**
  - Rutas de auth (`/auth/login`, `/auth/callback`, `/auth/logout`) implementan Authorization Code + PKCE con una librería OIDC certificada (openid-client o equivalente; Auth.js evaluado en SPIKE-06).
  - Sesión en cookie httpOnly/Secure/SameSite=Lax con ID opaco; tokens en store server-side (cifrado; Redis/Valkey o cookie cifrada si cabe).
  - Proxy `/api/bff/*` (Route Handlers) que añade `Authorization: Bearer` y reenvía a `finance-api`, propagando `traceparent`, `Idempotency-Key` y `If-Match`.
  - `proxy.ts` (antes `middleware.ts`) solo para comprobaciones ligeras de sesión/redirección.
- **Patrón de datos:** Server Components para shell, navegación y carga inicial cuando aporta; **TanStack Query** en Client Components para vistas interactivas (tablas, filtros, mutaciones optimistas). Un cliente API **generado desde OpenAPI** (`contracts/openapi/finance-api.v1.yaml`) compartido.
- **Sin lógica de negocio en el frontend**: validaciones de UX sí, reglas financieras no (las decide `finance-api`). Montos se manejan como string/decimal.js, nunca `number` (ADR-0006).
- **Server Actions**: permitidos solo como envoltorio del cliente BFF (no acceden a BD, no contienen reglas de dominio).
- i18n preparado (copy en español por defecto), formato de montos por `Intl.NumberFormat` con escala de la moneda.

## Análisis de opciones

### 1. Next.js App Router + BFF (elegida)
- **Pros:** BFF y UI en un solo deployable; Route Handlers y Server Components permiten mantener tokens server-side sin un servicio adicional; ecosistema enorme (shadcn/ui, auth libs); alto learning value; `standalone` output apto para contenedores.
- **Contras:** complejidad conceptual (RSC, caching, server/client boundary); historial de cambios disruptivos entre majors (p. ej. caching semantics, `middleware` → `proxy` en v16); acoplamiento a decisiones de Vercel; self-hosting requiere atención (cache, ISR no necesarios aquí).
- **Costo:** 0 (self-hosted en contenedor). **Complejidad operativa:** media.

### 2. Vite SPA + TanStack Router + BFF separado
- **Pros:** modelo mental simple (todo cliente); build y HMR muy rápidos; TanStack Router con tipado de rutas y search params excelente; el SPA se sirve como estáticos (barato, CDN).
- **Contras:** el BFF debe existir igualmente → un servicio más (o mezclar sesiones web en `finance-api`, contaminando la API REST con concerns de navegador); sin SSR (irrelevante para app autenticada, pero carga inicial más pesada).
- **Costo:** bajo (estáticos + BFF pequeño). **Complejidad operativa:** media (dos piezas).

### 3. React Router v7 framework mode (Remix)
- **Pros:** loaders/actions server-side = BFF natural; modelo web-standards (forms, fetch); más simple que RSC; progressive enhancement.
- **Contras:** la fusión Remix → React Router v7 y la evolución hacia "Remix 3" introducen incertidumbre de roadmap; ecosistema menor que Next; menos learning value de mercado.
- **Costo:** 0. **Complejidad operativa:** media-baja.

## Consecuencias

**Positivas**
- Tokens nunca expuestos al navegador; una sola pieza web que desplegar.
- Cliente API tipado desde el contrato → coherencia front/back.
- Componentes accesibles (Radix vía shadcn/ui) y gráficos potentes (ECharts).

**Negativas**
- Doble salto de red (navegador → BFF → API) en cada llamada; latencia adicional mínima en red interna.
- Requiere disciplina para no mover lógica de negocio a Server Actions.

**Riesgos**
- Upgrades mayores de Next.js costosos. *Mitigación:* usar subset estable (App Router, Route Handlers, RSC básico), evitar features experimentales; Renovate con revisión.
- CSRF en mutaciones vía BFF. *Mitigación:* SameSite=Lax + verificación de `Origin` + token anti-CSRF en mutaciones.

## Validación

- SPIKE-06: login PKCE, cookie httpOnly, proxy BFF con refresh transparente, logout global; verificación de que ninguna respuesta al navegador contiene tokens.
- Métricas: LCP < 2.5 s en dashboard con dataset `demo`; interacción de filtro en tabla de transacciones < 200 ms (p95) con 10⁴ filas paginadas.
- E2E Playwright de flujos críticos.

## Notas

- Verificado 2026-10-01: Next.js 16 está disponible y renombra `middleware.ts` → `proxy.ts` (runtime Node.js), confirmando la tendencia a tratar esa capa como frontera de red/BFF ligera.
- Versión exacta de Next.js/React a fijar en Phase 1.
- Disenso menor (registrado sin cambiar la decisión): para una app 100% autenticada, la opción 2 es más simple en el cliente; el factor decisivo a favor de Next es evitar un tercer servicio para el BFF.

## Resultado del spike (SPIKE-06, 2026-10-01)

Informe completo y evidencia: [spikes/SPIKE-06-auth-bff/README.md](../../spikes/SPIKE-06-auth-bff/README.md). Estado del ADR: sigue **Propuesto**.

- **Next.js 16.3.8** (App Router, Turbopack, `next start`) funciona como BFF sin servicio extra:
  - Route Handlers `/api/bff/auth/{login,callback,logout}`, `/api/bff/session` (identidad + token CSRF, nunca tokens OAuth) y un proxy catch-all `/api/bff/[...path]` → `finance-api /api/v1/*` con `Authorization: Bearer`, allowlist de headers y `Cache-Control: no-store`.
  - Refresh transparente (< 60 s para expirar) y reintento tras 401: 5 peticiones concurrentes producen un solo refresh.
  - `proxy.ts` (ex-`middleware.ts`) se usó **solo** para el redirect ligero de `/app` según la presencia de la cookie. La validación real de la sesión ocurre en Server Components y Route Handlers.
- **Librería OIDC**: se elige **openid-client v6** directo (certificado, ~500 líneas de BFF en total). **Auth.js/NextAuth v5 se descarta**: sigue en beta (5.0.0-beta.32), su sesión por defecto es un JWT en cookie, no refresca nativamente los tokens del IdP y su CSRF no cubre el proxy. `@auth/core` es pre-1.0 y no aporta frente a openid-client.
- **Sesión**: Valkey con valor cifrado AES-256-GCM y clave = sha256(sid); TTL idle 30 min, absoluto 12 h. Una cookie cifrada stateless (iron-session) solo serviría como plan B, porque se acerca a 4 KB con los tokens de Keycloak.
- **CSRF** (mitigación del riesgo de este ADR), verificado con un `<form>` cross-site real:
  - SameSite=Lax: la cookie no se envía.
  - `Origin`/`Sec-Fetch-Site`: 403.
  - Solo `application/json`: 415.
  - `X-CSRF-Token` = HMAC(csrfSecret, sid): 403 si falta.
  - Se recomienda el *synchronizer token* derivado frente al double-submit cookie.
- **Latencia del doble salto**: en este host Windows no se distingue del suelo de ~15 ms de loopback (p50 BFF 15.3 ms vs directa 15.2 ms). Hay que volver a medir en Linux/CI.
- **Pendiente para Phase 1**:
  - CSP con nonce generado en `proxy.ts` y HSTS (requiere HTTPS local).
  - Lock distribuido de refresh si hay más de una réplica.
  - Verificar Secure cookies en WebKit sobre http://localhost (no probado).
