---
id: TC-PLATFORM-ARCH-001
title: "Las reglas de arquitectura rechazan que el dominio importe infraestructura, frameworks o internos de otros contextos"
spec: platform/delivery-pipeline
related_specs: []
requirement: "Control de reglas de arquitectura"
scenario: null
requirement_status: provisional
fr: []
nfr: [NFR-MAINT-002]
invariants: []
priority: high
type: platform
level: architecture
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 1
tags: ["dependency-cruiser", "architecture"]
error_code: null
preconditions:
  - "Configuración de dependency-cruiser con las reglas domain-no-infra, domain-no-framework, no-cross-context-internals, no-circular (docs/16 §5.17)"
  - "Módulos fixture que violan cada regla"
input:
  fixtures:
    - "ledger/domain que importa kysely"
    - "ledger/domain que importa @nestjs/common"
    - "transactions/application que importa @pf/ledger/src/domain/journal-entry"
    - "ledger/domain que importa ledger/infrastructure"
steps: ["Ejecutar pnpm lint:arch contra cada fixture"]
expected_result:
  - "Cada fixture produce una violación de la regla esperada y un código de salida distinto de cero"
  - "El código real produce cero violaciones"
created: 2026-10-01
updated: 2026-10-01
---

# TC-PLATFORM-ARCH-001 — Las reglas de arquitectura rechazan que el dominio importe infraestructura, frameworks o internos de otros contextos

## Intención

Mantiene el monolito modular extraíble y el dominio libre de frameworks (ARCHITECTURE §2, §6).

## Escenario

```gherkin
Dado un módulo de dominio que importa "kysely"
Cuando se ejecuta la verificación de arquitectura
Entonces reporta una violación de "domain-no-framework"
  Y la verificación falla
```
