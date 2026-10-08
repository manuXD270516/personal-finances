---
id: TC-PLANNING-AUTOCREATE-004
title: La creación de un periodo notifica a los participantes registrados en su misma transacción
spec: planning/financial-periods
related_specs:
  - planning/budget-templates
requirement: Participantes de la creación de periodos en la misma transacción
scenario: Participante notificado una sola vez por periodo
requirement_status: confirmed
fr:
  - FR-PLANNING-002
  - FR-PLANNING-010
nfr: []
invariants: []
priority: high
type: integration
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 2
tags:
  - financial-periods
  - period-created-hook
  - idempotency
error_code: null
preconditions:
  - Hoy es 2026-11-02 en America/La_Paz (reloj fijo)
  - Workspace con día de inicio 1 y periodos "2026-10" a "2027-01"
  - Un participante de prueba registrado en el hook de periodo creado (registra cada periodo recibido; configurable para fallar)
input:
  today: 2026-11-02
  timeZone: America/La_Paz
  startDay: 1
steps:
  - Configurar el participante para fallar y ejecutar la creación automática
  - Configurar el participante para aceptar y ejecutar la creación automática
  - Ejecutarla otra vez
expected_result:
  - 'Primera ejecución: "2027-02" no existe y el participante no registró nada (rollback completo)'
  - 'Segunda ejecución: "2027-02" existe en draft y el participante lo registró una vez, en la misma transacción'
  - 'Tercera ejecución: ningún periodo nuevo y el participante sigue con un solo registro de "2027-02"'
created: 2026-10-05
updated: 2026-10-08
---

# TC-PLANNING-AUTOCREATE-004 — La creación de un periodo notifica a los participantes registrados en su misma transacción

## Intención

`add-budget-templates` aplica el template predeterminado a cada periodo nuevo mediante el hook síncrono `PeriodCreatedHook` que invoca `EnsurePeriods`. Si el hook se ejecutara fuera de la transacción, un periodo podría quedar sin plan o con dos planes.

## Escenario

```gherkin
Dado un workspace con periodos hasta "2027-01" y un participante registrado
Cuando la creación automática crea "2027-02" y el participante falla
Entonces "2027-02" no se crea
Cuando se reintenta con el participante sano y luego otra vez
Entonces "2027-02" existe y el participante lo recibió exactamente una vez
```

## Notas

- Cubre también el scenario "Falla de un participante".
- El caso de punta a punta con el template predeterminado está en los TC de `planning/budget-templates` (requirement "Template por defecto aplicado a los periodos nuevos").
