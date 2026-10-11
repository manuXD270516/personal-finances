# PFOS: guía de trabajo para Claude Code

Estas reglas aplican a cualquier sesión, local o en la nube. Complementan los agentes `.claude/agents/arquitecto.md` (diseño) y `.claude/agents/implementador.md` (implementación). El estado vivo del proyecto (qué falta y qué espera al owner) está en [docs/38-estado-y-pendientes.md](docs/38-estado-y-pendientes.md); léelo al empezar.

## Proceso

- **Spec Driven Development con OpenSpec.** Nada se implementa sin un change en `openspec/changes/<change>/` (proposal, design, tasks, specs) y sus TC en `tests/cases/`. Orden de los changes: `docs/03-openspec-strategy.md` §7.
- **Decisiones del owner:** `docs/31`, `docs/33`, `docs/35` y `docs/37` (D1–D218). Respétalas. Lo no definido no se inventa: se anota como pregunta o pendiente. Las preguntas nuevas se consolidan en un doc `docs/NN-…-questions.md`, con opciones y recomendación, y sus respuestas en el `…-decisions.md` siguiente.
- **Ruteo de modelos:** diseño, specs, ADR y consolidación de preguntas → agente `arquitecto` (Opus 5.5). Implementación, archivado y cierre de PR → agente `implementador` (Sonnet 5.5). La sesión principal orquesta: revisa el informe, commitea, abre el PR y lo vigila.
- **Archivar** un change (`pnpm exec openspec archive <change> --yes`) solo con el 100 % de sus tareas en `[x]` y sus TC automatizados. Una tarea Could no hecha o diferida por decisión del owner se marca `[x]` con una nota que lo diga. Si el archive crea una spec nueva, reemplaza el `## Purpose` "TBD" por un propósito real; `spec:validate` falla si no.
- **Idioma:** todo en español (docs, specs, TC, nombres de tests, commits, PR). Los encabezados que OpenSpec parsea quedan en inglés (`## Purpose`, `### Requirement:`, `#### Scenario:`, `## Why`…), con texto normativo `DEBE (MUST)`; los identificadores de código, en inglés. UI con i18n es/en/pt, formato es-BO, moneda base BOB, zona America/La_Paz.

## Pull requests

- Una rama por change. Commits y PR en español; los commits terminan con `Co-Authored-By` del modelo que los escribió.
- Abre el PR y activa enseguida `gh pr merge --auto --squash --delete-branch`. `main` está protegida: los 17 checks son obligatorios, `strict` (la rama debe estar al día) y `enforce_admins`.
- Vigila el PR hasta que se fusione. Si queda atrás de `main`, `gh pr update-branch`. Si un check falla, lee el log del job (`gh api repos/<repo>/actions/jobs/<id>/logs`), corrige en la misma rama y vuelve a vigilar. Un fallo de un test ajeno al cambio se diagnostica antes de relanzar; no se relanza a ciegas más de una vez. Runners cancelados sin ejecutar: relanza (`gh run rerun --failed`).
- Nunca abras un PR roto a propósito ni fusiones con checks en rojo o pendientes.
- Tras la fusión de una feature, un PR aparte `chore(openspec): archivar <change>`.

## Seguridad (repositorio público)

- Nunca credenciales reales, datos personales ni la tabla del banco del owner en el repositorio. Los valores de prueba van en los archivos de ejemplo o seed.
- Identidad de git local al repo, con el email noreply de GitHub.
- gitleaks en modo git desde un worktree escanea 0 commits; usa un `git clone --bare` o confía en el check `secrets` de CI. Las excepciones de `.gitleaks.toml` se mantienen estrechas.
- Cambiar la configuración de seguridad del repositorio (protección de ramas, checks obligatorios) requiere confirmación del owner.

## Docker y entornos

- **Nunca** ejecutes `pnpm stack:*` ni `docker compose` sin `PF_E2E_PROJECT=pfos-e2e-<nombre>` en la misma línea: sin él actúan sobre el proyecto `pfos`, el stack de desarrollo del owner (incidente 2026-10-08). Prefijo de puertos 3 o 4, nunca 5 (choca con otro stack en 55432/56379). Tags de imagen propios (`:<nombre>`); al terminar, borra solo tus contenedores e imágenes.
- Nunca mates procesos por nombre: solo por el PID de los que lanzaste.
- Worktrees locales en `.claude/worktrees/pf-<nombre>`; no toques los de nombre aleatorio (son tareas de la app del owner).
- Sin Docker (algunas sesiones en la nube), `pnpm test:integration`, `pnpm test:e2e` y `pnpm test:stack` no corren: ejecuta los demás gates y deja que CI valide esos; dilo en el informe.

## Código

- DDD hexagonal en `packages/contexts/<ctx>/src/{domain,application,infrastructure,interface,contracts}`; los contextos se comunican solo por `@pf/<ctx>/contracts` (`pnpm arch:check`).
- Dinero con Decimal y HALF_EVEN, nunca `number`. Ledger append-only.
- RLS forzada y registro en `platform.workspace_scoped_table` para toda tabla con `workspace_id`. Auditoría, recorrido y outbox en la misma unidad de trabajo.
- Dentro de una unidad de trabajo, nunca consultas en paralelo sobre el mismo cliente pg (`Promise.all`): el harness de integración falla con ese aviso.
- Migraciones solo expand, con timestamp posterior a la última de `main`; nunca edites una fusionada.
- Contratos aditivos: oasdiff limpio (`pnpm contract:breaking`), Spectral y Redocly sin errores. En el YAML, las descripciones con comas dentro de un flow mapping van entre comillas.
- Presupuesto de conexiones: la plantilla del host suma API 22 + worker 33 = 55 sobre 60 de Postgres. No agregues consumidores sin justificarlo y validar el test de arranque del worker.
- Tests: TC-id en el nombre (`it('[TC-…] …')`). Los PBT y los de muchos datos llevan timeout explícito (CI es más lento). No busques números sueltos con `toContain` (aparecen dentro de ids y marcas de tiempo): usa regex con límites. Los consumidores asíncronos (Planning provisiona periodos tras cada asiento) generan filas en segundo plano; las comparaciones de estado deben tenerlo en cuenta.

## Gates antes de entregar

`pnpm format:check`, `pnpm turbo typecheck lint test build`, `pnpm arch:check`, `pnpm traceability:check`, `pnpm spec:validate`, `pnpm config:docs:check`, `pnpm contract:breaking`, `pnpm test:integration` (dos veces seguidas en verde), y `pnpm test:e2e` si cambia la UI (con `PF_E2E_PROJECT`).

## Informe al owner

Al terminar un bloque: en español y breve, qué se fusionó (enlaces a los PR), qué quedó pendiente y qué necesita una decisión o una prueba suya. Actualiza `docs/38-estado-y-pendientes.md` en el mismo PR cuando cambie el estado.
