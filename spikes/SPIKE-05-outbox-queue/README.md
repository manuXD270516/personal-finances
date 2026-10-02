# SPIKE-05 — Transactional outbox + cola (BullMQ/Valkey vs BullMQ-PostgreSQL vs pg-boss)

> Código **descartable** (evidencia para ADR-0008). Fecha: 2026-10-01/02. Máquina: Windows 11 + Docker Desktop, Node 22.23, pnpm 12.4.2.

## 1. Pregunta

¿Cumple el patrón *transactional outbox* + relay + inbox idempotente las garantías de ARCHITECTURE §7 / docs/11 §2 y §6, y **qué cola** usar detrás del relay?

- **A** — BullMQ 6.3.10 sobre **Valkey 9** (`valkey/valkey:9-alpine`).
- **B** — BullMQ 6.3.10 con **backend PostgreSQL** (`createPostgresBackend`).
- **C** — **pg-boss 12.35.1**.

**Verificación de B:** existe tal como se describe. `bullmq@6.3.x` (latest en npm = 6.3.11 el 2026-10-01) exporta `createPostgresBackend`, `PostgresQueueBackend`, `runMigrations` (PG ≥ 13, recomendado 14). Se inyecta como 3er argumento de `Queue`/`Worker` (o `setDefaultBackendFactory`). Crea su propio schema (`bullmq`) con migraciones y usa `LISTEN` para despertar workers. `pg` es *peer dependency* opcional. Limitación relevante: acepta un `pg.Pool` o una config, **no** un cliente de una transacción en curso ⇒ no puede encolar dentro de la transacción del relay ni de la del comando.

## 2. Setup

```
spikes/SPIKE-05-outbox-queue/
  compose.yaml        # pf-spike-05: postgres:18-alpine (127.0.0.1:61532), valkey:9-alpine (127.0.0.1:61579), worker (profile "worker")
  Dockerfile          # worker Linux (node:22-alpine) para probar SIGTERM/SIGKILL reales
  sql/001_schema.sql  # app.transaction, platform.outbox/inbox/dead_letter, proyección app.balance, trigger NOTIFY
  src/envelope.ts     # ajv 2020-12 + ajv-formats contra contracts/events/envelope.v1.schema.json
  src/api.ts          # comando: fila de negocio + outbox en LA MISMA tx
  src/relay.ts        # relay genérico: SELECT … FOR UPDATE SKIP LOCKED + LISTEN outbox; sweeper
  src/consumer.ts     # handler idempotente: INSERT inbox ON CONFLICT DO NOTHING + efecto, misma tx
  src/options.ts      # adaptadores A/B/C (publisher, worker, reintentos, DLQ, shutdown)
  src/worker-main.ts  # proceso worker con handlers SIGTERM/SIGINT(/SIGBREAK)
  test/*.test.ts      # Vitest
  results/*.json      # métricas medidas (salida de los tests)
```

Diseño común a las 3 opciones:

- **Outbox**: `platform.outbox(id = eventId UUIDv7, sequence bigserial, …, envelope jsonb, published_at, attempts)`; el envelope se valida con ajv **antes** de insertarlo (productor) y **al consumirlo** (consumidor).
- **Relay**: lote de 500 `WHERE published_at IS NULL ORDER BY sequence FOR UPDATE SKIP LOCKED`, publica, `UPDATE published_at`, `COMMIT`. Polling 200–500 ms + `LISTEN outbox` (trigger `AFTER INSERT … FOR EACH STATEMENT` → `pg_notify`) como despertador. Usa `published_at IS NULL` (no "último sequence visto") para no perder filas con `sequence` menor que commitean tarde.
  - A/B: `addBulk` con `jobId = eventId` (dedupe del lado BullMQ mientras el job exista). Publicar y marcar **no** son atómicos ⇒ at-least-once.
  - C: `boss.insert(..., { db: <cliente de la tx del relay> })` ⇒ encolar y marcar `published_at` son **atómicos** (0 duplicados por el relay). Con pg-boss incluso se podría encolar directamente en la tx del comando y prescindir del relay.
- **Consumidor**: `platform.inbox(consumer, event_id)` + efecto (`app.balance`) en la misma transacción. Duplicado ⇒ no-op.
- **Reintentos/DLQ**: A/B `attempts` + backoff exponencial; en el último intento se escribe `platform.dead_letter` y el job queda en estado `failed`. C: `retryLimit` + `retryBackoff` + `deadLetter` nativo (cola `…-dlq`) cuyo worker escribe `platform.dead_letter`.
- **Shutdown**: A/B `worker.close()` (deja de tomar jobs, espera los activos); C `offWork({wait:true})` + `stop({graceful})`.

## 3. Comandos

```powershell
cd spikes/SPIKE-05-outbox-queue
pnpm install
pnpm up                                   # docker compose -p pf-spike-05 up -d --wait postgres valkey
pnpm typecheck
pnpm test:semantics                       # 17 tests: envelope, rollback, crash relay, duplicados, DLQ, orden, shutdown
pnpm test:perf                            # 10k eventos por opción (+ variante C-transactional)
pnpm test:valkey-down                     # sólo A: para/mata Valkey (sólo el contenedor de este spike)
pnpm test:signals                         # SIGTERM en Windows + worker en contenedor Linux (SIGTERM/SIGKILL)
pnpm down                                 # docker compose -p pf-spike-05 down -v
```

Todos los tests pasaron (17 + 7 perf + 1 + 4). `tsc` sin errores.

## 4. Resultados medidos

### 4.1 Tabla comparativa

| Criterio | A: BullMQ + Valkey | B: BullMQ backend PG | C: pg-boss 12 |
|---|---|---|---|
| Rollback del comando ⇒ sin evento | ✅ (outbox en PG, común) | ✅ | ✅ |
| Crash del relay tras publicar y antes de marcar (300 ev., 3 lotes "crasheados") | 0 perdidos, efecto ×1. Republica; `jobId` dedupe ⇒ 0 duplicados vistos | igual que A | 0 perdidos, **0 republicaciones** (publicar+marcar atómico) |
| Entrega duplicada (5 copias concurrentes del mismo `eventId`) | efecto ×1, 4 no-op por inbox | ídem | ídem |
| Reintentos + DLQ (3 intentos) | ✅ `failed` + dead_letter en 0,54 s (backoff 100 ms) | ✅ 0,43 s | ✅ 6,7 s (`retryDelay` mínimo 1 s, en segundos) |
| Orden por agregado **nativo** | ❌ (grupos = BullMQ Pro, de pago) | ❌ | ✅ política `key_strict_fifo` (`singletonKey = aggregateId`) |
| Orden con garantía (500 ev., 20 agregados, conc. 8) | 0 inversiones vía detección de huecos `aggregateVersion` + reintento; drenado 6,3 s (vs 0,9 s sin) | 0 inversiones; 0,95 s | 0 inversiones con `key_strict_fifo`; 0,77 s |
| Orden sin garantía (misma carga + jitter 10 ms) | 0 inversiones en esta corrida | 0 (1 en una corrida previa) | 0 (el adaptador agrupa por agregado dentro del lote) |
| API: escrituras/s con relay+consumidor corriendo (16 escritores) | **589/s**, p50 24 ms, p99 64 ms | 474/s, p50 30 ms, p99 103 ms | 352/s, p50 34 ms, p99 190 ms |
| Lag outbox (`published_at − created_at`) bajo carga, p50 / p99 / máx | 29 / 74 / 231 ms | 85 / 218 / 382 ms | 57 / 321 / 1395 ms |
| E2E (`inbox.processed_at − outbox.created_at`) p50 / p99 | 106 / 259 ms | 223 / 556 ms | 104 / 600 ms |
| Backlog 10k: relay (publicación) | 8 306 ev/s | 4 985 ev/s | 4 195 ev/s |
| Backlog 10k: consumo (inbox+efecto, conc. 16) | 1 022 ev/s | 634 ev/s | 1 000 ev/s |
| SIGTERM real (contenedor Linux) con job de 4 s en curso | job termina, commit, exit 0 en 3,9 s | ídem, 4,0 s | ídem, 3,9 s |
| SIGKILL a mitad de job | rollback; re-entrega ×1 a los **8,9 s** (lock 5 s + stalled check 2 s) | rollback; **9,2 s** | rollback; **49,5 s** (expira `expireInSeconds: 20` + ciclo del supervisor) |
| Valkey/Redis caído | API sigue escribiendo (100/100, p50 4,8 ms); relay reintenta; recupera en 3,5 s | n/a | n/a |
| Componentes stateful | PG + Valkey | sólo PG | sólo PG |
| UI/ecosistema | Bull Board/Taskforce, `@nestjs/bullmq` | misma API BullMQ (backend nuevo: sept-2026) | más limitado; Nest comunitario |

Fuentes: `results/semantics-{A,B,C}.json`, `results/perf.json`, `results/valkey-down.json`, `results/signals.json`.

### 4.2 Variante pg-boss `work({ transactional: true })`

Permite inbox + efecto + *completion* del job en **una** transacción (lo más cercano a exactly-once sin inbox). Medido: **130 ev/s** e2e, p99 **43 s**: con `batchSize: 1` no hay "burst" y cada worker espera `notifyPollingIntervalSeconds` (default **30 s**, mínimo 0,5 s) entre jobs. Con lotes transaccionales, un evento venenoso hace fallar el lote entero ⇒ descartado. El adaptador final de C usa lotes de 20 + `burstWhenBatchFull` + `perJobResults` y una transacción propia por job.

### 4.3 Hallazgos clave

1. **Valkey sin persistencia pierde jobs ya marcados como publicados** (medido: 50/50 perdidos tras `kill` + restart). La afirmación del ADR "si Redis pierde datos, el relay republica lo no confirmado" **no es cierta tal cual**: el relay sólo republica filas con `published_at IS NULL`. Hace falta un **sweeper** (`sweepUnconsumed`: vuelve a `NULL` lo publicado hace > X sin fila en inbox ni en dead_letter) — con él se recuperaron 50/50 — o AOF `appendfsync everysec` (ventana de pérdida ≈ 1 s) más el sweeper.
2. Con A el relay **no** es atómico con la cola: aparecen duplicados en cuanto se activa `removeOnComplete` (el dedupe por `jobId` sólo funciona mientras el job exista). El inbox los absorbe (test de duplicados).
3. Con `SKIP LOCKED` y **varios relays** se puede reordenar entre lotes; el orden por agregado exige **un solo relay activo** (o lock asesor/particionado por agregado) además del mecanismo del consumidor.
4. pg-boss con sus defaults (`batchSize 1`, `notifyPollingIntervalSeconds 30`) se "atasca": 40 de 300 jobs procesados en 10 s. Hay que configurar polling/burst explícitamente.
5. Las cuentas de pg-boss (`getQueue().activeCount/failedCount`) vienen de un caché de estadísticas (hasta 60 s) — no sirven como verdad inmediata en tests/alertas.
6. B y C ponen la carga de la cola en la **misma** PG que la API: el p99 de escritura de la API sube de 64 ms (A) a 103 ms (B) y 190 ms (C) con 10k eventos simultáneos. Irrelevante a escala de un usuario, relevante como señal.
7. `key_strict_fifo` bloquea el agregado mientras un job está en retry/failed: coincide con docs/11 §6 ("el consumidor que exige orden pausa ese agregado"), pero un DLQ abierto congela ese agregado hasta resolverlo.

### 4.4 Windows y señales

- Medido: `child.kill('SIGTERM')` en Windows **no ejecuta** `process.on('SIGTERM')`; Node llama a `TerminateProcess` (exit `signal: SIGTERM`, `code: null`) ⇒ equivale a SIGKILL. En consola, Ctrl+C entrega `SIGINT` y Ctrl+Break entrega `SIGBREAK` (ambos se manejan en `worker-main.ts`).
- Por eso el shutdown se probó con **señales reales en un contenedor Linux** (`docker compose stop` = SIGTERM + espera; `kill -s SIGKILL`), con `init: true` (tini) y `stop_grace_period: 30s`. En producción (ECS/Cloud Run/Compose) el worker siempre corre en Linux; en desarrollo local sobre Windows, el worker debe correr en contenedor o con `tsx watch`, que reinicia el proceso de forma abrupta (seguro gracias a inbox + re-entrega).

## 5. Evidencia

- Tests: `test/outbox.test.ts`, `test/perf.test.ts`, `test/valkey-down.test.ts`, `test/signals.test.ts`.
- Métricas JSON en `results/`.
- Los únicos contenedores tocados son `pf-spike-05-*` (incluido `stop`/`kill` de `pf-spike-05-valkey-1`). Entorno desmontado con `docker compose -p pf-spike-05 down -v`.

## 6. Recomendación

1. **Mantener** outbox en PG + relay + `platform.inbox` + `platform.dead_letter` como la forma canónica: las tres opciones cumplen at-least-once, idempotencia, DLQ y shutdown limpio con este diseño.
2. **Cola por defecto: pg-boss (C) para el perfil de un usuario.** Es la única con orden por agregado nativo (`key_strict_fifo`), publicación atómica con el outbox (o sin relay), cero infraestructura extra y rendimiento de consumo ≈ A (1 000 ev/s, órdenes de magnitud por encima de la carga esperada). Coste: recuperación más lenta de jobs huérfanos (≈ 50 s, ajustable con `expireInSeconds`/heartbeat) y configuración explícita de polling.
3. **Alternativa con la API de BullMQ: B (BullMQ-on-PostgreSQL)**. Funciona y cumple, pero es un backend recién publicado (sept-2026), ~40 % menos throughput que A en este spike, sin encolado transaccional y sin orden nativo. Re-evaluar en 6 meses si se quiere el ecosistema BullMQ (Bull Board, `@nestjs/bullmq`) sin Redis.
4. **Redis/Valkey puede ser opcional para un usuario único: sí.** La fuente de verdad ya está en PG; A sólo aporta latencia/throughput que no se necesita y añade un servicio stateful más, el riesgo de pérdida de jobs (requiere sweeper o AOF) y otra pieza en cloud (~USD 12–15/mes gestionado). Diseñar un puerto `JobQueue`/`EventPublisher` en `@pf/platform` con adaptador pg-boss por defecto y adaptador BullMQ/Valkey opcional (perfil compose `redis`) si se extraen servicios o se necesita rate limiting/caché distribuidos.
5. Independiente de la cola: **sweeper** de outbox (publicado sin inbox tras N min), **un solo relay activo** (advisory lock), métricas `outbox_lag_seconds`/`outbox_pending_count`/`events_dead_lettered_total`, validación ajv en productor y consumidor.

## 7. Riesgos

- **pg-boss**: bloat/vacuum de sus tablas en PG (configurar retención); carga de polling compartida con la API; defaults de polling peligrosos (hallazgo 4); stats cacheadas.
- **BullMQ-PG**: madurez (≈ 1 semana publicado); migraciones propias en schema `bullmq` que hay que integrar con dbmate/backups.
- **Valkey (A)**: pérdida de jobs sin persistencia; `maxmemory-policy` debe ser `noeviction`; doble lugar de estado.
- **Orden**: ninguna opción ordena entre agregados; varios relays pueden reordenar; `key_strict_fifo` congela agregados con eventos en DLQ.
- **Windows**: SIGTERM no es manejable; probar shutdown sólo en contenedor.
- Mediciones en una sola máquina de desarrollo, 1 corrida por escenario: tomar los números como orden de magnitud, no como benchmark.
