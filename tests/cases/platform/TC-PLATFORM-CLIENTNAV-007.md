---
id: TC-PLATFORM-CLIENTNAV-007
title: "Cambio de sección con el teclado"
spec: platform/web-interface
related_specs: []
requirement: "Foco y anuncio al cambiar de sección"
scenario: "Cambio de sección con el teclado"
requirement_status: confirmed
fr: []
nfr: ["NFR-USAB-102", "NFR-USAB-108", "NFR-USAB-101"]
invariants: []
priority: low
type: e2e
level: e2e
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 9
tags: ["navigation", "keyboard", "a11y", "conditional"]
error_code: null
preconditions:
  - "OWNER con sesión, operando solo con el teclado"
input: {}
steps:
  - "el OWNER, solo con el teclado, activa el enlace Presupuestos de la navegación"
expected_result:
  - "el título del documento es el de Presupuestos y el foco queda al principio del contenido de Presupuestos"
created: 2026-11-27
updated: 2026-11-27
---

# TC-PLATFORM-CLIENTNAV-007 — Cambio de sección con el teclado

## Intención

Verifica el requirement «Foco y anuncio al cambiar de sección» del change `adopt-client-navigation` (P12 de docs/78).

## Escenario

```gherkin
Dado OWNER con sesión, operando solo con el teclado
Cuando el OWNER, solo con el teclado, activa el enlace Presupuestos de la navegación
Entonces el título del documento es el de Presupuestos y el foco queda al principio del contenido de Presupuestos
```

## Notas

- Change `adopt-client-navigation` (P12 de docs/78; decisiones en docs/79, preguntas en docs/85). Lo implementa el agente `frontend` (D512). Datos ficticios; ningún dato real del owner.
- Etapa 2: condicionado a la pregunta 5 de docs/85; pasa a `deprecated` si no se migra.
