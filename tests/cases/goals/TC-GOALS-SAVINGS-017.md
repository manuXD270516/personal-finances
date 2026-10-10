---
id: TC-GOALS-SAVINGS-017
title: "Dentro de un episodio solo cambia el faltante; un ingreso que cubre lo reservado cierra el episodio y la próxima caída publica otro"
spec: goals/savings-goals
related_specs: []
requirement: "Meta sobre-asignada cuando el saldo cae"
scenario: "Ingreso que resuelve el episodio"
requirement_status: provisional
fr: ["FR-GOALS-004"]
nfr: []
invariants: ["INV-018"]
priority: high
type: domain
level: domain
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ["goals", "over-allocation"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda base BOB, TZ America/La_Paz y día de inicio del mes financiero 1"
  - "Cuentas activas \"Banco BOB\" (bank, LIQUID), \"Ahorro BOB\" (savings, LIQUID), \"Efectivo BOB\" (cash), \"Caja USD\" (cash, USD) y \"Tarjeta X\" (credit_card, BOB)"
  - "\"Banco BOB\" sobre-asignada con faltante 1200.00 BOB (TC-GOALS-SAVINGS-016)"
input: {"expense2": "100.00 BOB", "income": "2000.00 BOB", "expense3": "800.00 BOB"}
steps:
  - "Postear un gasto de 100.00 BOB"
  - "Postear un ingreso de 2000.00 BOB (saldo 7700.00 BOB)"
  - "Postear un gasto de 800.00 BOB (saldo 6900.00 BOB)"
expected_result:
  - "Tras el gasto de 100.00 BOB: faltante 1300.00 BOB, sin hecho nuevo"
  - "Tras el ingreso: estado NORMAL y marcas quitadas, sin hecho"
  - "Tras el gasto de 800.00 BOB: episodio nuevo con faltante 100.00 BOB y un hecho nuevo con otro episodeId"
created: 2026-10-10
updated: 2026-10-10
---

# TC-GOALS-SAVINGS-017 — Dentro de un episodio solo cambia el faltante; un ingreso que cubre lo reservado cierra el episodio y la próxima caída publica otro

## Intención

Un aviso por episodio evita ruido y no pierde una caída nueva.

## Escenario

```gherkin
Dado "Banco BOB" sobre-asignada con faltante 1200.00 BOB
Cuando se postea otro gasto de 100.00 BOB
Entonces el faltante es 1300.00 BOB sin hecho nuevo
Cuando se postea un ingreso de 2000.00 BOB
Entonces se quitan las marcas
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
