---
id: TC-CLASSIFICATION-COUNTERPARTY-001
title: Crear una counterparty con categoría por defecto y rechazar nombres equivalentes
spec: classification/counterparties
related_specs: []
requirement: Gestión de counterparties
scenario: Nombre equivalente sin acentos
requirement_status: confirmed
fr: [FR-CLASSIFICATION-010]
nfr: []
invariants: []
priority: high
type: api
level: api
automation_status: automated
automated_tests:
  - packages/contexts/classification/src/domain/domain.test.ts
  - packages/contexts/classification/src/application/classification.service.test.ts
status: automated
regression_suite: false
phase: 1
tags: [counterparties]
error_code: NAME_TAKEN
preconditions:
- Categoría activa "Supermercado" y categoría archivada "Old Gym"
- Counterparty activa "Tigo Bolivia"
input:
- create:
    name: Hipermaxi
    kind: MERCHANT
    defaultCategory: Supermercado
- create:
    name: TIGO bolivia
    kind: SERVICE_PROVIDER
- create:
    name: Gimnasio X
    kind: MERCHANT
    defaultCategory: Old Gym
steps:
- Enviar cada creación
expected_result:
- '"Hipermaxi" responde 201 activa con defaultCategoryId = Supermercado'
- '"TIGO bolivia" responde 409 NAME_TAKEN'
- '"Gimnasio X" responde 409 CATEGORY_ARCHIVED'
created: 2026-10-02
updated: 2026-10-03
---

# TC-CLASSIFICATION-COUNTERPARTY-001 — Crear una counterparty con categoría por defecto y rechazar nombres equivalentes

## Intención

FR-CLASSIFICATION-010: atributos, unicidad normalizada y categoría por defecto activa.

## Escenario

```gherkin
Dada la counterparty activa "Tigo Bolivia"
Cuando el usuario crea "TIGO bolivia"
Entonces se rechaza con "NAME_TAKEN"
```
