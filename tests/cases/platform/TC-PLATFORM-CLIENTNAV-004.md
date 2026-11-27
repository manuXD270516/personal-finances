---
id: TC-PLATFORM-CLIENTNAV-004
title: "Enlace en otra pestaña"
spec: platform/web-interface
related_specs: []
requirement: "Navegación entre secciones sin recargar el documento"
scenario: "Enlace en otra pestaña"
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
tags: ["navigation", "conditional"]
error_code: null
preconditions:
  - "OWNER con sesión"
input: {}
steps:
  - "el OWNER abre el enlace Presupuestos con Ctrl + clic"
expected_result:
  - "Presupuestos se abre en una pestaña nueva con la sesión activa"
created: 2026-11-27
updated: 2026-11-27
---

# TC-PLATFORM-CLIENTNAV-004 — Enlace en otra pestaña

## Intención

Verifica el requirement «Navegación entre secciones sin recargar el documento» del change `adopt-client-navigation` (P12 de docs/78).

## Escenario

```gherkin
Dado OWNER con sesión
Cuando el OWNER abre el enlace Presupuestos con Ctrl + clic
Entonces Presupuestos se abre en una pestaña nueva con la sesión activa
```

## Notas

- Change `adopt-client-navigation` (P12 de docs/78; decisiones en docs/79, preguntas en docs/85). Lo implementa el agente `frontend` (D512). Datos ficticios; ningún dato real del owner.
- Etapa 2: condicionado a la pregunta 5 de docs/85; pasa a `deprecated` si no se migra.
