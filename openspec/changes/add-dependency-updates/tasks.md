# Tareas

> Sin dominio, aplicación, API, UI ni migraciones: el change es configuración del repositorio, un benchmark del nightly y el aviso por issue del job `perf`. Preguntas de design.md: la 1 resuelta el 2026-10-13 (GitHub App hospedada de Mend Renovate); las 2 a 11 resueltas el 2026-10-16 con la recomendación de cada una (docs/43, D262–D271), así que el grupo 2 está desbloqueado. El owner informó el 2026-10-16 que instaló la app (D261). Ninguna sesión toca la protección de `main` ni los checks requeridos (D224).

## 1. SPEC y TEST CASES

- [ ] 1.1 Revisar el delta de `platform/delivery-pipeline`; `pnpm exec openspec validate add-dependency-updates --strict`
- [ ] 1.2 Revisar TC-PLATFORM-PIPELINE-005..009 contra los scenarios y las respuestas del owner; pasarlos a `ready` y `requirement_status: confirmed`

## 2. INFRAESTRUCTURA: configuración de Renovate

- [ ] 2.1 Verificar la antigüedad mínima efectiva de pnpm 12.4.2 en el repositorio (valor por defecto o el de `pnpm-workspace.yaml`) y anotarla en docs/23 §10; la de Renovate no puede ser menor (TC-PLATFORM-PIPELINE-007)
- [ ] 2.2 `renovate.json5` en la raíz: zona `America/La_Paz`, ventana lunes antes de las 06:00 y 5 PR abiertas como máximo (pregunta 2, D262), grupos por ecosistema sin los binarios con SHA-256 de `pr.yml` (pregunta 3, D263), `helpers:pinGitHubActionDigests`, `minimumReleaseAge: "3 days"` e `internalChecksFilter: "strict"` (pregunta 6, D266), `rebaseWhen: "behind-base-branch"`, `platformAutomerge` y automerge solo de parches de dependencias de desarrollo y digests y parches de acciones e imágenes de desarrollo (pregunta 4, D264), regla de majors sin automerge, exclusión de `spikes/`, de `allowBuilds`, `minimumReleaseAgeExclude` y `.trivyignore.yaml`, alertas de vulnerabilidad fuera de la ventana con etiqueta `security` (pregunta 5, D265) y plantillas de commit y PR en español (pregunta 8, D268)
- [ ] 2.3 Gestor regex para las imágenes de `apps/api/test/support/images.ts` y fijar PostgreSQL por digest (docs/20, pendiente de alinear) (TC-PLATFORM-PIPELINE-005)
- [ ] 2.4 Validar la configuración una vez con `renovate-config-validator` de una versión fijada (sin agregarlo como dependencia del workspace) y dejar el comando en docs/23 §10

## 3. ACTIVACIÓN (acción del owner)

- [ ] 3.1 Verificar que la app de Mend Renovate (instalada por el owner, informado el 2026-10-16, D261) abrió su PR de configuración (onboarding) y cerrarla o reemplazar su contenido por `renovate.json5` (tarea 2.2), sin fusionar la configuración por defecto de la app; dejar anotado en las notas de TC-PLATFORM-PIPELINE-005 el número de la PR y qué se hizo. Activar Dependabot alerts (pregunta 5 (a), D265) queda a cargo del owner; ninguna sesión cambia la configuración de seguridad del repositorio, la protección de `main` ni los checks requeridos — 2026-10-16: la instalación la hizo el owner; la verificación de la PR de configuración **no** se ha hecho
- [ ] 3.2 Primera corrida: cerrar la PR de onboarding si aparece, revisar el Dependency Dashboard y comprobar que la protección de `main` sigue con los 17 checks, `strict` y `enforce_admins` (TC-PLATFORM-PIPELINE-005)
- [ ] 3.3 Primera ventana semanal: una PR de grupo pasa los 17 checks; una major (si hay) queda abierta sin auto-merge (TC-PLATFORM-PIPELINE-006)

## 4. NIGHTLY DE RENDIMIENTO

- [ ] 4.1 Benchmark de NFR-PERF-002 en `apps/api/test/perf/nightly.perf.ts` (`GET W/transactions?q=supermercado&limit=50` en el workspace principal del Large Seed) y entrada `NFR-PERF-002` (p95 ≤ 400 ms) en `PERF_THRESHOLDS`; nombre del test con `[TC-PLATFORM-PIPELINE-008]`; si el plan no genera el término, usar otro frecuente y actualizar el TC
- [ ] 4.2 Corrida rápida local (`PF_PERF_SCALE=0.1`) y una corrida de `nightly` por `workflow_dispatch` a escala 1; anotar el p95 medido en docs/23 §5.5; NFR-PERF-002 es bloqueante en el nightly desde la primera corrida (pregunta 9, D269): si supera 400 ms, proponer un change de corrección aparte
- [ ] 4.3 Aviso por issue cuando falla el job `perf` de `.github/workflows/nightly.yml` (pregunta 10 (a), D270; design decisión 11): paso con `if: failure()` que abre el issue "nightly perf: umbral superado" con el enlace a la corrida y `perf-summary.md`, o comenta el abierto con ese título; `permissions: { contents: read, issues: write }` solo en el job `perf` (TC-PLATFORM-PIPELINE-009). El scenario ya está en el delta (2026-10-16). Verificar una vez con un umbral forzado en una corrida por `workflow_dispatch` (sin fusionar ese cambio) y anotar el issue en el TC

## 5. TESTS AUTOMATIZADOS

- [ ] 5.1 Test de política de `renovate.json5` ejecutado por `pnpm test` (job `unit`): ventana semanal y grupos por ecosistema, acciones por SHA (TC-PLATFORM-PIPELINE-005); ninguna regla con `automerge: true` aplica a `major`, `platformAutomerge` activo y ninguna opción que salte la protección o los checks (TC-PLATFORM-PIPELINE-006); `minimumReleaseAge` ≥ 3 días y ≥ la de pnpm, y rutas de `allowBuilds`, `minimumReleaseAgeExclude` y `.trivyignore.yaml` fuera del alcance del bot (TC-PLATFORM-PIPELINE-007); el parser de JSON5 que use debe estar ya en el lockfile o justificarse
- [ ] 5.2 Test de política del workflow ejecutado por `pnpm test`: en `nightly.yml`, solo el job `perf` y el ya existente `fx-smoke-live` declaran `issues: write`, y el paso de aviso del job `perf` usa el título exacto y busca el issue abierto antes de crear otro (TC-PLATFORM-PIPELINE-009)
- [ ] 5.3 Regresión: TC-PLATFORM-PIPELINE-001..004 sin cambios; `pnpm perf:bench` con los benchmarks existentes en verde

## 6. DOCS

- [ ] 6.1 docs/23 §10 (as-built de Renovate: ejecutor, ventana, grupos, automerge, antigüedad mínima, qué queda manual) y §5.5 (NFR-PERF-002 en el nightly y aviso por issue del job `perf`); docs/20 (Renovate configurado; PostgreSQL de Testcontainers por digest); docs/02 NFR-MAINT-012 (dónde se mide); docs/26 RISK-024 (mitigación activa)
- [ ] 6.2 Estados de los TC a `automated` (005–009; 005 y 006 también con la verificación manual de la primera corrida en sus notas); `pnpm traceability:check`, `pnpm format:check`, `pnpm exec openspec validate add-dependency-updates --strict`
