---
id: TC-IDENTITY-DEMO-007
title: "Dos cargas con la misma ancla producen los mismos saldos y asientos balanceados"
spec: identity/demo-data
related_specs: ["ledger/journal-posting"]
requirement: "Contenido demo ficticio, realista y determinista"
scenario: "Dos cargas con la misma ancla producen los mismos saldos"
requirement_status: confirmed
fr: ["FR-IDENTITY-014","FR-LEDGER-001"]
nfr: []
invariants: ["INV-004"]
priority: high
type: integration
level: database-integration
automation_status: automated
automated_tests: ["apps/api/src/demo/dataset/demo-plan.test.ts","apps/api/test/db/seed-demo.int.test.ts","apps/api/test/demo/demo-data.int.test.ts","apps/api/test/demo/demo-v2.int.test.ts"]
status: automated
regression_suite: false
phase: 1
tags: ["demo-data","determinism","golden"]
error_code: null
preconditions:
  - "Dataset demo versión 2 (suscripciones, tarjetas, préstamos y metas) con resumen de referencia v2: saldos de las 14 cuentas, conteos y bloque modules (golden-summary.json)"
  - "FixedClock; ancla 2026-09-30"
  - "Worker de la prueba sin tareas programadas por reloj (sin cron de la cola ni ejecuciones de arranque; fix-demo-golden-clock-dependence); consumidores del outbox activos"
input: {"datasetVersion":"2","anchorDate":"2026-09-30","loads":2}
steps:
  - "Cargar la demo en un workspace demo A"
  - "Limpiar A y cargar la demo en un workspace demo B con la misma ancla"
  - "Comparar saldos por cuenta y moneda con el golden summary"
expected_result:
  - "A y B tienen las mismas cuentas con los mismos saldos por moneda, iguales al resumen de referencia v2 (golden summary), y los mismos estados por módulo"
  - "Cada asiento de A y de B suma 0 por moneda"
  - "Las instituciones son ficticias (p. ej. \"Banco Andino Demo\") y los identificadores de cuenta empiezan con DEMO-"
created: 2026-10-03
updated: 2026-10-20
---

# TC-IDENTITY-DEMO-007 — Dos cargas con la misma ancla producen los mismos saldos y asientos balanceados

## Intención

La demo sirve como oráculo de reportes y de UI solo si es reproducible y pasa por las mismas invariantes que los datos reales (docs/29 §3).

## Escenario

```gherkin
Dado el dataset demo versión 1 y la ancla 2026-09-30
Cuando cargo la demo dos veces en workspaces distintos
Entonces ambos tienen los mismos saldos que el golden summary
  Y todos los asientos suman 0 por moneda
```

## Notas

- Cubre también el scenario "Instituciones ficticias".
- Dataset v2 (`add-phase-4-demo-data`): el resumen de referencia incluye el bloque `modules`; con otra ancla solo se comparan los estados por módulo (las cifras exactas son las de la ancla fija).
- La segunda carga exige limpiar la primera (límite de un demo por usuario).
- 2026-10-20 (nightly 39411997796): falló una vez con "Banco Andino Demo — Cuenta corriente" en 116919.90 BOB y "Efectivo" en 9673.69 BOB, un "Retiro de efectivo" de 600.00 BOB de más. Causa: el worker del test, con el reloj real, ejecutaba `commitments.generate-occurrences` (cron `10 * * * *` UTC) sobre la demo con la ancla 2026-09-30 y materializaba la ocurrencia automática del 2026-10-02. Fallaba solo si el minuto 10 UTC caía entre la carga y la lectura de saldos, y desde el 2026-10-02. Corrección y guardias en `fix-demo-golden-clock-dependence` (TC-IDENTITY-DEMO-021..024); las aserciones de este TC no cambian. 2026-10-20 (implementación): el worker de `demo-data.int.test.ts` y de `DemoWorld` arranca con `scheduledJobs: false`; sin Docker en la sesión, la verificación queda a cargo del check `integration` de CI.
- 2026-10-21 (tras #154): nightly manual run 39669892721 (2026-10-21 20:23 UTC, commit 68f01e5, tras #154): `regression` VERDE (15 min, incluye `demo-data.int.test.ts` y `demo-v2.int.test.ts`). Un verde de `regression` por sí solo no prueba el arreglo (el fallo dependía del minuto :10 UTC y era intermitente); lo respaldan la opción `scheduledJobs: false`, TC-IDENTITY-DEMO-022 (guarda determinista) y el job `integration` verde del CI de #154. Falta ver varias corridas seguidas sin el fallo para darlo por superado.
