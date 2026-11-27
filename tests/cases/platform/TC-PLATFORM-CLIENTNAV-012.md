---
id: TC-PLATFORM-CLIENTNAV-012
title: "Cierre de sesión"
spec: platform/web-interface
related_specs: []
requirement: "Documento nuevo al cambiar de contexto"
scenario: "Cierre de sesión"
requirement_status: confirmed
fr: ["FR-IDENTITY-002"]
nfr: ["NFR-SEC-001"]
invariants: []
priority: low
type: security
level: security
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 9
tags: ["navigation", "auth", "conditional"]
error_code: null
preconditions:
  - "OWNER con sesión"
input: {}
steps:
  - "el OWNER cierra sesión desde Transacciones"
expected_result:
  - "se carga un documento nuevo sin sesión y Atrás no muestra Transacciones con datos"
created: 2026-11-27
updated: 2026-11-27
---

# TC-PLATFORM-CLIENTNAV-012 — Cierre de sesión

## Intención

Verifica el requirement «Documento nuevo al cambiar de contexto» del change `adopt-client-navigation` (P12 de docs/78).

## Escenario

```gherkin
Dado OWNER con sesión
Cuando el OWNER cierra sesión desde Transacciones
Entonces se carga un documento nuevo sin sesión y Atrás no muestra Transacciones con datos
```

## Notas

- Change `adopt-client-navigation` (P12 de docs/78; decisiones en docs/79, preguntas en docs/85). Lo implementa el agente `frontend` (D512). Datos ficticios; ningún dato real del owner.
- Etapa 2: condicionado a la pregunta 5 de docs/85; pasa a `deprecated` si no se migra.
