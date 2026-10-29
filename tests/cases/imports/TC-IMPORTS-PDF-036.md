---
id: TC-IMPORTS-PDF-036
title: "La vista previa muestra la diferencia entre el saldo inicial del extracto y el de la cuenta"
spec: imports/import-pipeline
related_specs: []
requirement: "Saldo inicial del extracto PDF contra el saldo de la cuenta"
scenario: "Mes anterior sin importar"
requirement_status: provisional
fr: ["FR-IMPORTS-011"]
nfr: []
invariants: []
priority: medium
type: integration
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 6
tags: ["imports", "pdf"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda base BOB y zona America/La_Paz"
  - "FixedClock en 2026-10-20T10:00:00-04:00"
  - "Cuenta \"Banco BOB\" (ASSET, activa, BOB, últimos dígitos registrados \"0001\")"
  - "EDITOR \"Ana\" autenticada salvo indicación"
  - "Extractos PDF generados por código desde movimientos sintéticos (marca SINTETICO), nunca versionados; documentos con propósito extracto para importar disponibles"
  - "\"Banco BOB\" con saldo 2000.00 BOB al cierre del 2026-02-28"
input: "Datos del scenario \"Mes anterior sin importar\" del delta de add-pdf-statement-parser"
steps:
  - "\"Banco BOB\" tiene un saldo de 2000.00 BOB al 2026-02-28 y el extracto de marzo de \"Banco Pampa Demo\" declara un saldo inicial de 2640.00"
expected_result:
  - "la vista previa muestra una diferencia de saldo inicial de 640.00 BOB"
  - "la importación se puede aprobar"
created: 2026-10-29
updated: 2026-10-29
---

# TC-IMPORTS-PDF-036 — La vista previa muestra la diferencia entre el saldo inicial del extracto y el de la cuenta

## Intención

Cuando el extracto PDF declara su saldo inicial y su periodo, la vista previa DEBERÍA (SHOULD) mostrar la diferencia entre ese saldo inicial y el saldo de la cuenta destino al cierre del día anterior al periodo, para advertir meses sin importar o movimientos registrados a mano que faltan; esa diferencia NO DEBE (MUST NOT) bloquear la aprobación ni crear ajustes.

## Escenario

```gherkin
Dado Workspace "W1" con moneda base BOB y zona America/La_Paz
  Y FixedClock en 2026-10-20T10:00:00-04:00
  Y Cuenta "Banco BOB" (ASSET, activa, BOB, últimos dígitos registrados "0001")
  Y EDITOR "Ana" autenticada salvo indicación
  Y Extractos PDF generados por código desde movimientos sintéticos (marca SINTETICO), nunca versionados; documentos con propósito extracto para importar disponibles
  Y "Banco BOB" con saldo 2000.00 BOB al cierre del 2026-02-28
Cuando "Banco BOB" tiene un saldo de 2000.00 BOB al 2026-02-28 y el extracto de marzo de "Banco Pampa Demo" declara un saldo inicial de 2640.00
Entonces la vista previa muestra una diferencia de saldo inicial de 640.00 BOB
  Y la importación se puede aprobar
```

## Notas

- Change: `add-pdf-statement-parser` (Phase 6, D324). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; ningún extracto real del owner ni PDF versionado (D255, D281, D282).
