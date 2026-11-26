---
id: TC-AUDIT-LIFECYCLE-029
title: "Una fusión de contraparte rechazada no deja rastro en los recorridos"
spec: audit/lifecycle-timeline
related_specs: ["classification/counterparties"]
requirement: "Fusión en el recorrido de categorías y contrapartes"
scenario: "Fusión de contraparte rechazada"
requirement_status: provisional
fr: ["FR-AUDIT-009","FR-CLASSIFICATION-013"]
nfr: []
invariants: []
priority: low
type: api
level: api
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 9
tags: ["lifecycle","merge","counterparties"]
error_code: "COUNTERPARTY_ARCHIVED"
preconditions:
  - "Workspace \"W1\" en BOB; \"HIPERMAXI S.A.\" activa y \"Hiper Viejo\" archivada; usuario EDITOR"
input: {}
steps:
  - "se intenta fusionar \"HIPERMAXI S.A.\" en \"Hiper Viejo\""
  - "se consultan los dos recorridos"
expected_result:
  - "la fusión responde 409 COUNTERPARTY_ARCHIVED"
  - "ninguno de los dos recorridos tiene transiciones ni anotaciones nuevas"
created: 2026-11-25
updated: 2026-11-25
---

# TC-AUDIT-LIFECYCLE-029 — Una fusión de contraparte rechazada no deja rastro en los recorridos

## Intención

Verifica el scenario "Fusión de contraparte rechazada" del requirement "Fusión en el recorrido de categorías y contrapartes" de `audit/lifecycle-timeline` (FR-AUDIT-009, FR-CLASSIFICATION-013).

## Escenario

```gherkin
Dado Workspace "W1" en BOB; "HIPERMAXI S.A." activa y "Hiper Viejo" archivada; usuario EDITOR
Cuando se intenta fusionar "HIPERMAXI S.A." en "Hiper Viejo"
Y se consultan los dos recorridos
Entonces la fusión responde 409 COUNTERPARTY_ARCHIVED
Y ninguno de los dos recorridos tiene transiciones ni anotaciones nuevas
```

## Notas

- Change `add-category-and-counterparty-merge` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
