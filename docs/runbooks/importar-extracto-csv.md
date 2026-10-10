# Runbook — importar un extracto CSV

> **Estado:** vigente desde `add-basic-csv-import` (Phase 3) · **Relacionado:** [13-import-architecture.md](../13-import-architecture.md) · [28-ui-ux-design-system.md](../28-ui-ux-design-system.md) §4.7 · docs/35 D122 y D149–D151 · `packages/contexts/imports/README.md`

Carga el histórico real de **una cuenta** desde el CSV que exporta el banco. Nada se crea hasta aprobar; el archivo no se guarda (solo sus celdas, que se purgan a los 90 días).

## 1. Importar (OWNER o EDITOR)

1. En el detalle de la cuenta o en **Transacciones**, pulsar *Importar CSV* y elegir el archivo (≤ 2 MiB, ≤ 5 000 filas de datos, ≤ 50 columnas). Se detecta la codificación (UTF-8 con o sin BOM, windows-1252) y el delimitador (`,` `;` tabulación `|`).
2. **Mapear:** indicar la columna de fecha, la de descripción y el monto (una columna con signo —"negativo es salida" o "positivo es salida"— o columnas de débito y crédito), si la primera fila es encabezado, cuántas filas iniciales saltar, el **formato de fecha** (`dd/MM/yyyy`, `dd-MM-yyyy`, `dd/MM/yy`, `yyyy-MM-dd`, `MM/dd/yyyy`) y el **separador decimal**. Nada se adivina por fila: un monto con más decimales que la moneda o una fecha inexistente deja la fila inválida (nunca se redondea). Se precarga el último mapeo de la cuenta.
3. **Revisar:** conteos (nuevas, ya importadas, posibles duplicados, inválidas), salidas y entradas a crear y saldo actual → resultante. Cada **posible duplicado** (mismo monto, dirección y ±3 días que un gasto, ingreso o transferencia ya registrado) exige decidir: *Crear de todos modos*, *Omitir* (queda vinculado al movimiento existente; un import posterior lo reconoce como ya importado) o *Excluir*. Los **pagos de tarjeta y las transferencias propias** que no estén registrados se importarían como gasto o ingreso: exclúyelos y regístralos como transferencia.
4. **Aprobar:** se crean, de forma asíncrona y por lotes de 200, un gasto o ingreso `POSTED` **sin categoría** por fila (asiento, auditoría con origen *import* y recorrido incluidos). Categorízalos después con la edición masiva de Transacciones.
5. **Resultado:** `COMPLETED`, o `PARTIALLY_FAILED` si un lote fue rechazado (p. ej. el periodo se cerró entre la vista previa y la persistencia): se listan las filas afectadas y su código. *Reintentar* crea solo las faltantes (idempotente); *Aceptar el resultado parcial* termina como `COMPLETED_WITH_ERRORS`. Si el OWNER debe reabrir un periodo, hacerlo antes de reintentar.

## 2. Reimportar el mismo archivo o rangos solapados

Es seguro: cada fila tiene una huella (cuenta, fecha, monto con signo, moneda, descripción normalizada y ordinal entre filas idénticas del archivo). Reimportar el mismo archivo crea 0 transacciones; un archivo que se solapa crea solo las filas nuevas; dos compras idénticas el mismo día se conservan como dos. Si se **anula** una transacción importada, su fila vuelve a ser importable. Subir un archivo ya importado en la misma cuenta avisa (`IMPORT_FILE_ALREADY_IMPORTED`) sin bloquear.

> Tras **restaurar un export en un workspace nuevo** las huellas anteriores no coinciden (incluyen los ids de workspace y cuenta): reimportar el mismo archivo en el workspace restaurado muestra posibles duplicados para decidir, nunca crea en silencio.

## 3. Retención y expiración

| Qué | Cuándo | Efecto |
|---|---|---|
| Importación sin aprobar (esperando mapeo o revisión) | A los 30 días (`IMPORT_REVIEW_TTL`) | El job diario `imports.expire-reviews` la cancela (actor `SYSTEM`, auditado) y descarta sus celdas |
| Celdas crudas (`imports.staged_transaction`) | 90 días después de terminar o cancelar (`IMPORT_STAGING_RETENTION`) | El job diario `imports.purge-staging` las borra; se conservan la importación, sus conteos y los vínculos de idempotencia |

Ambos jobs corren a las 03:40 UTC (`IMPORT_MAINTENANCE_CRON`, `off` los desactiva) y al arrancar el worker.

## 4. Operación y diagnóstico

- **Estado y progreso:** `GET /api/v1/workspaces/{ws}/imports/{id}` (`status`, `progress.batchesDone / batchCount`, `counters`, `errors[]`).
- **Una importación quedó en `PERSISTING`:** el consumidor `imports.persist` reanuda al re-entregar el evento (los lotes con transacciones se saltan). Revisar `platform.dead_letter` por el consumidor `imports.persist` y los logs del worker (`import persisted`: solo `importJobId`, conteos y códigos; nunca montos ni descripciones). Un error de dominio de un lote (`PERIOD_CLOSED`, `ACCOUNT_CLOSED`) NO es transitorio: deja `PARTIALLY_FAILED` con el motivo por fila.
- **Conexiones del worker:** `imports.persist` suma 1 a la concurrencia de consumidores y usa una conexión más mientras persiste un lote; `DATABASE_POOL_MAX` del host es 22 (Σ concurrencia 17 + 4 reservadas + 1). Si se agregan consumidores, subirlo y validarlo con el test de arranque del worker (`TC-COMMITMENTS-MATCH-012`).
- **Rendimiento medido:** vista previa de 5 000 filas ≈ 1 s; la persistencia cuesta ≈ 24 ms por fila (≈ 2 min para 5 000 filas), por encima del objetivo de 20 s de la spec: la ruta de escritura masiva llega con `RecordImportedTransactions` en Phase 6.
