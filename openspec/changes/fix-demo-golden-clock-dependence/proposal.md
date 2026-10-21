# Propuesta: fix-demo-golden-clock-dependence

## Why

El 2026-10-20 la corrida nightly 39411997796 (job `regression`) falló en `[TC-IDENTITY-DEMO-007] dos cargas con la ancla 2026-09-30 dan los mismos saldos (golden) y asientos balanceados` (`apps/api/test/demo/demo-data.int.test.ts`): "Banco Andino Demo — Cuenta corriente" quedó en 116919.90 BOB (golden 117519.90) y "Efectivo" en 9673.69 BOB (golden 9073.69), es decir, un "Retiro de efectivo" de 600.00 BOB de más. El mismo test pasó ese día en el CI de #150 (07:41–08:04 UTC), en dos corridas del nightly (08:05–08:23 y 09:36–09:50 UTC) y en el CI de #152 (10:36–10:58 UTC); falló cuando el archivo corrió entre las 11:09 y las 11:14 UTC.

Causa encontrada en el código (detalle en design.md §Contexto):

1. El dataset Demo v2 crea la definición recurrente "Retiro de efectivo" de 600.00 BOB, transferencia de la cuenta corriente a "Efectivo", los días 2 de cada mes y en modo `AUTO_CREATE` (`apps/api/src/demo/dataset/plan-modules/commitments.ts:363-376`). Con la ancla 2026-09-30, el plan resuelve las ocurrencias hasta la del 2026-09-02; la del 2026-10-02 queda programada.
2. El worker que arranca el test usa el reloj real (`createWorkerRuntime` sin `clock`, `apps/api/test/demo/demo-data.int.test.ts:240-247`) y registra el job `commitments.generate-occurrences` con el cron por omisión `10 * * * *` en UTC (`COMMITMENTS_SCHEDULER_CRON`, `packages/platform/src/config/variables.ts:829-840`; `apps/api/src/worker/create-worker-runtime.ts:501-504`).
3. Ese job recorre todos los workspaces `ACTIVE`, incluido el demo. Toma "hoy" del reloj real en la zona del workspace (`packages/contexts/commitments/src/application/generate-occurrences.service.ts:57`) y materializa toda ocurrencia `AUTO_CREATE` con vencimiento ≤ hoy (`generate-occurrences.service.ts:201-213`; `OccurrenceClock.autoCreateDue`). Con hoy = 2026-10-20 crea la transferencia del 2026-10-02.

El test falla solo si el minuto 10 de alguna hora UTC cae entre la confirmación de la primera carga y la lectura de saldos (unos 30 a 60 s). Por eso pasa la mayoría de las corridas y falló en la que cruzó las 11:10 UTC. Es una **bomba de tiempo** armada desde el **2026-10-02 a las 00:00 en America/La_Paz** (04:00 UTC), el primer día en que una ocurrencia automática posterior a la ancla vence. Afecta también al check requerido `integration` del PR, que corre el mismo archivo, y a `demo-v2.int.test.ts`, que arranca su worker igual (`apps/api/test/support/demo-world.ts:65-69`) y lee estados durante varios minutos. La diferencia crece con la fecha real: desde el 2026-10-30 se suma el sueldo automático de 12600.00 BOB, desde el 2026-11-02 un segundo retiro y desde el 2026-11-16 el seguro trimestral de 450.00 BOB.

No es un defecto del producto que la demo siga el reloj real. Desde la app y desde la seed la ancla es "hoy" (`packages/contexts/identity/src/application/demo-data.service.ts:79`; `apps/api/src/seed/run-seed.ts`, con `systemClock`), y la spec ya prevé que la demo tenga "ocurrencias, cuotas y cargos futuros que generan los propios cronogramas". El defecto está en las pruebas: comparan una carga con una ancla pasada contra el resumen de referencia mientras un worker con reloj real ejecuta tareas programadas sobre ese workspace. El producto tiene además un hueco menor del mismo origen: el cargador verifica los saldos **después** de confirmar el plan (`apps/api/src/demo/demo-data-loader.ts:356-397`, fuera de la unidad de trabajo del plan de las líneas 312-353). Si una tarea programada corre en ese intervalo con una fecha posterior a la ancla, la carga termina `FAILED` (`DEMO_GOLDEN_MISMATCH`) sin que haya un error real. Puede pasar con un job `demo.load` que se ejecuta después de medianoche respecto del día de la solicitud.

## What Changes

- **Pruebas de la demo sin tareas programadas por reloj.** El runtime del worker acepta una opción solo para pruebas que desactiva las tareas programadas: la instancia no dispara crons (incluidos los fijos en código, como la recuperación de huecos de FX o el barrido de notificaciones) y no encola las ejecuciones de arranque. Los consumidores del outbox siguen activos. `demo-data.int.test.ts` y `DemoWorld` (`demo-v2.int.test.ts`) arrancan su worker con esa opción. Con eso, TC-IDENTITY-DEMO-007 y el resto de la suite demo son deterministas a cualquier hora y fecha.
- **Prueba de independencia de la fecha real.** Un archivo de integración nuevo con un worker de reloj fijo y modificable. Carga la demo con la ancla 2026-09-30 con el reloj del worker en 2027-10-30, espera a que se asienten los consumidores y exige los saldos del resumen de referencia. Así los consumidores no dependen de la fecha real y se detectan antes otras bombas por fecha. También comprueba que en ese archivo no se ejecutó ninguna tarea programada.
- **La demo sigue el reloj de la instalación (comportamiento actual, ahora explícito y probado).** En el mismo archivo, con el reloj del worker en el 2026-10-02 a las 12:00 en America/La_Paz, una ejecución manual del motor de recurrencia crea exactamente un "Retiro de efectivo" de 600.00 BOB (116919.90 BOB y 9673.69 BOB), y una segunda ejecución ese día no crea nada. Esto reproduce de forma determinista lo que pasó en el nightly.
- **Verificación de la carga antes de publicar los datos (producto, Should).** El cargador compara los saldos con el oráculo de la ancla y verifica el balance de comprobación dentro de la misma unidad de trabajo del plan, antes de confirmarla. Ningún otro proceso puede modificar el workspace entre la ejecución del plan y su verificación. La verificación de integridad del ledger con su propia conexión sigue después.
- **Fuera de alcance:** congelar los workspaces demo frente a las tareas programadas (descartado por el owner, D288); recalcular la ancla cuando el job de carga corre otro día (descartado, D289); cambiar los crons, el horizonte o el motor de recurrencia; cambiar el dataset, el resumen de referencia o los montos; endpoints, eventos, migraciones o UI.

## Capabilities

### New Capabilities
(ninguna)

### Modified Capabilities
- `identity/demo-data`: ADDED "Resumen de referencia independiente del reloj real" (Must), "Verificación de la carga antes de publicar sus datos" (Should) y "El workspace demo sigue el reloj de la instalación después de la carga" (Should; confirmado por el owner el 2026-10-21, D288). No modifica requirements existentes.

## Impact

**Specs impactadas:** `identity/demo-data` (3 ADDED). Lee sin modificar: `commitments/recurrence-engine` ("Modo creación automática", "Generación idempotente de ocurrencias").

**Componentes/contextos impactados:** `apps/api/src/worker/create-worker-runtime.ts` (opción de pruebas para desactivar las tareas programadas: cola sin cron y sin ejecuciones de arranque); `apps/api/src/runtime/platform-resources.ts` y `packages/platform/src/queue/pgboss-job-queue.ts` (exponer el interruptor `schedule` de pg-boss del consumidor, que hoy se deriva del rol en `pgboss-job-queue.ts:52`); `apps/api/src/demo/demo-data-loader.ts` (verificación de saldos y balance de comprobación dentro de la unidad de trabajo del plan; gancho de pruebas tras la confirmación, como `failAt`); `apps/api/test/demo/demo-data.int.test.ts`, `apps/api/test/support/demo-world.ts` y un archivo nuevo `apps/api/test/demo/demo-clock.int.test.ts`. Sin cambios en los bounded contexts.

**APIs impactadas:** ninguna.

**Tablas impactadas:** ninguna.

**Eventos impactados:** ninguno.

**Migraciones requeridas:** ninguna.

**Invariantes afectadas:** INV-004 (cada asiento suma cero por moneda; se verifica antes de confirmar), INV-013 (generación idempotente: la segunda ejecución del día no duplica el retiro) e INV-025 (nada se escribe fuera del workspace demo). Sin cambios de comportamiento financiero.

**Test cases:** AÑADIDOS: TC-IDENTITY-DEMO-021, TC-IDENTITY-DEMO-022, TC-IDENTITY-DEMO-023 y TC-IDENTITY-DEMO-024. MODIFICADOS: TC-IDENTITY-DEMO-007 (precondición: worker sin tareas programadas por reloj; nota del incidente). DEPRECADOS: ninguno.

**Impacto de regresión:** no cambia ninguna aserción de TC-IDENTITY-DEMO-001..020. El worker de los archivos demo deja de ejecutar tareas programadas, y ningún TC de esos archivos depende de ellas: las de la demo se ejecutan dentro del cargador con su reloj simulado. Agrega una carga demo (~30 s) al job `integration`; está dentro del presupuesto de NFR-MAINT-007 según la medición de la tarea 5.3. La verificación del cargador antes de confirmar mantiene los mismos códigos de error (`DEMO_GOLDEN_MISMATCH`, `DEMO_LEDGER_INVARIANT`).

**Riesgos introducidos:** que la lectura de saldos dentro de la unidad de trabajo no vea lo escrito por el plan si algún saldo se proyecta de forma asíncrona (mitigación: design.md decisión 4, con alternativa); que una tarea programada nueva no quede cubierta (mitigación: TC-IDENTITY-DEMO-022 la detecta por la tabla de schedules de la cola, no por una lista fija). Sin RISK-id nuevo.
