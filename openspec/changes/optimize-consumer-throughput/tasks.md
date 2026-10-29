# Tareas

> Change de plataforma de Phase 6 (D301): primero se mide (E6–E10b) y después se optimiza. Sin Docker, `pnpm perf:bench` y `pnpm test:integration` no corren en la sesión: las mediciones las hace el job `perf` por `workflow_dispatch` de `nightly` desde la rama no fusionada `claude/optimize-consumer-throughput-experiments`, y la integración la valida CI; se dice en el informe. Ningún umbral cambia sin decisión del owner (D300, D306, TC-PLATFORM-PIPELINE-028) y no se agregan consumidores, concurrencia ni pool (D249).
>
> **Orden de implementación.** Grupo 1 → grupo 2 (se fusiona, sin cambio de comportamiento) → grupo 3 (experimentos e informe; pregunta de umbrales) → grupos 4 y 5 (entrega agrupada y consumidores, de a uno) → grupos 6 a 8. Va antes de `add-bulk-imported-transactions` y de `add-import-pipeline`.

## 1. SPEC y TEST CASES

- [ ] 1.1 Revisar los deltas de `platform/event-delivery` y `platform/delivery-pipeline`; `pnpm exec openspec validate optimize-consumer-throughput --strict`
- [ ] 1.2 Revisar TC-PLATFORM-THROUGHPUT-001..015 contra los scenarios (cifras: 5 000 transacciones ⇒ 15 000 eventos ⇒ 45 000 entregas; 28 + 4 = 32 de 34; 22 + 34 + 4 + 4 + 3 = 67 de 97); pasarlos a `ready` al empezar

## 2. INSTRUMENTACIÓN y perfil de ráfaga (decisiones 1 y 6; se fusiona)

- [ ] 2.1 Tests primero en `apps/api/test/perf/perf-report.test.ts`: la sección `consumerCost[]` y la fila `imports.hostConfig` se publican con `gate: false` y no cambian el veredicto (TC-PLATFORM-THROUGHPUT-012..015)
- [ ] 2.2 Perfil de ráfaga en el harness: persistir N transacciones importadas con los consumidores detenidos (relay activo) y arrancar el worker con una configuración dada; medir drenado por consumidor y del outbox desde el arranque (E9)
- [ ] 2.3 Muestreo de esperas por bloqueos (`pg_stat_activity`/`pg_locks`, cada segundo, consultas en serie sobre una conexión propia contada en la precondición de presupuesto) y modo «un consumidor a la vez» (E7, E8)
- [ ] 2.4 `imports.perf.ts`: segunda medición con la configuración del host (concurrencia 1, worker 34, API 22) con la precondición de presupuesto (67 de 97) y su fila informativa; sin tocar `PREVIEW_BUDGET_MS`, `PERSIST_CEILING_MS` ni `DRAIN_BUDGET_MS`
- [ ] 2.5 Registro del motivo de cada trabajo reintentado (expiración frente a fallo del handler) en el reporte (E10b, HI6 de docs/53)
- [ ] 2.6 Test de política `scripts/delivery-policy/test/nightly-policy.test.ts`: las filas nuevas son informativas y los umbrales de docs/02 no cambian (TC-PLATFORM-PIPELINE-028 sigue verde)

## 3. DIAGNÓSTICO (decisión 1; rama no fusionada)

- [ ] 3.1 Corridas por `workflow_dispatch` lejos de las 06:00 UTC: E6 y E7 ×2 (ráfaga con la configuración del host), E8 (un consumidor a la vez), E9 ×2 (configuración del código y del host), E10b; anotar run id, hora y commit
- [ ] 3.2 Informe `docs/NN-consumer-throughput-findings.md` (siguiente número libre): costo por evento de cada consumidor, bloqueos, ritmo aislado, drenado de la ráfaga con cada configuración, relay, motivo de los reintentos; lista de consumidores a agrupar (decisión 4) y propuesta de umbrales
- [ ] 3.3 `docs/NN-consumer-throughput-questions.md` con las preguntas 1 y 2 de design.md, opciones, recomendación y la evidencia de 3.2

## 4. PLATAFORMA: entrega agrupada (decisiones 2, 3 y 7; TDD)

- [ ] 4.1 Tests primero (unitarios con cola y pool falsos) en `packages/platform/src/events/consumers.test.ts`: un grupo de 100 eventos de un workspace ⇒ una transacción, inbox de 100 y una invocación (TC-PLATFORM-THROUGHPUT-001); duplicados filtrados (002); fallo de grupo ⇒ respaldo evento por evento y solo el culpable en reintento (003); dos workspaces ⇒ dos invocaciones con su contexto (004); consumidor sin `grouping` igual que antes (006); definir `grouping` sin `groupHandler` falla al registrar
- [ ] 4.2 `EventConsumerDefinition.grouping`/`groupHandler`, `EventConsumerRuntime` con lotes de `maxBatch`, agrupación por workspace, inbox multi-fila `ON CONFLICT DO NOTHING RETURNING` y respaldo con `deliver`; config `EVENT_CONSUMER_GROUP_BATCH_SIZE` en `@pf/platform` y `docs/config-reference.md` (`pnpm config:docs`)
- [ ] 4.3 Métricas `event_consumer_group_size` y `event_consumer_group_fallbacks_total` (TC-PLATFORM-THROUGHPUT-011)
- [ ] 4.4 Integración con PostgreSQL real (`apps/api/test/events/`): orden por agregado con lotes de 100 y versiones 1..10 (TC-PLATFORM-THROUGHPUT-005), aislamiento RLS por grupo (004) y TC-PLATFORM-EVENTS-014/018/019 en verde

## 5. CONSUMIDORES (decisiones 3 y 4; uno por vez, según el informe)

- [ ] 5.1 Por cada consumidor elegido en 3.2: test de equivalencia primero (PBT: el mismo conjunto de eventos entregado de a uno y agrupado, en órdenes al azar, deja el mismo estado) (TC-PLATFORM-THROUGHPUT-007); `groupHandler` con el efecto por conjunto; sus TC existentes en verde
- [ ] 5.2 `planning.budget-thresholds`: reemplazar `WorkspaceCoalescer` por el `groupHandler` (una evaluación por grupo); TC-PLANNING-THRESHOLD-* en verde
- [ ] 5.3 `commitments.occurrence-matcher`: búsqueda de candidatas por conjunto; ráfaga con 12 compatibles y reentregas ⇒ exactamente 12 sugerencias (TC-PLATFORM-THROUGHPUT-010, TC-COMMITMENTS-MATCH-* en verde)
- [ ] 5.4 Relay: solo si 3.2 lo señala como cuello, inserción por cola en una sentencia con su test (decisión 5); si no, marcar como no aplicable con nota
- [ ] 5.5 Consumidores descartados por no ser independientes del orden: dejar constancia en el informe y en esta tarea

## 6. VERIFICACIÓN

- [ ] 6.1 Test de arranque con la plantilla del host: 28 consumidores con concurrencia 1, 32 de 34 (TC-PLATFORM-THROUGHPUT-009)
- [ ] 6.2 Gates: `pnpm format:check`, `pnpm turbo typecheck lint test build`, `pnpm arch:check`, `pnpm traceability:check`, `pnpm spec:validate`, `pnpm config:docs:check`, `pnpm contract:breaking` (sin cambios de contrato) y `pnpm test:integration` dos veces seguidas en verde (o CI si la sesión no tiene Docker)
- [ ] 6.3 Tras fusionar: `nightly` por `workflow_dispatch` sobre `main` y dos nightlies programados seguidos con la ráfaga del host ≤ 120 s por consumidor (TC-PLATFORM-THROUGHPUT-008) y TC-IMPORTS-CSV-029 verde; anotar las corridas en los TC

## 7. DOCS y cierre

- [ ] 7.1 Actualizar los docs de design.md § «Cambios a docs compartidos» y docs/38 (estado del change y §3)
- [ ] 7.2 TC-PLATFORM-THROUGHPUT-001..015 a `automated` (008 y 012..015 con la evidencia de 6.3); nota en TC-IMPORTS-CSV-029 con las dos configuraciones; `pnpm traceability:check` y `pnpm exec openspec validate optimize-consumer-throughput --strict`
- [ ] 7.3 Si el owner responde la pregunta 1 con (a) o (b): pasar la fila del host a bloqueante con su test de política (cambio aparte de esta tarea si llega después del archivado)
