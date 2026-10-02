---
id: TC-CLASSIFICATION-SYSTEM-003
title: El nombre de una categoría de sistema se muestra en el idioma del usuario
spec: classification/categories
related_specs: []
requirement: Nombres traducibles de las categorías de sistema
scenario: Mismo concepto en dos idiomas
requirement_status: confirmed
fr: [FR-CLASSIFICATION-003]
nfr: []
invariants: []
priority: medium
type: api
level: api
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: false
phase: 1
tags: [system-categories, i18n]
error_code: null
preconditions:
- 'Workspace con dos miembros: U1 con locale es-BO y U2 con locale en'
- Gasto de 12.00 BOB en la categoría FEES
input:
  request: GET /api/v1/workspaces/{W1}/categories/{FEES}
steps:
- Consultar como U1
- Consultar como U2
expected_result:
- U1 recibe name = "Comisiones"; U2 recibe name = "Fees"
- Ambos reciben el mismo id y systemCode FEES
- El gasto de 12.00 BOB aparece bajo la misma categoría para ambos
created: 2026-10-02
updated: 2026-10-02
---

# TC-CLASSIFICATION-SYSTEM-003 — El nombre de una categoría de sistema se muestra en el idioma del usuario

## Intención

Nombres visibles traducibles sin alterar identidad (FR-CLASSIFICATION-003; UI en es con en/pt preparados).

## Escenario

```gherkin
Dados un usuario en "es-BO" y otro en "en"
Cuando ambos consultan la categoría de sistema de comisiones
Entonces el primero ve "Comisiones" y el segundo "Fees"
```

## Notas

- Locale sin traducción (p. ej. fr) cae a español.
