---
id: TC-PLATFORM-CLIENTNAV-006
title: "Avisos descartados al cambiar de sección"
spec: platform/web-interface
related_specs: []
requirement: "Navegación entre secciones sin recargar el documento"
scenario: "Avisos descartados al cambiar de sección"
requirement_status: confirmed
fr: []
nfr: ["NFR-PERF-004", "NFR-USAB-001", "NFR-USAB-102"]
invariants: []
priority: low
type: e2e
level: e2e
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 9
tags: ["navigation", "toasts", "conditional"]
error_code: null
preconditions:
  - "EDITOR con sesión"
input: {}
steps:
  - "el EDITOR registra un gasto de 25.00 BOB y, con el aviso visible, pasa a Presupuestos"
expected_result:
  - "la región de avisos está vacía en Presupuestos"
created: 2026-11-27
updated: 2026-11-27
---

# TC-PLATFORM-CLIENTNAV-006 — Avisos descartados al cambiar de sección

## Intención

Verifica el requirement «Navegación entre secciones sin recargar el documento» del change `adopt-client-navigation` (P12 de docs/78).

## Escenario

```gherkin
Dado EDITOR con sesión
Cuando el EDITOR registra un gasto de 25.00 BOB y, con el aviso visible, pasa a Presupuestos
Entonces la región de avisos está vacía en Presupuestos
```

## Notas

- Change `adopt-client-navigation` (P12 de docs/78; decisiones en docs/79, preguntas en docs/85). Lo implementa el agente `frontend` (D512). Datos ficticios; ningún dato real del owner.
- Etapa 2: condicionado a la pregunta 5 de docs/85; pasa a `deprecated` si no se migra.
