# Tareas

> Change de seguimiento del 48 (D299, [docs/52](../../../docs/52-perf-under-load-owner-decisions.md)): sin dominio, API, UI ni migraciones salvo que la medición pida un arreglo del producto (grupo 4). Primero se mide y después se corrige. Sin Docker, `pnpm perf:bench` no corre en la sesión: las mediciones las hace el job `perf` por `workflow_dispatch` de `nightly` desde la rama `claude/fix-imports-perf-experiments`, que no se fusiona, y se dice en el informe. El job `perf` sigue bloqueante (D285) y el umbral de 120 s no cambia (D112).
>
> **Orden de implementación.** (1) Grupo 1. (2) Grupo 2 en un PR que se fusiona (tests unitarios y de política sin Docker). (3) Grupo 3: diagnóstico por `workflow_dispatch` desde la rama no fusionada e informe. (4) Grupo 4 según la causa (si pide cambiar el presupuesto de producción o el umbral, pregunta al owner antes). (5) Grupos 5 a 7.

## 1. SPEC y TEST CASES

- [ ] 1.1 Revisar el delta de `platform/delivery-pipeline`; `pnpm exec openspec validate fix-imports-perf-connection-budget --strict`
- [ ] 1.2 Revisar TC-PLATFORM-PIPELINE-029..032 contra los scenarios; pasarlos a `ready` al empezar la implementación

## 2. MEDICIÓN y veredictos del benchmark (decisiones 2 a 4; se fusiona)

- [ ] 2.1 Tests primero (TDD) en `apps/api/test/perf/connection-budget.test.ts`: la suma de pools 52 + 52 + 4 + 4 + 3 = 115 frente a 100 con 3 reservadas falla con la suma, el límite y el detalle por pool; una suma que cabe pasa (TC-PLATFORM-PIPELINE-029)
- [ ] 2.2 Tests primero en `perf-report.test.ts`: una adquisición vencida con el pool del worker en 34 de 34 da el veredicto `conexiones` con pool, uso, máximo y espera, separado del drenado (TC-PLATFORM-PIPELINE-030); un drenado de 123 458,95 ms frente a 120 000 ms falla nombrando los consumidores que terminaron después de 120 s, con veredicto de drenado (TC-PLATFORM-PIPELINE-032); el reporte publica `connections` y `drainByConsumer` (aditivos) en `perf-results.json` y una tabla en `perf-summary.md` (TC-PLATFORM-PIPELINE-031)
- [ ] 2.3 `apps/api/test/perf/connection-budget.ts`: precondición de presupuesto (`max_connections` y `superuser_reserved_connections` de `pg_settings`) y muestreador cada segundo de `totalCount`, `idleCount` y `waitingCount` de cada pool, la espera máxima de adquisición y el pico de `pg_stat_activity` por `application_name`; consultas en serie sobre una conexión propia, contada en la suma
- [ ] 2.4 `imports.perf.ts`: precondición antes de subir el archivo, muestreo durante la persistencia y el drenado, pendientes por consumidor al terminar la persistencia y tiempo hasta 0 desde la persistencia; mensajes de fallo con el veredicto. Sin cambiar `PREVIEW_BUDGET_MS`, `PERSIST_CEILING_MS` ni `DRAIN_BUDGET_MS`
- [ ] 2.5 Test de política `scripts/delivery-policy/test/nightly-policy.test.ts`: los umbrales de `imports.perf.ts` siguen fijados a docs/02 (ya cubierto por TC-PLATFORM-PIPELINE-028; verificar que el refactor no lo rompe) y `nightly.yml` no cambia

## 3. DIAGNÓSTICO (decisiones 1 y 6; rama `claude/fix-imports-perf-experiments`, no se fusiona)

- [ ] 3.1 Corridas por `workflow_dispatch` de `nightly` desde la rama, lejos de las 06:00 UTC y con el aviso por issue de `perf` desactivado en la rama: M1 ×2 (conexiones por pool y del servidor, orden de `main`), M2 (host en quietud al empezar `imports`), M3 ×2 (drenado por consumidor), M4 (`imports` sola sin Large Seed). Anotar run id, hora y commit
- [ ] 3.2 Informe en `docs/NN-imports-perf-findings.md` (siguiente número libre): HI1–HI5 aceptadas o descartadas con sus mediciones, causa de cada manifestación (conexiones y drenado marginal), opción de arreglo elegida (A1–A5) y comparación de la suma medida con la plantilla del host (`max_connections=70`, API 22 + worker 34, D249)
- [ ] 3.3 Si la causa pide cambiar el presupuesto de conexiones de producción, la concurrencia de un consumidor frente a la plantilla del host o el umbral de 120 s, o si el drenado marginal no tiene causa medida: preguntas en un doc `docs/NN-…-questions.md` con opciones y recomendación, antes del grupo 4

## 4. ARREGLO según la causa (decisión 5)

- [ ] 4.1 Arreglo del benchmark (A1, A2 o A3), si es la causa: test primero (la precondición de 2.1 pasa con los pools nuevos) y cambio en `apps/api/test/support/` o en la suite; `max_connections` del contenedor efímero solo con la suma medida
- [ ] 4.2 Arreglo del producto (A4 o A5), si es la causa: test primero (unitario o de integración con TC-id), cambio con su configuración documentada (`docs/config-reference.md`, `pnpm config:docs:check`) y TC-PLATFORM-EVENTS-019 en verde
- [ ] 4.3 Si 4.2 cambia un comportamiento especificado, agregar antes el delta de la capability correspondiente (`platform/event-delivery` o `imports/import-pipeline`) con su TC y validar `--strict`
- [ ] 4.4 Marcar como no aplicable, con nota, la opción que la medición descarte

## 5. VERIFICACIÓN local

- [ ] 5.1 Gates: `pnpm format:check`, `pnpm turbo typecheck lint test build`, `pnpm arch:check`, `pnpm traceability:check`, `pnpm spec:validate`, `pnpm config:docs:check` y `pnpm contract:breaking` (sin cambios de contrato); `pnpm test:integration` dos veces si 4.2 toca código de producción

## 6. VERIFICACIÓN en GitHub

- [ ] 6.1 Tras fusionar el arreglo: `nightly` por `workflow_dispatch`; anotar en TC-PLATFORM-PIPELINE-029..032 las conexiones y el drenado por consumidor publicados
- [ ] 6.2 Criterio de salida: `imports.perf.ts` en verde en dos nightlies programados seguidos, con el reporte de conexiones y de drenado; las demás suites siguen en verde y ningún umbral cambió (TC-PLATFORM-PIPELINE-028)

## 7. DOCS y cierre

- [ ] 7.1 docs/23 §5.5 (precondición de presupuesto, veredicto `conexiones`, drenado por consumidor, causa y arreglo); nota con causa y camino en TC-IMPORTS-CSV-029; docs/38 (fila del change y §4 «Conexiones» con la cifra vigente de la plantilla del host)
- [ ] 7.2 TC-PLATFORM-PIPELINE-029, 030 y 032 a `automated`; 031 a `automated` con la corrida de 6.2 como evidencia; `pnpm traceability:check` y `pnpm exec openspec validate fix-imports-perf-connection-budget --strict`
