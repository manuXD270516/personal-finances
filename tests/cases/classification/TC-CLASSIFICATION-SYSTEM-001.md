---
id: TC-CLASSIFICATION-SYSTEM-001
title: Un workspace nuevo sin catálogo contiene exactamente las categorías de sistema
spec: classification/categories
related_specs: []
requirement: Categorías de sistema provisionadas en cada workspace
scenario: Workspace nuevo sin catálogo inicial
requirement_status: confirmed
fr: [FR-CLASSIFICATION-003]
nfr: []
invariants: []
priority: critical
type: integration
level: application
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: true
phase: 1
tags: [system-categories, workspace]
error_code: null
preconditions:
- Usuario autenticado sin workspaces
input:
  createWorkspace:
    name: Personal
    baseCurrency: BOB
    seedDefaultCategories: false
steps:
- Crear el workspace
- Listar todas las categorías con includeArchived=true
expected_result:
- 'Existen exactamente 11 categorías, todas con systemCode: FEES, FX_FEES, INTEREST, LOAN_FEES, INSURANCE, TAXES, ADJUSTMENTS, UNCATEGORIZED (EXPENSE) e INTEREST_EARNED, ADJUSTMENTS_INCOME, UNCATEGORIZED_INCOME (INCOME)'
- No existe ninguna categoría de usuario
- Reprovisionar el mismo workspace no crea duplicados
created: 2026-10-02
updated: 2026-10-02
---

# TC-CLASSIFICATION-SYSTEM-001 — Un workspace nuevo sin catálogo contiene exactamente las categorías de sistema

## Intención

Transactions, transferencias y conversiones dependen de UNCATEGORIZED y FEES desde la primera operación.

## Escenario

```gherkin
Dado un usuario sin workspaces
Cuando crea un workspace sin catálogo inicial
Entonces el workspace contiene solo las 11 categorías de sistema con su código y tipo
```

## Notas

- OPENING_BALANCE no se provisiona (pregunta abierta en design.md).
