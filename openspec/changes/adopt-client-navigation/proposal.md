# Propuesta: adopt-client-navigation

## Why

Cada cambio de sección carga un documento nuevo: React se rehidrata, el marco se vuelve a montar y se vuelve a pedir el perfil (`/me`). docs/78 (P12, § 11.1 punto 6) propuso migrar a la navegación del cliente de Next (`next/link`) y el owner lo dejó como change aparte **después de medir INP y navegación** (D511, [docs/79](../../../docs/79-ui-ux-modern-web-decisions.md)). El change 81 midió solo INP: con 2 000 filas, ninguna mediana local supera los 200 ms de NFR-PERF-004 (abrir fila 200 ms, filtrar 136 ms, aprobar 72 ms, edición masiva 30 ms), y esas interacciones no mejoran con `next/link` porque ocurren dentro de una página. **La navegación entre secciones no se midió.** Migrar es de esfuerzo L, toca unas 200 anclas y los specs E2E que esperan `ready`, y excluye M-29. Con los datos de hoy la migración completa no se justifica, así que este change se propone **reducido**: primero medir la navegación con el objetivo de NFR-PERF-004 y migrar solo si incumple. La decisión queda para el owner (pregunta 5 de [docs/85](../../../docs/85-ui-lotes-l6-l7-questions.md), bloqueante para la etapa 2).

## What Changes

- **Etapa 1, medición (sin condición):** spec informativo en el proyecto `inp` de Playwright que mide, para Inicio → Transacciones, Presupuestos, Reportes y el detalle de una transacción, el tiempo hasta el contenido propio y el LCP, en escritorio y en un perfil de teléfono modesto («Fast 4G» y CPU ×4), mediana de 3 corridas, contra 2.5 s (NFR-PERF-004). Nunca falla la suite.
- **Etapa 2, migración (condicionada a la pregunta 5 y, en la opción recomendada, a que la medición incumpla):** `AppLink` sobre el `Link` de next-intl con `prefetch={false}`, migración de las anclas internas, documento nuevo para idioma, workspace, cierre de sesión y las altas que dependen del montaje, avisos vaciados al cambiar de ruta, foco al contenido y anuncio de la sección, historial con desplazamiento restaurado, sesión validada en cada navegación y specs E2E que esperan el contenido propio en lugar de `ready`.
- **Si no se migra:** los 5 requirements de la etapa 2 se retiran del delta antes de archivar, TC-PLATFORM-CLIENTNAV-003..014 pasan a `deprecated` y M-29 queda habilitado para el change 83 (pregunta 6).
- **Fuera de alcance:** prefetch y speculation rules (M-32), `experimental.viewTransition` de Next, cambios de API, BFF o CSP, y volver la medición un gate de CI.

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities
- `platform/web-interface`: 6 ADDED (1 Should, 5 Could): medición de la navegación (etapa 1) y, condicionados, navegación sin recargar, foco y anuncio, historial y desplazamiento, documento nuevo al cambiar de contexto, y sesión y seguridad en la navegación del cliente.

## Impact

**Specs impactadas:** `platform/web-interface` (6 ADDED). Lee sin modificar: `identity/authentication` (sesión del BFF, cierre de sesión), `identity/workspace-membership` (cambio de workspace) y `security/access-control` (CSP con nonce).

**Componentes/contextos impactados:** etapa 1: solo `tests/e2e` (`src/navigation-timing.ts`, `specs/navigation.spec.ts`, proyecto `inp`). Etapa 2: `apps/web` (capa interface): `src/ui/common/AppLink.tsx` (nuevo), las anclas internas de `src/ui`, `AppFrame.tsx` (avisos y foco), `session-context.tsx`, los formularios con `location.assign` y `tests/e2e` (`helpers.ts`, `finance.ts` y los specs que esperan `ready`). Ningún contexto de dominio.

**APIs impactadas:** ninguna (`contracts/openapi` no cambia).

**Tablas impactadas:** ninguna.

**Eventos impactados:** ninguno.

**Migraciones requeridas:** ninguna.

**Test cases:** AÑADIDOS — TC-PLATFORM-CLIENTNAV-001..014 (14; 003..014 condicionados a la etapa 2). MODIFICADOS — ninguno. DEPRECADOS — ninguno (003..014 pasarían a `deprecated` si no se migra).

**Impacto de regresión:** etapa 1: nulo (solo pruebas fuera del job de PR). Etapa 2: alto: cambia cómo se navega en toda la app y obliga a ajustar los specs E2E que esperan `ready`. Mitigación: migración por dominio en PR separados, suite completa dos veces, WebKit del job `e2e` y los TC de aislamiento de workspace y de sesión vencida.

**Riesgos introducidos:** sin RISK-id registrado. Estado que sobrevive al cambio de sección (mitigado con documento nuevo al cambiar de workspace y avisos vaciados) y M-29 inerte si se migra.

**Invariantes afectadas:** ninguna (no toca dinero, ledger, FX ni periodos).
