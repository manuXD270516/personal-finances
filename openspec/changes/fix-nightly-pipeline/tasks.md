# Tareas

> Sin dominio, aplicación, API, UI ni migraciones: el change corrige el ejecutor de la suite de regresión, tests y el harness de rendimiento. Las preguntas de [docs/44](../../../docs/44-fix-nightly-pipeline-questions.md) no bloquean los grupos 1 a 7 (se implementan con la recomendación); el grupo 8 solo se hace si el owner adopta las opciones indicadas. Ninguna sesión toca la protección de `main` ni los checks requeridos (D224). Sin Docker, `pnpm test:integration` y `pnpm perf:bench` no corren: se deja que CI y la corrida por `workflow_dispatch` los validen y se dice en el informe.

## 1. SPEC y TEST CASES

- [ ] 1.1 Revisar el delta de `platform/delivery-pipeline`; `pnpm exec openspec validate fix-nightly-pipeline --strict`
- [ ] 1.2 Revisar TC-PLATFORM-PIPELINE-010..019 contra los scenarios; pasarlos a `ready` al empezar la implementación

## 2. HERRAMIENTA: ejecutor de la Financial Regression Suite (decisión 1)

- [ ] 2.1 `scripts/traceability/src/regression.ts`: `vitestCommand` deja de pasar `-t` y nombra solo los archivos del grupo; eliminar `testNamePattern` y su aserción en `regression.test.ts` (motivo: el filtro por nombre es la causa del falso rojo y deja de existir; el test del comando pasa a verificar que no hay patrón) (TC-PLATFORM-PIPELINE-012). Actualizar el comentario de cabecera
- [ ] 2.2 Resultado por grupo en el reporte (`regression-suite.md`: paquete, tipo, archivos, TC, estado y duración cuando se ejecuta con `--run`) y salida distinta de cero si algún grupo falla. Tests con un repositorio de fixture: un TC que depende de un test anterior del mismo archivo pasa (TC-PLATFORM-PIPELINE-010) y un test sin TC que falla en un archivo de la suite pone el grupo en rojo e indica paquete y archivo (TC-PLATFORM-PIPELINE-011)
- [ ] 2.3 Medir la duración del job `regression` con archivos completos y `NIGHTLY=1` (corrida por `workflow_dispatch` o local con Docker); si pasa de 45 min, subir `timeout-minutes` del job en `nightly.yml` y anotarlo

## 3. TESTS DE INTEGRACIÓN de Planning (decisión 2)

- [ ] 3.1 `pg-planning.int.test.ts`: TC-PLANNING-PERIOD-002, -ACTIVATION-001, -FISCALDAY-001 e -ISOLATION-001 aseguran sus periodos con un fixture idempotente o un workspace propio; TC-PLANNING-AUTOCREATE-002 usa un workspace que ningún otro test toca y conserva su aserción de primera creación. Sin cambiar ninguna aserción de los escenarios
- [ ] 3.2 `pg-budgets.int.test.ts`: TC-PLANNING-THRESHOLD-005 crea su presupuesto y su línea en vez de leer la del test anterior
- [ ] 3.3 Verificar cada uno de los seis tests ejecutándolo solo (`vitest run --config vitest.integration.config.ts -t '\[TC-…\]'`) y con el archivo completo, dos veces seguidas; anotar el resultado aquí

## 4. TESTS del shared-kernel: cobertura (decisión 3)

- [ ] 4.1 Tests propios de `src/money/canonical-decimal.ts` y `src/valuation/exact-rate.ts` (montos y tasas como texto decimal, nunca `number`; escalas y redondeo HALF_EVEN)
- [ ] 4.2 Tests de `src/time/period-calendar.ts` (días de inicio 1 y 25, meses cortos, febrero bisiesto, zona `America/La_Paz`) y `src/time/end-of-day.ts`; nombrar los TC de Planning existentes cuando el test ejercite su comportamiento
- [ ] 4.3 Tests de `src/lifecycle/lifecycle-machine.ts` (transiciones válidas, inválidas y estados terminales) y de las ramas faltantes de `src/valuation/flow-valuation.ts`
- [ ] 4.4 `pnpm --filter @pf/shared-kernel run test:coverage` ≥ 96 % de líneas y ≥ 91 % de ramas (margen sobre 95/90); `test:mutation` sigue ≥ 80 %. Anotar las cifras en docs/23 §5.5
- [ ] 4.5 Test de política en `scripts/delivery-policy/test/nightly-policy.test.ts`: los umbrales de `packages/shared-kernel/vitest.config.ts` son ≥ 95 % de líneas y ≥ 90 % de ramas (TC-PLATFORM-PIPELINE-014) y el paso de cobertura del job `mutation` ejecuta `test:coverage` sin `continue-on-error` ni condición que lo vuelva no bloqueante (TC-PLATFORM-PIPELINE-013)

## 5. TESTS DE RENDIMIENTO (decisiones 4 y 5)

- [ ] 5.1 `perf-report.ts`: `rlsResult` con pares (diferencia por par), mediana, IC del 95 % por bootstrap con semilla fija, veredicto (`OK`, `no demostrada sobre el piso absoluto`, `no demostrada sobre el 10 %`, `brecha demostrada`, `plan distinto`) y campos aditivos `ci95Ms`, `pairs` y `verdict` en el JSON. Tests unitarios en `perf-report.test.ts` con muestras sintéticas para los tres escenarios (TC-PLATFORM-PIPELINE-015, 016 y 017), escritos antes que el cambio (TDD)
- [ ] 5.2 `nightly.perf.ts`: 20 pares de calentamiento y 200 medidos, intercalados; comparar método de acceso e índice de cada sentencia con y sin RLS y pasarlos a `rlsResult`
- [ ] 5.3 Diagnóstico de la fila "saldo por cuenta (índice INCLUDE)": `EXPLAIN (ANALYZE, VERBOSE)` con y sin RLS; anotar en docs/23 §5.5 si `platform.current_workspace_id()` se evalúa por fila. Si la diferencia queda demostrada con el criterio nuevo, no se esconde: se aplica la respuesta a la pregunta 5
- [ ] 5.4 Helper compartido de entorno de benchmark con las tres cuotas relajadas; migrar `loan-simulator`, `spendable`, `goals`, `subscriptions`, `upcoming-payments`, `commitments`, `imports` (vía `portability.ts`) y `nightly`. Agregar `[TC-PLATFORM-PIPELINE-018]` al nombre de los benchmarks del simulador de estrategias y de disponible para gastar (TC-PLATFORM-PIPELINE-018)
- [ ] 5.5 Test de política: ninguna suite `apps/api/test/perf/*.perf.ts` configura la API sin el helper; con un archivo de fixture que usa las cuotas por defecto, la regla falla indicando el archivo (TC-PLATFORM-PIPELINE-019)

## 6. TESTS AUTOMATIZADOS y regresión

- [ ] 6.1 `pnpm turbo typecheck lint test build`, `pnpm arch:check`, `pnpm traceability:check`, `pnpm format:check`, `pnpm spec:validate`; `pnpm test:integration` dos veces seguidas en verde (CI si la sesión no tiene Docker)
- [ ] 6.2 `pnpm traceability:regression --run` local o en CI con Docker: todos los grupos en verde
- [ ] 6.3 Regresión: TC-PLATFORM-PIPELINE-001..009, TC-DEBT-AMORT-045 y TC-REPORTING-SPENDABLE-014 sin cambios en sus aserciones

## 7. DOCS y verificación en GitHub

- [ ] 7.1 docs/16 §11.3 (la suite corre archivos completos; sin filtro por TC), docs/23 §5.5 (as-built de los tres jobs, criterio de RLS, helper de cuotas, cifras de cobertura) y docs/38 (fila del change y pendientes)
- [ ] 7.2 Estados de los TC a `automated` (010–019); `pnpm traceability:check`, `pnpm exec openspec validate fix-nightly-pipeline --strict`
- [ ] 7.3 Tras fusionar: lanzar `nightly` por `workflow_dispatch` y anotar el resultado de `regression`, `mutation` y `perf` en las notas de TC-PLATFORM-PIPELINE-010, 013 y 015/018. `perf` puede seguir en rojo solo por TC-COMMITMENTS-MATCH-012 (y por la fila de RLS si la diferencia es real, pregunta 5); cualquier otra brecha se investiga antes de archivar

## 8. CONDICIONAL: preguntas 1 y 2 de docs/44

- [ ] 8.1 Solo si el owner adopta la opción (a) de la pregunta 1: cobertura del shared-kernel dentro del job `unit` de `pr.yml` (sin check nuevo ni cambio de nombres), con su confirmación explícita por tocar un check requerido; actualizar el delta y los TC con `/opsx:update` antes de implementarlo. Si no la adopta, se marca `[x]` con la nota
- [ ] 8.2 Solo si el owner adopta la opción (a) de la pregunta 2: aviso por issue de `regression` y `mutation` con título fijo por job y `issues: write` solo en esos jobs (mismo patrón y test de política que D270); actualizar el delta y los TC antes de implementarlo. Si no la adopta, se marca `[x]` con la nota
