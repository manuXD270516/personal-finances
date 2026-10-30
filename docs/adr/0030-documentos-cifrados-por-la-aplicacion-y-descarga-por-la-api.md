# ADR-0030: Documentos cifrados por la aplicación y descarga por la API

- Estado: **Aceptado (2026-10-29)** — decisión del owner D313 (docs/57); matiza a ADR-0009 sin reemplazarlo
- Fecha: 2026-10-29
- Decisores: Owner (Product/Tech Lead)
- Relacionado: Matiza [ADR-0009](0009-object-storage.md); [ADR-0027](0027-destino-de-despliegue-inicial-vps-compose.md); docs/12-security.md §3, §8, §10, §13, §16; docs/01 FR-DOCUMENTS-001..008; docs/02 NFR-SEC-006, NFR-SEC-012; docs/57-phase-6-consolidation-decisions.md (D313–D323); `openspec/changes/add-document-attachments` (decisiones 2, 3, 6 y 7); OpenSpec capabilities `documents/attachments`, `security/file-upload-security`

## Contexto y problema

ADR-0009 fijó el puerto `ObjectStorage` con API S3 (SeaweedFS en local y en el VPS, S3 en cloud) y, con SPIKE-07, el flujo de documentos: **subida** directa del navegador con un presigned PUT, **cifrado en reposo del lado del almacenamiento** (SSE) y **descarga** con un presigned GET de corta duración (FR-DOCUMENTS-004, NFR-SEC-012: GET ≤ 5 min). Además docs/12 §8.4 y la propia ADR-0009 asignaban la verificación del archivo a un job del worker.

Tres hechos del despliegue real (ADR-0027, N1) cambian ese reparto:

1. **No hay cifrado de lado del almacenamiento utilizable.** SeaweedFS no ofrece SSE-KMS validado (SPIKE-07 no lo midió) y su réplica nocturna va a Backblaze B2: sin cifrado propio, los documentos de una réplica quedarían en claro.
2. **El host es de 2 GB y el presupuesto de conexiones es justo.** API 22 + worker 34 = 56 sobre `max_connections = 70` (64 de 67 útiles con pg-boss). Un consumidor nuevo para verificar archivos costaría una conexión del worker.
3. **El almacenamiento no tiene puertos públicos.** Caddy solo publica la app y el IdP; la subida directa exige un endpoint S3 público acotado.

Se necesita decidir cómo se cifran los documentos, cómo se descargan y dónde se verifican.

## Drivers de decisión

- Cifrado en reposo que no dependa de una capacidad del almacenamiento que no existe (NFR-SEC-006).
- Sin URLs de descarga reutilizables: la autorización por workspace debe ocurrir en cada lectura (NFR-SEC-003/004).
- Borrado efectivo también en las réplicas y copias (NFR-COMP-002): el contenido borrado debe quedar ilegible aunque queden copias.
- No tocar el presupuesto de conexiones (ADR-0027).
- Una sola implementación criptográfica en el repositorio (los exports del workspace ya usan cifrado de sobre).

## Opciones consideradas

1. **Cifrado de sobre de la aplicación y descarga en streaming por la API** (sin presigned GET).
2. Presigned GET de 60 s y cifrado solo del lado del almacenamiento.
3. Ambos: cifrado de la aplicación y un proxy de descarga presignado.

Para la verificación: A) síncrona en la confirmación, dentro de la API; B) un consumidor nuevo en el worker.

## Decisión

**Opción 1 + verificación síncrona (A).**

- **Cifrado de sobre de la aplicación.** Cada documento se cifra con una **clave de datos propia** (AES-256-GCM por bloques de 64 KiB, formato `PFXE` v1 de `@pf/platform/crypto`, el mismo de los exports). La clave de datos se **envuelve** con la clave maestra activa de un **llavero propio** (`DOCUMENT_ENCRYPTION_KEYS`, distinto del de exports porque los documentos viven años), con `documents:{workspaceId}:{documentId}` como dato autenticado. `{ key_id, wrapped_key }` vive en `documents.document`, nunca en el bucket. El almacenamiento solo guarda texto cifrado.
- **Descarga solo por la API, siempre como adjunto.** `GET …/documents/{id}/download` autoriza por workspace, **audita antes del cuerpo**, descifra en streaming verificando cada bloque (un byte alterado ⇒ 422 `DOCUMENT_CONTENT_CORRUPTED` sin entregar bytes sin verificar) y responde con `Content-Disposition: attachment`, tipo canónico, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: sandbox; default-src 'none'`, `Cache-Control: private, no-store` y `Repr-Digest`. **No existe ninguna URL de descarga**; los presigned se usan solo para la subida (PUT, ≤ 10 min).
- **Verificación síncrona en `complete`** (no en el worker): fuera de toda transacción de base de datos (HEAD → lectura → suma → inspección por formato → antimalware opcional → cifrado → promoción) con dos unidades de trabajo cortas alrededor. Concurrencia acotada por un semáforo por proceso (2) y el parser de PDF y XLSX corre en un `worker_thread` con límites de memoria y tiempo. El plan B documentado es mover el mismo código (los inspectores son puros) a un consumidor del worker y responder `202`.
- **Crypto-shredding.** Eliminar un documento destruye `wrapped_key` y `key_id` en la misma unidad de trabajo y después borra el objeto **y todas sus versiones**: las copias de la réplica a B2 quedan ilegibles.
- **Cuarentena en un bucket propio sin versioning**, alcanzable solo por `PUT` firmado a través de un hostname dedicado de Caddy (`PF_DOMAIN_FILES`, solo `PUT`/`OPTIONS` firmados sobre ese bucket; 404 para todo lo demás); la réplica a B2 solo cubre el bucket de documentos (cifrado).

## Análisis de opciones

| Opción | Pros | Contras |
|---|---|---|
| 1. Sobre de la aplicación + descarga por API | No depende del almacenamiento; réplicas cifradas; borrado por destrucción de clave; autorización en cada lectura; reutiliza el código de los exports | La API transporta los bytes (CPU/ancho de banda del host); hay que respaldar el llavero |
| 2. Presigned GET + SSE del almacenamiento | La API no transporta los bytes | SeaweedFS no tiene SSE-KMS validado; réplicas en claro; URL reutilizable durante el TTL |
| 3. Ambos | — | Complejidad sin beneficio: el proxy presignado vuelve a emitir URLs de lectura |
| A. Verificación síncrona | Sin consumidor ni conexión nuevos; el motivo de rechazo llega en la misma respuesta | Memoria de la API (acotada); latencia de la confirmación |
| B. Consumidor en el worker | Aísla la carga | +1 conexión del worker (65 de 67 útiles); la UI debe sondear el resultado |

## Consecuencias

**Positivas.** Sin URLs de descarga reutilizables; cifrado en reposo verificable (el objeto leído del almacenamiento no revela el contenido); rotación de la clave maestra sin re-cifrar el contenido (`RewrapDocumentKeys`); un solo formato criptográfico para exports y documentos; ninguna conexión nueva.

**Negativas y riesgos.**
- **La pérdida del llavero implica la pérdida irreversible de todos los documentos.** Debe respaldarse **fuera del host** (gestor de contraseñas del owner o el secreto de despliegue), igual que la clave de pgBackRest; la API y el worker fallan al arrancar si falta una clave en uso (error que nombra la clave).
- **Los backups de la base conservan el envoltorio hasta 12 meses** (fulls mensuales × 12, ADR-0027): el borrado efectivo frente a una restauración completa de la base es ≤ 12 meses.
- Los parsers de formatos no confiables corren en el proceso de la API (en un `worker_thread` con límites, solo de estructura, sin renderizar ni ejecutar); un CVE en ese código se mitiga con la falla cerrada, las actualizaciones automáticas y la entrega solo como adjunto.
- Sin antimalware en producción (el host de 2 GB no aloja ClamAV, D314): rigen la lista de tipos, la inspección estructural y la entrega aislada; ClamAV existe como puerto y adapter y se enciende en la suite del nightly.

## Validación

- Suite de uploads maliciosos TC-SECURITY-UPLOAD-022 (17 casos, 18 con escáner) contra la API y SeaweedFS reales: todos rechazados, nada disponible ni en cuarentena.
- TC-SECURITY-UPLOAD-016: el objeto leído directo del almacenamiento no empieza con la firma del formato; un byte alterado ⇒ `DOCUMENT_CONTENT_CORRUPTED`.
- TC-SECURITY-UPLOAD-017: rotación con documentos existentes y arranque sin una clave en uso.
- Los gates de arquitectura (los contextos se comunican solo por `@pf/<ctx>/contracts`) y el test de arranque del worker (presupuesto de conexiones sin cambios).

## Notas

- 2026-10-29: la verificación se implementa en memoria (hasta 25 MiB por archivo, dos a la vez) en lugar de por bloques; el tope de la memoria es el mismo que ya exigían el PDF y el XLSX (acceso aleatorio). Optimizar el streaming del resto de formatos queda como mejora.
- Este ADR **matiza** ADR-0009 (la descarga deja de ser un presigned GET y el cifrado deja de ser SSE; la verificación deja de ser del worker); el resto de ADR-0009 (puerto `ObjectStorage`, API S3, SeaweedFS, versioning del bucket de documentos, endpoint público separado del interno) sigue vigente.
