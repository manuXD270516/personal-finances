# Propuesta: add-dependency-updates

## Why

El Platform track de docs/24 §6 pide para Phases 5–7 "Nightly de rendimiento con seed `large`; Renovate; SBOM". El SBOM ya se genera en `main.yml` y el nightly de rendimiento con el Large Seed existe desde 2026-10-04 (`nightly.yml`, job `perf`), pero ninguna de las dos piezas restantes está especificada: `platform/delivery-pipeline` no tiene requirements sobre la actualización de dependencias ni sobre el nightly, y Renovate sigue sin configurar (docs/20 §as-built). Hoy las dependencias, las acciones fijadas por SHA y las imágenes fijadas por digest solo se actualizan a mano, lo que deja abierto NFR-MAINT-012 (sin parches de seguridad pendientes más de 30 días; majors evaluados trimestralmente) y debilita la mitigación de RISK-024 (supply chain) que el registro de riesgos atribuye a Renovate. Además, el nightly no mide NFR-PERF-002 (búsqueda de texto con 50 000 transacciones, "Benchmark nightly" en docs/02), aunque el filtro `q` del listado de transacciones existe desde Phase 1.

El owner adoptó por omisión la opción (a) de la pregunta 6 de docs/40 (D224, docs/41): un change pequeño que modifica `platform/delivery-pipeline` con Renovate en agrupación semanal y sin automerge de versiones mayores, y que amplía el nightly de rendimiento con el seed `large`. D224 fija además que el change no cambia la protección de `main`; si llegara a cambiar los checks requeridos, eso requiere una confirmación aparte del owner.

## What Changes

- **Actualización automática de dependencias** (D224): un servicio de actualización (Renovate, sujeto a la pregunta 1 de design.md) propone por pull request las versiones nuevas de las dependencias del workspace pnpm (manifiestos, `catalog:` y `packageManager`), la versión de Node, las acciones de CI fijadas por SHA de commit y las imágenes fijadas por digest (Dockerfiles, compose y referencias de Testcontainers), agrupadas por ecosistema y abiertas solo dentro de una ventana semanal.
- **Sin automerge de majors y nunca con checks en rojo** (D224): una versión mayor llega en su propia PR y espera la revisión del owner; ninguna PR de actualización se fusiona con un check requerido en rojo o pendiente. Si el owner permite automerge para alguna clase de actualización (pregunta 4), se delega en el auto-merge nativo de GitHub, que exige los 17 checks requeridos con `strict` y `enforce_admins`.
- **Coherencia con la verificación de supply-chain del lockfile**: el servicio no propone versiones publicadas hace menos de la antigüedad mínima (pregunta 6; docs/23 §10 propone 3 días), que nunca es menor que la que aplica pnpm al instalar; no edita la lista de dependencias con scripts de instalación permitidos (`allowBuilds`) ni las excepciones de antigüedad (`minimumReleaseAgeExclude`); una PR cuyo lockfile no pasa la instalación congelada o `dependency-scan` queda en rojo para revisión manual.
- **Nightly de rendimiento con el Large Seed como requirement**: se especifica lo que ya corre (Large Seed a escala completa por los casos de uso, p95 contra los umbrales de docs/02, reporte como artefacto, fuera de los checks requeridos) y se amplía con el benchmark de NFR-PERF-002 (búsqueda de texto, p95 ≤ 400 ms).
- **Fuera de alcance:** cambios en la protección de `main` o en la lista de checks requeridos (D224: confirmación aparte del owner); instalar la GitHub App o activar Dependabot alerts (acciones del owner, pregunta 1); actualizar los binarios de Trivy y gitleaks fijados por versión y SHA-256 (pregunta 3); snapshot restaurable del Large Seed (docs/29 §7 P1, pregunta 11); NFR-PERF-007 y NFR-PERF-008 (ya tienen sus propios benchmarks en `imports.perf.ts` y `nightly.perf.ts`); E2E multi-navegador, `restore-drill` y demás jobs del Hito H; migrar a Node 26 LTS (llegará como la primera PR mayor y se revisa aparte).

## Capabilities

### New Capabilities

- Ninguna.

### Modified Capabilities

- `platform/delivery-pipeline`: actualización de dependencias agrupada y semanal, majors sin automerge y sin fusión con checks en rojo, antigüedad mínima coherente con el lockfile, nightly de rendimiento con el Large Seed (4 requirements ADDED: 2 Must, 2 Should).

## Impact

**Specs impactadas:** `platform/delivery-pipeline` (4 requirements ADDED; los 4 existentes no cambian). Leídas sin cambios: `platform/local-environment`, `quality/test-traceability`.

**Componentes/contextos impactados:** ningún bounded context. Configuración del repositorio: archivo de configuración de Renovate en la raíz (`renovate.json5`); test de política de la configuración en un paquete de scripts, ejecutado por `pnpm test` (job `unit`, ya requerido); `apps/api/test/perf/nightly.perf.ts` y `perf-report.ts` (benchmark y umbral de NFR-PERF-002). `.github/workflows/` no cambia salvo que el owner elija la opción (b) de la pregunta 1 o la (a) de la pregunta 10.

**APIs impactadas:** ninguna (`contracts/openapi` sin cambios; el benchmark usa `GET W/transactions?q=` existente).

**Tablas impactadas:** ninguna.

**Eventos impactados:** ninguno.

**Migraciones requeridas:** ninguna. Si el benchmark de NFR-PERF-002 no cumple, el índice que haga falta va en un change de corrección aparte (pregunta 9).

**Test cases:** AÑADIDOS — TC-PLATFORM-PIPELINE-005..008 (4). MODIFICADOS — ninguno. DEPRECADOS — ninguno.

**Impacto de regresión:** las PR de Renovate ejercitan el gate completo cada semana (los 17 checks); un upgrade de dependencias puede romper tests existentes, y por eso se fusiona solo en verde. El nightly agrega un benchmark (unos minutos sobre los 240 de su límite). Los checks requeridos de `main` y su configuración no cambian.

**Riesgos introducidos:** RISK-024 (supply chain: un paquete comprometido propuesto por el bot; mitigado con la antigüedad mínima, el lockfile congelado, `dependency-scan` y la revisión de majors); ruido de PR semanales para un owner único (agrupación y límite de PR abiertas); una GitHub App de terceros con permiso de escritura sobre el repositorio público (pregunta 1).

**Invariantes afectadas:** ninguna (no toca dinero, ledger, FX, periodos ni redondeo).
