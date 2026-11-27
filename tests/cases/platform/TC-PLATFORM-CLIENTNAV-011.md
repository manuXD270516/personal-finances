---
id: TC-PLATFORM-CLIENTNAV-011
title: "Cambio de workspace"
spec: platform/web-interface
related_specs: []
requirement: "Documento nuevo al cambiar de contexto"
scenario: "Cambio de workspace"
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
tags: ["navigation", "workspace-isolation", "conditional"]
error_code: null
preconditions:
  - "OWNER con sesión y dos workspaces ficticios, «Casa» con un gasto de 45.00 BOB y «Negocio» sin él"
input: {}
steps:
  - "el OWNER, con un gasto de 45.00 BOB visible en Transacciones del workspace «Casa», cambia al workspace «Negocio»"
expected_result:
  - "se carga un documento nuevo y Transacciones no muestra el gasto de 45.00 BOB"
created: 2026-11-27
updated: 2026-11-27
---

# TC-PLATFORM-CLIENTNAV-011 — Cambio de workspace

## Intención

Verifica el requirement «Documento nuevo al cambiar de contexto» del change `adopt-client-navigation` (P12 de docs/78).

## Escenario

```gherkin
Dado OWNER con sesión y dos workspaces ficticios, «Casa» con un gasto de 45.00 BOB y «Negocio» sin él
Cuando el OWNER, con un gasto de 45.00 BOB visible en Transacciones del workspace «Casa», cambia al workspace «Negocio»
Entonces se carga un documento nuevo y Transacciones no muestra el gasto de 45.00 BOB
```

## Notas

- Change `adopt-client-navigation` (P12 de docs/78; decisiones en docs/79, preguntas en docs/85). Lo implementa el agente `frontend` (D512). Datos ficticios; ningún dato real del owner.
- Etapa 2: condicionado a la pregunta 5 de docs/85; pasa a `deprecated` si no se migra.
