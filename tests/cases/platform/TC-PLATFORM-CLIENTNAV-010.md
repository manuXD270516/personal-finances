---
id: TC-PLATFORM-CLIENTNAV-010
title: "Sección nueva desde el principio"
spec: platform/web-interface
related_specs: []
requirement: "Historial y posición de desplazamiento"
scenario: "Sección nueva desde el principio"
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
  - "el OWNER, con Transacciones desplazada hasta la mitad, pasa a Reportes"
expected_result:
  - "Reportes se muestra desde el principio"
created: 2026-11-27
updated: 2026-11-27
---

# TC-PLATFORM-CLIENTNAV-010 — Sección nueva desde el principio

## Intención

Verifica el requirement «Historial y posición de desplazamiento» del change `adopt-client-navigation` (P12 de docs/78).

## Escenario

```gherkin
Dado OWNER con sesión y suficientes transacciones para desplazar la lista
Cuando el OWNER, con Transacciones desplazada hasta la mitad, pasa a Reportes
Entonces Reportes se muestra desde el principio
```

## Notas

- Change `adopt-client-navigation` (P12 de docs/78; decisiones en docs/79, preguntas en docs/85). Lo implementa el agente `frontend` (D512). Datos ficticios; ningún dato real del owner.
- Etapa 2: condicionado a la pregunta 5 de docs/85; pasa a `deprecated` si no se migra.
