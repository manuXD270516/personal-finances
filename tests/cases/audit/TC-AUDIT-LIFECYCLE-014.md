---
id: TC-AUDIT-LIFECYCLE-014
title: "Las máquinas de Category y Counterparty declaran ACTIVE y ARCHIVED con crear, archivar y desarchivar, sin fusión"
spec: audit/lifecycle-timeline
related_specs: ["classification/categories", "classification/counterparties"]
requirement: "Máquina de estados declarada por agregado"
scenario: "Definición de la máquina de una categoría y de una contraparte"
requirement_status: confirmed
fr: ["FR-AUDIT-009"]
nfr: []
invariants: []
priority: high
type: domain
level: domain
automation_status: not_automated
status: ready
regression_suite: false
phase: 1
tags: ["lifecycle", "classification"]
error_code: null
preconditions:
  - "Máquinas CATEGORY_LIFECYCLE y COUNTERPARTY_LIFECYCLE declaradas en el dominio de CLASSIFICATION"
input: {"aggregateTypes": ["Category", "Counterparty"]}
steps:
  - "Consultar GET W/lifecycle-machines/Category y GET W/lifecycle-machines/Counterparty"
  - "Intentar en el dominio ARCHIVE sobre una categoría ARCHIVED y UNARCHIVE sobre una contraparte ACTIVE"
expected_result:
  - "Cada máquina tiene estados ACTIVE y ARCHIVED, ninguno terminal"
  - "Transiciones CREATE (from [] a ACTIVE), ARCHIVE (ACTIVE a ARCHIVED) y UNARCHIVE (ARCHIVED a ACTIVE), cada una con guarda"
  - "ARCHIVE de Category declara el evento classification.CategoryArchived.v1; Counterparty no declara eventos"
  - "No existe transición MERGE en ninguna de las dos"
  - "Las transiciones no declaradas se rechazan con INVALID_STATUS_TRANSITION"
created: 2026-10-05
updated: 2026-10-05
---

# TC-AUDIT-LIFECYCLE-014 — Las máquinas de Category y Counterparty declaran ACTIVE y ARCHIVED con crear, archivar y desarchivar, sin fusión

## Intención

Fija las máquinas que el owner pidió para categorías y contrapartes (D52) usando solo las operaciones que define classification.

## Escenario

```gherkin
Dado el catálogo de máquinas declaradas
Cuando consulto las de Category y Counterparty
Entonces ambas tienen ACTIVE y ARCHIVED con crear, archivar y desarchivar
  Y ninguna declara fusión
```

## Notas

- La fusión (FR-CLASSIFICATION-007/013) es Could de Phase 2; cuando llegue, su change agrega la transición con machineVersion 2.
- Las categorías de sistema tienen la misma máquina; la guarda de ARCHIVE las rechaza con SYSTEM_CATEGORY_IMMUTABLE (TC-AUDIT-LIFECYCLE-017).
- Decisión del owner docs/31 D52 (2026-10-05). Pendiente de automatizar por la implementación (tareas 9.x de add-lifecycle-timeline).
