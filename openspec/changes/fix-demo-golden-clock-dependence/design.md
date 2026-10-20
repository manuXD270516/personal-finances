# Diseño: fix-demo-golden-clock-dependence

## Contexto

### Hecho observado

Nightly 39411997796 (2026-10-20), job `regression`, archivo completo `apps/api/test/demo/demo-data.int.test.ts`: `[TC-IDENTITY-DEMO-007]` obtuvo 116919.90 BOB en "Banco Andino Demo — Cuenta corriente" y 9673.69 BOB en "Efectivo", frente a 117519.90 BOB y 9073.69 BOB del resumen de referencia (`golden-summary.json`). La diferencia es un "Retiro de efectivo" de 600.00 BOB de la cuenta corriente a "Efectivo".

| Corrida (2026-10-20, UTC) | ¿Cruza el minuto :10? | Resultado |
|---|---|---|
| CI de #150, 07:41–08:04 | no (toda la corrida) | pasa |
| nightly manual, 08:05–08:23 | la corrida sí; el archivo demo, no consta | pasa |
| nightly, 09:36–09:50 | no | pasa |
| CI de #152, 10:36–10:58 | no | pasa |
| nightly, archivo demo 11:09–11:14 | **sí (11:10)** | **falla** |

### Cadena causal (verificada en el código)

| # | Hecho | Dónde |
|---|---|---|
| 1 | El dataset v2 crea la definición "Retiro de efectivo", `TRANSFER` de `bank_bob` a `cash`, 600.00 BOB (`60_000n` unidades menores), `monthDays: [2]`, `MONTHLY`, modo **`AUTO_CREATE`**, desde el mes A − 5. El plan solo resuelve las ocurrencias con fecha ≤ ancla (la última, 2026-09-02). Los flujos v1 de "Retiro de efectivo" de esos 6 meses se reemplazan por estas ocurrencias | `apps/api/src/demo/dataset/plan-modules/commitments.ts:363-376` y `:456-465`; `apps/api/src/demo/dataset/demo-plan.ts:776-785` |
| 2 | El cargador ejecuta el plan con un `FixedClock` y deja generadas las ocurrencias hasta ancla + `COMMITMENTS_HORIZON_DAYS` (90). La del 2026-10-02 queda `SCHEDULED` | `apps/api/src/demo/demo-data-loader.ts:172, 312-353` |
| 3 | El test arranca un worker con el **reloj real**: `createWorkerRuntime(workerConfig(baseEnv(deps)), …, { ledgerMaintenanceOnStart: false, fxGapFillOnStart: false })`, sin `clock` y con todos los crons por omisión. `DemoWorld` hace lo mismo | `apps/api/test/demo/demo-data.int.test.ts:240-247`; `apps/api/test/support/demo-world.ts:65-69` |
| 4 | El worker registra `commitments.generate-occurrences` con `COMMITMENTS_SCHEDULER_CRON`, que vale por omisión `10 * * * *` en UTC (minuto 10 de cada hora) | `packages/platform/src/config/variables.ts:829-840`; `apps/api/src/worker/create-worker-runtime.ts:501-504`; `apps/api/src/worker/commitments-jobs.ts:40-48` |
| 5 | El job recorre todo workspace `status = 'ACTIVE'` y no archivado; el workspace demo lo es | `packages/contexts/identity/src/interface/identity.module.ts:424-452` |
| 6 | Por workspace, toma hoy con `LocalDate.ofInstant(deps.clock.now(), calendar.timeZone)` (reloj del worker = real) y materializa toda ocurrencia `AUTO_CREATE` abierta con vencimiento ≤ hoy, una vez por día (`lastAutoCreateOn`) | `packages/contexts/commitments/src/application/generate-occurrences.service.ts:57, 201-213`; `packages/contexts/commitments/src/domain/occurrence-clock.ts:24-26` |
| 7 | Con hoy = 2026-10-20 la única ocurrencia automática vencida después de la ancla es la del 2026-10-02: crea el retiro de 600.00 BOB | — |

Las otras definiciones de la demo no cambian saldos todavía. "Alquiler" e "Internet" están en `PENDING_APPROVAL` y "Luz" en `NOTIFY_ONLY`: el job solo las pasa a próximas o atrasadas. El "Sueldo" (`AUTO_CREATE`, día 31 con ajuste al día hábil anterior) vence el 2026-10-30, porque el 2026-10-31 es sábado. El "Seguro vehicular" (`AUTO_CREATE`, trimestral, vence ancla − 45 = 2026-08-16) vuelve a vencer el 2026-11-16. Los planes de metas y las suscripciones de la demo se crean en `PENDING_APPROVAL` (`demo-module-executor.ts:205, 359, 452`).

### Por qué pasa unas horas sí y otras no, y desde cuándo

- La integración corre los archivos en serie (`fileParallelism: false`, `apps/api/vitest.integration.config.ts:13`). En `demo-data.int.test.ts`, el arranque del worker encola la ejecución `startup` del job antes de que exista la demo, así que no la toca. Después, solo el cron puede tocarla.
- El cron dispara una vez por hora, en el minuto 10 UTC (11:10 UTC son las 07:10 en America/La_Paz). TC-IDENTITY-DEMO-007 falla si ese minuto cae entre la confirmación del plan de la carga A y la lectura de sus saldos, unos 30 a 60 s con dos cargas de ~28 s. Si cae antes de que el cargador lea sus saldos (`demo-data-loader.ts:369`), la carga A termina `FAILED` (`DEMO_GOLDEN_MISMATCH`) y el test falla en `outcome`. Si cae después, falla en los saldos, que es lo observado. La probabilidad por corrida es de unos 1 a 2 en 60.
- **Bomba de tiempo** armada desde el **2026-10-02 00:00 America/La_Paz (04:00 UTC)**. Antes de esa fecha ninguna ocurrencia automática posterior a la ancla 2026-09-30 había vencido. Afecta al check requerido `integration` del PR (`pr.yml:154`, `pnpm test:integration`, mismo archivo) y al job `regression` del nightly. CI de #150 y #152 pasaron porque su ventana no cruzó el minuto 10.
- La magnitud crece con la fecha real: desde el 2026-10-30, +12600.00 BOB de sueldo; desde el 2026-11-02, un segundo retiro; desde el 2026-11-16, −450.00 BOB de seguro.
- `demo-v2.int.test.ts` tiene la misma exposición. Su `DemoWorld` arranca el worker igual y el archivo lee estados por módulo durante varios minutos. Los otros crons horarios también actúan sobre la demo con el reloj real: `PLANNING_PERIODS_CRON` en el minuto 5, `COMMITMENTS_SUBSCRIPTIONS_CRON` en el 20 (el trial de "Curso Kantuta Demo" terminó el 2026-10-05 = ancla + 5, y TC-IDENTITY-DEMO-015 espera `TRIAL`), `DEBT_CARDS_CRON` en el 30 y `GOALS_DAILY_CRON` en el 40. No se observó todavía una falla de ese archivo; la tarea 5.2 lo confirma.

### ¿Defecto del producto o de la prueba?

- **La demo que sigue el reloj real no es un defecto.** La ancla de la app y de la seed es hoy en la zona del workspace (`packages/contexts/identity/src/application/demo-data.service.ts:79`; `apps/api/src/seed/run-seed.ts`, `systemClock`). Con esa ancla el job no tiene nada atrasado, y en los días siguientes la demo evoluciona como un workspace real, que es lo que la spec ya admite ("ocurrencias, cuotas y cargos futuros que generan los propios cronogramas"). Una ancla pasada solo existe en las pruebas.
- **La prueba sí tiene un defecto.** Compara una carga con una ancla pasada contra el resumen de referencia mientras un proceso con reloj real modifica el workspace.
- **Hueco menor del producto.** El cargador verifica los saldos fuera de la unidad de trabajo del plan (`demo-data-loader.ts:356-397`). Si un job `demo.load` corre al día siguiente de la solicitud (cola atrasada o carga que cruza la medianoche de La Paz) y una tarea programada actúa en ese intervalo, la carga termina `FAILED` sin un error real.

## Objetivos / No objetivos

**Objetivos**

- TC-IDENTITY-DEMO-007 y la suite demo deterministas a cualquier hora y fecha de la corrida, sin cambiar sus aserciones ni el resumen de referencia.
- Detectar en CI, antes de que exploten, las dependencias de la fecha real en los consumidores de la demo.
- Hacer explícito y probado el comportamiento de producto, que la demo sigue el reloj de la instalación, con el caso exacto del incidente.
- Que la verificación del cargador no dependa de otros procesos.

**No objetivos**

- Congelar los workspaces demo frente a las tareas programadas (pregunta 1 de docs/45).
- Recalcular la ancla cuando el job de carga corre otro día (pregunta 2 de docs/45).
- Cambiar crons, horizonte, motor de recurrencia, dataset, resumen de referencia, contratos, eventos o migraciones.

## Decisiones

### 1. El worker de las pruebas demo no ejecuta tareas programadas

Opción de pruebas en `CreateWorkerRuntimeOptions`, `scheduledJobs?: boolean` (por omisión `true`, sin cambio en producción). Con `false`:

- la cola del worker se construye con el cron de pg-boss apagado (`schedule: false`; hoy `pgboss-job-queue.ts:52` lo deriva del rol `consumer`). La instancia no dispara **ningún** schedule de la tabla de pg-boss, ni los configurables (`*_CRON`) ni los fijos en código (`FX_GAP_FILL_CRON`, barrido y purga de notificaciones, retención de exportaciones), aunque los haya dejado registrados el worker de un archivo anterior;
- ninguna ejecución de arranque se encola: commitments, suscripciones, tarjetas, metas, periodos, imports, ledger, gap-fill de FX, backfills y barrido de notificaciones. Las opciones `*OnStart` existentes siguen y la nueva tiene prioridad;
- los manejadores de los jobs siguen registrados (se pueden ejecutar por envío manual) y los consumidores del outbox siguen activos.

`demo-data.int.test.ts` y `DemoWorld` arrancan el worker con `scheduledJobs: false`.

*Alternativas descartadas:* (a) poner los `*_CRON` en `off` por entorno: no cubre los crons fijos y `off` borra el schedule de la tabla compartida (`unschedule`). (b) Un reloj fijo en la ancla para el worker: `demo-data.int.test.ts` también carga con la ancla de hoy (TC-IDENTITY-DEMO-001) y `demo-v2.int.test.ts` con dos anclas (2026-09-30 y 2026-10-05), y un solo reloj fijo no sirve a todas. (c) Reintentar o esperar a que pase el minuto 10: esconde la causa y deja vivas las demás bombas.

### 2. Prueba de independencia de la fecha real (archivo nuevo)

`apps/api/test/demo/demo-clock.int.test.ts` crea su propio worker con `scheduledJobs: false` y `clock: new FixedClock(…)`, un reloj modificable con `set`. La API y la carga en proceso siguen como en TC-IDENTITY-DEMO-007.

1. **TC-IDENTITY-DEMO-021.** Reloj del worker en 2027-10-30T16:00Z (ancla + 395 días). Se carga la demo con la ancla 2026-09-30, se espera la publicación del outbox y que los conteos del workspace se estabilicen, como `settledCountsOf`. Se exigen los 14 saldos del resumen de referencia y asientos balanceados. Si algún consumidor usara la fecha real para algo que cambia saldos, aquí falla de forma determinista.
2. **TC-IDENTITY-DEMO-022.** Antes de cualquier envío manual, ninguna cola que figure en la tabla de schedules de pg-boss (`pgboss.schedule`, leída en la prueba) tiene trabajos creados desde el arranque del worker de este archivo. Se deriva de la tabla y no de una lista fija, así que cubre los crons nuevos.
3. **TC-IDENTITY-DEMO-024.** `clock.set(2026-10-02T16:00Z)` (12:00 en La Paz), envío manual de `commitments.generate-occurrences` con `trigger: 'manual'` y espera a que termine. Debe aparecer exactamente una transferencia nueva "Retiro de efectivo" de 600.00 BOB, fechada el 2026-10-02: cuenta corriente 116919.90 BOB y "Efectivo" 9673.69 BOB, los demás saldos sin cambios. Un segundo envío el mismo día no cambia nada. Un envío con el reloj en la ancla (2026-09-30T16:00Z), hecho antes del paso a 2026-10-02, tampoco cambia nada.

En el paso 3, el reloj en 2027-10-30 del paso 1 nunca llega al motor de recurrencia, porque con `scheduledJobs: false` no corre. Si se ejecutara con ese reloj, crearía 13 meses de ocurrencias.

### 3. TC-IDENTITY-DEMO-007 sin cambios en sus aserciones

Solo cambia la precondición: worker sin tareas programadas. Se agrega la nota del incidente al TC. El test de `demo-v2.int.test.ts` hereda la corrección por `DemoWorld`.

### 4. Verificación del cargador dentro de la unidad de trabajo del plan

En `DemoDataLoader.execute`, la comparación de saldos (`listAccounts` frente a `summarizeDemoPlan`) y el balance de comprobación pasan al final de `inDemo(async () => { … })` del plan (`demo-data-loader.ts:312-353`), después de `verifyModules`. Leen lo que escribió el plan antes de confirmarlo, y ningún otro proceso puede ver ni modificar esas filas hasta entonces. La verificación de integridad del ledger (`ledgerMaintenance.verifyLedgerIntegrity`) usa su propia conexión, queda después de confirmar y se acota al workspace como hoy. Los códigos de error no cambian. El orden de `progress(...)` se conserva.

Para probarlo, un gancho solo para pruebas, `afterPlanCommitted?: () => Promise<void>` (patrón de `failAt`), se ejecuta justo después de confirmar el plan. **TC-IDENTITY-DEMO-023**: en el archivo de la decisión 2, el gancho ejecuta el motor de recurrencia con el reloj del worker en 2026-10-02. La carga con la ancla 2026-09-30 termina `READY`, y después el workspace tiene el retiro de más, lo que prueba que el gancho actuó. Antes del cambio, la misma prueba termina `FAILED` con `DEMO_GOLDEN_MISMATCH`. Se escribe primero en rojo (TDD).

*Riesgo:* si algún saldo de `listAccounts` se proyecta de forma asíncrona, no se vería dentro de la unidad de trabajo. Hoy el saldo sale de los postings (consulta de saldo por cuenta con índice `INCLUDE`). Si no fuera así, la alternativa es leer el saldo de los postings del plan dentro de la unidad de trabajo, sin tocar la lectura pública.

### 5. Sin cambios de contratos ni datos

Sin OpenAPI, eventos, `ErrorCode`, migraciones ni RLS. Las opciones nuevas del runtime del worker y del cargador son internas y solo las usan las pruebas; producción no las pasa.

## Riesgos / Trade-offs

- **Las pruebas demo dejan de ejercitar las tareas programadas sobre la demo.** Lo compensa TC-IDENTITY-DEMO-024, que ejecuta el motor con un reloj fijo y un resultado exacto. Las tareas programadas siguen cubiertas por sus propios TC de contexto.
- **El worker del archivo nuevo usa un reloj fijo y comparte la base con los demás archivos.** Los archivos corren en serie y el worker de cada uno se cierra en `afterAll`. Con `scheduledJobs: false` no hay ejecuciones de arranque que recorran workspaces de archivos anteriores con un reloj de 2027.
- **El job `integration` dura más:** una carga demo de ~30 s más la espera de consumidores. La tarea 5.3 lo mide frente a NFR-MAINT-007.
- **Que el comportamiento "demo viva" sea el deseado** depende de la pregunta 1 de docs/45. Si el owner elige congelar la demo, TC-IDENTITY-DEMO-024 se reescribe (sin retiro nuevo) y se agrega el filtro en el directorio de workspaces de las tareas programadas, en un change aparte.

## Plan de migración

No aplica: sin migraciones ni cambios de configuración en producción. Despliegue sin pasos.

## Preguntas abiertas

En [docs/45](../../../docs/45-fix-demo-golden-clock-dependence-questions.md). **Ninguna bloquea la implementación:** los grupos 1 a 6 se hacen con las recomendaciones.

1. ¿La demo sigue el reloj de la instalación después de la carga, o se congela? Recomendación: que lo siga (comportamiento actual). Con esa recomendación, TC-IDENTITY-DEMO-024 es `provisional`.
2. ¿Se recalcula la ancla si el job de carga corre otro día que la solicitud? Recomendación: no.
