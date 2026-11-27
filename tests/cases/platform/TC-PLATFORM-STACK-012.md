---
id: TC-PLATFORM-STACK-012
title: "El harness de E2E rechaza un prefijo de puertos distinto de 3 o 4 antes de tocar Docker"
spec: platform/local-environment
related_specs: []
requirement: "Aislamiento de la corrida E2E por proyecto y prefijo de puertos"
scenario: "Prefijo 5 rechazado antes de tocar Docker"
requirement_status: confirmed
fr: []
nfr: ["NFR-PORT-001", "NFR-PORT-005"]
invariants: []
priority: high
type: platform
level: unit
automation_status: automated
automated_tests:
  - tests/e2e/src/ports.test.ts
status: automated
regression_suite: false
phase: 9
tags: ["e2e", "stack", "ports"]
error_code: null
preconditions:
  - "harness de E2E sin stack levantado"
input: {}
steps:
  - "se generan los puertos con PF_E2E_PORT_PREFIX=3"
  - "se intenta generar con PF_E2E_PORT_PREFIX=5"
expected_result:
  - "con 3, todos los PF_*_PORT del .env desechable, incluidos los TLS, empiezan por 3"
  - "con 5, la corrida falla con un mensaje que nombra PF_E2E_PORT_PREFIX y los valores 3 y 4"
  - "con 5, no se ejecuta ningún comando de Docker"
created: 2026-11-25
updated: 2026-11-27
---

# TC-PLATFORM-STACK-012 — El harness de E2E rechaza un prefijo de puertos distinto de 3 o 4 antes de tocar Docker

## Intención

CLAUDE.md prohíbe el prefijo 5 (choca con otro stack); hoy el harness lo acepta.

## Escenario

```gherkin
Dado harness de E2E sin stack levantado
Cuando se generan los puertos con PF_E2E_PORT_PREFIX=3
  Y se intenta generar con PF_E2E_PORT_PREFIX=5
Entonces con 3, todos los PF_*_PORT del .env desechable, incluidos los TLS, empiezan por 3
  Y con 5, la corrida falla con un mensaje que nombra PF_E2E_PORT_PREFIX y los valores 3 y 4
  Y con 5, no se ejecuta ningún comando de Docker
```

## Notas

- Change `add-e2e-https` (D516, [docs/84](../../../docs/84-webkit-e2e-questions.md)). Datos ficticios; ningún dato real del owner. La cookie de sesión no cambia.
