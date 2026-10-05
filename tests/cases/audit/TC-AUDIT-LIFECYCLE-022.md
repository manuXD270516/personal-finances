---
id: TC-AUDIT-LIFECYCLE-022
title: "El CSV del recorrido neutraliza un motivo que empieza con ="
spec: audit/lifecycle-timeline
related_specs: []
requirement: "Exportación del recorrido en CSV"
scenario: "Motivo que parece una fórmula"
requirement_status: confirmed
fr: ["FR-AUDIT-013"]
nfr: ["NFR-SEC-003"]
invariants: []
priority: high
type: security
level: api
automation_status: automated
automated_tests:
  - apps/api/test/api/lifecycle-export.api.test.ts
  - packages/contexts/audit/src/application/lifecycle-export.test.ts
status: automated
regression_suite: false
phase: 1
tags: ["lifecycle", "export", "security"]
error_code: null
preconditions:
  - "\"Bank A\" con 1000.00 BOB"
  - "Gasto posteado de 40.00 BOB anulado con motivo \"=SUM(A1:A9)\""
input: {"request": "GET W/transactions/{transactionId}/lifecycle/export?format=csv"}
steps:
  - "Exportar el recorrido a CSV"
  - "Leer la celda del motivo de la fila VOID"
expected_result:
  - "La celda contiene '=SUM(A1:A9) (prefijo ' que neutraliza la fórmula)"
  - "Lo mismo aplica a cualquier texto del archivo que empiece con =, +, - o @"
created: 2026-10-05
updated: 2026-10-05
---

# TC-AUDIT-LIFECYCLE-022 — El CSV del recorrido neutraliza un motivo que empieza con =

## Intención

Evita inyección de fórmulas al abrir el CSV en una planilla (docs/12, docs/14 §12).

## Escenario

```gherkin
Dado un gasto anulado con un motivo que parece una fórmula
Cuando exporto su recorrido a CSV
Entonces la celda del motivo queda neutralizada
```

## Notas

- Convención de escape de docs/14 §12 (prefijo ').
- Decisión del owner docs/31 D52 (2026-10-05). Automatizado en las tareas 9.x de add-lifecycle-timeline.
