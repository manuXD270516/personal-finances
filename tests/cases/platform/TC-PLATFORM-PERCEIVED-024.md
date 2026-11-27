---
id: TC-PLATFORM-PERCEIVED-024
title: "Cambio de sección con movimiento reducido"
spec: platform/web-interface
related_specs: []
requirement: "Transición entre secciones por documento"
scenario: "Cambio de sección con movimiento reducido"
requirement_status: confirmed
fr: []
nfr: ["NFR-USAB-107", "NFR-USAB-005", "NFR-SEC-008"]
invariants: []
priority: low
type: e2e
level: e2e
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 9
tags: ["view-transitions", "conditional", "csp"]
error_code: null
preconditions:
  - "OWNER con sesión y movimiento reducido en el sistema"
input: {}
steps:
  - "el OWNER, con movimiento reducido, pasa de Inicio a Presupuestos"
expected_result:
  - "Presupuestos aparece sin transición"
  - "no se registra ninguna violación de la política de seguridad de contenido"
created: 2026-11-27
updated: 2026-11-27
---

# TC-PLATFORM-PERCEIVED-024 — Cambio de sección con movimiento reducido

## Intención

Verifica el requirement «Transición entre secciones por documento» del change `refine-perceived-performance` (lote L7 de docs/78).

## Escenario

```gherkin
Dado OWNER con sesión y movimiento reducido en el sistema
Cuando el OWNER, con movimiento reducido, pasa de Inicio a Presupuestos
Entonces Presupuestos aparece sin transición
  Y no se registra ninguna violación de la política de seguridad de contenido
```

## Notas

- Change `refine-perceived-performance` (lote L7 de docs/78; decisiones en docs/79, preguntas en docs/85). Lo implementa el agente `frontend` (D512). Datos ficticios; ningún dato real del owner.
- Condicionado a las preguntas 5 y 6 de docs/85 (M-29, D511): si se migra a navegación del cliente pasa a `deprecated`.
