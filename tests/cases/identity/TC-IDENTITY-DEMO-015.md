---
id: TC-IDENTITY-DEMO-015
title: "La demo trae suscripciones en varios estados y monedas con su costo y una ocurrencia atrasada"
spec: identity/demo-data
related_specs: ["commitments/subscriptions", "commitments/recurrence-engine"]
requirement: "Suscripciones y compromisos recurrentes de demostración"
scenario: "Suscripciones de la demo al 2026-09-30"
requirement_status: provisional
fr: ["FR-IDENTITY-014", "FR-COMMITMENTS-012", "FR-COMMITMENTS-015"]
nfr: []
invariants: ["INV-001", "INV-002"]
priority: medium
type: integration
level: database-integration
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 5
tags: ["demo-data", "subscriptions", "recurring"]
error_code: null
preconditions:
  - "Workspace demo cargado con el dataset v2 y la fecha ancla 2026-09-30 (America/La_Paz), en estado READY y con los consumidores asíncronos drenados"
  - "Reloj de la API fijado en 2026-09-30; tasas de cierre del 2026-09-29: USD/BOB PARALLEL 7.00 y USDT/BOB PARALLEL 6.95"
input: {"action":"GET W/subscriptions y GET W/recurring/occurrences del workspace demo"}
steps:
  - "Listar las suscripciones con su estado, precio, ciclo y costo"
  - "Consultar el historial de precios de \"StreamFlix Demo\""
  - "Listar las ocurrencias por aprobar"
expected_result:
  - "8 suscripciones: 5 active (StreamFlix Demo 11.99 USD mensual, NubeSegura Demo 2.99 USD mensual, Antivirus Escudo Demo 39.99 USD anual, VPN Cóndor Demo 5.000000 USDT mensual, Gimnasio Sajama Demo 250.00 BOB mensual), 1 trial (Curso Kantuta Demo), 1 paused (MúsicaYa Demo) y 1 cancelled (Revista Andina Demo)"
  - "Historial de StreamFlix Demo: 9.99 USD hasta 2025-10-02 y 11.99 USD desde 2025-10-03"
  - "Costo total 412.94 BOB al mes (83.93 + 20.93 + 23.3275 + 34.75 + 250.00 = 412.9375) y 4955.25 BOB al año; Curso Kantuta Demo aparte con 105.00 BOB al mes"
  - "NubeSegura Demo tiene una propuesta de precio pendiente de 3.49 USD y su precio vigente sigue en 2.99 USD"
  - "La ocurrencia Internet Fibra Kantuta Demo de 199.00 BOB del 2026-09-28 está por aprobar y atrasada; las 6 definiciones recurrentes no tienen otras ocurrencias sin resolver anteriores a esa fecha"
created: 2026-10-15
updated: 2026-10-15
---

# TC-IDENTITY-DEMO-015 — La demo trae suscripciones en varios estados y monedas con su costo y una ocurrencia atrasada

## Intención

Cubre las tareas Could diferidas de `add-subscriptions` (8.3, alza de precio) y `add-recurrence-engine` (8.2, 6 definiciones con 6 meses de historia): la pantalla de suscripciones y la de ocurrencias de la demo muestran todos los estados y un costo no trivial en tres monedas.

## Escenario

```gherkin
Dado el workspace demo v2 cargado con la ancla 2026-09-30
  Y las tasas de cierre USD/BOB 7.00 y USDT/BOB 6.95 del 2026-09-29
Cuando consulto las suscripciones y las ocurrencias el 2026-09-30
Entonces hay 5 suscripciones activas, 1 en trial, 1 pausada y 1 cancelada
  Y el costo total es 412.94 BOB al mes y 4955.25 BOB al año, con 105.00 BOB al mes del trial aparte
  Y la ocurrencia de 199.00 BOB del 2026-09-28 está atrasada
```

## Notas

- Cálculo a mano: 11.99 × 7.00 = 83.93; 2.99 × 7.00 = 20.93; 39.99 × 7.00 / 12 = 23.3275; 5.000000 × 6.95 = 34.75; 250.00. Sin redondeo intermedio; HALF_EVEN solo al presentar (412.9375 ⇒ 412.94). Anual: 1007.16 + 251.16 + 279.93 + 417.00 + 3000.00 = 4955.25.
- Si la detección de cambio de precio de NubeSegura no se dispara por el camino usado en la carga, ajustar el dataset (design.md decisión 5), no el TC.
- Change: `add-phase-4-demo-data`.
