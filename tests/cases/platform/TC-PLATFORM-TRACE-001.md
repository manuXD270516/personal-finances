---
id: TC-PLATFORM-TRACE-001
title: "La verificación de trazabilidad falla ante IDs de TC desconocidos y casos automatizados sin pruebas"
spec: quality/test-traceability
related_specs: ["platform/delivery-pipeline"]
requirement: "Los tests automatizados referencian IDs de test case"
scenario: "Caso automatizado sin test"
requirement_status: confirmed
fr: []
nfr: [NFR-MAINT-005]
invariants: []
priority: high
type: platform
level: smoke
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: false
phase: 1
tags: ["traceability", "ci"]
error_code: null
preconditions:
  - "Generador scripts/traceability (docs/17 §6)"
  - "Repositorio fixture con especificaciones, casos y pruebas"
input:
  - fixture: "prueba titulada [TC-LEDGER-FOO-999] sin archivo de caso"
    rule: "R4"
  - fixture: "caso con status automated y sin prueba correspondiente"
    rule: "R3"
  - fixture: "caso que referencia un requisito inexistente con requirement_status confirmed"
    rule: "R1"
  - fixture: "requisito Must sin casos"
    rule: "R2"
  - fixture: "fixture consistente"
    rule: "none"
steps: ["Ejecutar pnpm traceability sobre cada fixture"]
expected_result:
  - "Cada fixture inconsistente termina con código distinto de cero y reporta el id de regla esperado"
  - "El fixture consistente termina con 0 y escribe tests/traceability/matrix.md y matrix.json"
created: 2026-10-01
updated: 2026-10-02
---

# TC-PLATFORM-TRACE-001 — La verificación de trazabilidad falla ante IDs de TC desconocidos y casos automatizados sin pruebas

## Intención

La cadena de trazabilidad FR → Requirement → Scenario → TC → prueba se hace cumplir, no es solo aspiracional (ARCHITECTURE §12).

## Escenario

```gherkin
Dada una prueba llamada "[TC-LEDGER-FOO-999] something"
  Y no existe ningún caso de prueba "TC-LEDGER-FOO-999"
Cuando se ejecuta la verificación de trazabilidad
Entonces falla con la regla "R4"
```
