# Tareas

> DESIGN GATE aprobado el 2026-10-01 (docs/DESIGN-GATE.md). Tareas habilitadas.

## 1. Spikes que desbloquean este change

- [x] 1.1 Ejecutar SPIKE-01 (CLI de OpenSpec en CI) y registrar los flags confirmados de `validate` en docs/23-ci-cd.md; verificar con el log de un workflow de prueba
- [x] 1.2 Ejecutar SPIKE-07 (imagen de object storage) y registrar la decisión en ADR-0009; verificar que PUT/GET presignados funcionan contra la imagen elegida
- [x] 1.3 Ejecutar SPIKE-08 (Compose en Windows/WSL2) y registrar hallazgos en docs/19-local-development.md; verificar que se midió el tiempo de arranque hasta healthy

## 2. Skeleton del repositorio

- [ ] 2.1 Crear workspace pnpm + Turborepo, tsconfig raíz estricto, ESLint/Prettier, `.editorconfig`; verificar que `pnpm install && pnpm turbo run typecheck` pasa
- [ ] 2.2 Crear `packages/shared-kernel` y `packages/platform` vacíos con carpetas por capa; verificar que los paquetes compilan
- [ ] 2.3 Crear el host NestJS `apps/api` con entrypoints `api`, `worker`, `migrate`, `seed` (sin módulos de negocio); verificar que cada uno arranca y termina/sirve según lo esperado
- [ ] 2.4 Crear el shell Next.js `apps/web` con ruta de salud; verificar que compila en modo standalone
- [ ] 2.5 Configurar i18n del web shell con español como locale por defecto y catálogos preparados para `en` y `pt`; verificar que cambiar de locale no rompe el build

## 3. Observabilidad base (platform/observability)

- [ ] 3.1 Redactar los TC de liveness/readiness/correlación/redacción de logs en tests/cases/platform; verificar que el chequeo del catálogo los acepta
- [ ] 3.2 Implementar `/health/live` y `/health/ready` con chequeo de dependencias (PG, object storage; Valkey solo si está habilitado por `JOB_QUEUE_DRIVER`/`SESSION_STORE`); verificar con tests de integración nombrados con sus TC-ids
- [ ] 3.3 Implementar logging JSON estructurado con propagación del ID de correlación API → worker y redacción de tokens; verificar con tests nombrados con sus TC-ids

## 4. Contenedores y stack local (platform/local-environment)

- [ ] 4.1 Redactar los TC de salud del stack, arranque por readiness, reset+seed, ida y vuelta backup/restore y ausencia de hosts fijos
- [ ] 4.2 Crear Dockerfiles multi-stage (`docker/api.Dockerfile`, `docker/web.Dockerfile`), non-root y con healthchecks; verificar que las imágenes compilan y corren como non-root
- [ ] 4.3 Crear `deploy/compose/compose.yaml` con perfiles `deps`, `core`, `seed`, `observability`, `ml`, volúmenes nombrados y `depends_on` por salud; verificar que `pnpm stack:up` llega a todo healthy en Windows y en CI Linux
- [ ] 4.4 Crear `.env.example` (sin secretos, puertos `PF_*` con defaults 2xxxx en 127.0.0.1), `pnpm setup:env`, el esquema de configuración validado al arrancar (docs/19 §0.3) e import del realm de desarrollo de Keycloak; verificar que gitleaks no reporta hallazgos y que el arranque falla con una variable faltante
- [ ] 4.5 Crear la migración SQL de bootstrap (schema `platform`, roles `pf_migrator`/`pf_app` sin BYPASSRLS); verificar que `migrate` termina y que el rol de app no puede saltarse RLS
- [ ] 4.6 Implementar scripts multiplataforma (`stack:up|down|restart|logs|reset`, `db:migrate`, `db:seed`, `backup:local`, `restore:local`) y verificarlos en Windows; automatizar el test de ida y vuelta backup/restore
- [ ] 4.7 Implementar apagado ordenado de api y worker; verificar con un test que envía SIGTERM a mitad de un job

## 5. Quality gate y entrega (platform/delivery-pipeline)

- [ ] 5.1 Redactar los TC de gate de OpenSpec, gate de arquitectura, gate de CVE crítico y promoción por digest
- [ ] 5.2 Agregar reglas de dependency-cruiser y un fixture que falle a propósito; verificar que el chequeo falla ante un import domain→infrastructure
- [ ] 5.3 Agregar `.github/workflows/pr.yml` con todos los chequeos requeridos (OpenSpec strict, formato, lint, typecheck, unit, integración con Testcontainers, arquitectura, build, Trivy, escaneo de dependencias, gitleaks); verificar en una PR de prueba
- [ ] 5.4 Agregar `main.yml` que publique imágenes con tag `sha-<commit>` y registre digests; verificar que un segundo job descarga por digest sin reconstruir
- [ ] 5.5 Configurar branch protection con chequeos requeridos; verificar que un chequeo fallido bloquea el merge

## 6. Trazabilidad de tests (quality/test-traceability)

- [ ] 6.1 Implementar `scripts/traceability` (validación del schema del catálogo, búsqueda de TC-ids en tests, cobertura de Must, chequeo de TC activo borrado) con TDD, verificando con tests unitarios sobre fixtures
- [ ] 6.2 Generar `tests/traceability/matrix.md` y `.json` en CI como artefactos; verificar que listan todos los TC catalogados

## 7. Cierre

- [ ] 7.1 Actualizar docs/19, docs/20, docs/23 y el README con los comandos tal como quedaron; verificar que cada comando documentado funciona tal cual en Windows
- [ ] 7.2 Actualizar estados de automatización de los TC, regenerar la matriz, ejecutar `openspec validate --all --strict` y archivar el change
