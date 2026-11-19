---
id: TC-PLATFORM-EVENTS-020
title: "El relay selecciona por lote las mismas cabezas pendientes que antes, una por agregado y workspace"
spec: platform/event-delivery
related_specs: []
requirement: "Selección de cabezas del relay acotada e independiente de las estadísticas"
scenario: "Misma selección que antes con varios agregados y workspaces"
requirement_status: provisional
fr: []
nfr: ["NFR-PERF-008", "NFR-REL-008"]
invariants: []
priority: critical
type: integration
level: database-integration
automation_status: automated
automated_tests:
  - "apps/api/test/events/relay-heads.int.test.ts"
status: automated
regression_suite: true
phase: 8
tags: ["ordering", "relay", "outbox", "fix-outbox-relay-head-query"]
error_code: null
preconditions:
  - "PostgreSQL real con el relay como pf_worker"
  - "Datos sintéticos; ningún dato del owner"
input: {"workspaces": 2, "aggregates_per_workspace": 4, "events_per_aggregate": "1 a 4", "shared_aggregate_id": true, "batchSize": 3}
steps:
  - "Confirmar eventos pendientes intercalados de varios agregados en dos workspaces, con un aggregate_id presente en ambos"
  - "Calcular en el test la selección de referencia de cada lote: mínimo sequence por (workspace_id, aggregate_id), orden por sequence, primeros 3"
  - "Correr lotes del relay hasta vaciar el outbox y registrar los ids de cada lote"
expected_result:
  - "Cada lote coincide en contenido y orden con la selección de referencia"
  - "Ningún evento sale en el mismo lote que otro anterior de su agregado; el agregado compartido sale una vez por workspace"
  - "Al vaciar el outbox cada agregado publicó todos sus eventos en orden de confirmación"
created: 2026-11-17
updated: 2026-11-17
---

# TC-PLATFORM-EVENTS-020 — El relay selecciona por lote las mismas cabezas pendientes que antes, una por agregado y workspace

## Intención

Equivalencia funcional de la consulta de cabezas con subconsulta escalar frente al `NOT EXISTS` anterior: mismas filas, mismo orden, una cabeza por `(workspace_id, aggregate_id)`, sucesores en lotes posteriores. Complementa TC-PLATFORM-EVENTS-013, que cubre la caída de la cola.

## Escenario

```gherkin
Dado eventos pendientes intercalados de varios agregados en dos workspaces que comparten un aggregate_id
Cuando el relay corre lotes de tamaño 3 hasta vaciar el outbox
Entonces cada lote son las 3 primeras cabezas pendientes por orden de confirmación
  Y ningún sucesor sale junto a su cabeza
  Y cada agregado publica todos sus eventos en orden
```

## Notas

- Debe pasar con la consulta anterior y con la nueva (test de equivalencia); se puede evaluar además la consulta anterior literal dentro de una transacción revertida como referencia.
