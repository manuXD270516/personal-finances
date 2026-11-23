# Tareas

> Fix de rendimiento sin cambio de comportamiento (D448: el umbral de 800 ms no se toca). Sin migraciones, índices, contratos ni configuración. Dominio test-first. La medición local a escala 1 necesita Docker (Testcontainers); sin Docker la valida el nightly.

## 1. SPEC y TEST CASES

- [ ] 1.1 Revisar los deltas (`reporting/financial-reports` y `fx/market-rates`, 1 ADDED cada uno) y `pnpm exec openspec validate fix-trends-report-perf --strict`
- [ ] 1.2 Pasar TC-REPORTING-REPORTS-055, -056, -057, TC-FX-RATE-009 y -010 de `draft` a `ready` al empezar

## 2. MEDICIÓN DE REFERENCIA (antes de tocar código)

- [ ] 2.1 Repetir en la máquina del implementador el diagnóstico de design §Medición sobre `main` (Large Seed a escala 1, `PF_PERF_SCALE=1`, instrumentación por fase local y no versionada, 40 medidas de tendencias de 24 meses y 30 de 12 y 6 meses) y anotar aquí el p50/p95 HTTP y por fase: es la referencia de TC-REPORTING-REPORTS-056 (≤ 50 % del p95)

## 3. DOMINIO FX (TDD)

- [ ] 3.1 `[TC-FX-RATE-009]` en `packages/contexts/fx/src/domain/rate-resolver.equivalence.test.ts` (nuevo): copia literal de `RateResolver` de `main` 4cdc7689 como oráculo dentro del test; generadores de candidatas y solicitudes del TC; fast-check con semilla fija, ≥ 300 corridas y timeout explícito. Verde con el resolvedor actual (es de equivalencia)
- [ ] 3.2 `[TC-FX-RATE-010]` en el mismo archivo: 10 000 candidatas con `asOf` contado (getter), 2 000 solicitudes; ROJO con el resolvedor actual (registrar el conteo)
- [ ] 3.3 Implementar design §Decisión 2 en `packages/contexts/fx/src/domain/rate-resolver.ts` (índice por par no ordenado y por instante en el constructor, tramo por búsqueda binaria reordenado al orden original, mismos filtros y mismo `ValuationRateSelector`); 3.1 y 3.2 en verde y `rate-resolver.test.ts`, `fx.properties.test.ts` y el resto de FX sin cambios

## 4. DOMINIO REPORTING (TDD)

- [ ] 4.1 `[TC-REPORTING-REPORTS-055]` (dominio) en `packages/contexts/reporting/src/domain/trend-matrix.equivalence.test.ts` (nuevo): copia literal de `TrendMatrix.build` de `main` 4cdc7689 como oráculo; generadores del TC con `ReportConversionPolicy` real (fecha de transacción y de corte, tasas ausentes); igualdad profunda con `exact` como texto. Verde con la implementación actual
- [ ] 4.2 `[TC-REPORTING-REPORTS-057]` en el mismo archivo: `Proxy` contador sobre los hechos y política espía; ROJO con la implementación actual (registrar el conteo)
- [ ] 4.3 Implementar design §Decisión 1 en `packages/contexts/reporting/src/domain/extended-reports.ts` (`TrendMatrix.build` en una pasada, ranking antes que las celdas y en orden de primera aparición); 4.1, 4.2 y TC-REPORTING-REPORTS-041 en verde sin cambios

## 5. APLICACIÓN

- [ ] 5.1 `[TC-REPORTING-REPORTS-055]` (aplicación) en `packages/contexts/reporting/src/application/extended-reports.queries.test.ts`: `getTrends` con los dobles de los puertos y datos generados frente a la misma consulta armada con el oráculo de 4.1; DTO completo igual, incluidos `meta.conversion.ratesUsed` (mismo orden), `meta.complete` y `meta.unconverted`
- [ ] 5.2 Contingencia de design §Decisión 3 (sin `await` por fila en `pg-nominal-flows.ts` y un solo `Money.parse` por hecho en `loadFacts`), **solo** si la medición de 6.1 tras 3.3 y 4.3 da p50 HTTP > 230 ms en la máquina de referencia de 2.1; si no hace falta, marcar `[x]` con la medición que lo justifica. Si se aplica: tests de `pg-nominal-flows` y de reportes sin cambios y 5.1 en verde

## 6. VERIFICACIÓN DE RENDIMIENTO

- [ ] 6.1 Repetir la medición de 2.1 en la misma máquina con el cambio: p95 HTTP de 24 meses ≤ 50 % del de 2.1, `resolveRates` ≤ 20 ms y `trendMatrix` ≤ 40 ms (p50); anotar todas las fases aquí y en TC-REPORTING-REPORTS-056
- [ ] 6.2 Gates: `pnpm format:check`, `pnpm turbo typecheck lint test build`, `pnpm arch:check`, `pnpm traceability:check`, `pnpm spec:validate`, `pnpm config:docs:check`, `pnpm contract:breaking` (sin cambios esperados) y `pnpm test:integration` dos veces seguidas en verde. Sin cambios en `apps/api/test/perf/*.perf.ts` (umbral, rango e iteraciones intactos, D448)
- [ ] 6.3 Nightlies programados tras la fusión (TC-REPORTING-REPORTS-056): `report-trends-24m` ≤ 800 ms en todos; ≤ 400 ms en al menos uno sobre AMD EPYC y en todos los de los 7 días siguientes; demás filas `report-*`, `reports-summary` y de dashboard sin empeorar más de un 10 % frente a la mediana previa con el mismo modelo de CPU. Registrar run, CPU, p50 y p95 aquí. Si un AMD supera 400 ms con 5.2 aplicada, no cerrar: informar al owner con la medición

## 7. DOCS y cierre

- [ ] 7.1 TC-REPORTING-REPORTS-055, -057, TC-FX-RATE-009 y -010 a `automated` con sus `automated_tests`; TC-REPORTING-REPORTS-056 a `automated` con `apps/api/test/perf/nightly.perf.ts` al cerrar 6.3 (agregar `[TC-REPORTING-REPORTS-056]` al nombre del test de la fila sin tocar su lógica); `requirement_status: confirmed` al archivar
- [ ] 7.2 docs/38 (fila del change y pendientes) y docs/23 §5.5 (nota de la fila `report-trends-24m`: causa y resultado); `pnpm traceability:check` y `openspec validate --strict`
