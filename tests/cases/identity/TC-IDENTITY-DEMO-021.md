---
id: TC-IDENTITY-DEMO-021
title: "Con el reloj del worker en 2027-10-30, la carga con la ancla 2026-09-30 sigue igual al resumen de referencia"
spec: identity/demo-data
related_specs: ["ledger/journal-posting"]
requirement: "Resumen de referencia independiente del reloj real"
scenario: "La comparación no depende de la fecha de la corrida"
requirement_status: confirmed
fr: ["FR-IDENTITY-014", "FR-LEDGER-001"]
nfr: []
invariants: ["INV-004"]
priority: high
type: integration
level: database-integration
automation_status: automated
automated_tests: ["apps/api/test/demo/demo-clock.int.test.ts"]
status: automated
regression_suite: false
phase: 5
tags: ["demo-data", "determinism", "golden", "clock"]
error_code: null
preconditions:
  - "Dataset demo versión 2 y resumen de referencia golden-summary.json (ancla 2026-09-30)"
  - "Worker propio del archivo con las tareas programadas desactivadas y un reloj fijo en 2027-10-30T16:00:00Z (ancla + 395 días); consumidores del outbox activos"
  - "API y carga en proceso como en TC-IDENTITY-DEMO-007 (FixedClock en la ancla para la solicitud)"
input: {"datasetVersion":"2","anchorDate":"2026-09-30","workerClock":"2027-10-30T16:00:00Z"}
steps:
  - "Cargar la demo con la ancla 2026-09-30 y esperar READY"
  - "Esperar a que el outbox del workspace demo quede publicado y sus conteos por tabla se estabilicen"
  - "Leer los saldos de las 14 cuentas por la API y los asientos del workspace demo"
expected_result:
  - "Las 14 cuentas tienen los saldos del resumen de referencia; entre ellas \"Banco Andino Demo — Cuenta corriente\" 117519.90 BOB y \"Efectivo\" 9073.69 BOB"
  - "Cada asiento suma 0.00 por moneda"
created: 2026-10-20
updated: 2026-10-20
---

# TC-IDENTITY-DEMO-021 — La comparación con el resumen de referencia no depende de la fecha real

## Intención

Los consumidores asíncronos que reaccionan a la carga no deben usar la fecha real para nada que cambie saldos. Con el reloj del worker muy por delante de la ancla, cualquier dependencia de la fecha real (otra "bomba de tiempo" como la del 2026-10-20) falla de forma determinista en CI y no al azar según la hora.

## Escenario

```gherkin
Dado el dataset demo versión 2 y la ancla 2026-09-30
  Y el reloj de los procesos que reaccionan a la carga en 2027-10-30
Cuando cargo la demo y espero a que terminen sus reacciones
Entonces las 14 cuentas tienen los saldos del resumen de referencia
  Y cada asiento suma 0.00 por moneda
```

## Notas

- Archivo previsto: `apps/api/test/demo/demo-clock.int.test.ts` (design.md decisión 2).
- Las tareas programadas están desactivadas en ese worker (TC-IDENTITY-DEMO-022): con el reloj en 2027 el motor de recurrencia crearía 13 meses de ocurrencias.
