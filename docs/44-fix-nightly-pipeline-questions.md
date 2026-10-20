# 44: Preguntas del change fix-nightly-pipeline

> **Fecha:** 2026-10-20 · **Change:** [`fix-nightly-pipeline`](../openspec/changes/fix-nightly-pipeline/proposal.md) · **Relacionado:** [design.md](../openspec/changes/fix-nightly-pipeline/design.md), [38-estado-y-pendientes.md](38-estado-y-pendientes.md), decisiones D43 ([31](31-phase-1-consolidation-decisions.md)), D224 ([41](41-phase-5-consolidation-decisions.md)) y D270 ([43](43-phase-5-owner-answers-2026-10-16.md))

El nightly falló en sus 12 corridas desde el 2026-10-05 por tres causas independientes (suite de regresión filtrada por nombre, cobertura del shared-kernel bajo el umbral y tres problemas del benchmark). El change las corrige sin bajar umbrales. Estas preguntas quedan para el owner. **Ninguna bloquea el orden de implementación:** los grupos 1 a 7 del change se implementan con la recomendación de cada una, y el grupo 8 (preguntas 1 y 2) solo se hace si el owner adopta la opción (a). Cada respuesta se registra en el siguiente `…-decisions.md` con su número D.

## 1. Cobertura del shared-kernel también en el gate de PR

**Contexto.** La cobertura del shared-kernel (≥ 95 % de líneas y ≥ 90 % de ramas, NFR-MAINT-002) solo se mide en el nightly. Cayó a 89.86 % / 84.07 % sin que ningún PR lo notara. El change agrega un test de política que impide rebajar los umbrales, pero no impide que un PR agregue un módulo sin tests.

**Opciones.**
- (a) Ejecutar `pnpm --filter @pf/shared-kernel run test:coverage` dentro del job `unit` de `pr.yml`, que ya es requerido. No agrega un check ni cambia nombres, pero cambia lo que exige un check requerido, por eso necesita tu confirmación (CLAUDE.md). Costo: unos segundos.
- (b) Dejarla solo en el nightly, con el aviso por issue de la pregunta 2.
- (c) Dejarlo como está.

**Recomendación: (a).** Una caída de cobertura se ve en el PR que la provoca, cuando es barato corregirla.

## 2. Aviso por issue de los jobs `regression` y `mutation`

**Contexto.** Solo `perf` (D270) y `fx-smoke-live` abren un issue al fallar. `regression` y `mutation` estuvieron en rojo 12 noches sin aviso; el nightly no es check requerido y nadie mira su color.

**Opciones.**
- (a) Un issue por job con título fijo ("nightly regression: falló", "nightly mutation: falló"), con el mismo patrón y el mismo test de política que D270: busca el abierto antes de crear y `issues: write` solo en esos jobs.
- (b) Un job final `notify` (`needs` de todos, `if: failure()`) con un único issue "nightly: falló" y el único `issues: write` del workflow fuera de `perf` y `fx-smoke-live`.
- (c) Sin aviso nuevo.

**Recomendación: (a).** Sigue el patrón ya aceptado en D270, separa los avisos por causa y se cierra uno sin tocar los otros.

## 3. El job `perf` mientras TC-COMMITMENTS-MATCH-012 siga en rojo

**Contexto.** Tras el Large Seed quedan 470 165 eventos pendientes en el outbox y los consumidores procesan 0.1–8 ev/s frente a los 42 de NFR-PERF-008; el matcher de compromisos no drena su ráfaga. Puede ser un cuello de botella real y queda fuera de este change (pendiente `investigate-consumer-throughput` en docs/38 §4). Con esa fila, el job `perf` seguirá en rojo después de este change.

**Opciones.**
- (a) Sigue bloqueante en el nightly. El issue "nightly perf: umbral superado" (D270) queda abierto y recibe cada noche un comentario con el resumen completo, donde se ve cualquier brecha nueva.
- (b) Marcar la fila como informativa hasta cerrar la investigación, con referencia al change.
- (c) Moverla a un job aparte (`perf-throughput`) para que el job `perf` vuelva a verde con el resto de los benchmarks.

**Recomendación: (a).** No esconde un posible defecto del producto y no agrega estructura que después hay que quitar. Su costo, que una brecha nueva no cambia el color del job, se compensa con el comentario diario del issue.

## 4. Piso absoluto del criterio de sobrecosto de RLS

**Contexto.** D43 fija el objetivo (< 10 % sobre la consulta real) y no cambia. El change cambia cómo se demuestra la diferencia: 200 pares intercalados, intervalo de confianza del 95 % de la mediana de las diferencias, brecha si el límite inferior alcanza a la vez el 10 % y el piso absoluto, más una brecha si la política cambia el plan de acceso. El piso de 0.5 ms ya existe en el código (no es una decisión tuya registrada).

**Opciones.**
- (a) Mantener 0.5 ms.
- (b) Subirlo a 1 ms.
- (c) Ligarlo al presupuesto del NFR de la consulta (p. ej. 2 % de los 50 ms de NFR-PERF-005, 1 ms).

**Recomendación: (a).** Con el intervalo de confianza el piso ya no tiene que absorber el ruido; subirlo solo ampliaría el margen en el que una regresión real pasa sin aviso. Los TC-PLATFORM-PIPELINE-015..017 quedan `provisional` hasta tu respuesta.

## 5. Si el sobrecosto de la consulta de índice resulta real

**Contexto.** La política de `ledger.posting` compara `workspace_id` con `platform.current_workspace_id()` (plpgsql `STABLE`). Si el diagnóstico de la tarea 5.3 muestra que se evalúa por fila y el criterio nuevo demuestra la diferencia, la fila seguirá en rojo. Solo aplica en ese caso.

**Opciones.**
- (a) Change aparte para optimizar la evaluación de las políticas (p. ej. evaluar el contexto una vez por consulta), con su propia medición y sin debilitar el fail-closed de D43 (sin contexto, `PF002`).
- (b) Pasar la fila de índice a informativa: D43 solo exige como bloqueantes las consultas reales de la aplicación, que hoy pasan.

**Recomendación: (a).** Es un costo real por fila en la tabla más grande y crece con el historial. La opción (b) quita la señal que lo detectó.
