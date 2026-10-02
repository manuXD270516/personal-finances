---
id: TC-TRANSACTIONS-SPLIT-003
title: "El reparto en partes iguales o por porcentaje es exacto y reproducible"
spec: transactions/splits
related_specs: ["ledger/journal-posting"]
requirement: "Reparto determinista por porcentaje o partes iguales"
scenario: "Tres partes iguales de 100.00 BOB"
requirement_status: confirmed
fr: [FR-TRANSACTIONS-027]
nfr: [NFR-DATA-003]
invariants: [INV-020, INV-021]
priority: critical
type: property
level: property
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: true
phase: 1
tags: ["splits", "rounding", "largest-remainder"]
error_code: null
preconditions: ["Regla de desempate: ante residuos iguales gana el índice menor"]
input:
  - total: "100.00 BOB"
    mode: "equal"
    parts: 3
    expected: ["33.34", "33.33", "33.33"]
  - total: "10.000001 USDT"
    mode: "percent"
    weights: ["50", "50"]
    expected: ["5.000001", "5.000000"]
  - total: "10.01 BOB"
    mode: "percent"
    weights: ["50", "30", "20"]
    expected: ["5.01", "3.00", "2.00"]
steps: ["Pedir cada reparto dos veces", "Generar montos y pesos aleatorios (fast-check)"]
expected_result:
  - "Los splits resultantes son exactamente los esperados y suman el total"
  - "Repetir el pedido produce el mismo resultado"
  - "PBT: para todo monto y pesos > 0, la suma es exacta y cada parte difiere de su cuota ideal en menos de una unidad de escala"
created: 2026-10-02
updated: 2026-10-02
---

# TC-TRANSACTIONS-SPLIT-003 — El reparto en partes iguales o por porcentaje es exacto y reproducible

## Intención

El reparto nunca debe crear ni perder centavos (INV-020, NFR-DATA-003).

## Escenario

```gherkin
Dado un gasto de 100.00 BOB
Cuando el usuario lo reparte en tres partes iguales
Entonces los splits son 33.34, 33.33 y 33.33 BOB
```

## Notas

- Comparte reglas con TC-LEDGER-MONEY-005 (Money.allocate del shared-kernel).
