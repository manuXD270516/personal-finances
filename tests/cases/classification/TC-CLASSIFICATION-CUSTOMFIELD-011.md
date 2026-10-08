---
id: TC-CLASSIFICATION-CUSTOMFIELD-011
title: "Un VIEWER ve custom fields pero no puede gestionarlos"
spec: classification/custom-fields
related_specs: ["security/access-control"]
requirement: "Gestión de custom fields restringida por rol"
scenario: "VIEWER intenta definir un custom field"
requirement_status: confirmed
fr: [FR-CLASSIFICATION-009, FR-IDENTITY-006]
nfr: [NFR-SEC-003]
invariants: []
priority: high
type: security
level: security
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 2
tags: ["custom-fields", "rbac"]
error_code: "INSUFFICIENT_ROLE"
preconditions:
  - "Custom field de transacción \"centro_costo\" (SELECT, opciones \"casa\" y \"oficina\", no obligatorio)"
  - "Usuario VIEWER en \"W1\""
input:
  - "{\"action\":\"list\"}"
  - "{\"action\":\"create\",\"key\":\"proyecto\"}"
  - "{\"action\":\"archive\",\"key\":\"centro_costo\"}"
steps:
  - "VIEWER lista, define y archiva"
expected_result:
  - "Listar: 200 con \"centro_costo\""
  - "Definir y archivar: 403 INSUFFICIENT_ROLE"
created: 2026-10-05
updated: 2026-10-08
---

# TC-CLASSIFICATION-CUSTOMFIELD-011 — Un VIEWER ve custom fields pero no puede gestionarlos

## Intención

docs/10 §14: gestionar catálogos es EDITOR+.

## Escenario

```gherkin
Dado un VIEWER del workspace
Cuando intenta definir "proyecto"
Entonces se rechaza con "INSUFFICIENT_ROLE"
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock`.
