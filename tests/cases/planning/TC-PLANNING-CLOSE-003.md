---
id: TC-PLANNING-CLOSE-003
title: Las advertencias deben reconocerse y quedan registradas en el snapshot
spec: planning/month-closing
related_specs: []
requirement: Advertencias reconocidas explícitamente
scenario: Advertencias reconocidas
requirement_status: provisional
fr:
  - FR-PLANNING-003
  - FR-PLANNING-004
nfr: []
invariants: []
priority: high
type: api
level: api
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 2
tags:
  - month-closing
  - checklist
error_code: MONTH_CLOSING_WARNINGS_NOT_ACKNOWLEDGED
preconditions:
  - '"2026-10" terminado, sin bloqueantes, con 3 porciones sin categoría por 210.00 BOB (WARNING)'
  - Usuario EDITOR
input:
  - acknowledgeWarnings: false
  - acknowledgeWarnings: true
steps:
  - Cerrar sin reconocer advertencias
  - Cerrar reconociendo advertencias
  - Leer el snapshot 1
expected_result:
  - "Sin reconocimiento: 409 MONTH_CLOSING_WARNINGS_NOT_ACKNOWLEDGED con warningItems = [UNCATEGORIZED]; periodo active"
  - "Con reconocimiento: periodo closed"
  - El snapshot registra la advertencia de 3 porciones sin categoría por 210.00 BOB reconocida por ese EDITOR
created: 2026-10-05
updated: 2026-10-05
---

# TC-PLANNING-CLOSE-003 — Las advertencias deben reconocerse y quedan registradas en el snapshot

## Intención

Las advertencias no bloquean, pero el cierre deja constancia de que se aceptaron conscientemente.

## Escenario

```gherkin
Dado que el checklist de "2026-10" solo tiene advertencias
Cuando el EDITOR cierra sin reconocerlas
Entonces se rechaza con "MONTH_CLOSING_WARNINGS_NOT_ACKNOWLEDGED"
Cuando cierra reconociéndolas
Entonces el snapshot registra las advertencias reconocidas
```

## Notas

- Cubre también "Advertencias sin reconocer".
