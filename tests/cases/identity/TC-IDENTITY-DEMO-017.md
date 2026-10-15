---
id: TC-IDENTITY-DEMO-017
title: "La demo trae metas en curso, en riesgo, alcanzada y con un episodio de sobre-asignación resuelto"
spec: identity/demo-data
related_specs: ["goals/savings-goals"]
requirement: "Metas de ahorro de demostración"
scenario: "Metas de la demo al 2026-09-30"
requirement_status: provisional
fr: ["FR-IDENTITY-014", "FR-GOALS-001", "FR-GOALS-003", "FR-GOALS-004", "FR-GOALS-009"]
nfr: []
invariants: []
priority: medium
type: integration
level: database-integration
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 5
tags: ["demo-data", "goals"]
error_code: null
preconditions:
  - "Workspace demo cargado con el dataset v2 y la fecha ancla 2026-09-30 (America/La_Paz), en estado READY y con los consumidores asíncronos drenados"
  - "Reloj de la API fijado en 2026-09-30; periodo financiero de septiembre de 2026"
input: {"action":"GET W/goals y GET W/goals/{id} del workspace demo"}
steps:
  - "Listar las metas con su saldo, porcentaje, estado y avance"
  - "Consultar el plan del periodo de \"Viaje\""
  - "Consultar los hechos de sobre-asignación de \"Billetera Altiplano Demo\""
expected_result:
  - "Fondo de emergencia: 30000.00 BOB, 18000.00 BOB en 12 aportes de 1500.00 BOB, 60.00 %, on-track (esperado 17990.12 BOB, +0.05 %), pendiente planificado del periodo 0.00 BOB"
  - "Viaje: 2000.00 USD, 550.00 USD reservados en Ahorro USD, behind (esperado 1328.47 USD, −58.60 %), pendiente planificado del periodo 100.00 USD de 150.00 USD"
  - "Laptop: 8000.00 BOB, achieved"
  - "Regalos: 500.00 BOB reservados en Billetera Altiplano Demo (saldo 700.00 BOB), sin sobre-asignación vigente y con un único hecho de sobre-asignación pasado de faltante 200.00 BOB"
created: 2026-10-15
updated: 2026-10-15
---

# TC-IDENTITY-DEMO-017 — La demo trae metas en curso, en riesgo, alcanzada y con un episodio de sobre-asignación resuelto

## Intención

Cubre la tarea Could diferida de `add-savings-goals` (8.3: aportes reales, reservas y un episodio de sobre-asignación) y alimenta el término de metas del disponible para gastar.

## Escenario

```gherkin
Dado el workspace demo v2 cargado con la ancla 2026-09-30
Cuando consulto las metas el 2026-09-30
Entonces "Fondo de emergencia" va on-track con 18000.00 BOB de 30000.00 BOB
  Y "Viaje" va behind con 550.00 USD y 100.00 USD pendientes del plan del periodo
  Y "Laptop" está achieved
  Y "Regalos" tuvo un solo episodio de sobre-asignación de 200.00 BOB, ya resuelto
```

## Notas

- Cálculo a mano: del 2025-10-01 al 2026-09-30 hay 364 días y al 2027-05-31, 607: 30000 × 364 / 607 = 17990.1153 ⇒ 17990.12; (18000 − 17990.1153) / 17990.1153 = +0.05 %. Del 2026-04-01 al 2026-09-30, 182 días, y al 2026-12-31, 274: 2000 × 182 / 274 = 1328.4672 ⇒ 1328.47; (550 − 1328.4672) / 1328.4672 = −58.60 %.
- Sobre-asignación: 600.00 − 300.00 = 300.00 < 500.00 reservados ⇒ faltante 200.00; 300.00 + 400.00 = 700.00 ≥ 500.00 ⇒ resuelto. Si el episodio no puede reproducirse con el reloj simulado (design.md, Riesgos), se omite con nota en tasks y se quita la última expectativa.
- Change: `add-phase-4-demo-data`.
