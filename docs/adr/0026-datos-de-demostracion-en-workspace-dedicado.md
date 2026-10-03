# ADR-0026: Datos de demostración en un workspace dedicado, cargado por acción explícita y purgable

- Estado: Propuesto (2026-10-03, decisión del owner D36; pendiente de aceptación del diseño de purga)
- Fecha: 2026-10-03
- Decisores: Owner (Product/Tech Lead)
- Relacionado: docs/31-phase-1-consolidation-decisions.md (D7, D36); docs/29-seed-datasets.md; docs/09-ledger-design.md (INV-007, INV-019, INV-029); docs/12-security.md (roles `pf_migrator`, `pf_app`, `pf_worker`); ADR-0004, ADR-0008, ADR-0023; OpenSpec change `add-demo-data` (capability `identity/demo-data`)

## Contexto y problema

El owner quiere poder ver PFOS "con vida" (demos, desarrollo de UI, pruebas manuales) usando datos financieros de demostración con apariencia real (bancos, comercios y personas ficticios), pero exige que (a) la carga ocurra **solo por una acción explícita en la app**, (b) los datos estén **claramente marcados como demo** y (c) sean **completamente removibles**.

El problema: PFOS es append-only por diseño. Los postings no se modifican ni borran (INV-007, ADR-0004), el audit log es append-only (INV-029, FR-AUDIT-003), las categorías y cuentas nunca se borran (D7, INV-019, FR-ACCOUNTS-008) y los triggers `platform.forbid_mutation()` (SQLSTATE PF003) lo garantizan en la base de datos. "Removible por completo" choca con esas invariantes si los datos demo comparten workspace con datos reales.

## Drivers de decisión

- Ninguna operación de limpieza puede tocar datos reales del owner, ni siquiera por error humano o bug.
- Las invariantes del ledger y de la auditoría siguen intactas para todo workspace real.
- La limpieza debe dejar cero rastro de datos demo en reportes, saldos, auditoría y read models.
- Carga determinista y reproducible (docs/29 §3), por los mismos application services (los datos demo pasan las mismas validaciones que los reales).
- Simplicidad operativa: un único mecanismo para la app y para el seed de CI/dev.

## Opciones consideradas

1. **Workspace demo dedicado, marcado `is_demo` de forma inmutable, archivado al limpiar y purgado físicamente por una función restringida** (elegida).
2. **Datos demo dentro del workspace real**, marcados con un flag por registro, y limpieza por reversas + anulaciones.
3. **Workspace demo dedicado, limpieza solo por archivo** (sin purga física).
4. **Base de datos o schema separado** para demos.

## Decisión

Se elige la **opción 1**:

1. "Cargar datos de demostración" (OWNER, configuración del workspace) crea un **workspace nuevo** con `is_demo = true`, cuyo único miembro es el usuario que lo pidió (OWNER). El flag se fija al crear y es **inmutable** (trigger que rechaza cualquier `UPDATE` de `is_demo`): un workspace real nunca puede volverse demo ni al revés.
2. Un job del worker carga el dataset versionado (docs/29 Demo Seed, anclado a "hoy" en la TZ del workspace) **a través de los application services** con el actor técnico `system:demo` (equivalente a `system:seed`), de modo que ledger, auditoría y outbox se escriben como en la operación real.
3. "Limpiar datos de demostración" **archiva el workspace demo al instante** (deja de listarse y toda ruta de negocio responde como inexistente) y encola la **purga**.
4. La purga la ejecuta el worker llamando a `platform.purge_demo_workspace(workspace_id)`, función `SECURITY DEFINER` propiedad de `pf_migrator` con `EXECUTE` concedido solo a `pf_worker`. La función: verifica `is_demo = true` y estado de limpieza pendiente; fija `SET LOCAL pf.demo_purge_workspace`; borra en orden de dependencias todas las filas con ese `workspace_id` de las tablas registradas como acotadas por workspace; y deja el `iam.workspace` como **lápida** (`status = PURGED`, sin datos de negocio). `platform.forbid_mutation()` se amplía para permitir `DELETE` **solo si** se cumplen a la vez: `current_user = pf_migrator` (es decir, dentro de la función), la GUC coincide con el `workspace_id` de la fila y el workspace es demo. Para cualquier workspace real el comportamiento PF003 no cambia.
5. La evidencia durable de la carga y de la purga vive en `platform.demo_workspace_run` (nivel instalación: workspace, solicitante, versión del dataset, instantes de carga/limpieza/purga, filas borradas por tabla), más log estructurado y métrica. Esa tabla no contiene datos financieros.

## Análisis de opciones

**Opción 1 (elegida).** Aísla por completo los datos demo usando el mismo mecanismo de aislamiento que ya protege a los workspaces entre sí (RLS por `workspace_id`, ADR-0023). La excepción al append-only es **acotada** (solo workspaces demo, solo dentro de una función con guardas múltiples) y verificable con tests. Contra: introduce una ruta de borrado físico que requiere tests de seguridad específicos y una lista completa de tablas acotadas por workspace (se apoya en el chequeo de catálogo existente).

**Opción 2 (descartada).** Mezclar datos demo y reales en un workspace contamina el ledger, la auditoría y los reportes: la "limpieza" por reversas deja cientos de asientos y registros de auditoría permanentes, los saldos históricos y los periodos muestran movimientos que nunca existieron, y un error de marcado podría revertir datos reales. Viola el espíritu de "completamente removible".

**Opción 3 (alternativa conservadora, diferible).** Archivar sin purgar no requiere ninguna excepción al append-only, pero los datos demo quedan para siempre en la base (backups, exportaciones, métricas). Es el **modo degradado** si la purga fallara o mientras no esté aceptada: el workspace queda archivado e invisible.

**Opción 4 (descartada para Phase 1).** Una BD/schema separado aísla físicamente, pero duplica migraciones, roles y configuración, y obliga a la app a enrutar conexiones por workspace. Costo desproporcionado para un solo usuario.

## Consecuencias

- **Positivas:** limpieza total sin tocar datos reales; las invariantes del ledger y de la auditoría siguen vigentes para todo workspace real; la demo ejercita los mismos casos de uso que la operación real (sirve también como prueba de humo); la UI marca el workspace demo con un indicador persistente porque el flag es del workspace.
- **Negativas:** existe una ruta de `DELETE` sobre tablas append-only (acotada y con guardas); hay que mantener la lista de tablas acotadas por workspace (un test de catálogo falla si una tabla nueva con `workspace_id` no está registrada); los IDs de la demo quedan reservados por la lápida.
- **Riesgo:** un bug que permitiera marcar un workspace real como demo habilitaría su purga. Mitigación: inmutabilidad del flag por trigger, verificación en la función, tests de seguridad (TC-IDENTITY-DEMO-005/-006) y ningún endpoint ni comando que fije `is_demo` salvo la creación del workspace demo.

## Validación

- Tests de integración: tras la purga no queda ninguna fila con ese `workspace_id` en ninguna tabla registrada; un workspace real no puede purgarse (ni con la GUC fijada por `pf_app`); `UPDATE is_demo` falla.
- `pnpm traceability:check` cubre los TC de `identity/demo-data`.
- Revisión de seguridad del amend a `platform.forbid_mutation()` antes de aceptar este ADR.

## Notas

- El seed `pnpm db:seed -- --profile=demo` (solo local/CI, docs/29) reutiliza el mismo cargador y crea el mismo tipo de workspace demo; nunca escribe datos financieros en W1/W2 de la Minimal Seed.
- Si en el futuro se implementa FR-IDENTITY-012 (borrado definitivo de workspace real con periodo de gracia), deberá tener su propio ADR: este no lo habilita.
