# Propuesta: fix-nightly-pipeline

## Why

El pipeline `nightly` (docs/23 §5.5) nunca pasó: las 12 corridas programadas desde el 2026-10-05 fallaron. El diagnóstico del 2026-10-17 sobre la corrida #12 encontró tres causas independientes, ninguna de ellas un defecto financiero del producto:

1. **`regression`:** el ejecutor de la Financial Regression Suite filtra por nombre (`vitest -t <TC-ids>`) dentro de cada archivo y salta los tests sin TC de la suite. Cinco tests de Planning (TC-PLANNING-PERIOD-002, -ACTIVATION-001, -FISCALDAY-001, -ISOLATION-001 y -THRESHOLD-005) dependen del estado que deja un test anterior del mismo archivo y fallan solo en el nightly; en el gate de PR, que corre el archivo completo, pasan.
2. **`mutation`:** la cobertura de `@pf/shared-kernel` cayó a 89.86 % de líneas y 84.07 % de ramas (umbrales 95 y 90, NFR-MAINT-002) porque los módulos agregados en Phases 2–5 se prueban desde otros paquetes y no tienen tests propios.
3. **`perf`:** (a) la fila bloqueante de sobrecosto de RLS de la consulta de saldo por cuenta falla con 0.56 ms de diferencia sobre 1.02 ms, donde el 10 % (0.1 ms) está bajo la resolución de la medición; (b) dos suites (simulador de estrategias de deuda y disponible para gastar) reciben 429 porque su API arranca con las cuotas por defecto; (c) el matcher de compromisos no drena el backlog del Large Seed (TC-COMMITMENTS-MATCH-012), un posible cuello de botella real que este change no trata.

Como el nightly no es check requerido y solo `perf` y `fx-smoke-live` avisan por issue, el rojo pasó desapercibido. Mientras siga así, el nightly no cumple su función: la suite de regresión financiera con PBT a 10 000 corridas, la cobertura y la mutación del núcleo compartido y los benchmarks de docs/02 no protegen nada.

## What Changes

- **Suite de regresión con la semántica del gate:** el ejecutor corre completo cada archivo que contiene un TC de la suite, sin filtrar por nombre; cualquier test que falle en esos archivos hace fallar el grupo. Además, los cinco tests de Planning identificados crean sus propios datos.
- **Cobertura del shared-kernel recuperada con tests propios** de `canonical-decimal`, `period-calendar`, `exact-rate`, `lifecycle-machine`, `end-of-day` y `flow-valuation`, sin bajar los umbrales; un test de política del gate de PR impide rebajarlos o volver no bloqueante el paso.
- **Criterio de sobrecosto de RLS robusto al ruido:** 200 pares intercalados, mediana de las diferencias por par con intervalo de confianza del 95 %, brecha solo si el límite inferior supera a la vez el 10 % y el piso de 0.5 ms, más una brecha estructural si la política cambia el plan de acceso. No cambia el umbral de D43 ni qué consultas son bloqueantes.
- **Una configuración compartida para los benchmarks** con las cuotas de la API relajadas; el test de política rechaza una suite que no la use.
- **Fuera de alcance:** el rendimiento de los consumidores tras el Large Seed (TC-COMMITMENTS-MATCH-012), que queda como pendiente en docs/38 con la propuesta de un change `investigate-consumer-throughput`; optimizar las políticas RLS si la diferencia resulta real (pregunta 5); cambiar umbrales de NFR, la protección de `main` o los checks requeridos; avisos por issue de `regression` y `mutation` y cobertura en el gate de PR (preguntas 1 y 2, solo si el owner las adopta); detectar en general dependencias de orden entre tests.

## Capabilities

### New Capabilities

- Ninguna.

### Modified Capabilities

- `platform/delivery-pipeline`: Financial Regression Suite con el contexto de ejecución del gate, cobertura del núcleo compartido sin rebajar umbrales, criterio de sobrecosto de RLS robusto al ruido y benchmarks sin la política de cuotas (4 requirements ADDED: 2 Must, 2 Should).

## Impact

**Specs impactadas:** `platform/delivery-pipeline` (4 requirements ADDED; los 4 de la spec principal y los 4 que agrega `add-dependency-updates`, aún sin archivar, no cambian). Leídas sin cambios: `quality/test-traceability`, `planning/financial-periods`, `planning/budgets`.

**Componentes/contextos impactados:** ningún código de producción. Herramienta `@pf/traceability` (`scripts/traceability/src/regression.ts` y su test); tests de integración de `@pf/planning` (`pg-planning.int.test.ts`, `pg-budgets.int.test.ts`); tests unitarios nuevos de `@pf/shared-kernel`; harness de rendimiento de `apps/api/test/perf/` (`perf-report.ts`, `nightly.perf.ts`, helper de entorno compartido y las suites `*.perf.ts`); test de política `scripts/delivery-policy/test/nightly-policy.test.ts`. `nightly.yml` no cambia salvo que el owner adopte las preguntas 1 o 2.

**APIs impactadas:** ninguna (`contracts/openapi` sin cambios).

**Tablas impactadas:** ninguna.

**Eventos impactados:** ninguno.

**Migraciones requeridas:** ninguna.

**Test cases:** AÑADIDOS — TC-PLATFORM-PIPELINE-010..019 (10). MODIFICADOS — ninguno en su comportamiento esperado; TC-DEBT-AMORT-045 y TC-REPORTING-SPENDABLE-014 solo cambian de entorno (cuotas relajadas). DEPRECADOS — ninguno.

**Impacto de regresión:** el job `regression` ejecuta más tests (los que el filtro saltaba) y tarda más; la suite crece, nunca se reduce (docs/16 §11.3). Los tests de integración de Planning cambian sus datos de preparación, no sus aserciones. El gate de PR gana reglas en el test de política (job `unit`, ya requerido) sin checks nuevos.

**Riesgos introducidos:** ninguno registrado. Riesgos del diseño: duración del job `regression`; dependencias de orden que siguen ocultas en otros archivos (ahora sin efecto, porque nightly y PR ejecutan lo mismo); falso negativo del criterio de RLS para diferencias pequeñas (< 0.5 ms o con mucha varianza); job `perf` todavía en rojo por TC-COMMITMENTS-MATCH-012 (pregunta 3).

**Invariantes afectadas:** ninguna (no toca dinero, ledger, FX, periodos ni redondeo; los tests nuevos del shared-kernel verifican el redondeo HALF_EVEN existente sin cambiarlo).
