---
id: TC-PLATFORM-CLIENTNAV-009
title: "Volver atrás"
spec: platform/web-interface
related_specs: []
requirement: "Historial y posición de desplazamiento"
scenario: "Volver atrás"
requirement_status: confirmed
fr: []
nfr: ["NFR-USAB-102", "NFR-USAB-006"]
invariants: []
priority: low
type: e2e
level: e2e
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 9
tags: ["navigation", "history", "conditional"]
error_code: null
preconditions:
  - "OWNER con sesión y suficientes transacciones para desplazar la lista"
input: {}
steps:
  - "el OWNER desplaza Transacciones hasta la mitad, pasa a Presupuestos y usa Atrás"
expected_result:
  - "vuelve a Transacciones en la misma posición de desplazamiento"
created: 2026-11-27
updated: 2026-11-27
---

# TC-PLATFORM-CLIENTNAV-009 — Volver atrás

## Intención

Verifica el requirement «Historial y posición de desplazamiento» del change `adopt-client-navigation` (P12 de docs/78).

## Escenario

```gherkin
Dado OWNER con sesión y suficientes transacciones para desplazar la lista
Cuando el OWNER desplaza Transacciones hasta la mitad, pasa a Presupuestos y usa Atrás
Entonces vuelve a Transacciones en la misma posición de desplazamiento
```

## Notas

- Change `adopt-client-navigation` (P12 de docs/78; decisiones en docs/79, preguntas en docs/85). Lo implementa el agente `frontend` (D512). Datos ficticios; ningún dato real del owner.
- Etapa 2: condicionado a la pregunta 5 de docs/85; pasa a `deprecated` si no se migra.
