# ADR-0009: Object storage — puerto `ObjectStorage` con API S3; S3 en cloud, alternativa a MinIO en local

- Estado: Aceptado (2026-10-02, tras SPIKE-07; decisión del owner)
- Fecha: 2026-10-01
- Decisores: Owner (Product/Tech Lead)
- Relacionado: docs/ARCHITECTURE.md §5, §10; docs/13-import-architecture.md; ADR-0011, ADR-0012, ADR-0013, ADR-0014; OpenSpec capabilities `documents/attachments`, `imports/import-pipeline`, `security/file-upload-security`; SPIKE-07

## Contexto y problema

PFOS almacena binarios: comprobantes y facturas adjuntos a transacciones (Documents, Phase 6), archivos CSV/OFX/PDF de imports, exports de reportes y backups lógicos. Estos archivos no deben vivir en PostgreSQL (tamaño, backups, costo) y deben:

- subirse/descargarse sin pasar el binario completo por `finance-api` cuando sea posible (presigned URLs);
- aislarse por workspace (prefijo `ws/<workspaceId>/…` + autorización);
- escanearse/validarse (tipo MIME real, tamaño) antes de considerarse disponibles;
- funcionar igual en local (Docker Compose en Windows) y en cloud.

MinIO era la elección por defecto para S3 local, pero su edición community cambió de distribución (ver Notas), por lo que la opción local debe reevaluarse.

## Drivers de decisión

- API S3 como estándar de facto (SDK único, portabilidad).
- Paridad local ↔ cloud (presigned URLs, multipart, cabeceras).
- Licencia y distribución sostenible (imagen oficial disponible, mantenida).
- Footprint pequeño en local (Windows/WSL2).
- Costo cloud mínimo y durabilidad.
- Seguridad: cifrado en reposo, acceso privado, URLs efímeras.

## Opciones consideradas

**Abstracción:**
- Puerto `ObjectStorage` propio (put, get, presignPut, presignGet, head, delete-lógico) con adapter S3 (AWS SDK v3) — elegida.
- Usar el SDK directamente en los contextos — rechazada (acopla dominio/aplicación a S3).

**Backend local (S3-compatible):**
1. MinIO community.
2. Garage.
3. SeaweedFS.
4. RustFS.
5. LocalStack S3.
6. Filesystem local (adapter alternativo sin API S3).

**Backend cloud:** Amazon S3 (con ECS/Fargate, ADR-0013); en plan B, Google Cloud Storage vía API XML interoperable o adapter GCS.

## Decisión

- Puerto **`ObjectStorage`** en `@pf/platform`; un único adapter **S3 (AWS SDK v3)** configurable por env (`S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, credenciales).
- **Cloud: Amazon S3**, bucket privado, Block Public Access, SSE (SSE-S3 por defecto; SSE-KMS si el presupuesto lo permite), versioning y lifecycle (expiración de uploads incompletos y de imports temporales).
- **Local:** servicio Compose `object-storage` con API S3. El candidato preferente se decide en **SPIKE-07** entre **Garage**, **SeaweedFS** y (por compatibilidad máxima) una build de MinIO; **MinIO deja de ser el default** dadas las condiciones actuales de distribución.
- Flujo de subida: API valida metadatos → crea `Document` en estado `pending_upload` → devuelve presigned PUT (TTL corto, content-type y tamaño restringidos) → cliente sube → evento/confirmación → worker valida (magic bytes, tamaño, opcional antivirus) → `available`. Descarga vía presigned GET de TTL corto tras autorización.
- Claves: `ws/<workspaceId>/<context>/<uuidv7>`; nunca nombres de archivo del usuario en la key.

## Análisis de opciones

### Local

| Opción | Pros | Contras | Licencia | Complejidad |
|---|---|---|---|---|
| MinIO CE | Máxima compatibilidad S3 conocida; consola | Imágenes/binarios oficiales discontinuados (oct 2025), repo archivado (abr 2026): habría que compilar de fuente congelada o usar imágenes de terceros; sin parches | AGPLv3 | Media (build propia) y riesgo de seguridad |
| **Garage** | Ligero (Rust), un binario, imagen oficial, activo (v2.x 2026); presigned URLs soportadas | Subconjunto de API S3 (sin algunas features: p. ej. ciertas políticas/ACLs, versioning limitado); configuración inicial (layout, keys) requiere script | AGPLv3 (uso sin modificar: sin obligación para nosotros) | Baja-media |
| **SeaweedFS** | Maduro (2012+), S3 gateway amplio, Apache 2.0 | Arquitectura con master/volume/filer: más piezas aunque existe modo `server` all-in-one; más memoria | Apache 2.0 | Media |
| RustFS | API muy compatible, consola, Apache 2.0 | 1.0 aún en RC (ago 2026) | Apache 2.0 | Baja; riesgo de madurez |
| LocalStack S3 | Emula AWS fielmente | Orientado a tests; imagen pesada; licencias/planes cambiantes | Mixta | Media |
| Filesystem adapter | Cero dependencias | Sin presigned URLs reales → rompe paridad | n/a | Baja, paridad nula |

### Cloud
- **Amazon S3:** durabilidad 11 nueves, ~USD 0.023/GB-mes (Standard), costos irrelevantes para volúmenes personales (< 10 GB); integración IAM con task roles de ECS (sin claves estáticas). Contra: lock-in leve, mitigado por API S3 y el puerto.
- **GCS (plan B Cloud Run):** API XML compatible con S3 para operaciones básicas y presigned (con HMAC keys); verificar en SPIKE-09 si el adapter S3 basta.

## Consecuencias

**Positivas**
- Código de aplicación independiente del proveedor; cambiar backend = cambiar env vars.
- Binarios fuera de PG: backups de BD pequeños y rápidos.
- Presigned URLs descargan a la API del tráfico de archivos.

**Negativas**
- Un servicio más en Compose; inicialización (bucket, keys) vía script cross-platform.
- Diferencias sutiles de compatibilidad S3 entre backend local y S3 real.

**Riesgos**
- Comportamiento de presigned/headers difiere entre local y AWS. *Mitigación:* suite de contrato del adapter `ObjectStorage` ejecutada contra el backend local (CI) y contra S3 real en staging (smoke).
- Subidas maliciosas. *Mitigación:* `security/file-upload-security` (validación de magic bytes, tamaño, content-disposition attachment, aislamiento por workspace).

## Validación

- **SPIKE-07 (0.5 d):** levantar Garage y SeaweedFS en Compose en Windows/WSL2; probar put/get, presigned PUT/GET desde navegador (CORS), multipart > 5 MB, head, listado por prefijo, footprint de memoria. Criterio: el que pase todo con menor configuración se vuelve default.
- Test de contrato del adapter con Testcontainers.
- Métrica: 0 objetos con ACL pública (AWS Config/check en IaC).

## Notas

- Verificado 2026-10-01 (múltiples fuentes, incl. Wikipedia y análisis de la comunidad): MinIO dejó de publicar imágenes Docker y binarios community en octubre 2025, puso el repo en modo mantenimiento en diciembre 2025 y lo **archivó (read-only) el 2026-04-25**; el código sigue siendo AGPLv3 pero solo como fuente congelada. MinIO comercial (AIStor) es otro producto.
- Verificado 2026-10-01: Garage v2.3.0 (2026-04-16, AGPLv3); SeaweedFS Apache 2.0, maduro; RustFS 1.0.0-rc.3 (2026-08-21, Apache 2.0, sin 1.0 estable).
- ARCHITECTURE §10 nombra el servicio `object-storage` "MinIO o alternativa"; esta ADR mantiene esa redacción y solo cambia la preferencia a "alternativa salvo que SPIKE-07 demuestre lo contrario".

## Resultado del spike (SPIKE-07, 2026-10-01)

Informe completo y evidencia: [spikes/SPIKE-07-object-storage/README.md](../../spikes/SPIKE-07-object-storage/README.md). Docker Desktop 29.8.1 (WSL2), `@aws-sdk/client-s3` 3.1145.0, un backend a la vez.

| | SeaweedFS 4.48 (`mini`) | Garage v2.4.1 | RustFS 1.0.0 |
|---|---|---|---|
| Suite S3 (23 checks: presigned PUT con Content-Type/Content-Length firmados, presigned POST con `content-length-range`, presigned GET con expiración y `attachment`, HEAD, `x-amz-checksum-sha256`, CORS, versioning, multipart 50 MiB con partes presignadas, delete, persistencia) | **23/23** | 18 PASS, 3 WARN (400 en vez de 403), **2 FAIL: sin versioning** | 23/23 |
| CORS en navegador real (origen permitido / no permitido) | OK / bloqueado | OK / bloqueado | OK / bloqueado |
| Arranque frío → healthy | 4.1 s | 2.3 s | 8.8 s |
| Memoria idle / tras carga | 70 / 363 MiB (112 MiB con `GOMEMLIMIT=200MiB`, límite 256m) | 7 / 12 MiB | 121 / 150 MiB |
| Imagen comprimida | 92 MB | 26 MB | 109 MB |
| Licencia | Apache-2.0 | AGPL-3.0 | Apache-2.0 |

**Recomendación (para aceptación del owner):** backend local por defecto **SeaweedFS** `chrislusf/seaweedfs:4.48@sha256:4e61d15fd35994cb1e43e1e553dff106794841fd9a99ade2fc8c8bfce4d7872d` en modo `mini`, con `GOMEMLIMIT` + límite de memoria y init idempotente one-shot (`head-bucket || create-bucket`, CORS, versioning). Plan B: RustFS (reevaluar con 1.0.x más maduro). Garage descartado como default por no soportar versioning (requisito de DR y de paridad con S3 prod).

**Decisiones de diseño que salen del spike (aplican a cualquier backend y a AWS):**
- El adapter S3 debe fijar `requestChecksumCalculation`/`responseChecksumValidation = 'WHEN_REQUIRED'`: con el default del SDK el presigned PUT incluye un CRC32 inválido y falla (SeaweedFS/Garage; RustFS no lo valida).
- Presigned PUT: firmar `content-type` y `content-length` (`signableHeaders`) → tamaño **exacto**; si se necesita rango, presigned **POST** con `content-length-range`. Firmar `x-amz-checksum-sha256` (`unhoistableHeaders`) para detectar archivo sustituido.
- CORS por bucket con origen explícito y `ExposeHeaders: ETag` (necesario para multipart desde navegador).
- Endpoint S3 público (firma de URLs para el navegador) separado del interno.

**Correcciones a esta ADR/docs:** RustFS publicó 1.0.0 estable el 2026-09-16 (la nota "sin 1.0 estable" quedó desactualizada). El puerto de host 9000/9001 previsto en docs/19 colisiona con otro MinIO en la máquina del owner; elegir otro default.
