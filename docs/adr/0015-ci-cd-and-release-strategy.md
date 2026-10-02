# ADR-0015: CI/CD y estrategia de release — GitHub Actions, trunk-based, Conventional Commits, release-please, imágenes inmutables

- Estado: Propuesto
- Fecha: 2026-10-01
- Decisores: Owner (Product/Tech Lead)
- Relacionado: docs/ARCHITECTURE.md §5, §11; ADR-0011, ADR-0013, ADR-0014, ADR-0016, ADR-0018, ADR-0024; OpenSpec capability `platform/delivery-pipeline`; SPIKE-01

## Contexto y problema

Un sistema financiero mantenido por una persona necesita que el pipeline sea el "segundo revisor": cada cambio debe pasar formato, lint, tipos, validación de specs, reglas de arquitectura, tests de dominio/integración, build y escaneo de imágenes antes de mezclar; y el despliegue debe promover **la misma imagen** de staging a producción con migraciones seguras y rollback simple. Hay que elegir plataforma de CI/CD, modelo de branching, convención de commits/versionado y flujo de promoción.

## Drivers de decisión

- Integración con el hosting del repo (GitHub).
- Costo (minutos gratuitos/repos privados).
- Seguridad (OIDC a la nube, sin secretos estáticos; permisos mínimos).
- Velocidad de feedback (cache, Turborepo affected).
- Trazabilidad release ↔ cambios ↔ specs.
- Simplicidad para 1 persona.

## Opciones consideradas

**Plataforma:** 1. GitHub Actions (elegida) · 2. GitLab CI · 3. CircleCI/Buildkite · 4. AWS CodePipeline/CodeBuild.

**Branching:** A. Trunk-based con PRs cortos (elegida) · B. GitFlow · C. GitHub Flow con ramas largas por feature.

**Versionado/release:** i. Conventional Commits + release-please (elegida) · ii. semantic-release · iii. Changesets · iv. Versionado manual.

## Decisión

- **GitHub Actions** con workflows en `.github/workflows/`, permisos `contents: read` por defecto, acciones de terceros pinneadas por SHA, autenticación a AWS (y GCP si plan B) vía **OIDC**.
- **Trunk-based**: `main` siempre desplegable; PRs pequeños y de vida corta; feature flags para trabajo incompleto; branch protection con checks requeridos.
- **Conventional Commits** (validados con commitlint en PR title/commits) y **release-please** para changelog, tags semver y release notes. Versionado del producto como un todo (un número de versión para el monorepo desplegable), con changelog por paquete si aporta.
- **Pipeline de PR** (ARCHITECTURE §11), ordenado de lo barato a lo caro y paralelizado con Turborepo (`--affected`):
  1. format (Prettier/Biome check) → lint (ESLint) → typecheck
  2. `openspec validate --strict` (ADR-0024)
  3. architecture tests (dependency-cruiser + tests SQL de fronteras)
  4. unit/domain (Vitest) + property-based
  5. integration (Testcontainers: PG, Valkey, S3)
  6. contract checks (Spectral/Redocly sobre OpenAPI, JSON Schema de eventos, compatibilidad)
  7. build de imágenes → **Trivy** (imagen + IaC) + dependency scan (`pnpm audit`/OSV) + SBOM
  8. E2E smoke con Compose (Playwright) — en PR si toca web/api, siempre en `main`
  9. Matriz de trazabilidad generada (ADR-0024) como artefacto
- **Merge a `main`:** build y push de imágenes con tag inmutable `sha-<git-sha>` a ECR (o registro elegido) → deploy automático a **staging** por **digest** → job `migrate` (solo migraciones *expand*) → smoke tests → **aprobación manual** (GitHub Environment `production` con reviewer = owner) → producción con el mismo digest.
- **Release:** release-please abre PR de release; al mergearlo se crea tag semver y se añade el tag `vX.Y.Z` a las imágenes ya construidas (sin rebuild).
- **Migraciones destructivas (contract):** marcadas explícitamente; job separado con aprobación manual y solo después de que la versión que ya no usa la estructura está en producción.
- **Rollback:** redeploy del digest anterior (las migraciones expand son compatibles hacia atrás por diseño).
- Dependencias: **Renovate** con agrupación y automerge solo de patch de dev-deps con CI verde.

## Análisis de opciones

### Plataforma
- **GitHub Actions (elegida):** *Pros:* nativo del repo, marketplace, OIDC a AWS/GCP, environments con aprobación, cache. *Contras:* minutos limitados en privados (2 000/mes free), YAML verboso, supply chain de acciones (mitigado pinneando SHA). *Costo:* 0–bajo. *Complejidad:* baja.
- **GitLab CI:** excelente pero requiere mover el repo o mirroring. *Complejidad:* media.
- **CircleCI/Buildkite:** potentes, costo adicional y otra integración. *Complejidad:* media.
- **CodePipeline/CodeBuild:** integra con AWS pero DX pobre, lock-in, no sirve para el plan B. *Complejidad:* media-alta.

### Branching
- **Trunk-based:** integración continua real, menos conflictos; requiere feature flags y tests sólidos. Ideal para 1 persona.
- **GitFlow:** ramas `develop`/`release` innecesarias, merges complejos; descartado.
- **Ramas largas:** integración tardía; descartado.

### Versionado
- **release-please:** PR de release revisable, no publica nada sin merge; soporta monorepo. *Contra:* configuración inicial.
- **semantic-release:** publica en cada merge, menos control, orientado a librerías npm.
- **Changesets:** ideal para librerías publicadas con versiones por paquete; aquí los paquetes no se publican.
- **Manual:** propenso a olvidos.

## Consecuencias

**Positivas**
- El pipeline impone calidad, arquitectura y specs de forma automática.
- La misma imagen (por digest) recorre staging → prod; rollback trivial.
- Changelog y versiones automáticos y trazables.

**Negativas**
- Pipeline largo (objetivo PR < 15 min) que requiere cache y paralelización.
- Mantenimiento de workflows YAML.

**Riesgos**
- Minutos de CI agotados. *Mitigación:* `--affected`, cache de Turborepo remoto opcional, E2E solo cuando aplica; evaluar runners self-hosted si hace falta.
- Migración incompatible desplegada. *Mitigación:* expand/contract obligatorio + test de compatibilidad (versión N−1 de la app contra esquema N en CI).
- Supply chain (acción comprometida). *Mitigación:* SHA pinning, permisos mínimos, Renovate.

## Validación

- SPIKE-01: `openspec validate --strict` integrado como check requerido.
- Métricas DORA simplificadas: lead time PR→prod < 1 día; change failure rate < 15%; MTTR (rollback) < 15 min; duración p50 del pipeline de PR < 15 min.
- Ensayo de rollback en staging antes del primer release a producción.

## Notas

- Límites y precios de GitHub Actions para repos privados: a verificar al configurar (no verificado por web en esta redacción).
- Se podrá usar GitHub Container Registry en lugar de ECR si el plan B se activa.
