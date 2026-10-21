---
id: TC-IDENTITY-DEMO-024
title: "La demo con la ancla 2026-09-30 recibe un solo Retiro de efectivo de 600.00 BOB cuando el motor corre el 2026-10-02"
spec: identity/demo-data
related_specs: ["commitments/recurrence-engine", "ledger/journal-posting"]
requirement: "El workspace demo sigue el reloj de la instalación después de la carga"
scenario: "El retiro automático del día 2 llega con su fecha"
requirement_status: confirmed
fr: ["FR-IDENTITY-014", "FR-COMMITMENTS-007"]
nfr: []
invariants: ["INV-004", "INV-013"]
priority: medium
type: integration
level: database-integration
automation_status: automated
automated_tests: ["apps/api/test/demo/demo-clock.int.test.ts"]
status: automated
regression_suite: false
phase: 5
tags: ["demo-data", "clock", "recurrence"]
error_code: null
preconditions:
  - "Demo cargada con la ancla 2026-09-30 (TC-IDENTITY-DEMO-021) en el archivo con worker de reloj fijo y modificable, sin tareas programadas"
  - "Definición \"Retiro de efectivo\": 600.00 BOB, AUTO_CREATE, días 2, de \"Banco Andino Demo — Cuenta corriente\" a \"Efectivo\""
input: {"runs":[{"clock":"2026-09-30T16:00:00Z"},{"clock":"2026-10-02T16:00:00Z"},{"clock":"2026-10-02T16:00:00Z"}]}
steps:
  - "Con el reloj del worker en 2026-09-30T16:00:00Z, enviar commitments.generate-occurrences (trigger manual) y esperar a que termine"
  - "Comprobar que los saldos son los del resumen de referencia y que no hay movimientos nuevos"
  - "Pasar el reloj a 2026-10-02T16:00:00Z (12:00 en America/La_Paz), enviar el job y esperar a que termine"
  - "Leer los saldos y los movimientos \"Retiro de efectivo\" con fecha posterior a la ancla"
  - "Enviar el job otra vez el mismo día y volver a leer"
expected_result:
  - "Con el reloj en la ancla no se crea ningún movimiento (117519.90 BOB y 9073.69 BOB)"
  - "Con el reloj en 2026-10-02 se crea exactamente una transferencia \"Retiro de efectivo\" de 600.00 BOB con fecha 2026-10-02"
  - "\"Banco Andino Demo — Cuenta corriente\" queda en 116919.90 BOB, \"Efectivo\" en 9673.69 BOB y las otras 12 cuentas sin cambios"
  - "La segunda ejecución del 2026-10-02 no crea nada y los saldos no cambian"
  - "Cada asiento suma 0.00 por moneda"
created: 2026-10-20
updated: 2026-10-21
---

# TC-IDENTITY-DEMO-024 — La demo sigue el reloj de la instalación

## Intención

Reproduce de forma determinista lo que pasó en el nightly del 2026-10-20 (run 39411997796): el worker con la fecha real 2026-10-20 materializó la ocurrencia automática del 2026-10-02 sobre una demo con la ancla 2026-09-30. Fija que ese es el comportamiento esperado de una demo viva: una sola vez, con su fecha y con los montos exactos.

## Escenario

```gherkin
Dado una demo cargada con la ancla 2026-09-30 y el "Retiro de efectivo" automático de 600.00 BOB los días 2
Cuando el motor de recurrencia corre el 2026-10-02 a las 12:00 en America/La_Paz
Entonces se crea exactamente un "Retiro de efectivo" de 600.00 BOB con fecha 2026-10-02
  Y la cuenta corriente queda en 116919.90 BOB y Efectivo en 9673.69 BOB
  Y repetir el motor ese día no crea nada
```

## Notas

- Cubre también los scenarios "Repetir el motor el mismo día no duplica el retiro" y "El día de la ancla no hay nada que materializar".
- `provisional` hasta la pregunta 1 de [docs/45](../../../docs/45-fix-demo-golden-clock-dependence-questions.md). Si el owner elige congelar la demo, este TC se reescribe (sin retiro nuevo) en un change aparte.
- Ejecutado en GitHub (2026-10-21): pasó en el CI de #154 (job `integration` verde, 18 min tras subir `timeout-minutes` de 25 a 40 en `pr.yml`; una corrida previa se canceló por timeout a los 25 min, sin fallo de test).
- Confirmado (2026-10-21, D288 de [docs/46](../../../docs/46-nightly-and-perf-owner-decisions.md)): el owner adoptó la demo viva (pregunta 1 de docs/45); `requirement_status` pasa a `confirmed` y no se abre el change de demo congelada.
