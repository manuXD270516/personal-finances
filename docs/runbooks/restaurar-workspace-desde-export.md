# Runbook — restaurar un workspace desde un export

> **Estado:** vigente desde `add-workspace-export` (Phase 2) · **Relacionado:** [30-backup-and-disaster-recovery.md](../30-backup-and-disaster-recovery.md) §10–§11 · [12-security.md](../12-security.md) §4 · docs/33 D98–D102/D108 · `contracts/export/v1/README.md`

El export de workspace es la copia de seguridad del USUARIO (portabilidad); no sustituye los backups de plataforma. Restaurar **siempre crea un workspace nuevo** con identificadores nuevos: el workspace original no se toca.

## 1. Exportar (OWNER)

1. En **Configuración → Exportar el espacio de trabajo**, pulsar *Exportar* y confirmar. Si el último inicio de sesión tiene más de 10 minutos, la app pide confirmar la identidad (se vuelve a la misma pantalla).
2. Esperar el estado *Lista* (la lista muestra el vencimiento a 7 días) y pulsar *Descargar*. El ZIP descargado está **en claro**: guardarlo en un lugar seguro. Para borrar el archivo del servidor antes, *Eliminar archivo*.
3. Comprobar la integridad: la cabecera `Repr-Digest` y el SHA-256 de la lista coinciden con `sha256sum export.zip`.

## 2. Importar

1. En **Configuración → Importar un archivo exportado**, elegir el `.zip` (≤ 200 MB) e *Importar*. Requiere autenticación reciente.
2. El progreso pasa por *Validando → Importando → Verificando*. Al terminar, *Abrir el espacio de trabajo nuevo* (nombre con el sufijo « (restaurado)»).
3. La importación es una sola transacción: verifica saldos por cuenta y balance de comprobación contra el manifiesto. Si no coinciden o el archivo está alterado, **no se crea nada** y la importación queda `FAILED` con su código.

## 3. Diagnóstico

| Síntoma | Causa probable | Qué hacer |
|---|---|---|
| 403 `REAUTHENTICATION_REQUIRED` | `auth_time` > 10 min | Usar *Confirmar mi identidad* y reintentar |
| 409 `EXPORT_IN_PROGRESS` / `IMPORT_IN_PROGRESS` | Ya hay una operación en curso | Esperar a que termine |
| 410 `EXPORT_EXPIRED` | Venció (7 días) o se eliminó | Exportar de nuevo |
| 422 `EXPORT_FILE_CORRUPTED` | Archivo alterado/truncado, o clave maestra retirada del llavero | Si es la descarga: volver a exportar. Si es la importación: usar el archivo original |
| 422 `EXPORT_FORMAT_UNSUPPORTED` | Versión futura o export de un workspace de demostración | Exportar desde un workspace real con la misma versión de la app |
| 422 `EXPORT_VERIFICATION_FAILED` | Los datos no cuadran con el manifiesto | Abrir incidente con el `requestId`: el archivo es sospechoso |
| 413 `UPLOAD_TOO_LARGE` | > `WORKSPACE_IMPORT_MAX_BYTES` | Dividir no es posible; pedir al owner ajustar el límite |
| 503 en export/import | Falta `EXPORT_ENCRYPTION_KEYS` | Configurar el llavero (nunca en el repositorio) |

## 4. Operación de claves

- Variables: `EXPORT_ENCRYPTION_KEYS` (`kid:clave[,kid:clave…]`, 32 bytes en base64url o hexadecimal) y `EXPORT_ENCRYPTION_ACTIVE_KEY_ID`. Generar con `openssl rand -hex 32`.
- **Rotación:** agregar la clave nueva, fijarla como vigente y conservar las anteriores hasta que expiren los exports envueltos con ellas (≤ 7 días). Quitar una clave deja indescifrables sus exports vigentes (se vuelve a exportar).
- Los exports huérfanos se purgan por el job de retención y por el *lifecycle* de 8 días del bucket.

## 5. Auditoría

Cada paso queda en el audit log (categoría `SECURITY`): `identity.export.requested|completed|failed|downloaded|discarded|expired`, `identity.import.requested|rejected|succeeded|failed` e `identity.workspace.restored` (en el workspace nuevo, con el id del origen).
