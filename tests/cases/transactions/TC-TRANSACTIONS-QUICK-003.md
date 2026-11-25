---
id: TC-TRANSACTIONS-QUICK-003
title: "Dos gastos seguidos sin salir del formulario dejan el saldo en 925.00 BOB"
spec: transactions/transaction-recording
related_specs: []
requirement: "Registrar y seguir registrando"
scenario: "Dos gastos seguidos"
requirement_status: confirmed
fr: ["FR-TRANSACTIONS-001","FR-TRANSACTIONS-010"]
nfr: ["NFR-USAB-007"]
invariants: []
priority: critical
type: e2e
level: e2e
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 9
tags: ["quick-capture","money","idempotency"]
error_code: null
preconditions:
  - "un EDITOR con sesión"
  - "\"Banco BOB\" activa con saldo 1000.00 BOB"
  - "categorías \"Alimentación\" y \"Transporte\""
  - "fecha fija 2026-11-25 en America/La_Paz"
input:
  monto1: "45.00"
  monto2: "30.00"
  moneda: "BOB"
steps:
  - "el usuario registra 45.00 BOB en \"Alimentación\" con \"Registrar\""
  - "registra 30.00 BOB en \"Transporte\" con \"Registrar\""
expected_result:
  - "tras el primero la URL sigue en /transacciones/nueva, el monto está vacío y con foco, la cuenta es \"Banco BOB\" y la fecha 2026-11-25"
  - "aparece el aviso \"Gasto de Bs 45,00 registrado\" con \"Deshacer\" y \"Ver\""
  - "las dos solicitudes POST llevan claves de idempotencia distintas"
  - "existen dos gastos distintos y el saldo de \"Banco BOB\" es 925.00 BOB"
  - "el flujo completo con categoría sugerida aceptada usa como máximo 4 interacciones por gasto"
created: 2026-11-25
updated: 2026-11-25
---

# TC-TRANSACTIONS-QUICK-003 — Dos gastos seguidos sin salir del formulario dejan el saldo en 925.00 BOB

## Intención

Verifica D502 y NFR-USAB-007: varios gastos seguidos sin navegar, sin reutilizar la clave de idempotencia y con el saldo correcto.

## Escenario

```gherkin
Dado un EDITOR con sesión
  Y "Banco BOB" activa con saldo 1000.00 BOB
  Y categorías "Alimentación" y "Transporte"
  Y fecha fija 2026-11-25 en America/La_Paz
Cuando el usuario registra 45.00 BOB en "Alimentación" con "Registrar"
  Y registra 30.00 BOB en "Transporte" con "Registrar"
Entonces tras el primero la URL sigue en /transacciones/nueva, el monto está vacío y con foco, la cuenta es "Banco BOB" y la fecha 2026-11-25
  Y aparece el aviso "Gasto de Bs 45,00 registrado" con "Deshacer" y "Ver"
  Y las dos solicitudes POST llevan claves de idempotencia distintas
  Y existen dos gastos distintos y el saldo de "Banco BOB" es 925.00 BOB
  Y el flujo completo con categoría sugerida aceptada usa como máximo 4 interacciones por gasto
```

## Notas

- Change `add-quick-capture` (lote L2, docs/78; decisiones en docs/79). Datos ficticios; ningún dato real del owner.
