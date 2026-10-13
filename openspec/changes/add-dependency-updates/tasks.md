# Tareas

> Sin dominio, aplicación, API, UI ni migraciones: el change es configuración del repositorio y un benchmark del nightly. Confirmar las preguntas 3, 4 y 6 de design.md antes del grupo 2 y la pregunta 1 (acción del owner) antes del grupo 3. No cambia la protección de `main` ni los checks requeridos (D224).

## 1. SPEC y TEST CASES

- [ ] 1.1 Revisar el delta de `platform/delivery-pipeline`; `pnpm exec openspec validate add-dependency-updates --strict`
- [ ] 1.2 Revisar TC-PLATFORM-PIPELINE-005..008 contra los scenarios y las respuestas del owner; pasarlos a `ready` y `requirement_status: confirmed`

## 2. INFRAESTRUCTURA: configuración de Renovate

- [ ] 2.1 Verificar la antigüedad mínima efectiva de pnpm 12.4.2 en el repositorio (valor por defecto o el de `pnpm-workspace.yaml`) y anotarla en docs/23 §10; la de Renovate no puede ser menor (TC-PLATFORM-PIPELINE-007)
- [ ] 2.2 `renovate.json5` en la raíz: zona `America/La_Paz`, ventana y límite de PR (pregunta 2), grupos por ecosistema (pregunta 3), `helpers:pinGitHubActionDigests`, `minimumReleaseAge` e `internalChecksFilter: "strict"` (pregunta 6), `rebaseWhen: "behind-base-branch"`, `platformAutomerge` y reglas de automerge (pregunta 4), regla de majors sin automerge, exclusión de `spikes/`, de `allowBuilds`, `minimumReleaseAgeExclude` y `.trivyignore.yaml`, alertas de vulnerabilidad (pregunta 5) y plantillas de commit (pregunta 8)
- [ ] 2.3 Gestor regex para las imágenes de `apps/api/test/support/images.ts` y fijar PostgreSQL por digest (docs/20, pendiente de alinear) (TC-PLATFORM-PIPELINE-005)
- [ ] 2.4 Validar la configuración una vez con `renovate-config-validator` de una versión fijada (sin agregarlo como dependencia del workspace) y dejar el comando en docs/23 §10

## 3. ACTIVACIÓN (acción del owner)

- [ ] 3.1 El owner instala o habilita el ejecutor elegido en la pregunta 1, limitado a este repositorio, y, si adopta la pregunta 5 (a), activa Dependabot alerts; ninguna sesión cambia la configuración de seguridad del repositorio
- [ ] 3.2 Primera corrida: cerrar la PR de onboarding si aparece, revisar el Dependency Dashboard y comprobar que la protección de `main` sigue con los 17 checks, `strict` y `enforce_admins` (TC-PLATFORM-PIPELINE-005)
- [ ] 3.3 Primera ventana semanal: una PR de grupo pasa los 17 checks; una major (si hay) queda abierta sin auto-merge (TC-PLATFORM-PIPELINE-006)

## 4. NIGHTLY DE RENDIMIENTO

- [ ] 4.1 Benchmark de NFR-PERF-002 en `apps/api/test/perf/nightly.perf.ts` (`GET W/transactions?q=supermercado&limit=50` en el workspace principal del Large Seed) y entrada `NFR-PERF-002` (p95 ≤ 400 ms) en `PERF_THRESHOLDS`; nombre del test con `[TC-PLATFORM-PIPELINE-008]`; si el plan no genera el término, usar otro frecuente y actualizar el TC
- [ ] 4.2 Corrida rápida local (`PF_PERF_SCALE=0.1`) y una corrida de `nightly` por `workflow_dispatch` a escala 1; anotar el p95 medido en docs/23 §5.5; si supera 400 ms, abrir la pregunta de corrección (pregunta 9)
- [ ] 4.3 Solo si el owner adopta la pregunta 10 (a): aviso por issue cuando falla el job `perf`, con `issues: write` solo en ese job, y su scenario en el delta; si no, marcar esta tarea con la nota de la decisión

## 5. TESTS AUTOMATIZADOS

- [ ] 5.1 Test de política de `renovate.json5` ejecutado por `pnpm test` (job `unit`): ventana semanal y grupos por ecosistema, acciones por SHA (TC-PLATFORM-PIPELINE-005); ninguna regla con `automerge: true` aplica a `major`, `platformAutomerge` activo y ninguna opción que salte la protección o los checks (TC-PLATFORM-PIPELINE-006); `minimumReleaseAge` ≥ 3 días y ≥ la de pnpm, y rutas de `allowBuilds`, `minimumReleaseAgeExclude` y `.trivyignore.yaml` fuera del alcance del bot (TC-PLATFORM-PIPELINE-007); el parser de JSON5 que use debe estar ya en el lockfile o justificarse
- [ ] 5.2 Regresión: TC-PLATFORM-PIPELINE-001..004 sin cambios; `pnpm perf:bench` con los benchmarks existentes en verde

## 6. DOCS

- [ ] 6.1 docs/23 §10 (as-built de Renovate: ejecutor, ventana, grupos, automerge, antigüedad mínima, qué queda manual) y §5.5 (NFR-PERF-002 en el nightly); docs/20 (Renovate configurado; PostgreSQL de Testcontainers por digest); docs/02 NFR-MAINT-012 (dónde se mide); docs/26 RISK-024 (mitigación activa)
- [ ] 6.2 Estados de los TC a `automated` (005–008; 005 y 006 también con la verificación manual de la primera corrida en sus notas); `pnpm traceability:check`, `pnpm format:check`, `pnpm exec openspec validate add-dependency-updates --strict`
