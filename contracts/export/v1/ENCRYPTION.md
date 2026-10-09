# Cifrado en reposo del archivo de export (v1)

> Change `add-workspace-export` (decisión 4) · identity/workspace-portability · NFR-SEC-006 · docs/30 §11

El archivo de export (`pfos-export` ZIP) **nunca** se guarda en claro en el almacenamiento de objetos. Se cifra con
**cifrado de sobre**: una clave de datos aleatoria de 256 bits por archivo, envuelta con una **clave maestra** identificada
(`keyId`) y rotable que jamás se guarda junto al archivo.

## Formato del objeto cifrado (`.pfxe`)

```
cabecera (13 B) = "PFXE" | versión (1 B = 0x01) | prefijo de nonce aleatorio (8 B)
bloque i        = texto cifrado (≤ 64 KiB) | tag GCM (16 B)           i = 0, 1, 2 …
nonce_i         = prefijo (8 B) | i (uint32 big-endian)               (12 B)
AAD_i           = cabecera (13 B) | i (uint32 BE) | último (1 B: 1 si es el último bloque, 0 si no)
```

- Algoritmo: **AES-256-GCM** por bloque. Todos los bloques completos miden 64 KiB; el último puede ser más corto (incluso
  vacío: un archivo vacío es un único bloque de 16 B con el tag).
- El número de bloque y la marca de «último bloque» van en el AAD: reordenar, duplicar, truncar o extender el archivo
  invalida el tag de algún bloque. El lector procesa un bloque completo solo cuando sabe si es el último.
- La descarga primero **autentica todo el objeto** (primera pasada) y compara el SHA-256 del contenido con el registrado al
  exportar; solo entonces descifra en streaming hacia el cliente (segunda pasada). Una alteración ⇒ `EXPORT_FILE_CORRUPTED`
  sin entregar ni un byte.

## Clave de datos y clave maestra

- `iam.workspace_export` guarda `{ key_id, wrapped_key }`; el bucket solo tiene el objeto cifrado.
- `wrapped_key` = `nonce (12 B) | AES-256-GCM(clave de datos de 32 B) | tag (16 B)` bajo la clave maestra `key_id`, con
  `AAD = key_id | "|" | <workspaceId>|<exportId>` (un envoltorio copiado a otra fila no descifra).
- Llavero local/CI: `EXPORT_ENCRYPTION_KEYS=kid:clave[,kid:clave…]` (clave de 32 bytes en base64url —43 caracteres— o hexadecimal —64—, p. ej. `openssl rand -hex 32`) y
  `EXPORT_ENCRYPTION_ACTIVE_KEY_ID`. Cloud: el mismo puerto `ExportKeyProvider` con un adaptador KMS
  (`GenerateDataKey`/`Decrypt`) — pendiente del change de despliegue cloud.
- **Rotación**: una clave nueva pasa a ser la vigente; las anteriores permanecen en el llavero hasta que expiren los exports
  envueltos con ellas (≤ retención, 7 días). Quitar una clave del llavero deja indescifrables sus exports vigentes (son
  temporales: se vuelve a exportar).
- Además, el bucket de exports usa cifrado del lado del servidor (SSE) donde exista y un *lifecycle* de 8 días como red de
  seguridad; la protección principal es la de aplicación descrita aquí.

## Lo que NO cubre

El ZIP que el usuario **descarga** está en claro (HTTPS): cifrarlo con una frase del usuario es una decisión posterior
(docs/33 D98, Phase 7+). La UI advierte guardarlo en un lugar seguro.
