---
id: TC-PLATFORM-PERCEIVED-023
title: "Cambio de sección con soporte"
spec: platform/web-interface
related_specs: []
requirement: "Transición entre secciones por documento"
scenario: "Cambio de sección con soporte"
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
tags: ["view-transitions", "conditional"]
error_code: null
preconditions:
  - "OWNER con sesión, sin movimiento reducido, en Chromium"
input: {}
steps:
  - "el OWNER, sin movimiento reducido y en un navegador con soporte, pasa de Inicio a Presupuestos"
expected_result:
  - "Presupuestos aparece con una transición desde Inicio"
created: 2026-11-27
updated: 2026-11-27
---

# TC-PLATFORM-PERCEIVED-023 — Cambio de sección con soporte

## Intención

Verifica el requirement «Transición entre secciones por documento» del change `refine-perceived-performance` (lote L7 de docs/78).

## Escenario

```gherkin
Dado OWNER con sesión, sin movimiento reducido, en Chromium
Cuando el OWNER, sin movimiento reducido y en un navegador con soporte, pasa de Inicio a Presupuestos
Entonces Presupuestos aparece con una transición desde Inicio
```

## Notas

- Change `refine-perceived-performance` (lote L7 de docs/78; decisiones en docs/79, preguntas en docs/85). Lo implementa el agente `frontend` (D512). Datos ficticios; ningún dato real del owner.
- Condicionado a las preguntas 5 y 6 de docs/85 (M-29, D511): si se migra a navegación del cliente pasa a `deprecated`.
