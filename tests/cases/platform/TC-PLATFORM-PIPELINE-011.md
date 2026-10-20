---
id: TC-PLATFORM-PIPELINE-011
title: "Un test sin TC que falla dentro de un archivo de la suite pone el grupo en rojo y el reporte nombra paquete y archivo"
spec: platform/delivery-pipeline
related_specs: []
requirement: "Financial Regression Suite con el contexto de ejecución del gate"
scenario: "Falla un test sin test case dentro de un archivo de la suite"
requirement_status: confirmed
fr: []
nfr: [NFR-MAINT-005]
invariants: []
priority: high
type: platform
level: smoke
automation_status: not_automated
automated_tests:
  - "scripts/traceability/test/regression.test.ts"
status: draft
regression_suite: false
phase: 5
tags: ["nightly", "regression-suite", "traceability"]
error_code: null
preconditions:
  - "Repositorio de fixture con un archivo de la suite que contiene un TC que pasa y un test sin TC que falla"
input:
  failing_test: "test sin identificador de TC con una aserción falsa"
steps:
  - "Ejecutar la suite del fixture con --run"
  - "Leer la salida y el reporte"
expected_result:
  - "El grupo del archivo queda en rojo"
  - "La salida del ejecutor es distinta de 0"
  - "El reporte indica el paquete y el archivo del grupo fallido"
created: 2026-10-20
updated: 2026-10-20
---

# TC-PLATFORM-PIPELINE-011 — Un test sin TC que falla dentro de un archivo de la suite pone el grupo en rojo y el reporte nombra paquete y archivo

## Intención

Con archivos completos, un test sin TC de un archivo de la suite también protege la regresión: su fallo no puede quedar oculto.

## Escenario

```gherkin
Dado un archivo de la suite con un test sin TC que falla
Cuando el pipeline programado ejecuta la suite
Entonces el grupo queda en rojo y la corrida falla
  Y el reporte indica paquete y archivo
```

## Notas

- Change `fix-nightly-pipeline` (diagnóstico de la corrida nightly #12, 2026-10-17).
