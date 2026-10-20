---
id: TC-PLATFORM-PIPELINE-010
title: "La suite nocturna ejecuta el archivo completo y un TC que necesita el estado de un test anterior pasa como en el gate"
spec: platform/delivery-pipeline
related_specs: []
requirement: "Financial Regression Suite con el contexto de ejecución del gate"
scenario: "Un test case que necesita el estado de un test anterior del mismo archivo"
requirement_status: confirmed
fr: []
nfr: [NFR-MAINT-005]
invariants: []
priority: high
type: platform
level: smoke
automation_status: automated
automated_tests:
  - "scripts/traceability/test/regression.test.ts"
status: automated
regression_suite: false
phase: 5
tags: ["nightly", "regression-suite", "traceability"]
error_code: null
preconditions:
  - "Repositorio de fixture con un paquete y un archivo de test con dos tests: el primero sin TC crea estado en memoria del módulo y el segundo, marcado en la suite, lo lee"
input:
  files: ["src/periodos.test.ts"]
  tests: ["crea los periodos 2026-10..2027-01 (sin TC)","[TC-DEMO-CORE-001] rechaza un 2026-10 solapado"]
steps:
  - "Generar la suite del fixture"
  - "Ejecutarla con --run (tipo unit)"
expected_result:
  - "Los dos tests se ejecutan en el orden del archivo"
  - "El TC de la suite pasa, igual que con el archivo completo"
  - "El grupo queda en verde y la salida es 0"
created: 2026-10-20
updated: 2026-10-20
---

# TC-PLATFORM-PIPELINE-010 — La suite nocturna ejecuta el archivo completo y un TC que necesita el estado de un test anterior pasa como en el gate

## Intención

El filtro por nombre del ejecutor saltaba el test que preparaba el estado y producía un rojo que el gate de PR no ve (corrida nightly #12: cinco TC de Planning). La suite debe ejecutar lo mismo que el gate.

## Escenario

```gherkin
Dado un archivo con un test sin TC que crea los periodos "2026-10".."2027-01"
Y después un TC de la suite que inserta un "2026-10" solapado
Cuando el pipeline programado ejecuta la suite
Entonces ambos tests corren en ese orden
  Y el TC obtiene el rechazo por solapamiento, como en el gate de PR
```

## Notas

- Change `fix-nightly-pipeline` (diagnóstico de la corrida nightly #12, 2026-10-17).
- Automatizado (2026-10-20): `scripts/traceability/test/regression.test.ts` ejecuta con `--run` un fixture unit cuyo TC lee el estado de un test anterior sin TC; pasa con el archivo completo. Verificación en GitHub (tarea 7.3): corrida de `nightly` por `workflow_dispatch` tras fusionar.
- Verificado en GitHub (2026-10-20, corrida manual de `nightly` run 39390841971 tras #150): el job `regression` corre los archivos completos y los cinco tests de Planning ya no fallan; duración ~17 min con archivos completos (la tarea 2.3 no requiere subir el timeout). Quedaba rojo solo `packages/contexts/ledger (unit)`: `[TC-LEDGER-BALANCE-003]` agotaba el timeout de 5 s con 10 000 casos de fast-check; seguimiento (2026-10-20): timeout explícito (15 s en PR, 300 s con `NIGHTLY=1`) en todos los tests con `fc.assert` de los archivos que leen `NIGHTLY` y guarda en `nightly-policy.test.ts` que lo exige. Medido en local con `NIGHTLY=1`: ledger completo 11 s, shared-kernel (money y recurrence) 21 s, commitments (generation, pricing, subscription) 6 s. Pendiente confirmar en la próxima corrida del nightly.
