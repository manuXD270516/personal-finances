# ADR-0016: Estrategia de testing — Vitest, Testcontainers, Playwright, fast-check, contract y architecture tests

- Estado: Aceptado (2026-10-02, tras SPIKE-03/04; decisión del owner)
- Fecha: 2026-10-01
- Decisores: Owner (Product/Tech Lead)
- Relacionado: docs/ARCHITECTURE.md §5, §11, §12; tests/cases/; docs/16-testing-strategy.md; docs/17-test-traceability.md; ADR-0002, ADR-0003, ADR-0004, ADR-0006, ADR-0007, ADR-0015, ADR-0022, ADR-0024; OpenSpec capability `quality/test-traceability`; SPIKE-03, SPIKE-04

## Contexto y problema

Los errores en PFOS son caros: un bug de redondeo o de balance corrompe el historial financiero, y un bug de RLS expone datos de otro workspace. El equipo es una persona apoyada por agentes de IA, que generan código rápidamente pero requieren una red de seguridad automática. Hay que decidir: frameworks, niveles de la pirámide, cómo testear contra infraestructura real, cómo testear invariantes financieras, cómo verificar arquitectura y contratos, y cómo trazar tests a specs.

## Drivers de decisión

- Confianza en invariantes financieras (property-based).
- Velocidad de feedback (unit en milisegundos, watch mode).
- Realismo de integración (PG real con RLS/triggers, no mocks).
- Compatibilidad con TypeScript/ESM, NestJS y monorepo.
- Trazabilidad FR → Requirement → Scenario → TC → test (ADR-0024).
- Costo/mantenimiento razonables.

## Opciones consideradas

**Runner unit/integration:** 1. **Vitest** (elegida) · 2. Jest (+ ts-jest/@swc/jest) · 3. `node:test`.

**Integración con infraestructura:** A. **Testcontainers** (elegida) · B. Compose compartido para tests · C. Mocks/in-memory (pg-mem, ioredis-mock).

**E2E:** **Playwright** (elegida) vs Cypress.

**Property-based:** **fast-check** (elegida).

**Contratos:** Spectral/Redocly (OpenAPI lint) + JSON Schema (eventos) (elegida) vs Pact (consumer-driven).

**Arquitectura:** dependency-cruiser (elegida) vs ts-arch / eslint-plugin-boundaries.

## Decisión

Pirámide (de más a menos tests):

| Nivel | Herramienta | Alcance | Infra |
|---|---|---|---|
| Domain/unit | Vitest | Agregados, VOs (Money), políticas, servicios de dominio | Ninguna |
| Property-based | fast-check (en Vitest) | Invariantes INV-NNN: balance por moneda, largest remainder, reversas, round-trips | Ninguna / PG para round-trip |
| Application | Vitest | Casos de uso con puertos fake (in-memory) | Ninguna |
| Integration | Vitest + **Testcontainers** (PG 18, Valkey, S3 local) | Adapters Kysely, RLS, constraint triggers, outbox/inbox, migraciones | Contenedores efímeros |
| Contract | Spectral/Redocly + JSON Schema + tests de respuesta vs OpenAPI | API REST y eventos | — |
| Architecture | dependency-cruiser + tests SQL (`information_schema`) | Capas, fronteras, FKs cross-schema, RLS habilitado en todas las tablas | PG |
| E2E | **Playwright** | Flujos críticos de usuario (login, registrar gasto, transferencia, conversión, cierre de mes) | Compose `core` |

Reglas:
- Todo test automatizado que implemente un test case incluye su **TC-ID** en el nombre: `it('[TC-LEDGER-TRANSFER-001] transfer preserves net worth', …)`.
- Los TC se documentan en `tests/cases/<context>/TC-*.md` (en español) con referencia al Requirement/Scenario OpenSpec.
- Mocks solo para puertos en tests de application; **prohibido mockear la BD** en tests de repositorios.
- Cobertura: umbral alto en `domain` (≥ 90% líneas/ramas) y moderado global; la cobertura no es objetivo en sí — la trazabilidad de scenarios sí.
- Mutation testing (Stryker) opcional sobre `@pf/ledger` y `@pf/shared-kernel` en job nocturno (Phase 2+).
- Datos de prueba: builders/fixtures por contexto; seeds `minimal|demo|large` para E2E y performance.

## Análisis de opciones

### Vitest vs Jest

| Criterio | Vitest | Jest |
|---|---|---|
| ESM/TS nativo | Sí (Vite/esbuild; SWC vía plugin para decorators) | Requiere ts-jest/@swc/jest; ESM aún con fricción |
| Velocidad | Alta (workers, watch inteligente) | Media |
| API | Compatible con Jest (`describe/it/expect/vi`) | Estándar histórico |
| Monorepo | `projects`/workspace nativo | `projects` |
| NestJS | Requiere `unplugin-swc` para `emitDecoratorMetadata`; default en Nest v12 | Default histórico en Nest ≤ 11 |
| Ecosistema | Grande y creciente; browser mode | Muy grande, maduro |

- **Vitest — Pros:** rápido, ESM-first, misma config para todos los paquetes, compatible con la API de Jest, adoptado por NestJS v12. **Contras:** decorator metadata requiere SWC (configuración adicional para tests de `interface`); algunas librerías aún documentan solo Jest. **Costo:** 0. **Complejidad:** baja.
- **Jest — Pros:** maduro, documentación extensa, integración Nest histórica. **Contras:** lento con TS; soporte ESM experimental; transformaciones extra. **Costo:** 0. **Complejidad:** media.
- **node:test — Pros:** sin dependencias. **Contras:** ecosistema de mocks/reporters pobre. Descartado.

### Testcontainers vs Compose compartido vs mocks
- **Testcontainers:** aislamiento por suite, misma imagen pinneada que producción, paralelizable; contra: requiere Docker en CI/local (ya requerido), arranque ~2–5 s (mitigable reutilizando contenedores por worker).
- **Compose compartido:** más rápido de arrancar pero estado compartido → flakiness.
- **Mocks/pg-mem:** no soportan RLS, constraint triggers ni `NUMERIC` exacto con fidelidad → falsos verdes. Descartado para persistencia.

### Playwright vs Cypress
- Playwright: multi-navegador, paralelismo gratis, trace viewer, API testing; Cypress: buena DX pero paralelismo/dashboard de pago y limitaciones multi-tab/origen. Playwright elegido.

### Pact vs JSON Schema/OpenAPI
- Pact aporta valor con múltiples equipos/consumidores; con un solo consumidor (BFF) y contract-first, lint + validación de respuestas contra OpenAPI es suficiente. Reevaluar al extraer servicios.

## Consecuencias

**Positivas**
- Invariantes financieras verificadas con miles de casos generados.
- RLS y triggers probados contra PG real.
- Trazabilidad automática spec → test.

**Negativas**
- Tests de integración más lentos que unit; requieren Docker.
- Configuración SWC para tests que instancian módulos Nest.

**Riesgos**
- Flakiness en E2E. *Mitigación:* pocos E2E, datos aislados por test, retries solo en CI con reporte.
- Tests sin TC-ID → huecos de trazabilidad. *Mitigación:* el generador de matriz falla si un Scenario no tiene TC o un TC no tiene test (gradual: warning en Phase 1, error desde Phase 2).

## Validación

- SPIKE-03: suite fast-check de Money/allocation en Vitest.
- SPIKE-04: test de un módulo Nest con Vitest + `unplugin-swc` (DI con metadata funcionando).
- Métricas: suite unit+domain < 60 s; integration < 5 min en CI; flaky rate E2E < 2%.

## Notas

- Verificado 2026-10-01: el roadmap de NestJS v12 (InfoQ, abril 2026) adopta Vitest como runner por defecto (con SWC/OXC para decorators); Vitest/esbuild no emite decorator metadata sin SWC (`unplugin-swc`).
- Versiones actuales de Testcontainers-node, Playwright y fast-check: a verificar al implementar (no verificadas en esta redacción).
