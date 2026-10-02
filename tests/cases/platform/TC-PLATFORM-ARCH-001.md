---
id: TC-PLATFORM-ARCH-001
title: "Las reglas de arquitectura rechazan que el dominio importe infraestructura, frameworks o internos de otros contextos"
spec: platform/delivery-pipeline
related_specs: []
requirement: "Quality gate de pull request"
scenario: "Una violación de arquitectura bloquea el merge"
requirement_status: confirmed
fr: []
nfr: [NFR-MAINT-001, NFR-MAINT-006, NFR-MAINT-008]
invariants: []
priority: high
type: platform
level: architecture
automation_status: automated
automated_tests: ["scripts/architecture/test/architecture-rules.test.ts"]
status: automated
regression_suite: false
phase: 1
tags: ["dependency-cruiser", "architecture"]
error_code: null
preconditions:
  - "Configuración .dependency-cruiser.cjs con las reglas de docs/16 §5.17 (domain-no-infra, domain-no-framework, domain-only-shared-kernel, application-no-infra, no-cross-context-internals, web-no-backend-internals, shared-kernel-pure, no-circular) más las de SPIKE-04 (application-no-framework, contracts-are-leaves, composition-root-only-public-entrypoints, not-to-unresolvable)"
  - "Mini repositorio fixture limpio (scripts/architecture/test/fixtures/baseline) y un overlay por regla que la viola (scripts/architecture/test/fixtures/violations/<regla>)"
input:
  fixtures:
    - "ledger/domain que importa kysely"
    - "ledger/domain que importa @nestjs/common"
    - "transactions/application que importa ../../../ledger/src/domain/journal-entry (regla no-cross-context-internals)"
    - "transactions/application que importa @pf/ledger/src/domain/journal-entry (bloqueado por exports: regla not-to-unresolvable)"
    - "ledger/domain que importa node:fs"
    - "process.env fuera de packages/platform (regla no-restricted-properties de ESLint)"
    - "ledger/domain que importa ledger/infrastructure"
steps: ["Ejecutar dependency-cruiser (mismo comando que pnpm arch:check) sobre el mini repositorio base y sobre cada overlay de violación", "Ejecutar pnpm arch:check sobre el repositorio real"]
expected_result:
  - "Cada fixture produce una violación de la regla esperada y un código de salida distinto de cero"
  - "Sin el overlay (mini repositorio base) el chequeo pasa con código de salida 0"
  - "El código real produce cero violaciones"
created: 2026-10-01
updated: 2026-10-02
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
