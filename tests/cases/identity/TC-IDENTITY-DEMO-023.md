---
id: TC-IDENTITY-DEMO-023
title: "El motor de recurrencia con fecha 2026-10-02 justo después de publicar el plan no hace fallar la carga con la ancla 2026-09-30"
spec: identity/demo-data
related_specs: ["commitments/recurrence-engine", "ledger/journal-posting"]
requirement: "Verificación de la carga antes de publicar sus datos"
scenario: "Una tarea programada justo después de publicar el plan no hace fallar la carga"
requirement_status: confirmed
fr: ["FR-IDENTITY-014", "FR-LEDGER-001"]
nfr: []
invariants: ["INV-004"]
priority: medium
type: integration
level: database-integration
automation_status: automated
automated_tests: ["apps/api/test/demo/demo-clock.int.test.ts"]
status: automated
regression_suite: false
phase: 5
tags: ["demo-data", "determinism", "clock", "loader"]
error_code: DEMO_GOLDEN_MISMATCH
preconditions:
  - "Carga en proceso con la ancla 2026-09-30 y un gancho de pruebas que se ejecuta justo después de confirmar el plan y antes de que termine la carga"
  - "El gancho ejecuta commitments.generate-occurrences para el workspace demo con el reloj en 2026-10-02T16:00:00Z (12:00 en America/La_Paz)"
input: {"anchorDate":"2026-09-30","hookClock":"2026-10-02T16:00:00Z"}
steps:
  - "Escribir primero la prueba y verla fallar con el cargador actual (FAILED, DEMO_GOLDEN_MISMATCH)"
  - "Cargar la demo con el gancho"
  - "Leer el estado de la carga y los saldos de la cuenta corriente y de Efectivo"
expected_result:
  - "La carga termina READY (no FAILED con DEMO_GOLDEN_MISMATCH)"
  - "Después de la carga, \"Banco Andino Demo — Cuenta corriente\" tiene 116919.90 BOB y \"Efectivo\" 9673.69 BOB: el gancho actuó, pero después de la verificación (117519.90 BOB y 9073.69 BOB)"
created: 2026-10-20
updated: 2026-10-20
---

# TC-IDENTITY-DEMO-023 — La verificación de la carga no depende de otros procesos

## Intención

El cargador verificaba los saldos después de confirmar el plan. Si una tarea programada con una fecha posterior a la ancla actuaba en ese intervalo, la carga terminaba `FAILED` sin que hubiera un error real. Con la verificación dentro de la unidad de trabajo del plan, ningún otro proceso puede intervenir.

## Escenario

```gherkin
Dado una carga de la demo con la ancla 2026-09-30
Cuando el motor de recurrencia corre con fecha 2026-10-02 justo después de publicarse el plan
Entonces la carga termina READY
  Y la verificación de la carga encontró 117519.90 BOB en la cuenta corriente y 9073.69 BOB en Efectivo
```

## Notas

- TDD: la prueba se escribe antes del cambio en `demo-data-loader.ts` (design.md decisión 4) y debe fallar con el código actual.
- `error_code` es el código que la prueba demuestra que ya NO se produce.
- Ejecutado en GitHub (2026-10-21): pasó en el CI de #154 (job `integration` verde, 18 min tras subir `timeout-minutes` de 25 a 40 en `pr.yml`; una corrida previa se canceló por timeout a los 25 min, sin fallo de test).
