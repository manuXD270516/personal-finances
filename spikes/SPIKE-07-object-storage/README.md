# SPIKE-07 — Object storage local S3-compatible (SeaweedFS vs Garage vs RustFS)

> Código **descartable**. Evidencia para [ADR-0009](../../docs/adr/0009-object-storage.md). Ejecutado el 2026-10-01 (UTC 2026-10-02 ~01:10–01:30) en Windows 11 + Docker Desktop 29.8.1 (WSL2), Node v22.23.1, `@aws-sdk/client-s3` 3.1145.0.

## 1. Pregunta

MinIO community está archivado y sin imágenes oficiales. ¿Qué backend S3 local usar en Compose (`object-storage`) para tener paridad con Amazon S3 en el flujo de [docs/12-security.md §8](../../docs/12-security.md) y [docs/07 §4.2](../../docs/07-c4-architecture.md): presigned PUT con Content-Type/tamaño restringidos subido directo desde el navegador (CORS), HEAD de tamaño/ETag/checksum, presigned GET de TTL corto con `Content-Disposition: attachment`, multipart, versioning (para DR, [docs/30](../../docs/30-backup-and-disaster-recovery.md)) y persistencia en volumen nombrado?

Candidatos (imágenes oficiales, fijadas por versión **y digest**):

| Backend | Imagen | Digest | Estado upstream (verificado 2026-10-01) |
|---|---|---|---|
| SeaweedFS | `chrislusf/seaweedfs:4.48` | `sha256:4e61d15f…d4872d` | Release estable 2026-09-28; cadencia ~semanal; repo activo, Apache-2.0 |
| Garage | `dxflrs/garage:v2.4.1` | `sha256:9c96caa2…d0d020` | Release 2026-09-08; repo activo (git.deuxfleurs.fr), AGPL-3.0 |
| RustFS | `rustfs/rustfs:1.0.0` | `sha256:8cc98017…f4d1ff` | **1.0.0 estable publicada 2026-09-16** (la ADR decía "sin 1.0 estable": quedó desactualizado); ya hay `1.0.1-preview.*`; Apache-2.0 |

Init de buckets: `amazon/aws-cli:2.37.8@sha256:420ab345…6398c` (one-shot) — igual para los tres.

## 2. Setup

```
spikes/SPIKE-07-object-storage/
├─ compose.yaml            # 3 perfiles (seaweedfs | garage | rustfs), cada uno con su *-init one-shot
├─ compose.limits.yaml     # override: SeaweedFS con límite 256m + GOMEMLIMIT
├─ config/
│  ├─ cors.json            # CORS: solo http://localhost:61600, GET/PUT/POST/HEAD, expone ETag/x-amz-version-id/x-amz-checksum-sha256
│  ├─ seaweedfs-s3.json    # identidad S3 de SeaweedFS
│  └─ garage.toml          # Garage single-node (rpc_secret/admin_token por env)
├─ scripts/init-bucket.sh  # idempotente: head-bucket || create-bucket; put-bucket-cors; put-bucket-versioning
├─ src/
│  ├─ backends.ts          # endpoints/credenciales de prueba
│  ├─ s3-suite.ts          # suite PASS/FAIL/WARN (23 checks) + fases de persistencia
│  ├─ run-all.ts           # orquestador: arranque medido, memoria, suite, restart/recreate
│  ├─ browser-check.ts     # página en http://localhost:61600 para probar CORS en navegador real
│  ├─ extra-checks.ts      # lifecycle + SSE-S3 por defecto
│  ├─ cleanup-sse.ts       # revierte SSE por defecto (ver hallazgo RustFS)
│  └─ sdk-default-checksum.ts  # efecto del CRC32 por defecto del SDK en presigned PUT
└─ results/                # evidencia (logs y JSON)
```

Puertos de host (solo `127.0.0.1`): SeaweedFS S3 **61733**, Garage S3 **61790** (+ admin 61793), RustFS S3 **61720**, página de prueba **61600**. Proyecto Compose `pf-spike-07`. No se tocó ningún contenedor ajeno (el MinIO de otro proyecto en 9000/9001 siguió intacto).

Credenciales: valores de prueba hardcodeados en `compose.yaml`/`backends.ts`, válidos solo para este spike.

## 3. Comandos ejecutados

```bash
cd spikes/SPIKE-07-object-storage
npm install
# Git Bash en Windows: export MSYS_NO_PATHCONV=1 (si no, '/garage' se convierte en 'C:/Program Files/Git/garage')
npx tsx src/run-all.ts                 # 1 backend a la vez: down -v → up → healthy → init → 30 s idle → stats → suite → restart → down/up → persist-check
docker compose -p pf-spike-07 --profile seaweedfs --profile garage --profile rustfs up -d --wait
npx tsx src/s3-suite.ts <seaweedfs|garage|rustfs>   # suite individual
npx tsx src/extra-checks.ts && npx tsx src/cleanup-sse.ts
npx tsx src/sdk-default-checksum.ts
npx tsx src/browser-check.ts           # abrir http://localhost:61600 y http://127.0.0.1:61600 (origen no permitido)
docker compose -p pf-spike-07 -f compose.yaml -f compose.limits.yaml --profile seaweedfs up -d --wait seaweedfs
docker compose -p pf-spike-07 --profile seaweedfs --profile garage --profile rustfs down -v   # teardown
```

## 4. Resultados

### 4.1 Compatibilidad funcional (`src/s3-suite.ts`, fetch de Node "como navegador")

| Check | SeaweedFS 4.48 | Garage v2.4.1 | RustFS 1.0.0 |
|---|---|---|---|
| Buckets creados por init; re-ejecución idempotente ("ya existe") | PASS | PASS | PASS |
| Presigned PUT firma `content-type;content-length;host` | PASS | PASS | PASS |
| Subida con `fetch` | PASS 200 | PASS 200 | PASS 200 |
| Rechaza Content-Type distinto | PASS 403 | PASS 403 | PASS 403 |
| Rechaza cuerpo de otro tamaño (Content-Length firmado) | PASS 403 | PASS 403 | PASS 403 |
| Rechaza sin Content-Type | PASS 403 | **WARN 400** (rechaza, código ≠ AWS) | PASS 403 |
| HEAD: tamaño, ETag = MD5, Content-Type | PASS | PASS | PASS |
| ListObjectsV2 por prefijo `ws/<id>/` | PASS | PASS | PASS |
| Presigned GET + `response-content-disposition=attachment` | PASS | PASS | PASS |
| Presigned GET expira (TTL 2 s, reintento a +5 s) | PASS 403 `Request has expired` | **WARN 400** `Date is too old` (expira, código ≠ AWS) | PASS 403 |
| Presigned **POST** policy, dentro de `content-length-range` | PASS 204 | PASS 204 | PASS 204 |
| POST policy excede rango → rechazado y objeto no creado | PASS 400 `EntityTooLarge` | PASS 400 `InvalidRequest` | PASS 400 `EntityTooLarge` |
| `x-amz-checksum-sha256` correcto + HEAD `ChecksumMode=ENABLED` lo devuelve | PASS | PASS | PASS |
| Checksum incorrecto (SDK) rechazado | PASS `BadDigest` | PASS `InvalidDigest` | PASS `BadDigest` |
| Presigned PUT con checksum firmado: cuerpo manipulado (mismo tamaño) rechazado | PASS 400 | PASS 400 | PASS 400 |
| GetBucketCors | PASS | PASS | PASS |
| Preflight origen permitido (`ACAO=http://localhost:61600`) | PASS | PASS | PASS |
| Preflight origen no permitido | PASS 403 sin ACAO | **WARN** 403 con `ACAO: *` (el navegador lo bloquea igual por status) | PASS 403 sin ACAO |
| PUT real con Origin expone `ETag` (Access-Control-Expose-Headers) | PASS | PASS | PASS |
| Versioning `Enabled` | PASS | **FAIL** `NotImplemented: PutBucketVersioning` | PASS |
| 2 versiones, leer v1 por VersionId, delete marker, HEAD 404, v2 recuperable | PASS | **FAIL** (no soportado) | PASS |
| Multipart 50 MiB (5×10 MiB) con **partes presignadas** subidas por fetch; ETag `…-5`; SHA-256 de descarga idéntico | PASS (~71 MiB/s) | PASS (~87 MiB/s) | PASS (~86 MiB/s) |
| Delete → HEAD 404 | PASS | PASS | PASS |
| Persistencia tras `restart` (volumen nombrado) | PASS (objeto + CORS) | PASS | PASS |
| Persistencia tras `down` (sin -v) + `up` (contenedor recreado) | PASS | PASS | PASS |
| **Total suite** | **23 PASS** | **18 PASS, 3 WARN, 2 FAIL** | **23 PASS** |

Extra (`results/extra-checks.log`):

| Check | SeaweedFS | Garage | RustFS |
|---|---|---|---|
| Lifecycle (AbortIncompleteMultipartUpload 7 d + Expiration por prefijo) | PASS | PASS | PASS |
| Lifecycle `NoncurrentVersionExpiration` | PASS | aceptado (sin versioning: sin efecto) | PASS |
| SSE-S3 por defecto del bucket (`PutBucketEncryption AES256`) | aceptado; PUTs siguen OK | `NotImplemented` | **aceptado, pero luego TODOS los PUT fallan 400** (`SSE-S3 requires RUSTFS_SSE_S3_MASTER_KEY…`) hasta `DeleteBucketEncryption` |

### 4.2 Navegador real (Chromium, `results/browser-check.txt`)

- Origen `http://localhost:61600`: en los 3 backends PUT presignado (con `content-type`, `content-length` y `x-amz-checksum-sha256` firmados) → 200, `ETag` legible desde JS, GET presignado → 200 contenido idéntico, PUT con Content-Type distinto → 403.
- Origen `http://127.0.0.1:61600` (no permitido): los 3 bloqueados por CORS en el preflight ("No 'Access-Control-Allow-Origin' header" en SeaweedFS/RustFS; "does not have HTTP ok status" en Garage).

### 4.3 Footprint y operación (`results/summary.json`, `results/mem-after-load.log`)

| Métrica | SeaweedFS 4.48 (`mini`) | Garage v2.4.1 | RustFS 1.0.0 |
|---|---|---|---|
| Imagen (comprimida, Docker Hub, amd64) | 92 MB | **26 MB** | 109 MB |
| Imagen local (`docker image inspect .Size`, store containerd) | 724 MB | 99 MB | 400 MB |
| Arranque en frío → S3 responde / healthy (imagen ya descargada, volumen vacío) | 3.8 s / 4.1 s | **2.1 s / 2.3 s** | 8.8 s / 8.8 s |
| Restart → healthy | 4.1 s | 3.9 s | 2.1 s |
| Contenedor recreado (volumen existente) → healthy | 2.2 s | 2.5 s | 2.2 s |
| Init (contenedor aws-cli, 2 buckets + CORS + versioning) | 10.4 s | 8.1 s | 17.9 s* |
| Memoria idle (30 s tras healthy, mediana de 3 muestras) | 70 MiB | **6.9 MiB** | 121 MiB |
| Memoria tras la suite (50 MiB multipart) y +2 min | **363 MiB** (no baja) | 12 MiB | 150 MiB |
| Ídem con `GOMEMLIMIT=200MiB` + límite 256m (`compose.limits.yaml`) | 112 MiB, 23/23 PASS, sin OOM | — | — |
| CPU en reposo (`docker stats`, % de 1 core) | 6–9 % | ~0 % | 0–5 % |
| Configuración necesaria | 1 JSON de identidades + flags | TOML + secretos RPC/admin; `--single-node --default-bucket` evita el bootstrap manual de layout/keys | Solo env (`RUSTFS_ACCESS_KEY/SECRET_KEY`) |
| Licencia | Apache-2.0 | AGPL-3.0 | Apache-2.0 |

\* el init incluye arranque del contenedor aws-cli (Python, ~5–7 s fijo); en RustFS además esperó a que S3 aceptara `ListBuckets`.

### 4.4 Hallazgos transversales (valen para cualquier backend)

1. **SDK v3 ≥ 3.729 rompe presigned PUT por defecto**: sin `requestChecksumCalculation: 'WHEN_REQUIRED'` el presigner añade `x-amz-checksum-crc32` (del cuerpo vacío) y `x-amz-sdk-checksum-algorithm` a la URL → SeaweedFS 400 `BadDigest`, Garage 400 `InvalidDigest` (como haría S3). **RustFS lo acepta (200)**, es decir, *no valida* ese checksum en query: menos paridad con AWS (`results/sdk-default-checksum.log`). El adapter `ObjectStorage` debe fijar `requestChecksumCalculation`/`responseChecksumValidation = 'WHEN_REQUIRED'`.
2. **Tamaño con presigned PUT**: S3 no tiene "content-length-range" en PUT; firmar `content-length` (opción `signableHeaders` de `getSignedUrl` + `ContentLength` en el comando) fija el tamaño **exacto** declarado por la API, y los 3 backends lo hacen cumplir (403). El navegador no puede falsear `Content-Length` (lo calcula del body). Si se necesita un rango (tamaño desconocido), usar **presigned POST** con `content-length-range`, que los 3 soportan.
3. **Checksum extremo a extremo**: firmar `x-amz-checksum-sha256` (`unhoistableHeaders`) obliga al navegador a enviar el SHA-256 declarado al crear el `Document`; los 3 rechazan cuerpo manipulado y devuelven el checksum en HEAD → cubre "Archivo sustituido → checksum SHA-256 firmado en la URL" de docs/12 §STRIDE.
4. **CORS multipart**: para que el navegador complete multipart necesita leer `ETag` de cada parte → `ExposeHeaders: ["ETag"]` en la regla CORS (incluido en `config/cors.json`).
5. **Git Bash**: `MSYS_NO_PATHCONV=1` es necesario para comandos `docker run … /garage …`; refuerza ADR-0012 (scripts en Node, no bash).

## 5. Recomendación

**Default local: SeaweedFS `chrislusf/seaweedfs:4.48@sha256:4e61d15fd35994cb1e43e1e553dff106794841fd9a99ade2fc8c8bfce4d7872d`, modo `mini`, con `GOMEMLIMIT` y límite de memoria.**

- Es el único candidato **maduro** (desde 2012, releases estables semanales) que pasó **23/23**, incluido **versioning** (requisito de DR en docs/30 §1 y del STRIDE de docs/12), códigos de error alineados con AWS (403 `SignatureDoesNotMatch`/`AccessDenied`, 400 `BadDigest`/`EntityTooLarge`) y validación estricta de checksums (más paridad que RustFS).
- Apache-2.0, imagen oficial, init trivial con `aws-cli` (y `-bucket=` nativo de `weed mini` como alternativa sin contenedor extra).
- Coste: más memoria/CPU que Garage. Mitigación medida: `GOMEMLIMIT=200MiB` + `memory: 256m` → 112 MiB tras carga, sin OOM y 23/23 PASS. Desactivar componentes no usados (`-webdav=false -admin.ui=false -s3.port.iceberg=0 -s3.port.lance=0`).

**Plan B: RustFS 1.0.0** (23/23, sencillo, Apache-2.0) — reevaluar cuando tenga ≥ 3 meses de 1.0.x estable: hoy 1.0.0 tiene 2 semanas, arranque en frío más lento, no valida el checksum CRC32 de query (diverge de AWS) y acepta un `PutBucketEncryption` que después bloquea todas las escrituras.

**Garage: descartado como default** pese a ser el más ligero (7 MiB, 26 MB) porque **no implementa versioning** (rompe la paridad con la configuración de S3 en prod y las pruebas de restauración de versiones), ni SSE por defecto, y usa códigos 400 donde AWS usa 403. Sería válido si se decidiera no probar versioning en local. AGPL-3.0 sin modificación ni distribución no genera obligaciones, pero añade revisión legal innecesaria.

### Snippet de servicio Compose recomendado (para docs/19)

```yaml
  object-storage:
    <<: *deps-common
    image: chrislusf/seaweedfs:4.48@sha256:4e61d15fd35994cb1e43e1e553dff106794841fd9a99ade2fc8c8bfce4d7872d
    command:
      - mini
      - -dir=/data
      - -s3.port=8333
      - -s3.config=/etc/seaweedfs/s3.json
      - -s3.allowedOrigins=${WEB_ORIGIN:-http://localhost:3000}   # además de la regla CORS por bucket
      - -webdav=false
      - -admin.ui=false
      - -s3.port.iceberg=0
      - -s3.port.lance=0
    environment:
      GOMEMLIMIT: 200MiB
    volumes:
      - object-storage-data:/data
      - ./object-storage/s3.json:/etc/seaweedfs/s3.json:ro   # generado desde plantilla por el script de setup (credenciales de .env)
    ports:
      - "127.0.0.1:${HOST_PORT_OBJECT_STORAGE:-<puerto libre>}:8333"   # ver Riesgos: 9000 choca con otro MinIO del owner
    healthcheck:
      test: ["CMD", "wget", "-q", "-O", "/dev/null", "http://127.0.0.1:8333/healthz"]
      interval: 10s
      timeout: 3s
      retries: 5
      start_period: 60s
      start_interval: 1s
    deploy:
      resources:
        limits: { cpus: "1.0", memory: 256m }

  object-storage-init:
    image: amazon/aws-cli:2.37.8@sha256:420ab345e847291b541b45d989535f55bcff957c27fa1100fae4aa233e86398c
    entrypoint: ["/bin/sh", "/init/init-bucket.sh"]   # head-bucket || create-bucket; put-bucket-cors; put-bucket-versioning (añadir lifecycle: probado OK)
    restart: "no"
    environment:
      S3_ENDPOINT: http://object-storage:8333
      AWS_ACCESS_KEY_ID: ${OBJECT_STORAGE_ACCESS_KEY:?}
      AWS_SECRET_ACCESS_KEY: ${OBJECT_STORAGE_SECRET_KEY:?}
      AWS_REGION: us-east-1
      AWS_REQUEST_CHECKSUM_CALCULATION: when_required
      BUCKETS: "pfos-local-documents pfos-local-exports pfos-local-imports"
    volumes:
      - ./object-storage/init-bucket.sh:/init/init-bucket.sh:ro
      - ./object-storage/cors.json:/init/cors.json:ro
    depends_on:
      object-storage: { condition: service_healthy }
```

Los servicios que dependan de buckets listos usan `depends_on: { object-storage-init: { condition: service_completed_successfully } }`.

Config del adapter (`@pf/platform`): `forcePathStyle: true`, `requestChecksumCalculation/responseChecksumValidation: 'WHEN_REQUIRED'`, presign PUT con `signableHeaders: ['content-type','content-length']` y `unhoistableHeaders: ['x-amz-checksum-sha256']`; dos clientes/endpoint: interno (`http://object-storage:8333`, para HEAD/worker) y público (`OBJECT_STORAGE_PUBLIC_ENDPOINT`, para firmar URLs que usa el navegador — el host forma parte de la firma).

## 6. Riesgos

| Riesgo | Mitigación |
|---|---|
| Memoria de SeaweedFS crece con cargas grandes (363 MiB sin límite y no la devuelve) | `GOMEMLIMIT` + `deploy.resources.limits.memory` (probado 256m) |
| CPU de fondo de `weed mini` (6–9 % de un core en reposo) | Aceptable en dev; `docker compose stop object-storage` si no se usa |
| Cadencia de releases muy alta de SeaweedFS (semanal) → cambios de comportamiento | Fijar tag + digest; Renovate con suite de contrato del adapter (esta suite es la base) en CI antes de subir versión |
| Divergencias de códigos de error/validaciones entre backend local y AWS | Suite de contrato contra S3 real en staging (ADR-0009 §Riesgos); mapear errores por familia (4xx) en el adapter, no por código exacto |
| Host del presigned URL: debe ser alcanzable por el navegador y coincidir con el firmado | Endpoint público separado del interno (ver arriba); cerrar con SPIKE-06/08 |
| **Puerto por defecto 9000/9001 de docs/19 colisiona con el MinIO de otro proyecto del owner** | Cambiar el default de `HOST_PORT_OBJECT_STORAGE` a un puerto libre y no exponer UI admin (deshabilitada) |
| `PutBucketEncryption` sin efecto real / con efecto bloqueante según backend | En local no configurar SSE de bucket; SSE solo en IaC de AWS |
| Init con imagen aws-cli añade ~140 MB de descarga y ~6 s | Alternativa: flag `-bucket=` de `weed mini` + script Node (`pnpm dev:init`) con el mismo SDK |

## 7. Licencias

- **SeaweedFS**: Apache-2.0 (GitHub `seaweedfs/seaweedfs`, licencia detectada `Apache-2.0`). Sin obligaciones relevantes para uso local.
- **Garage**: AGPL-3.0. Uso sin modificar y sin distribuirlo con el producto → sin obligaciones para PFOS; igualmente descartado por funcionalidad.
- **RustFS**: Apache-2.0 (label de la imagen y GitHub).
- **amazon/aws-cli**: Apache-2.0 (herramienta de init, no se distribuye).
- **@aws-sdk/***: Apache-2.0.

## 8. Impacto en ADRs/docs

- ADR-0009: añadida sección **Resultado del spike**; Estado sigue *Propuesto*. Corregir la nota "RustFS sin 1.0 estable" (1.0.0 salió el 2026-09-16).
- docs/19 §4/§5.2: reemplazar el snippet `object-storage` por el de §5 (digest real, flags, healthcheck `/healthz` confirmado, sin UI admin) y revisar el puerto por defecto 9000/9001.
- docs/12 §8: documentar que el límite de tamaño en presigned PUT es **exacto** (content-length firmado) y que el rango requiere presigned POST.
- docs/30: versioning local viable con SeaweedFS (permite ensayar "restaurar versión previa").
