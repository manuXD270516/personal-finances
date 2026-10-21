# Diseño: fix-nightly-pipeline

## Contexto

`nightly.yml` (docs/23 §5.5) corre cada día a las 06:00 UTC desde que se fusionó en `main`. Las 12 corridas programadas desde el 2026-10-05 fallaron y ninguna pasó. El diagnóstico del 2026-10-17 sobre la corrida #12 (run 38889989855) encontró tres causas independientes, una por job:

| Job | Paso | Síntoma | Causa |
|---|---|---|---|
| `regression` | `pnpm traceability:regression --run` | `TC-PLANNING-PERIOD-002`, `-ACTIVATION-001`, `-FISCALDAY-001` y `-ISOLATION-001` (`pg-planning.int.test.ts`) fallan con `null.id`; `TC-PLANNING-THRESHOLD-005` (`pg-budgets.int.test.ts`) recibe `undefined` en vez de `'23505'` | `vitestCommand` (`scripts/traceability/src/regression.ts`) ejecuta cada grupo con `vitest -t <TC-ids>`, que salta los tests sin TC de la suite. Esos cinco tests leen el estado que dejó un test anterior del mismo archivo: `[TC-PLANNING-AUTOCREATE-002]` crea "2026-10".."2027-01" en `w1`, y el test sin TC "las líneas se guardan…" crea la línea que usa THRESHOLD-005. En el gate de PR el archivo corre completo y pasan |
| `mutation` | Cobertura (`pnpm --filter @pf/shared-kernel run test:coverage`) | 89.86 % de líneas (umbral 95) y 84.07 % de ramas (umbral 90). Stryker pasa (91.6 %) | Módulos agregados en Phases 2–5 sin tests propios en el paquete: `src/money/canonical-decimal.ts` (0 %), `src/time/period-calendar.ts` (45 %), `src/valuation/exact-rate.ts` (82 %), `src/lifecycle/lifecycle-machine.ts`, `src/time/end-of-day.ts` y `src/valuation/flow-valuation.ts`. Los contextos que los usan los prueban en sus propios paquetes, pero la cobertura del shared-kernel solo cuenta sus tests |
| `perf` | `pnpm perf:bench` | (a) `RLS-OVERHEAD saldo por cuenta (índice INCLUDE)`: 54.9 % frente a < 10 % (1.58 ms frente a 1.02 ms, diferencia 0.56 ms); (b) `loan-simulator.perf` ([TC-DEBT-AMORT-045]) y `spendable.perf` reciben 429; (c) `commitments.perf` [TC-COMMITMENTS-MATCH-012]: el matcher no drena la ráfaga (470 165 eventos pendientes en el outbox tras el Large Seed; consumidores a 0.1–8 ev/s frente a 42) | (a) `rlsResult` (`apps/api/test/perf/perf-report.ts`) compara medianas de 40 muestras de `EXPLAIN ANALYZE`; a 1 ms el 10 % es 0.1 ms, bajo la resolución del instrumento, y el piso de 0.5 ms quedó justo debajo de la diferencia observada. (b) Solo `nightly.perf.ts` (y en parte `commitments.perf.ts` e `imports.perf.ts`) relaja las cuotas; las demás suites usan `baseEnv(deps)` con las cuotas por defecto (120 escrituras y 10 costosas por minuto). (c) Posible cuello de botella real del producto: fuera de este change |

Nadie se enteró durante 12 días porque `regression` y `mutation` no avisan por issue (solo `perf` desde D270, y `fx-smoke-live`), y el nightly no es check requerido (`add-dependency-updates`, decisión 10).

Decisiones del owner que se aplican:

| Decisión | Origen | Aplicación |
|---|---|---|
| D43 | docs/31 | El sobrecosto de RLS (< 10 %, ADR-0023) se mide sobre la consulta real de la aplicación; el agregado sintético de todo el workspace es informativo. Este change no cambia el umbral ni qué consultas son bloqueantes: cambia cómo se demuestra la diferencia (decisión 4) |
| D224, D270 | docs/41, docs/43 | El nightly no es check requerido; el job `perf` abre o comenta el issue "nightly perf: umbral superado". No se toca la protección de `main` ni los checks requeridos |
| NFR-MAINT-002 | docs/02 | shared-kernel: líneas ≥ 95 %, ramas ≥ 90 %, mutation score ≥ 80 %. "Los umbrales solo pueden subir" (NFR-MAINT-003, mismo criterio) |
| docs/16 §11.3 | Estrategia de tests | La Financial Regression Suite "se ejecuta completa en cada PR"; su tamaño nunca disminuye sin un change aprobado |
| CLAUDE.md | Regla del proyecto | Nunca debilitar ni borrar un test existente sin registrar el motivo en el change; cambiar checks requeridos requiere confirmación del owner |
| D283–D287 | docs/46 | Respuestas del owner a docs/44 (2026-10-21, "Toma mis recomendaciones"): cobertura del shared-kernel en el job `unit` del PR, confirmada de forma explícita (decisión 7); aviso por issue de `regression` y `mutation` (decisión 8); `perf` sigue bloqueante con el issue de D270 comentado cada noche; piso de 0.5 ms; el sobrecosto real de RLS va al change `optimize-rls-policy-overhead` |

| Elemento | Capa | Cambio |
|---|---|---|
| `scripts/traceability/src/regression.ts`, `test/regression.test.ts` | herramienta de calidad | El ejecutor deja de filtrar por nombre (decisión 1) |
| `packages/contexts/planning/test/integration/pg-planning.int.test.ts`, `pg-budgets.int.test.ts` | tests de integración | Los cinco tests crean sus datos (decisión 2) |
| `packages/shared-kernel/src/**/*.test.ts` | tests unitarios | Nuevos tests de los seis módulos (decisión 3) |
| `apps/api/test/perf/perf-report.ts`, `perf-report.test.ts`, `nightly.perf.ts` | tests de rendimiento | Criterio de RLS (decisión 4) |
| `apps/api/test/perf/*.perf.ts`, helper compartido de entorno de benchmark | tests de rendimiento | Cuotas relajadas en una sola configuración (decisión 5) |
| `scripts/delivery-policy/test/nightly-policy.test.ts` | test de política (`pnpm test`, job `unit`) | Reglas nuevas: umbrales de cobertura, paso bloqueante, suites de perf con el helper; avisos de `regression` y `mutation` (decisión 8) |
| `scripts/delivery-policy/test/pr-policy.test.ts` (nuevo) | test de política del gate de PR | Paso de cobertura del shared-kernel en el job `unit`, bloqueante, sin cambiar el id, el nombre ni el `timeout-minutes` del job (decisión 7) |
| `.github/workflows/pr.yml` | CI (gate de PR) | Un paso más en el job `unit` (decisión 7, D283). Sin jobs nuevos ni cambios de nombre |
| `.github/workflows/nightly.yml` | CI | Pasos de aviso por issue y `permissions` en los jobs `regression` y `mutation` (decisión 8, D284) |
| Bounded contexts, OpenAPI, eventos, migraciones | — | Sin cambios |

## Objetivos / No objetivos

**Objetivos**

- `regression` en verde y con la misma semántica que el gate de PR: un test de la suite nunca depende de qué otros tests se filtraron.
- `mutation` en verde sin tocar los umbrales: la cobertura vuelve a ≥ 95 % / ≥ 90 % con tests propios del shared-kernel.
- `perf` sin falsos positivos por ruido de medición ni por la política de cuotas, sin esconder una regresión real de RLS.
- Dejar en el test de política (gate de PR) las reglas que impiden que estas tres causas vuelvan en silencio.

**No objetivos**

- El rendimiento bajo carga del job `perf` (causa 3c, TC-COMMITMENTS-MATCH-012; y los dos benchmarks de `spendable.perf` que dan p95 sobre 300 ms desde el run 39669892721): lo investiga el change `investigate-perf-under-load` (D290). Hasta entonces el job `perf` sigue en rojo y bloqueante, con el issue de D270 comentado cada noche (D285).
- Cambiar umbrales de NFR, la protección de `main`, la lista de checks requeridos o sus nombres. La decisión 7 cambia lo que ejecuta un check requerido (`unit`), con la confirmación explícita del owner (D283), y nada más.
- Detectar en general dependencias de orden entre tests (barajar el orden, ejecutar cada TC aislado): ver Riesgos.
- Optimizar las políticas RLS: la diferencia de la consulta de índice resultó real (tarea 5.3); la optimización va en el change `optimize-rls-policy-overhead` (D287).

## Decisiones

1. **El ejecutor de la suite corre archivos completos (no filtra por nombre).** `vitestCommand` arma `vitest run [--config vitest.integration.config.ts] --passWithNoTests <archivos>` sin `-t`. Alternativas descartadas:
   - *Solo arreglar los tests dependientes*: el escaneo estático de `tests/traceability/regression-suite.json` muestra que 58 de los 61 archivos de integración de la suite (y 126 unitarios) tienen tests que el filtro salta; no hay forma barata de demostrar que ninguno de ellos deja estado del que dependa un TC de la suite, y cada test nuevo puede reintroducir el problema. El filtro produce una semántica que ningún otro gate ejercita.
   - *Filtrar y además auditar todo*: costo sin fin y el resultado caduca con cada PR.
   Con archivos completos la suite nocturna ejecuta exactamente lo que el gate de PR ya ejecuta en verde, más `NIGHTLY=1` (PBT a 10 000 corridas). docs/16 §11.3 ya dice que la suite "se ejecuta completa"; el filtro era un detalle del ejecutor, no una decisión. Costo: los tests sin TC de esos archivos también corren (estimado: integración ≈ el job `integration` del PR, unos 8 min, más unitarios con PBT nocturnos; el job tiene 60 min). La tarea 2.3 mide la duración real y, si pasa de 45 min, se sube `timeout-minutes` del job (no es check requerido).
   El reporte sigue igual (TC de la suite, grupos, archivos), con una columna nueva de resultado por grupo. `testNamePattern` y su aserción en `regression.test.ts` se eliminan porque dejan de usarse (motivo registrado en la tarea 2.1); el test del comando pasa a verificar que no hay `-t`.
2. **Además, los cinco tests identificados crean sus datos.** Un test case debe poder leerse y ejecutarse solo: PERIOD-002, ACTIVATION-001, FISCALDAY-001 e ISOLATION-001 llaman al inicio a un fixture idempotente que asegura los periodos de `w1`/`w2` (`ensurePeriods` es idempotente) o usan un workspace propio; AUTOCREATE-002 conserva su aserción de "primera creación" (`created` = `[0, 4]`) usando un workspace que ningún otro test toca. THRESHOLD-005 crea su presupuesto y su línea en vez de leer la del test anterior. Es defensa en profundidad: con la decisión 1 ya no fallan en el nightly, pero así `vitest -t '[TC-…]'` local también reproduce el resultado del gate. Verificación: ejecutar cada uno solo con `-t` (tarea 3.3). No es un requirement de la spec porque es higiene de tests, no conducta del pipeline.
3. **Cobertura con tests propios del shared-kernel, sin rebajar umbrales.** Tests unitarios (o de propiedades donde aplique) en `packages/shared-kernel/src/**` para `canonical-decimal`, `period-calendar` (días de inicio 1 y 25, fin de mes corto, febrero bisiesto, zona `America/La_Paz`), `exact-rate`, `lifecycle-machine` (transiciones válidas e inválidas, terminales), `end-of-day` y `flow-valuation` (incluidas las ramas de moneda base, tasa faltante y escala HALF_EVEN). Meta con margen: ≥ 96 % de líneas y ≥ 91 % de ramas para no oscilar en el borde. Los tests nombran el TC del comportamiento cuando existe en el catálogo (p. ej. TC-PLANNING-FISCALDAY-*, TC-LEDGER-MONEY-*); los que solo cubren ramas sin un TC catalogado van sin TC-id. Los umbrales de `vitest.config.ts` (95/90) y el paso bloqueante de `nightly.yml` quedan protegidos por el test de política (TC-PLATFORM-PIPELINE-013 y 014). El dinero sigue con Decimal y HALF_EVEN: ningún test usa `number` para montos.
4. **Criterio de RLS robusto al ruido.** En `perf-report.ts`:
   - Muestreo: 20 pares de calentamiento y 200 pares medidos (antes 5 y 40), intercalando con RLS (`pf_app` + contexto) y sin RLS (superusuario) en cada par, para que la deriva del host afecte a ambos lados por igual. A ≈ 1–5 ms por sentencia agrega menos de un minuto al job.
   - Estadístico: diferencia por par `dᵢ = con − sin`; estimador = mediana de `dᵢ`; intervalo de confianza del 95 % por bootstrap de percentiles con 2 000 remuestreos y semilla fija (resultado reproducible a partir de las muestras del reporte).
   - Brecha de tiempo en una consulta bloqueante si y solo si `IC₉₅.inf ≥ 0.10 × mediana(sin)` **y** `IC₉₅.inf ≥ 0.5 ms`. Es decir, la regresión tiene que estar demostrada, no solo observada en la mediana. No esconde una regresión real: un sobrecosto sostenido de 0.56 ms en 200 pares da un intervalo estrecho (p. ej. 0.52–0.60 ms) y sigue fallando; solo se absorbe la diferencia cuyo intervalo cruza el piso.
   - Brecha estructural: si el plan con RLS usa un método de acceso (`Index Only Scan`, `Index Scan`, `Bitmap Heap Scan`, `Seq Scan`) o un índice distinto al plan sin RLS en alguna sentencia, es brecha aunque el tiempo no lo demuestre. Es la regresión real más probable de una política (perder el índice) y no depende del ruido.
   - Reporte: `value` = estimador relativo (mediana de `dᵢ` / mediana sin RLS), `notes` con medianas, IC y motivo (`OK`, `no demostrada sobre el piso absoluto`, `no demostrada sobre el 10 %`, `brecha demostrada`, `plan distinto`). Las filas informativas (agregado sintético, D43) siguen sin hacer fallar.
   - Qué consultas son bloqueantes no cambia (D43 más las de índice). El umbral del 10 % y el piso de 0.5 ms no cambian; la pregunta 4 confirma el piso con el owner.
   - Diagnóstico de la fila que falló: `EXPLAIN (ANALYZE, VERBOSE)` de la consulta de índice con y sin RLS para ver si `platform.current_workspace_id()` (plpgsql `STABLE`) se evalúa por fila como `Filter`. Si lo hace y la diferencia queda demostrada, no se esconde: el job sigue en rojo por esa fila y se aplica la pregunta 5.
5. **Una sola configuración de entorno para los benchmarks.** Un helper compartido en `apps/api/test/perf/` (p. ej. `perfApiEnv(deps, overrides)`) devuelve `baseEnv(deps)` con `RATE_LIMIT_READS_PER_MIN`, `RATE_LIMIT_WRITES_PER_MIN` y `RATE_LIMIT_COSTLY_PER_MIN` en 1 000 000, como ya hace `nightly.perf.ts`. Todas las suites `*.perf.ts` configuran la API a través de él (directamente o vía `portability.ts`, que lo recibe). El limitador de tasa sigue cubierto por sus tests de API (TC-PLATFORM-API-*); el benchmark mide latencia, no la política. El test de política escanea `apps/api/test/perf/*.perf.ts` y falla si una suite llama a `baseEnv(` para la configuración de la API sin el helper (TC-PLATFORM-PIPELINE-019). Las variables son de test: no cambian `config-reference.md` ni los valores por defecto del producto.
6. **TC-COMMITMENTS-MATCH-012 queda fuera** (hoy lo investiga `investigate-perf-under-load`, D290). 470 165 eventos pendientes en el outbox al terminar la carga y consumidores a 0.1–8 ev/s frente a los 42 ev/s de NFR-PERF-008 apuntan a un cuello de botella real (o a una interacción entre el backlog del Large Seed y la suite siguiente, que comparte la base). Ajustar el benchmark para que pase sin entender la causa escondería un problema del producto. Se deja como pendiente en docs/38 §4 con la propuesta de `investigate-consumer-throughput`; la pregunta 3 decide cómo se ve el job `perf` mientras tanto.
7. **Cobertura del shared-kernel dentro del job `unit` del PR (D283, grupo 8.1).** En `.github/workflows/pr.yml`, el job `unit` (hoy: checkout, `setup-workspace` y `run: pnpm test`, `timeout-minutes: 15`) agrega **después** de `pnpm test` un paso:

   ```yaml
         # D283 (fix-nightly-pipeline 8.1): cobertura del shared-kernel, NFR-MAINT-002 (≥ 95 % líneas, ≥ 90 % ramas).
         - name: Cobertura del shared-kernel (≥ 95 % líneas, ≥ 90 % ramas)
           run: pnpm --filter @pf/shared-kernel run test:coverage
   ```

   Sin `if`, sin `continue-on-error` y sin `timeout-minutes` propio. El script `test:coverage` (`vitest run --coverage`) ya existe y lee los umbrales de `packages/shared-kernel/vitest.config.ts` (95/90), los mismos que usa el job `mutation` del nightly; `@vitest/coverage-v8` ya es dependencia del paquete y el shared-kernel no depende de otros paquetes del workspace, así que no hace falta compilar antes. Va después de `pnpm test` para que un fallo de tests se vea primero y con su propio mensaje. Corre los tests del shared-kernel por segunda vez (con instrumentación); se acepta el costo (segundos) frente a reordenar `turbo run test`. Alternativas descartadas: (a) cambiar el script `test` del paquete a `vitest run --coverage` haría que `pnpm test` local también falle por cobertura y mezclaría dos responsabilidades; (b) un job nuevo sería un check más, que el owner no pidió y obligaría a cambiar la protección de `main`. **No cambian:** el id `unit` (que es el nombre del check requerido, el job no declara `name:`), el `timeout-minutes: 15`, la lista de jobs de `pr.yml`, la protección de `main` ni los checks requeridos. La tarea 8.1 mide la duración del job antes y después; si con el paso nuevo el job pasa de 12 min (80 % del límite) en tres corridas de CI, se detiene y se pregunta al owner en vez de subir el timeout.

   Test de política nuevo `scripts/delivery-policy/test/pr-policy.test.ts` (corre en `pnpm test`, es decir, en el propio job `unit`), con el helper `loadWorkflow` existente:
   - el job `unit` existe con ese id, no declara `name:` (o declara `unit`) y su `timeout-minutes` es 15;
   - entre sus pasos hay uno cuyo `run` es exactamente `pnpm --filter @pf/shared-kernel run test:coverage`, sin `if` ni `continue-on-error`, y el job tampoco declara `continue-on-error`;
   - ese paso va después del paso `pnpm test`;
   - con un workflow de fixture sin el paso, con `continue-on-error: true` o con `if: false`, la regla falla indicando el job `unit` y el paso (TC-PLATFORM-PIPELINE-021).
   La regla de umbrales existente (TC-PLATFORM-PIPELINE-014) sigue protegiendo los 95/90 de `vitest.config.ts`, que ahora valen para los dos gates. TC-PLATFORM-PIPELINE-020 verifica el efecto: con la cobertura bajo el umbral el job `unit` falla (test de política sobre el workflow más una verificación manual única en una rama de prueba no fusionada).

8. **Aviso por issue de `regression` y `mutation` (D284, grupo 8.2).** Mismo patrón que el job `perf` (D270), un issue por job:

   | Job | Título fijo | Cuerpo |
   |---|---|---|
   | `regression` | `nightly regression: falló` | Enlace a la corrida y `tests/traceability/regression-suite.md` (estado por grupo y sección «Grupos en rojo» con paquete y archivos), o "sin reporte" si no existe |
   | `mutation` | `nightly mutation: falló` | Enlace a la corrida y las métricas de cobertura del shared-kernel y del dominio IDENTITY y el mutation score (lo mismo que el paso `Resumen` del job), o "sin reporte" |

   Cada job agrega al final un paso con `if: ${{ failure() }}`, `GH_TOKEN: ${{ github.token }}`, que busca con `gh issue list --state open --search "in:title \"<título>\""` el issue abierto con ese título exacto (filtro `select(.title == …)`), comenta si existe y crea si no. Cada job declara `permissions: { contents: read, issues: write }`; el workflow sigue con `permissions: contents: read`. Para no repetir el bloque tres veces, el paso puede extraerse a un script versionado (`scripts/ci/nightly-issue.sh <título> <archivo de resumen>`) que también use `perf`; si se extrae, el test de política verifica el script y que cada job lo invoque con su título. Un job cancelado no avisa (`failure()` es falso al cancelar). Un aviso no se cierra solo: lo cierra quien corrige (igual que D270).

   Test de política (`nightly-policy.test.ts`): (a) `issues: write` solo en `regression`, `mutation`, `perf` y `fx-smoke-live`, nunca a nivel de workflow; (b) los pasos de aviso de `regression` y `mutation` corren solo con `failure()`, usan su título exacto, buscan el abierto antes de crear y van después del paso que puede fallar; (c) los títulos de los tres jobs son distintos. **Cambio de un test existente (motivo registrado):** la aserción `[TC-PLATFORM-PIPELINE-009] el job perf no es un check requerido ni cambia a los demás jobs` exige hoy que `regression` y `mutation` no declaren `permissions`, y la de `solo los jobs perf y fx-smoke-live declaran issues: write` los excluye; con D284 ambas pasan a exigir exactamente `{ contents: read, issues: write }` en esos dos jobs y a admitir los cuatro jobs que avisan. No se debilita: la regla sigue rechazando `issues: write` a nivel de workflow o en cualquier otro job.

## Contratos

Sin cambios en OpenAPI, eventos ni `ErrorCode`. El formato del reporte de rendimiento (`perf-results.json`, artefacto interno del nightly) agrega en las filas de RLS los campos opcionales `ci95Ms: [inf, sup]`, `pairs` y `verdict`. Es aditivo: los consumidores existentes (`renderMarkdown`, el paso de resumen de `nightly.yml` y el cuerpo del issue de D270) siguen leyendo los mismos campos.

## Riesgos / Trade-offs

- **Duración del job `regression`:** archivos completos más PBT a 10 000 corridas en todos los PBT de esos archivos (no solo los de la suite). Mitigación: medir en la tarea 2.3; subir el `timeout-minutes` del job si hace falta (no es check requerido).
- **Dependencias de orden que siguen ocultas:** con archivos completos, un test que depende de otro pasa en ambos gates, igual que hoy en el PR. El change no las elimina en general; solo las cinco conocidas. Detectarlas (barajar el orden con `sequence.shuffle` o ejecutar cada TC aislado) costaría el arranque de Testcontainers por TC (≈ 100 TC de integración) y queda como mejora futura.
- **Falso negativo del criterio de RLS:** una regresión real pequeña (< 0.5 ms o con mucha varianza) puede no quedar demostrada en una corrida. Se acepta: el piso ya existía, el plan estructural cubre la regresión más grave, y el reporte publica el IC de cada corrida para ver tendencias.
- **Una suite con cuotas relajadas oculta un 429 legítimo:** no aplica; el limitador no es objeto del benchmark y tiene tests de API propios.
- **El job `perf` sigue en rojo** por la fila de RLS INCLUDE (real; change `optimize-rls-policy-overhead`), TC-COMMITMENTS-MATCH-012 y los dos benchmarks de `spendable.perf` (change `investigate-perf-under-load`). Mientras esté en rojo, una brecha nueva no cambia el color del job; se ve en el comentario diario del issue de D270, que lleva `perf-summary.md` completo (D285).
- **Cobertura en el job `unit` (decisión 7):** el gate de PR exige más; una PR que agregue al shared-kernel código sin tests queda en rojo. Es lo buscado (D283). Riesgo menor: la duración del job sube unos segundos; si se acercara a los 15 min se pregunta al owner en vez de subir el límite.
- **Ruido de issues (decisión 8):** con un rojo persistente cada job comenta su issue cada noche; es el mismo comportamiento aceptado en D270 y separa las causas.

## Plan de migración

Sin migraciones de base de datos. Orden de aplicación: grupo 2 (ejecutor) y grupo 3 (tests de planning) son independientes; grupo 4 (cobertura) es independiente; grupo 5 (perf) puede ir en paralelo. Tras fusionar, se lanza `nightly` por `workflow_dispatch` y se anota el resultado de cada job en las notas de los TC (tarea 7.3). Rollback: revertir el PR; ningún dato cambia.

## Preguntas abiertas

Ninguna. Las cinco preguntas de [docs/44-fix-nightly-pipeline-questions.md](../../../docs/44-fix-nightly-pipeline-questions.md) quedaron resueltas el 2026-10-21 con la recomendación de cada una (D283–D287, [docs/46](../../../docs/46-nightly-and-perf-owner-decisions.md)). Texto original de las preguntas, para referencia:

1. ¿La cobertura del shared-kernel corre también en el gate de PR (job `unit`), para que no vuelva a caer en silencio? Recomendación: sí, dentro del job `unit` existente (sin check nuevo); requiere la confirmación del owner por tocar un check requerido.
2. ¿Los jobs `regression` y `mutation` avisan por issue al fallar, como `perf` (D270)? Recomendación: sí, un issue por job con título fijo.
3. ¿Cómo queda el job `perf` mientras TC-COMMITMENTS-MATCH-012 siga en rojo? Recomendación: sigue bloqueante en el nightly; el issue de D270 queda abierto y se comenta cada noche.
4. ¿Se mantiene el piso absoluto de 0.5 ms del criterio de RLS? Recomendación: sí, con el intervalo de confianza y el chequeo de plan.
5. Si la diferencia de la consulta de índice resulta real: ¿change aparte para optimizar la evaluación de las políticas o fila informativa? Recomendación: change aparte.
