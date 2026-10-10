---
id: TC-GOALS-SAVINGS-015
title: "Reservar exactamente el disponible se acepta; reservar sobre una cuenta llena de aportes reales se rechaza (PBT)"
spec: goals/savings-goals
related_specs: []
requirement: "Reservas limitadas por el saldo de la cuenta"
scenario: "Reserva exactamente igual al disponible"
requirement_status: provisional
fr: ["FR-GOALS-004"]
nfr: []
invariants: ["INV-018"]
priority: high
type: property
level: property
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ["goals", "earmark", "guard", "pbt"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda base BOB, TZ America/La_Paz y día de inicio del mes financiero 1"
  - "Cuentas activas \"Banco BOB\" (bank, LIQUID), \"Ahorro BOB\" (savings, LIQUID), \"Efectivo BOB\" (cash), \"Caja USD\" (cash, USD) y \"Tarjeta X\" (credit_card, BOB)"
  - "\"Banco BOB\" saldo 7000.00 BOB, reservado 3500.00 BOB"
  - "\"Ahorro BOB\" saldo 1000.00 BOB, todo aporte real de \"Fondo de emergencia\""
input: {"earmark_banco": "3500.00 BOB", "earmark_ahorro": "1.00 BOB"}
steps:
  - "Reservar 3500.00 BOB de \"Banco BOB\" para \"Laptop\""
  - "Reservar 1.00 BOB de \"Ahorro BOB\" para \"Laptop\""
  - "PBT: secuencias aleatorias de reservas, liberaciones y reasignaciones sobre una cuenta con saldo fijo"
expected_result:
  - "La primera se acepta y el disponible queda 0.00 BOB"
  - "La segunda se rechaza con EARMARK_EXCEEDS_BALANCE"
  - "PBT: tras cada comando aceptado reservado ≤ saldo"
created: 2026-10-10
updated: 2026-10-10
---

# TC-GOALS-SAVINGS-015 — Reservar exactamente el disponible se acepta; reservar sobre una cuenta llena de aportes reales se rechaza (PBT)

## Intención

El límite es inclusivo y considera los fondos reales, no solo las reservas.

## Escenario

```gherkin
Dado "Banco BOB" con 3500.00 BOB disponibles
Cuando el EDITOR reserva 3500.00 BOB
Entonces se acepta
  Y el disponible queda en 0.00 BOB
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
