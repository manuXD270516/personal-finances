# 49: Decisión del owner sobre el fail-closed de RLS con la forma InitPlan V2 (2026-10-23) y decisión D297

> **Estado:** Registrado · **Fecha:** 2026-10-23 · **Relacionado:** [48-perf-and-rls-owner-decisions.md](48-perf-and-rls-owner-decisions.md) (D291–D296), [38-estado-y-pendientes.md](38-estado-y-pendientes.md), [08-data-model.md](08-data-model.md) §1.4, [23-ci-cd.md](23-ci-cd.md) §5.5, change [`optimize-rls-policy-overhead`](../openspec/changes/optimize-rls-policy-overhead/proposal.md) (49), [ADR-0023](adr/0023-multi-tenancy-and-row-level-security.md)

La numeración continúa la de docs/48 (último id usado: D296). Este documento registra la respuesta **tal cual** y su consecuencia; el detalle lo desarrollan el design, el delta spec y TC-SECURITY-RLS-007 del change 49.

## Contexto

La fase b del change 49 migra todas las políticas de aislamiento a la forma V2 `workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())])`, que quita el nodo `Result` de la consulta de saldo por cuenta (diferencia de 0,268 ms con V0 a 0,000 ms en el experimento del job `integration` de #162).

Con V2 el contexto se evalúa como InitPlan al leer la primera fila (o al armar la condición de índice), no al planificar. Medido en PostgreSQL 16 local sobre una base sin datos (52 de 300 operaciones en 33 tablas):

- Sin contexto, una lectura de una tabla **sin filas** devuelve vacío en lugar de `PF002`; una inserción por defecto puede fallar antes con otra restricción (p. ej. `23514` en `fx.rate_anomaly_review`).
- Con al menos una fila en la tabla, o cuando la condición se arma con datos, sigue fallando con `PF002`.
- Nunca se lee ni se escribe una fila de otro workspace; el cruce W1/W2 sigue dando `42501` o 0 filas.

Esto contradecía el escenario «el resultado es el mismo que con la política anterior» de TC-SECURITY-RLS-007, el requirement «Aislamiento fail-closed sin contexto de workspace» («nunca devolver un resultado vacío en silencio») y la frase de docs/08 («nunca devuelve 0 filas»).

## Respuesta del owner

| ID | Pregunta de origen | Respuesta del owner (tal cual) | Consecuencia |
|---|---|---|---|
| D297 | Informe de la fase b del change 49 (2026-10-23): V2 cambia el resultado sin contexto en las tablas vacías | Opción recomendada «Aceptar V2 y enmendar la spec» | Se **acepta V2** y la spec exige el invariante real de seguridad: sin contexto de workspace, ninguna operación lee ni escribe una fila de ningún workspace; el resultado válido es `PF002`, o un resultado vacío o un rechazo sin ninguna fila afectada. El contexto ausente **nunca concede acceso**. Ya no se exige `PF002` idéntico a la política anterior en las tablas vacías. Se modifica el requirement «Aislamiento fail-closed sin contexto de workspace» y se reescribe TC-SECURITY-RLS-007. Desbloquea la fusión del change 49 (pendiente solo de CI y de la medición del `nightly`). |

## Alternativas descartadas

- **Descartar la migración V2 (aplicar D295).** Mantiene `PF002` en todas las tablas, pero deja el sobrecosto de 0,805 ms en la fila bloqueante del benchmark, sin otra variante que lo quite sin cambiar el fail-closed (V1 y V3a no quitan el nodo; V3b tiene el mismo efecto en tablas vacías). El invariante de seguridad que importa (ninguna fila expuesta) ya se cumple con V2.
- **Aplicar V2 solo a las tablas calientes** (p. ej. `ledger.posting`). Deja dos formas de política, contradice el alcance total de D294 y la regla de forma canónica (TC-SECURITY-RLS-011), y no evita el efecto: las tablas calientes casi nunca están vacías, pero la diferencia de comportamiento seguiría existiendo en ellas.

## Consecuencias

- **Seguridad:** el aislamiento no cambia. Sin contexto no hay acceso a filas; el error ruidoso `PF002` se mantiene en toda operación que llega a evaluar una fila, que es el caso de una base con datos. Lo que se pierde es la señal ruidosa ante un bug de contexto sobre una tabla vacía, que devuelve vacío (no hay nada que exponer).
- **Diagnóstico:** un bug de contexto en una tabla vacía ya no se detecta por `PF002`. La aplicación fija el contexto en cada unidad de trabajo y TC-SECURITY-RLS-002 (tablas con filas) sigue exigiendo `PF002`.
- **Spec y TC:** el delta de `security/access-control` del change 49 agrega un MODIFIED del requirement «Aislamiento fail-closed sin contexto de workspace» y enmienda el ADDED «Reescritura de las políticas de aislamiento sin pérdida de aislamiento». TC-SECURITY-RLS-007 exige el invariante nuevo por tabla de `platform.workspace_scoped_table`, con la tabla vacía y con filas de otro workspace. TC-SECURITY-RLS-002 no cambia.
- **Docs:** docs/08 (§1.4 y tabla de errores), docs/12 y docs/23 §5.5 se corrigen; docs/38 quita el bloqueo de la fila 49.
- **D296 sigue vigente:** el hallazgo previo de `platform.idempotency_key` e `iam.workspace_export` (vacío sin `PF002` con la política anterior) es coherente con el invariante nuevo, pero se revisa en el change de seguridad aparte.

## Pendiente del owner

Ninguna pregunta queda abierta por esta decisión.
