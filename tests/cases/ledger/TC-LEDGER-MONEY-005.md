---
id: TC-LEDGER-MONEY-005
title: "La distribución por mayor residuo reparte las unidades menores de forma determinista"
spec: ledger/journal-posting
related_specs: ["transactions/splits"]
requirement: "Redondeo y distribución deterministas"
scenario: null
requirement_status: provisional
fr: [FR-LEDGER-006]
nfr: []
invariants: [INV-020, INV-001]
priority: critical
type: unit
level: unit
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: true
phase: 1
tags: ["allocation", "tdd"]
error_code: null
preconditions:
  - "Regla de desempate (provisional): ante residuos iguales se favorece el índice menor"
input:
  - total: "100.00 BOB"
    weights: [1, 1, 1]
    expected: ["33.34", "33.33", "33.33"]
  - total: "10.01 BOB"
    weights: [50, 30, 20]
    expected: ["5.01", "3.00", "2.00"]
  - total: "-100.00 BOB"
    weights: [1, 1, 1]
    expected: ["-33.34", "-33.33", "-33.33"]
  - total: "0.000001 USDT"
    weights: [1, 1]
    expected: ["0.000001", "0.000000"]
steps: ["Llamar a Money.allocate(weights) para cada caso"]
expected_result:
  - "Los resultados son exactamente iguales a las partes esperadas"
  - "Las partes siempre suman el total"
created: 2026-10-01
updated: 2026-10-01
---

# TC-LEDGER-MONEY-005 — La distribución por mayor residuo reparte las unidades menores de forma determinista

## Intención

Las divisiones (splits) y las cuotas nunca deben perder ni inventar un centavo (ARCHITECTURE §4.6).

## Escenario

```gherkin
Dado un total de 100.00 BOB
Cuando se distribuye en tres partes iguales
Entonces las partes son 33.34, 33.33 y 33.33 BOB
  Y las partes suman 100.00 BOB
```

## Notas

- 10.01 x [50,30,20]: exactos 5.005/3.003/2.002 → pisos 5.00/3.00/2.00 (suma 10.00); el 0.01 restante va al mayor residuo fraccionario (índice 0).
