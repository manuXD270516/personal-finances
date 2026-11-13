# Diseño: fix-worker-user-context

## Contexto

`pf_worker` es miembro de `pf_app` y hereda sus políticas. La política `workspace_member_read` de `iam.workspace` exige `platform.current_user_id()` (lanza `PF002` sin usuario). Por eso el worker nunca lee `iam.workspace` en su transacción: usa el rol `pf_workspace_directory` (`SET LOCAL ROLE`, lectura de columnas acotadas, migración `20261003230100`) en una conexión propia.

IDENTITY expone `actorSettings` y `actorCalendar` (`identity-wiring.ts`): si el contexto de petición tiene un actor `USER`, usan la ruta de la petición; en otro caso, la de directorio. FX (`RatePairResolver.baseCurrencyOf`) y la valoración de ACCOUNTS recibían la ruta de petición pura.

## Decisión

Cablear `actorSettings` en FX y en `valuation.workspaces` de ACCOUNTS. Sin migración y sin tocar políticas: no se abre RLS. Alternativas descartadas: relajar `workspace_member_read` para `pf_worker` (abriría `iam.workspace` completo al worker) y fijar un usuario ficticio en el worker (rompería la atribución de actor de proceso).

## Por qué solo la demo lo mostraba

La moneda base solo se consulta al valorar monedas distintas de la base. Los tests de tarjetas existentes usan BOB; la demo trae tarjetas en USD y el consumidor `debt.card-activity` y el job diario las valoran.

## Pruebas

TC-SECURITY-RLS-019: con el dataset Demo v2 cargado y el worker real, `events.debt.card-activity` drena su cola sin `PF002` en `pgboss.job` y `debt.card-daily` (envío manual) termina con `failed = 0`. Rojo previo en `main`: 8 entregas con `PF002` y 1 fallo del job.
