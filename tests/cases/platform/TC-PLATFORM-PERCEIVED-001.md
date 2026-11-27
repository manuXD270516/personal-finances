---
id: TC-PLATFORM-PERCEIVED-001
title: "Cambio de pestaña con movimiento permitido"
spec: platform/web-interface
related_specs: []
requirement: "Transición al cambiar de pestaña o de filtro"
scenario: "Cambio de pestaña con movimiento permitido"
requirement_status: confirmed
fr: []
nfr: ["NFR-USAB-107", "NFR-USAB-005", "NFR-USAB-102"]
invariants: []
priority: low
type: e2e
level: e2e
automation_status: automated
automated_tests:
  - apps/web/src/ui/common/motion.test.ts
  - tests/e2e/specs/perceived-performance.spec.ts
status: automated
regression_suite: false
phase: 9
tags: ["motion", "view-transitions"]
error_code: null
preconditions:
  - "OWNER con sesión y un préstamo de 12000.00 BOB"
  - "sin movimiento reducido"
input: {}
steps:
  - "en el detalle de un préstamo de 12000.00 BOB el OWNER, sin pedir movimiento reducido y en un navegador con soporte, pasa de la primera pestaña a la segunda"
expected_result:
  - "el contenido cambia con una transición que dura como máximo 300 ms"
  - "el foco queda en la segunda pestaña"
created: 2026-11-27
updated: 2026-11-27
---

# TC-PLATFORM-PERCEIVED-001 — Cambio de pestaña con movimiento permitido

## Intención

Verifica el requirement «Transición al cambiar de pestaña o de filtro» del change `refine-perceived-performance` (lote L7 de docs/78).

## Escenario

```gherkin
Dado OWNER con sesión y un préstamo de 12000.00 BOB
  Y sin movimiento reducido
Cuando en el detalle de un préstamo de 12000.00 BOB el OWNER, sin pedir movimiento reducido y en un navegador con soporte, pasa de la primera pestaña a la segunda
Entonces el contenido cambia con una transición que dura como máximo 300 ms
  Y el foco queda en la segunda pestaña
```

## Notas

- Change `refine-perceived-performance` (lote L7 de docs/78; decisiones en docs/79, preguntas en docs/85). Lo implementa el agente `frontend` (D512). Datos ficticios; ningún dato real del owner.
- Parte unitaria de `withViewTransition` en `src/ui/common/motion.test.ts`.
