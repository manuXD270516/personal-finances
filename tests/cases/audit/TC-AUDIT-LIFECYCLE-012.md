---
id: TC-AUDIT-LIFECYCLE-012
title: "Los registros de transición son inmutables en la base de datos"
spec: audit/lifecycle-timeline
related_specs: []
requirement: "Registro de transición atómico con el cambio"
scenario: "Registro de transición inmutable"
requirement_status: confirmed
fr: ["FR-AUDIT-009","FR-AUDIT-003"]
nfr: []
invariants: ["INV-007","INV-029"]
priority: critical
type: security
level: database-integration
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: true
phase: 1
tags: ["lifecycle","immutability"]
error_code: null
preconditions:
  - "Una transición registrada en W1"
input: {"statements":["UPDATE audit.lifecycle_transition SET reason = 'x'","DELETE FROM audit.lifecycle_transition","TRUNCATE audit.lifecycle_transition"]}
steps:
  - "Ejecutar cada sentencia con pf_app y con pf_worker"
expected_result:
  - "Todas fallan (sin grant o SQLSTATE PF003)"
  - "La transición queda igual"
created: 2026-10-03
updated: 2026-10-03
---

# TC-AUDIT-LIFECYCLE-012 — Los registros de transición son inmutables en la base de datos

## Intención

Un recorrido editable no sería evidencia (FR-AUDIT-003).

## Escenario

```gherkin
Dada una transición registrada
Cuando un proceso intenta modificarla o borrarla
Entonces la base de datos lo rechaza
```

## Notas

- Si add-demo-data está aplicado, la única excepción es la purga de un workspace demo (ADR-0026).
