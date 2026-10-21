---
id: TC-IDENTITY-DEMO-022
title: "Ninguna tarea programada de la instalación se ejecuta durante las verificaciones de la demo"
spec: identity/demo-data
related_specs: []
requirement: "Resumen de referencia independiente del reloj real"
scenario: "Ninguna tarea programada actúa durante la verificación"
requirement_status: confirmed
fr: ["FR-IDENTITY-014"]
nfr: []
invariants: []
priority: high
type: integration
level: database-integration
automation_status: automated
automated_tests: ["apps/api/test/demo/demo-clock.int.test.ts"]
status: automated
regression_suite: false
phase: 5
tags: ["demo-data", "determinism", "clock", "worker"]
error_code: null
preconditions:
  - "Worker del archivo arrancado con las tareas programadas desactivadas (sin cron de la cola y sin ejecuciones de arranque)"
  - "La tabla de schedules de la cola contiene las tareas registradas por la instalación (configurables y fijas en código), incluidas las que dejaron workers de archivos anteriores"
input: {"action":"Cargar la demo y esperar sus reacciones sin envíos manuales"}
steps:
  - "Anotar el instante de arranque del worker del archivo"
  - "Cargar la demo con la ancla 2026-09-30 y esperar a que terminen sus reacciones (TC-IDENTITY-DEMO-021)"
  - "Leer de la tabla de schedules de la cola los nombres de todas las colas programadas"
  - "Contar los trabajos de esas colas creados desde el arranque del worker, antes de cualquier envío manual"
expected_result:
  - "La lista de colas programadas no está vacía (incluye al menos commitments.generate-occurrences)"
  - "Ninguna de esas colas tiene trabajos creados desde el arranque del worker del archivo"
created: 2026-10-20
updated: 2026-10-20
---

# TC-IDENTITY-DEMO-022 — Ninguna tarea programada actúa durante las verificaciones de la demo

## Intención

Guardia contra la causa del fallo del 2026-10-20: el worker de los tests demo ejecutaba `commitments.generate-occurrences` con el reloj real (cron `10 * * * *` UTC) sobre una demo con la ancla 2026-09-30, y creaba el "Retiro de efectivo" del 2026-10-02. La lista de colas sale de la tabla de schedules y no de una lista fija, así que una tarea programada nueva queda cubierta sin tocar el test.

## Escenario

```gherkin
Dado el worker de las pruebas demo con las tareas programadas desactivadas
  Y la instalación con tareas programadas registradas
Cuando corren las verificaciones de la demo
Entonces ninguna de esas tareas se ejecuta
```

## Notas

- Cubre también el scenario "La comparación no depende de la hora de la corrida": con esta guardia, TC-IDENTITY-DEMO-007 deja de depender del minuto 10 de cada hora UTC.
- Archivo previsto: `apps/api/test/demo/demo-clock.int.test.ts`. `demo-data.int.test.ts` y `DemoWorld` usan la misma opción del worker.
- Ejecutado en GitHub (2026-10-21): pasó en el CI de #154 (job `integration` verde, 18 min tras subir `timeout-minutes` de 25 a 40 en `pr.yml`; una corrida previa se canceló por timeout a los 25 min, sin fallo de test).
