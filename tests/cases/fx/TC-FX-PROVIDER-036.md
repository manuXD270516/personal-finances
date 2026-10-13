---
id: TC-FX-PROVIDER-036
title: "Solo se habilitan providers con verificación de términos registrada como apta"
spec: fx/market-rate-providers
related_specs: []
requirement: "Providers habilitados solo con términos verificados"
scenario: "Provider sin verificación registrada"
requirement_status: confirmed
fr: ["FR-FX-015"]
nfr: ["NFR-COMP-007"]
invariants: []
priority: critical
type: unit
level: architecture
automation_status: automated
automated_tests:
  - packages/contexts/fx/src/application/crypto-rate-providers.test.ts
  - packages/contexts/fx/src/infrastructure/providers/providers.architecture.test.ts
status: automated
regression_suite: false
phase: 5
tags: ["fx", "terms-of-use", "config"]
error_code: "FX_PROVIDER_CONFIG_INVALID"
preconditions:
  - "Descriptores de providers con su estado de términos"
input: {"FX_PROVIDER_CRYPTO_PRIMARY": "<id sin verificación>"}
steps:
  - "Validar la configuración con un provider sin verificación"
  - "Validar con un provider marcado REJECTED"
  - "Test de arquitectura sobre todos los adapters registrados"
expected_result:
  - "Providers cripto deshabilitados con FX_PROVIDER_CONFIG_INVALID; paralelo.bo y bo.dolarapi.com siguen"
  - "Todo adapter registrado tiene descriptor VERIFIED con fecha y referencia al ADR"
created: 2026-10-13
updated: 2026-10-13
---

# TC-FX-PROVIDER-036 — Solo se habilitan providers con verificación de términos registrada como apta

## Intención

NFR-COMP-007 y RISK-023: ningún provider sin términos verificados (docs/39 §B.2, D225).

## Escenario

```gherkin
Dado un provider sin verificación
Cuando se configura
Entonces no se inicia y el resto sigue
```

## Notas

