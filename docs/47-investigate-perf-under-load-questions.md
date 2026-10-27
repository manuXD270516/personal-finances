# 47: Preguntas de los changes investigate-perf-under-load y optimize-rls-policy-overhead

> **Fecha:** 2026-10-21 · **Changes:** [`investigate-perf-under-load`](../openspec/changes/investigate-perf-under-load/proposal.md) (48) y [`optimize-rls-policy-overhead`](../openspec/changes/optimize-rls-policy-overhead/proposal.md) (49) · **Relacionado:** [46-nightly-and-perf-owner-decisions.md](46-nightly-and-perf-owner-decisions.md) (D283–D290), [44-fix-nightly-pipeline-questions.md](44-fix-nightly-pipeline-questions.md), [38-estado-y-pendientes.md](38-estado-y-pendientes.md), docs/23 §5.5

> **Resueltas el 2026-10-23:** el owner adoptó la recomendación de las seis preguntas (D291–D296, [docs/48](48-perf-and-rls-owner-decisions.md)).

Los dos changes salen de las respuestas del owner del 2026-10-21 (D287 y D290). Estas preguntas son nuevas; cada respuesta se registra en el siguiente `…-decisions.md` con su número D. Ninguna bloquea la redacción. **Bloquean el orden de implementación:** la 1 (grupo 5 del change 48) y la 4 (grupo 3 del change 49). Las demás son condicionales o se pueden responder después del informe.

## Change 48: investigate-perf-under-load

### 1. Cómo aislar las suites del backlog residual del Large Seed [bloquea el grupo 5 del change 48]

**Contexto.** Todas las suites del job `perf` comparten un único PostgreSQL. La medición de throughput de `nightly.perf.ts` deja, al cerrar su worker, buena parte de los ~470 165 eventos del Large Seed en el outbox y en las colas de los consumidores, y las suites que corren después (el orden de los archivos no está fijado) miden con ese backlog. El requirement Must del change exige que cada suite empiece sin carga ajena o falle por interferencia; falta elegir cómo se consigue.

**Opciones.**
- (a) **Purgar el backlog residual** en la base efímera del benchmark al terminar la medición de throughput (marcar o borrar los eventos pendientes del outbox y vaciar las colas de eventos). Barato, un solo job, solo en el harness de pruebas.
- (b) **Una base por suite**, creada desde una plantilla limpia (o un contenedor por suite). Aislamiento total; suma minutos por suite y más memoria en el runner.
- (c) **Job aparte para el throughput** (`perf-throughput`), con su propia base. Separa del todo la carga del Large Seed; agrega un job al nightly (no es check requerido) y duplica la carga del seed.

**Recomendación: (a).** Ataca la causa probable (hipótesis H1) sin cambiar la estructura del nightly. La medición con el backlog completo (S3) se conserva, y la precondición de aislamiento hace fallar la suite si la purga no alcanza. Si el informe muestra que el volumen de la base (H3) también influye, se reconsidera (b).

### 2. La fila de throughput por consumidor con handler real después del informe

**Contexto.** NFR-PERF-008 pide ≥ 42 ev/s por consumidor con un handler trivial (TC-PLATFORM-EVENTS-014, integración). El nightly mide además el throughput de cada consumidor real drenando el backlog del Large Seed, como fila informativa (0,04–9 ev/s el 2026-10-21). Con D285 ninguna fila cambia de estado durante la investigación.

**Opciones.**
- (a) Sigue informativa hasta que el informe proponga un umbral por consumidor con handler real; ese umbral se decide en una pregunta aparte.
- (b) Pasa a bloqueante con 42 ev/s por consumidor apenas termine la investigación.
- (c) Se elimina del nightly y queda solo el test de integración con handler trivial.

**Recomendación: (a).** Con handler real el costo depende de cada consumidor; un umbral único de 42 ev/s pensado para un handler trivial daría rojos sin significado, y quitar la fila perdería la única señal con carga real.

### 3. Runner del job `perf`

**Contexto.** El job corre en `ubuntu-latest` (4 CPU, 16 GiB) con PostgreSQL, la API, el worker y Vitest en el mismo host. docs/02 da umbrales locales (p. ej. NFR-PERF-001 local ≤ 300 ms frente a 200 ms en la nube). Una hipótesis del change (H2) es la contención de CPU.

**Opciones.**
- (a) Seguir con el runner estándar y tratar los umbrales de docs/02 como locales; la investigación mide la contención y propone arreglos dentro de ese límite.
- (b) Usar un runner más grande (de pago, 8 o más CPU) solo para `perf`.
- (c) Mover `perf` al VPS N1 cuando exista (D248), con un runner propio.

**Recomendación: (a).** No tiene costo, es reproducible por cualquiera y el repositorio es público. Si el informe demuestra que la contención del runner es la única causa, se vuelve a preguntar con la evidencia.

## Change 49: optimize-rls-policy-overhead

### 4. Alcance de la reescritura de las políticas [bloquea el grupo 3 del change 49]

**Contexto.** Hay unas 128 cláusulas de política que comparan `workspace_id` con `platform.current_workspace_id()` en 39 migraciones, más las que crea `audit.protect_partition` para cada partición de auditoría. El sobrecosto se midió en `ledger.posting` (la tabla más grande). El experimento del grupo 1 elige la forma; falta decidir a cuántas tablas se aplica.

**Opciones.**
- (a) **Todas** las políticas que usan el contexto de workspace, en una migración explícita, con la regla de catálogo de forma canónica para todas.
- (b) **Solo las tablas del ledger** (`posting`, `journal_entry`, `entry_reversal`, `balance_snapshot`, `ledger_account`); la regla de catálogo se aplica solo a las tablas nuevas.
- (c) **Solo `ledger.posting`.**

**Recomendación: (a), después de validar la forma en `ledger.posting` con el experimento.** Una sola forma en todo el catálogo hace posible la regla que impide volver atrás, y el resto de las tablas crece con el historial igual que el ledger. El riesgo de una migración grande se cubre con la prueba de equivalencia tabla por tabla y la reversa.

### 5. Si ninguna forma quita el nodo sin debilitar el aislamiento [condicional]

**Contexto.** El nodo `Result` podría venir de que la consulta filtra por `workspace_id = $1` y la política por `workspace_id = current_workspace_id()`: el planner une ambas igualdades y deriva un filtro de una sola evaluación que pone en un nodo de compuerta. Si es así, la forma InitPlan también lo produciría. Solo aplica si el experimento lo confirma para todas las variantes.

**Opciones.**
- (a) Volver al owner con la medición de cada variante antes de cambiar nada.
- (b) Quitar el filtro explícito por workspace solo en las consultas de agregación del ledger y dejar que la política filtre (pierde la defensa en profundidad en esas consultas).
- (c) Aceptar el sobrecosto y revisar el criterio del benchmark para consultas de solo índice (requeriría revisar D43 y D286).

**Recomendación: (a).** Las opciones (b) y (c) cambian decisiones de seguridad o de medición ya tomadas; conviene decidirlas con la evidencia a la vista.

### 6. Si el experimento encuentra un hueco de fail-closed que ya existe [condicional]

**Contexto.** La política actual lanza `PF002` sin contexto cuando la función se evalúa. Con una lectura secuencial de una tabla vacía (o sin filas que evaluar), la función puede no ejecutarse y la consulta devolver vacío sin error, con la política actual y con la nueva. No hay fuga de datos (no hay filas), pero la spec pide un error explícito. Solo aplica si la prueba de equivalencia lo encuentra.

**Opciones.**
- (a) Registrar el hallazgo y corregirlo en un change de seguridad aparte (p. ej. una verificación del contexto al abrir la unidad de trabajo, además de la política).
- (b) Corregirlo dentro de `optimize-rls-policy-overhead`.
- (c) Aceptarlo y precisar la spec de fail-closed para tablas sin filas.

**Recomendación: (a).** No lo causa esta optimización, tiene su propio diseño y mezclarlo complicaría la revisión de un cambio de seguridad ya sensible.
