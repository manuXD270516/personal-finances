---
id: TC-AUDIT-LIFECYCLE-018
title: "El recorrido de una contraparte creada en línea lista crear, archivar y desarchivar sin tocar el gasto"
spec: audit/lifecycle-timeline
related_specs: ["classification/counterparties", "transactions/transaction-recording"]
requirement: "Recorrido de una contraparte"
scenario: "Contraparte creada en línea, archivada y desarchivada"
requirement_status: confirmed
fr: ["FR-AUDIT-009", "FR-AUDIT-010", "FR-CLASSIFICATION-012"]
nfr: []
invariants: ["INV-033"]
priority: high
type: api
level: api
automation_status: not_automated
status: ready
regression_suite: false
phase: 1
tags: ["lifecycle", "classification", "api"]
error_code: null
preconditions:
  - "\"Bank A\" con 1000.00 BOB"
  - "FixedClock 2026-03-10T10:00:00-04:00, avanzando 1 h por paso"
input: {"sequence": ["POST W/transactions gasto 120.00 BOB con contraparte nueva \"Entel\" (inline)", "PATCH alias [\"ENTEL S.A.\"]", "ARCHIVE", "UNARCHIVE"]}
steps:
  - "Ejecutar la secuencia"
  - "GET W/counterparties/{counterpartyId}/lifecycle"
  - "Consultar el gasto y su asiento"
expected_result:
  - "items en orden: TRANSITION CREATE (∅ a ACTIVE), ANNOTATION changedFields [aliases], TRANSITION ARCHIVE, TRANSITION UNARCHIVE"
  - "currentState ACTIVE y path [ACTIVE, ARCHIVED, ACTIVE]"
  - "El gasto sigue en 120.00 BOB, revisión 1, con el mismo asiento; \"Bank A\" en 880.00 BOB"
created: 2026-10-05
updated: 2026-10-05
---

# TC-AUDIT-LIFECYCLE-018 — El recorrido de una contraparte creada en línea lista crear, archivar y desarchivar sin tocar el gasto

## Intención

La contraparte creada desde el formulario de transacción tiene su propio recorrido, sin efecto en el ledger (D52).

## Escenario

```gherkin
Dado un gasto de 120.00 BOB que crea en línea la contraparte "Entel"
Cuando le agrego un alias, la archivo y la desarchivo
Entonces su recorrido muestra crear, archivar y desarchivar
  Y el gasto no cambia
```

## Notas

- 1000.00 − 120.00 = 880.00 BOB.
- Decisión del owner docs/31 D52 (2026-10-05). Pendiente de automatizar por la implementación (tareas 9.x de add-lifecycle-timeline).
