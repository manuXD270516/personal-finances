# contracts/export/v1 — Formato abierto del export del workspace (`pfos-export`)

> Change `add-workspace-export` · identity/workspace-portability · FR-IDENTITY-010, FR-IDENTITY-017, NFR-PORT-009, NFR-REL-014

Formato de portabilidad **versionado y validable**: un único ZIP con el contenido completo de un workspace, sin secretos.

## Estructura del archivo

```
manifest.json                      # índice: secciones, SHA-256 de cada archivo, conteos y verificación de saldos
json/<sección>.jsonl               # un registro JSON por línea; cada línea valida contra <sección>.schema.json
csv/transactions.csv               # vista plana, una fila por split (RFC 4180, UTF-8 con BOM, CRLF)
csv/account-balances.csv           # saldo por cuenta y moneda a la instantánea
```

- **Instantánea**: una transacción `READ ONLY, ISOLATION LEVEL REPEATABLE READ`; `manifest.snapshotAt` es su instante.
- **Montos y tasas**: cadenas decimales exactas con la escala de la moneda (`"45.90"`, `"100.000000"`); nunca números JSON.
- **Instantes**: ISO-8601 UTC con microsegundos (`2026-10-09T14:03:22.123456Z`); fechas de negocio `AAAA-MM-DD`.
- **CSV**: las celdas de texto que empiezan con `=`, `+`, `-`, `@`, tabulación o retorno se neutralizan con una comilla simple
  (CSV injection); los montos exactos no se tocan.
- **Sin secretos**: no viajan tokens, sesiones, claves de idempotencia, mensajes del outbox ni hashes de IP del cliente
  (`audit_log.client_ip_hash`, `idempotency_key`, `user_agent`, `request_id` se omiten).
- **Excluido a propósito**: notificaciones y entregas (derivadas), caché de saldos (`ledger.balance_snapshot`, se
  reconstruye), membresías (el importador queda como único OWNER) y las tablas técnicas de plataforma. La lista vive en el
  `PortabilityRegistry` (`PORTABILITY_EXCLUSIONS`) y un test exige que toda tabla de negocio con `workspace_id` tenga una
  sección o una exclusión con motivo.

## Esquemas

`<sección>.schema.json` (JSON Schema 2020-12, `additionalProperties: false`, todas las columnas obligatorias con `null`
explícito) se **generan desde el catálogo de la base** y las declaraciones de cada contexto (`PortabilitySection` en su
`contracts`); un test de integración los compara con estos archivos (`UPDATE_EXPORT_SCHEMAS=1` los regenera). `manifest.schema.json`
es manual.

## Versionado

- Compatible (columna nueva, sección nueva opcional): misma `formatVersion`, esquema y archivos actualizados.
- Incompatible: `formatVersion` + 1 y una carpeta `v2`; el importador mantiene lectores de las versiones anteriores soportadas.
- La importación rechaza una versión desconocida (`EXPORT_FORMAT_UNSUPPORTED`) y un archivo con secciones que no conoce.

## Importación

Siempre a un **workspace nuevo** con **identificadores nuevos** (UUIDv7 que conservan el instante del original); los ids que
viajan dentro de JSON (diffs de auditoría, recorridos, snapshots de cierre) se reescriben con el mismo mapa. La historia se
inserta tal cual (sin re-ejecutar comandos) en una sola transacción y se verifica contra `manifest.verification`.

El cifrado en reposo del archivo almacenado está en [ENCRYPTION.md](ENCRYPTION.md).
