# Runbook — Documentos adjuntos: llavero, subida pública y rotación

> **Estado:** Vigente desde 2026-10-29 · **Decisión:** [ADR-0030](../adr/0030-documentos-cifrados-por-la-aplicacion-y-descarga-por-la-api.md) (D313, D316) · **Relacionado:** [deploy-and-restore.md](deploy-and-restore.md), [docs/30](../30-backup-and-disaster-recovery.md), `deploy/host/pfos-bootstrap-storage.sh`, `deploy/compose/caddy/Caddyfile`
>
> Nada de este runbook lo ejecuta CI por su cuenta: las claves y el DNS los aplica el owner en el host.

## 1. Requisitos de despliegue (una vez)

1. **DNS:** un registro más para `PF_DOMAIN_FILES` (p. ej. `files.<dominio>`) apuntando al mismo host que la app; Caddy emite su certificado automáticamente.
2. **`/etc/pfos/pfos.env`:** completar `PF_DOMAIN_FILES`, `OBJECT_STORAGE_QUARANTINE_BUCKET`, `OBJECT_STORAGE_PUBLIC_ENDPOINT=https://${PF_DOMAIN_FILES}`, `DOCUMENT_ENCRYPTION_KEYS` y `DOCUMENT_ENCRYPTION_ACTIVE_KEY_ID` (la plantilla trae los marcadores `__set__` / `__generate__`; el deploy rechaza los que queden sin completar).
3. **Buckets:** `sudo deploy/host/pfos-bootstrap-storage.sh` (idempotente) crea la cuarentena **sin versioning** y con CORS solo `PUT`/`HEAD` del origen de la app.
4. **Comprobación:** `PUT` sin firma a `https://<PF_DOMAIN_FILES>/<bucket>/ws/x` ⇒ 404; `GET` de cualquier ruta ⇒ 404. Solo los `PUT` firmados sobre la cuarentena pasan al almacenamiento.

## 2. Respaldo del llavero (obligatorio)

`DOCUMENT_ENCRYPTION_KEYS` es el **único** modo de leer los documentos: perderlo implica perder **todos** los documentos de forma irreversible (las réplicas a B2 y los backups solo tienen texto cifrado).

- Guardar una copia de la línea completa `DOCUMENT_ENCRYPTION_KEYS=…` **fuera del host** (gestor de contraseñas del owner o el secreto de despliegue), junto con la clave de pgBackRest.
- Verificar el respaldo al rotar y tras cada restauración del host.

## 3. Rotación de la clave maestra

1. Generar `k2`: `openssl rand -hex 32`.
2. Agregarla **sin quitar `k1`**: `DOCUMENT_ENCRYPTION_KEYS=k2:<hex>,k1:<hex>` y `DOCUMENT_ENCRYPTION_ACTIVE_KEY_ID=k2`; desplegar. Los documentos nuevos se envuelven con `k2`.
3. El job `documents.maintenance` (cada 10 minutos) vuelve a envolver las claves de datos existentes con `k2` en lotes de 500, sin tocar el contenido. Confirmar que no quedan documentos con `k1`: la API y el worker arrancan con un error que nombra la clave si falta una que sigue en uso.
4. Solo cuando el job terminó, se puede retirar `k1` (y actualizar el respaldo del §2).

## 4. Borrado y backups

Eliminar un documento destruye su clave envuelta en la misma transacción y borra el objeto con todas sus versiones. Los backups de la base (pgBackRest, fulls mensuales × 12) conservan el envoltorio hasta 12 meses: frente a una restauración completa de la base, el borrado efectivo es ≤ 12 meses.

## 5. Diagnóstico

| Síntoma | Causa probable | Acción |
|---|---|---|
| `complete` responde 503 con `Retry-After` | Verificaciones simultáneas al máximo (`DOCUMENT_VERIFY_MAX_CONCURRENCY`) o almacenamiento caído | La UI reintenta; revisar `/health/ready` |
| Un documento queda `UPLOADED` | La API cayó a mitad de la verificación | El job lo reintenta a los 10 minutos |
| Descarga 422 `DOCUMENT_CONTENT_CORRUPTED` | Objeto alterado o clave maestra ausente del llavero | Restaurar el objeto de la réplica o la clave del respaldo |
| `documents_storage_usage_drift_bytes` ≠ 0 | Deriva entre los contadores y la suma real | Revisar el log del job; los contadores se recalculan desde los documentos |
