---
id: TC-LEDGER-MONEY-001
title: No se puede crear Money a partir de un number de JavaScript
spec: ledger/journal-posting
related_specs: []
requirement: Aritmética monetaria decimal exacta
scenario: Valores no decimales
requirement_status: confirmed
fr: [FR-LEDGER-007]
nfr: [NFR-DATA-001]
invariants: [INV-001]
priority: critical
type: unit
level: unit
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: true
phase: 1
tags: [money, shared-kernel, tdd]
error_code: MONEY_INVALID_AMOUNT
preconditions:
- Value object Money de @pf/shared-kernel
input:
  valid:
  - '"0.1"'
  - '"685.00"'
  - '"-100.000000"'
  invalid_runtime:
  - 0.1 (number, forzado mediante cast)
  - NaN
  - '"1e3"'
  - '" 1.00"'
  - '"1,00"'
  - '"Infinity"'
  - '""'
steps:
- Llamar a Money.of(amount, currency) con cada valor
expected_result:
- Los strings decimales válidos producen Money con el valor exacto
- Pasar un number no compila en el chequeo de tipos (verificado con @ts-expect-error)
- Cada valor inválido lanza MONEY_INVALID_AMOUNT en tiempo de ejecución
created: 2026-10-01
updated: 2026-10-02
---

# TC-LEDGER-MONEY-001 — No se puede crear Money a partir de un number de JavaScript

## Intención

INV-001: el dinero nunca es un float. Se combina con la regla de ESLint pf/no-number-money (TC-PLATFORM-ARCH-002).

## Escenario

```gherkin
Dado el value object Money
Cuando se crea a partir del number 0.1
Entonces la creación falla con el código "MONEY_INVALID_AMOUNT"
Cuando se crea a partir del string "0.1" en BOB
Entonces su monto es exactamente 0.1
```
