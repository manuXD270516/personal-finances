# Propuesta: bootstrap-platform-foundation

## Por qué

Bajo las reglas del proyecto no se puede construir ningún slice funcional hasta contar con una plataforma local reproducible, un quality gate automatizado y una cadena de trazabilidad spec→test funcionando. Este change convierte el diseño de plataforma de Phase 0 (docs/19–23, ADR-0011/0012/0015/0016/0024) en comportamiento verificable. Se aplica **después de aprobar el DESIGN GATE**, como primer paso del Implementation Gate y antes de cualquier capability de negocio de Phase 1.

## Qué cambia

- Se introduce un entorno local en contenedores que se levanta con un solo comando, con perfiles seleccionables (`deps`, `core`, `seed`, `observability`, `ml`), arranque ordenado por salud y volúmenes nombrados persistentes.
- Se introducen endpoints estándar de liveness/readiness en todo contenedor de aplicación; readiness refleja las dependencias críticas.
- Se introduce el quality gate de pull request: validación OpenSpec, formato, lint, typecheck, tests unitarios/de dominio, tests de integración contra dependencias reales, chequeos de fronteras de arquitectura, build de contenedores y escaneos de seguridad.
- Se introduce la promoción *build once*: las imágenes se construyen una vez por commit, con tag inmutable, y se promueven por digest.
- Se introduce el mecanismo de trazabilidad: catálogo de test cases, IDs TC en los nombres de tests automatizados, matriz generada y chequeos de CI que fallan ante enlaces rotos.
- **Fuera de alcance:** cualquier capability de negocio (cuentas, ledger, transacciones…), aprovisionamiento cloud (Terraform sigue solo en diseño hasta aceptar el ADR de cloud), despliegue a producción, tests E2E de navegador más allá de un smoke, dashboards de observabilidad más allá del perfil local opcional.

## Capacidades

### Capacidades nuevas
- `platform/local-environment`: stack local reproducible en contenedores — perfiles, arranque ordenado por salud, configuración por entorno, volúmenes y comandos operativos (start/stop/reset/seed/backup/restore).
- `platform/observability`: endpoints de salud base (liveness/readiness), logs estructurados con IDs de correlación y perfil opcional de telemetría local.
- `platform/delivery-pipeline`: quality gates de pull request y política de promoción de imágenes *build once*.
- `quality/test-traceability`: catálogo versionado de test cases, vínculo por TC-id en tests automatizados y matriz de trazabilidad exigida desde requerimientos hasta tests.

### Capacidades modificadas
- Ninguna (aún no existen capabilities).

## Impacto

**Specs impactadas:** crea `platform/local-environment`, `platform/observability`, `platform/delivery-pipeline`, `quality/test-traceability`.

**Componentes/contextos impactados:** skeleton del repositorio (`apps/api`, `apps/web`, `packages/shared-kernel`, `packages/platform`), `deploy/compose/`, `docker/`, `scripts/`, `.github/workflows/`, `tests/cases/`, `tests/traceability/`. Sin código de dominio de ningún bounded context.

**APIs impactadas:** agrega endpoints operativos `GET /health/live` y `GET /health/ready` (fuera de `/api/v1`, no forman parte del contrato de negocio); sin cambios en los paths de negocio de `contracts/openapi/finance-api.v1.yaml`.

**Tablas impactadas:** bootstrap del schema `platform` vacío y tabla de control de la herramienta de migraciones; ninguna tabla de negocio.

**Eventos impactados:** ninguno.

**Migraciones requeridas:** solo la migración inicial de bootstrap (crear schemas y roles: rol propietario de migraciones y rol de aplicación sin `BYPASSRLS`). No destructiva.

**Test cases:** AÑADIDOS (ya redactados en `tests/cases/platform/`) — TC-PLATFORM-STACK-001, TC-PLATFORM-STACK-002, TC-PLATFORM-PIPELINE-001, TC-PLATFORM-ARCH-001, TC-PLATFORM-ARCH-002, TC-PLATFORM-TRACE-001. AÑADIDOS (a redactar en los grupos de tareas 3–6) — TC-PLATFORM-STACK-003..006 (reset+seed, ida y vuelta backup/restore, sin hosts fijos, apagado ordenado del worker), TC-PLATFORM-OBS-001..003 (liveness, readiness, correlación/redacción de logs), TC-PLATFORM-PIPELINE-002..003 (gate de CVE crítico, promoción por digest), TC-PLATFORM-TRACE-002..004 (TC-id desconocido, requirement Must sin cobertura, borrado de TC activo). MODIFICADOS — ninguno. DEPRECADOS — ninguno.

**Impacto de regresión:** ninguno (no existe comportamiento previo). Desde este change toda PR ejecuta el gate completo; la suite de regresión comienza aquí.

**Riesgos introducidos:** fricción de file-watching y rendimiento en Windows/WSL2 (mitigado con perfil `deps` + hot reload en host, SPIKE-08); imagen de object storage pendiente de SPIKE-07 (RISK-006); deriva de flags del CLI de OpenSpec entre versiones (versión fijada, SPIKE-01).
