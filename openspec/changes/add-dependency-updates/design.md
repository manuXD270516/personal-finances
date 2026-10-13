# Diseño: add-dependency-updates

## Contexto

Estado del repositorio en `main` (2026-10-13) que el change toma como punto de partida:

- **Gate de PR** (`pr.yml`): 17 jobs que son checks requeridos de `main` (docs/23 §16), con `strict` (rama al día) y `enforce_admins`; el auto-merge de GitHub está activo y las sesiones lo usan con `gh pr merge --auto --squash --delete-branch`. `dependency-scan` corre `trivy fs` (CRITICAL con corrección, excepciones con vencimiento en `.trivyignore.yaml`) sobre `pnpm-lock.yaml`; `secrets` corre gitleaks sobre los commits de la PR.
- **Supply-chain del lockfile**: `setup-workspace` instala con `pnpm install --frozen-lockfile` (pnpm 12.4.2 por `packageManager`); `pnpm-workspace.yaml` mantiene el `catalog:` de versiones (ADR-0018), las excepciones `minimumReleaseAgeExclude` (la antigüedad mínima la aplica pnpm al resolver) y la lista revisada `allowBuilds` de paquetes con scripts de instalación (SPIKE-04 R5).
- **Fijado**: acciones por SHA de commit completo con el tag como comentario (docs/23 §14); imágenes por tag y digest en `compose*.yaml` y Dockerfiles; Testcontainers en `apps/api/test/support/images.ts` (PostgreSQL solo con tag, pendiente de alinear según docs/20); binarios de Trivy y gitleaks por versión y SHA-256 en las variables de entorno de `pr.yml`.
- **SBOM**: ya lo genera `main.yml` (docs/39 §B.4); no se toca.
- **Nightly** (`nightly.yml`, docs/23 §5.5): job `perf` con `pnpm perf:bench` (todos los `apps/api/test/perf/*.perf.ts`), Large Seed v2 a escala 1 (97 374 transacciones en el workspace principal más 20 satélites) cargado por los casos de uso en cada corrida (sin snapshot), umbrales en `PERF_THRESHOLDS` (`perf-report.ts`) para NFR-PERF-001/003/004/005/006 y overhead de RLS; reporte `perf-results.json` + `perf-summary.md` como artefacto (90 días). No es check requerido. NFR-PERF-002 (búsqueda de texto, p95 ≤ 400 ms, "Benchmark nightly") no se mide.
- **Renovate**: propuesto en docs/23 §10, ADR-0015, ADR-0011, ADR-0018 y docs/12 §supply chain, pero sin configurar (docs/20).

Decisiones que se aplican:

| Decisión | Origen | Aplicación |
|---|---|---|
| D224 | Por omisión (P6 de docs/40, opción a) | Change pequeño que modifica `platform/delivery-pipeline`: Renovate con agrupación semanal, sin automerge de majors, y nightly de rendimiento con seed `large`. No cambia la protección de `main`; si llegara a cambiar checks requeridos, requiere confirmación aparte del owner. |
| ADR-0015 | Aceptado | Dependencias con Renovate, agrupación y automerge solo de parches de dependencias de desarrollo con CI en verde (se confirma en la pregunta 4). |
| docs/23 §10 | Propuesta de diseño | Renovate (GitHub App) para versiones y Dependabot alerts solo para avisos; `minimumReleaseAge: "3 days"`; ventana semanal; Node, imagen base y `setup-node` en el mismo grupo. |
| CLAUDE.md | Regla del proyecto | Cambiar la configuración de seguridad del repositorio (protección de ramas, checks requeridos) requiere confirmación del owner; nunca fusionar con checks en rojo o pendientes. |

| Elemento | Capa | Cambio |
|---|---|---|
| `renovate.json5` (raíz) | configuración del repositorio | Nuevo |
| Test de política de la configuración (`[TC-PLATFORM-PIPELINE-005..007]`), en un paquete de scripts que `pnpm test` ya ejecuta | tests | Nuevo |
| `apps/api/test/perf/nightly.perf.ts`, `perf-report.ts` | tests de rendimiento | Ampliado (NFR-PERF-002) |
| `.github/workflows/*` | CI | Sin cambios salvo pregunta 1 (b) o pregunta 10 (a) |
| Bounded contexts, OpenAPI, eventos, migraciones | — | Sin cambios |

## Objetivos / No objetivos

**Objetivos**

- PR semanales y agrupadas que mantengan al día dependencias, acciones, imágenes y Node, sin trabajo manual de búsqueda de versiones (NFR-MAINT-012).
- Ninguna ruta que fusione una versión mayor sin revisión, ni ninguna PR con checks en rojo o pendientes.
- Que el bot conviva con la verificación de supply-chain existente (lockfile congelado, antigüedad mínima de pnpm, `allowBuilds`, `dependency-scan`) sin abrirle excepciones.
- Que el nightly de rendimiento quede especificado y cubra NFR-PERF-002.

**No objetivos**

- Cambiar la protección de `main`, los checks requeridos o sus nombres (D224).
- Instalar apps ni activar ajustes de seguridad del repositorio en nombre del owner.
- Actualizar automáticamente los binarios con SHA-256 de `pr.yml` (pregunta 3).
- Snapshot restaurable del Large Seed, comparación de tendencias entre corridas, k6 o mediciones en cloud.

## Decisiones

1. **Renovate y no Dependabot version updates** (docs/23 §10): soporta el `catalog:` de pnpm, `packageManager`, digests en compose y en TypeScript (gestor regex) y `helpers:pinGitHubActionDigests`. Dependabot queda solo para alertas, si el owner las activa (pregunta 5). La forma de ejecutarlo (app hospedada o autoalojado) es la pregunta 1.
2. **Configuración en `renovate.json5` en la raíz**, no en `.github/`: se versiona y se revisa como código; un test de política la lee y verifica las reglas de este change, de modo que `pnpm test` (job `unit`, ya requerido) falla si alguien activa el automerge de majors o baja la antigüedad mínima. No agrega checks requeridos.
3. **Ventana semanal con zona `America/La_Paz`** y agrupación por ecosistema: dependencias del workspace (parches y menores juntos), acciones de CI, imágenes (Dockerfiles, compose y Testcontainers por servicio) y runtime (Node en `.nvmrc`, imagen base `node:*` y versión en `engines`, en un grupo, como pide docs/23 §10). Las majors salen de los grupos: una PR por paquete mayor. Límite de PR abiertas a la vez (pregunta 2) para no saturar a un owner único. Dependency Dashboard activado (issue en el repositorio, sin datos sensibles) para ver lo pendiente y relanzar una PR a mano.
4. **Sin automerge de majors, por configuración y por test**: regla `matchUpdateTypes: ["major"]` con `automerge: false` y verificación en el test de política. Para la clase que el owner permita (pregunta 4), `platformAutomerge: true`: Renovate activa el auto-merge nativo de GitHub, que espera los 17 checks con `strict` y `enforce_admins`; Renovate nunca fusiona por sí mismo saltando la protección, y una PR con un check en rojo queda abierta.
5. **Rama al día**: con `strict`, una PR atrasada no se fusiona; Renovate la rebasa cuando queda detrás de `main` (`rebaseWhen: "behind-base-branch"`), lo que relanza los checks.
6. **Antigüedad mínima** (`minimumReleaseAge`, por defecto 3 días, pregunta 6), con `internalChecksFilter: "strict"` para que no abra una PR antes de cumplirla. Debe ser mayor o igual que la antigüedad efectiva de pnpm (la tarea 2.1 la verifica: valor por defecto de pnpm 12 o el que fije `pnpm-workspace.yaml`); si fuera menor, Renovate propondría versiones que `pnpm install` rechaza y la PR saldría en rojo.
7. **Lockfile**: Renovate regenera `pnpm-lock.yaml` con la versión de pnpm de `packageManager`; no toca `allowBuilds`, `minimumReleaseAgeExclude` ni `.trivyignore.yaml` (rutas excluidas de sus actualizaciones y verificado en el test de política). Si una dependencia nueva trae scripts de instalación, la PR falla en `pnpm install --frozen-lockfile` y el owner decide si la agrega a `allowBuilds` en esa misma rama.
8. **Commits y PR**: título Conventional Commit `chore(deps): …` con la plantilla en español donde Renovate lo permite (pregunta 8); etiquetas `dependencies` y, para majors, `major`. Las PR de Renovate siguen la regla de CLAUDE.md: si un check falla, se corrige en la misma rama (o se cierra), nunca se fusiona en rojo.
9. **Nightly: NFR-PERF-002** como un benchmark más de `nightly.perf.ts`: `GET W/transactions?q=supermercado&limit=50` sobre el workspace principal del Large Seed (≥ 50 000 transacciones), con el mismo calentamiento e iteraciones (`PF_PERF_ITERATIONS`, 200) que NFR-PERF-001, y entrada `'NFR-PERF-002': { metric: 'p95', limitMs: 400 }` en `PERF_THRESHOLDS`, de modo que la aserción final (`ningún p95 supera su umbral`) lo incluye. El término se elige entre las descripciones que el Large Seed genera (catálogo sugerido es-BO); si el plan no produce "supermercado", la tarea 4.1 usa otro término frecuente y actualiza el TC.
10. **El nightly no es check requerido** y su fallo no bloquea PR (como hoy); el requirement lo deja escrito para que un change futuro no lo convierta en requerido sin la confirmación del owner.

## Contratos

Sin cambios de contratos: ni OpenAPI (`contracts/openapi/finance-api.v1.yaml` intacto; el benchmark usa el parámetro `q` existente del listado de transacciones), ni eventos, ni `ErrorCode`. `pnpm contract:breaking` sin diferencias.

Configuración nueva (ilustrativa; los valores marcados dependen de las preguntas):

```json5
// renovate.json5 (raíz)
{
  $schema: 'https://docs.renovatebot.com/renovate-schema.json',
  extends: ['config:recommended', 'helpers:pinGitHubActionDigests', ':dependencyDashboard'],
  timezone: 'America/La_Paz',
  schedule: ['before 6am on monday'], // pregunta 2
  prConcurrentLimit: 5, // pregunta 2
  minimumReleaseAge: '3 days', // pregunta 6
  internalChecksFilter: 'strict',
  rebaseWhen: 'behind-base-branch',
  platformAutomerge: true,
  automerge: false,
  labels: ['dependencies'],
  ignorePaths: ['**/spikes/**'],
  packageRules: [
    { matchUpdateTypes: ['major'], automerge: false, groupName: null, labels: ['dependencies', 'major'] },
    // pregunta 4 (a): automerge solo de parches y digests de dependencias de desarrollo y de acciones
    // pregunta 3: grupos por ecosistema (workspace, acciones, imágenes, runtime)
  ],
  customManagers: [
    // pregunta 3: imágenes de Testcontainers en apps/api/test/support/images.ts (tag + digest)
  ],
}
```

## Riesgos / Trade-offs

- [RISK-024: paquete comprometido propuesto por el bot] → antigüedad mínima de 3 días, lockfile congelado, `allowBuilds` intocable por el bot, `dependency-scan` y revisión del owner de majors; nada se fusiona en rojo.
- [GitHub App de terceros con escritura en un repositorio público] → instalación limitada a este repositorio y decisión del owner (pregunta 1); el bot no tiene permisos de administración, así que no puede tocar la protección de `main`.
- [Ruido de PR para un owner único] → ventana semanal, grupos, límite de PR abiertas y automerge acotado (pregunta 4).
- [PR que se queda atrás por `strict`] → rebase automático; cada rebase relanza los 17 checks (minutos de Actions en un repositorio público: sin costo).
- [Tests inestables ajenos al upgrade en una PR del bot] → misma regla de CLAUDE.md: diagnosticar antes de relanzar, no más de un relanzamiento a ciegas.
- [NFR-PERF-002 no cumple con el Large Seed] → el nightly se pone en rojo (no bloquea PR); la corrección (índice o consulta) va en un change aparte (pregunta 9).
- [Primera major esperada: Node 26 LTS desde el 2026-10-28] → llega como PR propia del grupo runtime; requiere revisar Next.js, NestJS, Kysely, BullMQ y Testcontainers (docs/20) antes de fusionar.

## Plan de migración

Sin migraciones de base de datos ni cambios de contratos. Orden de despliegue:

1. Fusionar `renovate.json5` y el test de política (el bot aún no corre: sin efecto).
2. El owner instala o habilita el ejecutor elegido en la pregunta 1, limitado a este repositorio. La primera corrida abre el Dependency Dashboard y, si el repositorio no tenía configuración, una PR de onboarding que se cierra (la configuración ya está en `main`).
3. Primera ventana semanal: revisar las PR de grupo; las majors quedan abiertas para revisión.

Rollback: desinstalar o pausar la app (o el workflow) y cerrar las PR abiertas; borrar `renovate.json5` en un PR. El benchmark de NFR-PERF-002 se revierte quitando su entrada.

Independiente de los demás changes de Phase 5 (docs/39 §B.5); puede ir en paralelo.

## Preguntas abiertas

Las marcadas **[B]** bloquean el grupo de tareas indicado, no la redacción de la spec.

1. **[B] Cómo se ejecuta Renovate** (bloquea el grupo 3). Las PR que abre un workflow con `GITHUB_TOKEN` no disparan `pull_request`, así que los 17 checks requeridos nunca correrían y la PR no podría fusionarse. Opciones: (a) **Mend Renovate como GitHub App hospedada (gratuita), instalada por el owner solo en este repositorio**; sin secretos en el repositorio ni workflow nuevo; (b) Renovate autoalojado en un workflow programado con una GitHub App propia del owner (ID y clave privada como secretos) o un PAT de grano fino; control total, pero agrega un workflow con secretos de escritura; (c) Dependabot version updates (nativo, sin instalación), con peor soporte para el `catalog:` de pnpm y sin gestor para las imágenes de Testcontainers. **Recomendación: (a)**. Es una acción de configuración del repositorio: requiere confirmación y ejecución del owner.
2. **Ventana y límite de PR** (no bloquea). Opciones: (a) **lunes antes de las 06:00 America/La_Paz (después del nightly de las 02:00), con 5 PR abiertas como máximo**; (b) sábado, para revisar el fin de semana; (c) mensual (menos ruido, pero los parches tardan hasta 30 días, al límite de NFR-MAINT-012). **Recomendación: (a)**.
3. **[B] Qué gestores y archivos cubre** (bloquea el grupo 2). Opciones: (a) **workspace pnpm (manifiestos, `catalog:`, `packageManager`), `.nvmrc` y `engines`, acciones de GitHub por SHA, Dockerfiles, compose y un gestor regex para `apps/api/test/support/images.ts` (aprovechando para fijar PostgreSQL también por digest); fuera: los binarios de Trivy y gitleaks con SHA-256 en `pr.yml`, que se revisan a mano cada trimestre**, porque Renovate no puede recalcular el SHA-256 de un tarball y la PR saldría en rojo; (b) incluir esos binarios con un gestor regex que solo sube la versión (PR siempre roja hasta completar el SHA a mano); (c) solo el workspace pnpm. **Recomendación: (a)**. `spikes/` queda fuera (código descartable con sus propios workspaces).
4. **[B] Qué se fusiona solo** (bloquea el grupo 2). D224 solo excluye las majors. Opciones: (a) **automerge nativo (con los 17 checks) solo para parches de dependencias de desarrollo y para digests y parches de acciones de CI e imágenes de desarrollo; todo lo demás (menores, dependencias de producción, runtime) espera la revisión del owner**, como ADR-0015 y docs/23 §10; (b) ningún automerge: el owner revisa todo; (c) automerge de todo lo que no sea major (lectura literal de D224; más riesgo en dependencias de producción). **Recomendación: (a)**.
5. **Vulnerabilidades frente a actualizaciones normales** (no bloquea). NFR-MAINT-012 admite hasta 30 días; NFR-SEC-013 bloquea CRITICAL con corrección. Opciones: (a) **las PR que corrigen un aviso de seguridad (alertas de vulnerabilidad de Renovate, OSV) se abren fuera de la ventana semanal con etiqueta `security`, respetando la antigüedad mínima de pnpm; nunca automerge si son major; y el owner activa Dependabot alerts (solo alertas) en la configuración del repositorio**; (b) esperar la ventana semanal como el resto; (c) además, saltar la antigüedad mínima para correcciones de seguridad (choca con la verificación de pnpm; exigiría una excepción manual en `minimumReleaseAgeExclude`). **Recomendación: (a)**. Activar Dependabot alerts es un ajuste de seguridad del repositorio: lo hace el owner.
6. **[B] Antigüedad mínima** (bloquea el grupo 2). Opciones: (a) **3 días (docs/23 §10), verificando que no sea menor que la de pnpm**; (b) 7 días (más margen frente a paquetes comprometidos; parches más lentos); (c) solo la de pnpm. **Recomendación: (a)**.
7. **Quién revisa las PR de Renovate** (no bloquea). `main` exige 0 aprobaciones (docs/23 §2). Opciones: (a) **el owner revisa majors y PR que no se fusionan solas; una sesión `implementador` puede diagnosticar y corregir en la misma rama una PR del bot con un check en rojo (sin fusionar majors ni activar automerge en ellas)**; (b) solo el owner, sin sesiones; (c) sesiones con permiso para fusionar también majors tras revisar las notas de la versión. **Recomendación: (a)**.
8. **Idioma de commits y PR del bot** (no bloquea). CLAUDE.md pide commits y PR en español. Opciones: (a) **plantillas en español donde Renovate lo permite (`commitMessageAction`, `commitMessageTopic`, `prBodyTemplate` acotado), aceptando que las notas de versión de terceros queden en su idioma**; (b) dejar los textos por defecto en inglés como excepción documentada. **Recomendación: (a)**.
9. **NFR-PERF-002 bloqueante en el nightly** (no bloquea). Opciones: (a) **bloqueante como los demás umbrales desde la primera corrida (la spec lo escribe así); si no cumple, un change de corrección aparte**; (b) informativo durante dos semanas y luego bloqueante. **Recomendación: (a)**: el nightly no es check requerido, así que el rojo avisa sin frenar PR.
10. **Aviso cuando falla el nightly de rendimiento** (no bloquea). Hoy solo `fx-smoke-live` abre un issue al fallar. Opciones: (a) **abrir o comentar un issue "nightly perf: umbral superado" con el resumen, como `fx-smoke-live` (`issues: write` solo en ese job)**; (b) dejarlo en el rojo de Actions y el correo de GitHub. **Recomendación: (a)**. Toca `.github/workflows/nightly.yml` (no es check requerido ni protección de rama); si el owner la adopta, se agrega como tarea y como scenario en este change antes de implementarlo.
11. **Snapshot del Large Seed** (docs/29 §7 P1; no bloquea). Opciones: (a) **seguir generándolo en cada corrida (cabe en los 240 min del job) y diferir el snapshot al Hito H**; (b) snapshot `pg_dump` como artefacto de Actions (cientos de MB, retención 90 días); (c) GitHub Releases. **Recomendación: (a)**.
