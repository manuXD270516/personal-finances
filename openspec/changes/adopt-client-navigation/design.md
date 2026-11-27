# Diseño: adopt-client-navigation

## Contexto

Change 84 de docs/03 §7, nacido de la pregunta P12 de [docs/78](../../../docs/78-propuesta-mejora-ui-ux-modern-web.md) (§ 11.1 punto 6). El owner eligió en [docs/79](../../../docs/79-ui-ux-modern-web-decisions.md) D511: change aparte **después de medir INP y navegación (M-30, lote L5)**, y mientras tanto navegación por documento completo sin construir M-29. Lo implementa el agente `frontend` (D512).

**Lo que midió el change 81 (L5).** Solo INP, en Chromium local con 2 000 filas, mediana de 3 corridas: abrir fila 200 ms, filtrar 136 ms, aprobar ≈ 72 ms, edición masiva ≈ 30 ms. Ninguna supera los 200 ms de NFR-PERF-004. **No midió la navegación entre secciones.**

**Por qué eso cambia el alcance.** La navegación del cliente (`next/link`) no mejora el INP de esos flujos: son interacciones dentro de una misma página. Lo que mejora es el costo de **cambiar de sección**: hoy cada clic carga un documento nuevo, rehidrata React, vuelve a pedir `/me` y vuelve a montar el marco (§ 11.1 punto 6 a). Ese costo no está medido. Migrar es de esfuerzo L (unas 200 anclas, 12 `location.assign`, specs E2E que esperan `ready`, revisión del estado que hoy se reinicia con la recarga) y excluye M-29. Con los datos de hoy **no hay evidencia de que haga falta**. Por eso este change se propone **reducido y en dos etapas**, y la decisión de migrar vuelve al owner (pregunta 5 de [docs/85](../../../docs/85-ui-lotes-l6-l7-questions.md), **bloqueante** para los grupos 5 a 7):

1. **Etapa 1 (sin condición):** medir la navegación entre secciones con el objetivo que ya existe en NFR-PERF-004 (LCP ≤ 2.5 s en «Fast 4G» emulada). Esfuerzo S, sin tocar la app.
2. **Etapa 2 (condicionada):** migrar a `next/link` solo si el owner lo elige y, en la opción recomendada, solo si la medición incumple el objetivo en el perfil de teléfono modesto. Si no se migra, los requirements de la etapa 2 se retiran del delta antes de archivar (como hizo el change 81 con la paginación) y M-29 queda habilitado para el change 83.

Estado de `origin/main` (2026-11-27):

- 0 usos de `next/link`; anclas `<a href>` en `apps/web/src` (docs/78 contó 203 incluyendo las de componentes de datos; se recuenta en la tarea 5.1) y 12 `location.assign` en TSX: los de después de crear un recurso (`AccountDetail`, `CardForm`, `LoanForm`, `ConversionForm`, `GoalForm`, `TransferForm`, `TransactionDetail`, `RuleEditor`, `ConnectionsPage`), el cambio de idioma (`forms.tsx`) y el de sesión o workspace (`session-context.tsx`).
- `proxy.ts` incluye las peticiones RSC (`?_rsc=`) en su `matcher`: cada navegación del cliente pasa por la comprobación de la cookie y genera un nonce (barato, sin red).
- Layout autenticado con `force-dynamic` y `await connection()`; `SessionProvider` carga `/me` después del render.
- `tests/e2e/src/helpers.ts` y `finance.ts` esperan `getByTestId('ready')` tras el login y tras navegar.
- Medición de INP en `tests/e2e/src/inp.ts` (proyecto `inp`, fuera del job de PR).

## Objetivos / No objetivos

**Objetivos**

- Saber con datos si la navegación por documento cumple NFR-PERF-004 en un teléfono modesto.
- Si no cumple y el owner lo decide, migrar sin perder accesibilidad, idioma, seguridad de sesión ni aislamiento entre workspaces.

**No objetivos**

- Prefetch agresivo o speculation rules (M-32, descartado).
- `experimental.viewTransition` de Next (no evaluado; ver pregunta 6).
- Cambiar la API, el BFF o la CSP.
- Convertir la medición en gate de CI.

## Decisiones

1. **Medición de la navegación (etapa 1).** Módulo `tests/e2e/src/navigation-timing.ts` y spec `tests/e2e/specs/navigation.spec.ts` en el proyecto `inp` (fuera del job de PR, igual que la medición de INP). Para cada destino (Inicio → Transacciones, → Presupuestos, → Reportes y lista → detalle de un gasto de 45.00 BOB): marca de tiempo al clic (`performance.now()` justo antes del `click`, guardada en `sessionStorage` desde la página de origen, porque con navegación por documento se pierde el contexto JS) y, en el destino, el tiempo hasta que aparece el `data-testid` propio de la sección (no `ready`, que con navegación del cliente queda en el marco) y la mayor pintura de contenido con `PerformanceObserver({ type: 'largest-contentful-paint', buffered: true })` registrado con `addInitScript`. Para documento nuevo se usa además `PerformanceNavigationTiming` (Widely). Dos perfiles: escritorio sin limitación, y teléfono modesto con `Network.emulateNetworkConditions` («Fast 4G»: 150 ms de latencia, ≈ 1.6 Mbps de bajada, ≈ 750 kbps de subida) y `Emulation.setCPUThrottlingRate({ rate: 4 })` por CDP. Mediana de 3 corridas por destino y perfil, informe JSON adjunto con `testInfo.attach` y tabla en la salida, con estado frente a 2.5 s; nunca falla. LCP y Event Timing solo son fiables en Chromium: la medición es solo Chromium. El módulo se reutiliza después de migrar para comparar.
2. **Criterio de la etapa 2 (pregunta 5, opción B recomendada).** Se migra solo si la mediana del perfil de teléfono modesto supera 2.5 s (LCP o contenido propio) en al menos uno de los destinos. Si todos cumplen, no se migra: se retiran los requirements de la etapa 2, sus TC pasan a `deprecated`, se anotan los valores en la tarea 4.2 y M-29 queda habilitado en el change 83 (pregunta 6). El owner puede elegir migrar igual (opción C) o no medir y cerrar (opción A).
3. **`AppLink` común (etapa 2).** Componente en `src/ui/common/AppLink.tsx` sobre `next/link` de next-intl (`createNavigation(routing).Link`, que aplica el prefijo de idioma como hoy `localized()`), con `prefetch={false}` por omisión: el prefetch de Next pide la ruta RSC al entrar en el viewport y multiplicaría las peticiones autenticadas (y los nonces) en listas largas. Ctrl/Cmd + clic, clic medio y «abrir en pestaña nueva» siguen siendo de un `<a>` real. Todas las anclas internas pasan a `AppLink`; las externas y las de descarga (`/api/...`) quedan como `<a>`. Un test estático impide `<a href="/…">` internos nuevos (con marca de excepción `full-load:`).
4. **Qué sigue cargando un documento nuevo.** El cambio de idioma (cookie `NEXT_LOCALE` y catálogo), el de workspace y el cierre de sesión (`session-context.tsx`: el estado de React de un workspace no debe sobrevivir al cambio) y las navegaciones tras crear un recurso con `?creada=1`/`?aviso=registrada`, que hoy dependen de montar la página de destino desde cero. Estas últimas se revisan una por una: si la página de destino lee el parámetro solo al montar, pasan a `router.push` con un `key` por ruta; si no se puede garantizar, se quedan con `location.assign` y la marca `full-load:`.
5. **Avisos y estado del marco.** La región de avisos vive en `AppFrame` (change 78) y hoy se vacía porque el documento cambia. Con navegación del cliente se vacía explícitamente al cambiar de ruta (`usePathname` en un efecto), para conservar el comportamiento especificado. Los formularios con estado local se desmontan al cambiar de ruta (comportamiento de React), igual que hoy.
6. **Foco y anuncio.** Next 16 trae un anunciador de rutas (`next-route-announcer`, región en vivo que lee `document.title` o el primer `h1`). Además, tras cada cambio de ruta el foco pasa al contenedor principal (`<main tabIndex={-1}>`) para que Tab siga en el contenido nuevo; con navegación por documento esto ya lo hace el navegador al cargar. El título sale de `generateMetadata` de cada página, como hoy.
7. **Historial y desplazamiento.** El router de Next restaura el desplazamiento al volver y sube al principio al navegar hacia adelante. Riesgo: las regiones de tabla con su propio desplazamiento (change 81) no se restauran; se acepta (hoy tampoco).
8. **Sesión y seguridad.** Cada navegación del cliente pide la carga RSC de la ruta, que pasa por `proxy.ts` (cookie) y por el layout autenticado (`requireSession()`); con la sesión vencida el BFF responde con la redirección al login y el router de Next la sigue con una navegación completa. Verificación E2E borrando la cookie de sesión antes del clic. La CSP no cambia: las cargas RSC no ejecutan scripts en línea.
9. **E2E.** Los specs que esperan `ready` tras navegar pasan a esperar el contenido propio de la sección (helper `waitForSection(page, testId)`); `ready` se conserva solo tras el login. El cambio se hace en el mismo PR que la migración, por dominio. El subconjunto WebKit del job `e2e` (change 86) cubre `app-shell` y `transactions`, que ejercitan la navegación.

## Riesgos / Trade-offs

- **Medir sin migrar puede no cambiar nada.** Es el resultado esperado si la navegación por documento cumple; el costo es pequeño (S) y deja una línea de base para NFR-PERF-004, que hoy no tiene medición de LCP en CI.
- **Emulación ≠ teléfono real.** «Fast 4G» y CPU ×4 son una aproximación; los valores son informativos y el criterio usa el objetivo de NFR-PERF-004, que ya define esa emulación.
- **Estado que hoy se reinicia con la recarga** (filtros, paneles abiertos, sondeos): con navegación del cliente algunos componentes del marco persisten. Mitigación: inventario en la tarea 5.4 y los avisos vaciados explícitamente.
- **Aislamiento entre workspaces.** Si un cambio de workspace usara navegación del cliente podría quedar estado del anterior en memoria. Mitigación: decisión 4 (documento nuevo) y TC-PLATFORM-CLIENTNAV-011.
- **M-29 inerte.** Si se migra, `@view-transition` no actúa; el change 83 retira su requirement (pregunta 6).

## Plan de migración

Sin migraciones de datos ni de contratos. Etapa 1 en un PR propio (solo `tests/e2e`). Etapa 2, si corresponde, en varios PR dentro de la rama del change, por dominio (marco y navegación, transacciones, plan, reportes, deudas, el resto), cada uno con sus specs E2E ajustados; vuelta atrás: revertir el PR del dominio (los `<a>` y `AppLink` conviven sin conflicto).

## Preguntas abiertas

En [docs/85](../../../docs/85-ui-lotes-l6-l7-questions.md):

5. **¿Se hace el change 84 y con qué alcance?** Bloquea los grupos 5 a 7 de este change (la etapa 1 no espera). Recomendación: (B) medir primero y migrar solo si el perfil de teléfono modesto incumple NFR-PERF-004.
6. **M-29 si se mantiene la navegación por documento** (no bloquea este change).
