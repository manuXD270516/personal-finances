---
id: TC-PLATFORM-ARCH-002
title: "Una regla de ESLint prohíbe tipos number y el parseo de flotantes para valores monetarios"
spec: platform/delivery-pipeline
related_specs: []
requirement: "Quality gate de pull request"
scenario: null
requirement_status: confirmed
fr: []
nfr: [NFR-MAINT-001, NFR-MAINT-006, NFR-MAINT-008]
invariants: [INV-001]
priority: critical
type: platform
level: architecture
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: true
phase: 1
tags: ["eslint", "money"]
error_code: null
preconditions:
  - "tools/eslint-plugin-pf con las reglas pf/no-number-money y pf/no-float-parse"
input:
  invalid:
    - "interface Expense { amount: number }"
    - "Money.of(10.5, \"BOB\")"
    - "const fee = parseFloat(dto.fee)"
    - "total.toFixed(2)"
  valid:
    - "interface Expense { amount: Money }"
    - "Money.of(\"10.50\", \"BOB\")"
    - "const count: number = items.length"
steps: ["Ejecutar el RuleTester de ESLint con las muestras inválidas y válidas"]
expected_result:
  - "Cada muestra inválida reporta la regla correspondiente"
  - "Las muestras válidas no reportan nada (sin falsos positivos en números no monetarios)"
created: 2026-10-01
updated: 2026-10-02
---

# TC-PLATFORM-ARCH-002 — Una regla de ESLint prohíbe tipos number y el parseo de flotantes para valores monetarios

## Intención

INV-001 se aplica de forma estática antes de que se ejecute cualquier prueba.

## Escenario

```gherkin
Dada una propiedad "amount" tipada como number
Cuando se ejecuta el lint
Entonces la regla "pf/no-number-money" reporta un error
```
