---
id: TC-PLATFORM-PIPELINE-043
title: "Un drenado de 180 s que no llega a 0 en la fila informativa se publica con su seguimiento y su diagnóstico sin cambiar el veredicto del job"
spec: platform/delivery-pipeline
related_specs: ["platform/event-delivery"]
requirement: "Cada configuración del benchmark del import parte de una base en reposo"
scenario: "Drenado que no termina en la fila informativa"
requirement_status: confirmed
fr: []
nfr: ["NFR-PERF-007", "NFR-PERF-008"]
invariants: []
priority: high
type: platform
level: unit
automation_status: automated
automated_tests:
  - "apps/api/test/perf/persist-breakdown.test.ts"
  - "apps/api/test/perf/imports.perf.ts"
status: automated
regression_suite: false
phase: 6
tags: ["nightly", "perf", "imports", "stabilize-import-persist-perf"]
error_code: null
preconditions:
  - "Resultado sintético del benchmark del import de 5 000 filas (sin Docker; reporte del harness de rendimiento)"
  - "Datos ficticios; ningún dato de extractos reales del owner (D255, D281)"
input: {"configuration":"code","drain_cap_ms":180000,"outbox_pending":12201}
steps:
  - "Medir la configuración del código con un drenado que no llega a 0 en 180 s"
  - "Publicar la fila con el seguimiento del outbox y el diagnóstico, y calcular el veredicto del job con la fila del host en 14 400 ms"
expected_result:
  - "El reporte publica el seguimiento (un punto cada 10 s) y el diagnóstico del outbox en lugar de lanzar un error"
  - "El veredicto del job lo deciden solo las filas bloqueantes: con la fila del host en 14 400 ms el job no falla"
created: 2026-11-12
updated: 2026-11-12
---

# TC-PLATFORM-PIPELINE-043 — Un drenado de 180 s que no llega a 0 en la fila informativa se publica con su seguimiento y su diagnóstico sin cambiar el veredicto del job

## Intención

Requirement «Cada configuración del benchmark del import parte de una base en reposo» de `platform/delivery-pipeline` (change `stabilize-import-persist-perf`).

## Escenario

```gherkin
Dado Resultado sintético del benchmark del import de 5 000 filas (sin Docker; reporte del harness de rendimiento)
Cuando el drenado de la configuración del código no llega a 0 en 180 s con 12 201 eventos pendientes
Entonces el reporte publica la fila con el seguimiento del outbox y el diagnóstico (pendientes por tipo, intentos, antigüedad, transacción abierta más larga y plan de la consulta del relay) en lugar de lanzar un error
  Y el veredicto del job lo deciden solo las filas bloqueantes
```

## Notas

- Antes, el `until: timeout` del drenado se lanzaba también en la fila del código (informativa, D311) y hacía fallar el job aunque la fila bloqueante hubiera pasado.
