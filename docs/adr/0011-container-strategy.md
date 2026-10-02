# ADR-0011: Estrategia de contenedores — Docker multi-stage, non-root, una imagen por deployable

- Estado: Aceptado (2026-10-02, tras SPIKE-08; decisión del owner)
- Fecha: 2026-10-01
- Decisores: Owner (Product/Tech Lead)
- Relacionado: docs/ARCHITECTURE.md §2, §10, §11; docs/20-container-strategy.md; ADR-0002, ADR-0012, ADR-0013, ADR-0015, ADR-0017, ADR-0018

## Contexto y problema

PFOS tiene tres deployables: `finance-web` (Next.js UI + BFF), `finance-api` (NestJS; procesos `api`, `worker`, y comandos one-shot `migrate`, `seed`) y `finance-ml` (Python/FastAPI, Phase 8). Deben ejecutarse igual en local (Compose), CI y cloud (ECS/Fargate o Cloud Run), con la **misma imagen promovida** entre entornos (ARCHITECTURE §11). Hay que decidir el formato de empaquetado, cómo se construyen las imágenes en un monorepo pnpm, cómo se ejecutan distintos procesos desde una imagen, y los requisitos de seguridad/salud.

## Drivers de decisión

- Paridad local/CI/cloud; inmutabilidad (build once, deploy many).
- Seguridad de supply chain (imagen mínima, non-root, escaneo, SBOM).
- Tamaño y tiempo de build (cache de capas, monorepo).
- Simplicidad: pocos artefactos.
- Compatibilidad con plataformas serverless de contenedores.

## Opciones consideradas

1. **Una imagen por deployable, Dockerfile multi-stage, procesos por comando** (elegida).
2. Una imagen por proceso (`api`, `worker`, `migrate` separados).
3. Imagen "monolítica" única con web + api.
4. Buildpacks (Cloud Native Buildpacks / Nixpacks) sin Dockerfile.
5. Sin contenedores (PaaS de runtime Node, p. ej. despliegue directo de código).

## Decisión

- **Una imagen por deployable:** `finance-web`, `finance-api`, `finance-ml`. Dockerfiles en `docker/`.
- `finance-api` ejecuta distintos procesos por **comando**: `api` (`node dist/main.api.js`), `worker` (`node dist/main.worker.js`), `migrate` (dbmate up con rol migrador), `seed`. *Build once, run with different command.*
- **Multi-stage:** `deps` (pnpm fetch con cache mount) → `build` (`turbo prune --docker` del deployable + build) → `runtime` mínimo (Node LTS slim o distroless; Python slim para ML). Solo dependencias de producción en runtime (`pnpm deploy --prod`).
- **Seguridad:** usuario non-root (UID fijo ≥ 10000), filesystem read-only donde la plataforma lo permita, sin shells/herramientas innecesarias en runtime, base images pinneadas por **digest** y actualizadas por Renovate, `HEALTHCHECK` (o health checks de plataforma), escaneo **Trivy** (vulns + misconfig) y SBOM (Syft/Trivy) en CI, firma de imagen (cosign) como mejora posterior.
- **Salud:** `/health/live` (proceso vivo) y `/health/ready` (PG, Redis/Valkey, storage) en `api`; el worker expone un endpoint ligero de salud o heartbeat file según plataforma.
- **Señales:** PID 1 maneja SIGTERM (Node directo con handlers de graceful shutdown o `tini`).
- **Tags:** `sha-<git-sha>` inmutable + semver en release (ADR-0015); despliegue por digest.
- **Config:** solo env vars (12-factor), sin secretos en la imagen.
- Arquitecturas: `linux/amd64` obligatoria; `linux/arm64` (Graviton, Apple Silicon) multi-arch si el costo de build en CI es asumible.

## Análisis de opciones

### 1. Imagen por deployable + comando por proceso (elegida)
- **Pros:** 3 artefactos; api y worker siempre en la misma versión de código (eventos/outbox coherentes); migración ejecutada con exactamente el mismo código; promoción simple.
- **Contras:** la imagen de api incluye código de worker (tamaño marginal); escalado independiente se hace por servicio de plataforma, no por imagen (válido).
- **Costo:** bajo (1 repositorio ECR por deployable). **Complejidad operativa:** baja.

### 2. Imagen por proceso
- **Pros:** imágenes ligeramente más pequeñas.
- **Contras:** riesgo de desalinear versiones api/worker; más builds y tags.
- **Costo:** medio. **Complejidad:** media.

### 3. Imagen única web+api
- **Pros:** un solo artefacto.
- **Contras:** mezcla runtimes y ciclos (Next.js vs Nest), escalado acoplado, superficie de ataque mayor, contrario al BFF separado.
- **Complejidad:** media; descartada.

### 4. Buildpacks
- **Pros:** sin Dockerfile, imágenes reproducibles con parches de base automáticos.
- **Contras:** soporte de monorepo pnpm/Turborepo frágil; menos control sobre non-root/layers; menos learning value.
- **Costo:** bajo. **Complejidad:** baja-media; menor control.

### 5. Sin contenedores
- **Pros:** cero Dockerfiles.
- **Contras:** rompe paridad local/cloud, Compose y la estrategia de despliegue en ECS/Cloud Run.
- Descartada.

## Consecuencias

**Positivas**
- Misma imagen en todos los entornos; rollback = redeploy del digest anterior.
- Superficie de seguridad controlada y escaneada.

**Negativas**
- Dockerfiles de monorepo requieren cuidado (prune, cache mounts) para builds rápidos.
- Distroless dificulta debugging (sin shell); se usa `debug` tag o contenedor efímero.

**Riesgos**
- Builds lentos en CI. *Mitigación:* BuildKit cache (GitHub Actions cache/registry cache), `turbo prune`.
- Vulnerabilidades en base image. *Mitigación:* Trivy bloqueante para CRITICAL con fix disponible; Renovate para digests.

## Validación

- CI: build de las imágenes, Trivy sin CRITICAL corregibles, `docker run --user` verifica UID non-root, smoke de `/health/ready` en Compose (E2E smoke de ADR-0015).
- Métricas objetivo (a confirmar en Phase 1): imagen `finance-api` < 250 MB, `finance-web` < 200 MB; build incremental en CI < 5 min.

## Notas

- En Phase 0 no se crean Dockerfiles ejecutables (ARCHITECTURE §16); solo fragmentos ilustrativos en docs.
- `finance-ml` (Phase 8) seguirá las mismas reglas (python:3.x-slim, uv para dependencias, non-root).
