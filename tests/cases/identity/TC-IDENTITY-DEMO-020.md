---
id: TC-IDENTITY-DEMO-020
title: "Otra fecha ancla conserva los estados de la demo y ninguna institución sale del catálogo de referencia"
spec: identity/demo-data
related_specs: ["accounts/institutions"]
requirement: "Contenido demo ficticio, realista y determinista"
scenario: "Otra fecha ancla conserva los estados"
requirement_status: confirmed
fr: ["FR-IDENTITY-014", "FR-LEDGER-001"]
nfr: []
invariants: ["INV-004", "INV-025"]
priority: high
type: integration
level: database-integration
automation_status: automated
automated_tests: ["apps/api/src/demo/dataset/demo-plan.test.ts","apps/api/src/demo/dataset/plan-modules/cards.test.ts","apps/api/src/demo/dataset/plan-modules/loans.test.ts","apps/api/test/demo/demo-v2.int.test.ts"]
status: automated
regression_suite: false
phase: 5
tags: ["demo-data", "determinism"]
error_code: null
preconditions:
  - "Dos workspaces demo cargados con el dataset v2: uno con la ancla 2026-09-30 y otro con la ancla 2026-10-05 (America/La_Paz), ambos READY"
  - "Catálogo de referencia de instituciones del entorno de prueba con una entrada no ficticia de prueba"
input: {"action":"Cargar con dos anclas y comparar estados por módulo"}
steps:
  - "Cargar la demo con la ancla 2026-10-05"
  - "Comparar los estados por módulo con los de la ancla 2026-09-30"
  - "Listar las instituciones del workspace demo y las fechas de todos los movimientos"
expected_result:
  - "Suscripciones: 5 active, 1 trial, 1 paused y 1 cancelled en ambas cargas"
  - "Tarjeta Kantuta Demo: el estado de cuenta USD anterior al último está OVERDUE y el último está ISSUED sin vencer en ambas cargas"
  - "Préstamo de consumo con al menos una cuota en mora, Préstamo familiar saldado, Viaje behind y Laptop achieved en ambas cargas"
  - "Ningún movimiento tiene fecha posterior a la ancla, salvo ocurrencias, cuotas y cargos futuros de los cronogramas"
  - "Todas las instituciones tienen nombres ficticios terminados en \"Demo\" y ninguna proviene del catálogo de referencia"
  - "En ambas cargas cada asiento suma 0.00 por moneda"
created: 2026-10-15
updated: 2026-10-15
---

# TC-IDENTITY-DEMO-020 — Otra fecha ancla conserva los estados de la demo y ninguna institución sale del catálogo de referencia

## Intención

Desde la app la demo se carga con la ancla "hoy": sus estados (emitido, vencido, mora, en riesgo, alcanzada) no deben depender del día en que se cargue, y sus instituciones no deben depender del catálogo del entorno (design.md decisiones 4 y 6).

## Escenario

```gherkin
Dado la demo v2 cargada con la ancla 2026-09-30
Cuando la cargo en otro workspace demo con la ancla 2026-10-05
Entonces los estados por módulo son los mismos
  Y ningún movimiento queda después de la ancla
  Y ninguna institución proviene del catálogo de referencia
```

## Notas

- Con la ancla 2026-10-05: cierres de "Tarjeta Kantuta Demo" el día 23 (vencimiento el 13), cuota 6 del préstamo de consumo el 2026-09-26, ocurrencia atrasada de internet el 2026-10-03. Las cifras exactas solo se comparan con la ancla fija (TC-IDENTITY-DEMO-015..019).
- La entrada no ficticia del catálogo es un dato de prueba inventado del test, nunca una entidad real.
- Change: `add-phase-4-demo-data`.
