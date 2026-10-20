---
id: TC-PLATFORM-PIPELINE-019
title: "Una suite de benchmarks que configura la API con las cuotas por defecto hace fallar el test de política"
spec: platform/delivery-pipeline
related_specs: []
requirement: "Los benchmarks no miden la política de cuotas"
scenario: "Una suite nueva sin la configuración compartida"
requirement_status: confirmed
fr: []
nfr: [NFR-PERF-004]
invariants: []
priority: medium
type: platform
level: smoke
automation_status: automated
automated_tests:
  - "scripts/delivery-policy/test/nightly-policy.test.ts"
status: automated
regression_suite: false
phase: 5
tags: ["nightly", "perf", "rate-limit", "policy"]
error_code: null
preconditions:
  - "Suites apps/api/test/perf/*.perf.ts que configuran la API con el helper compartido"
input:
  fixture: "suite de benchmark que llama a baseEnv(deps) para la API sin el helper"
steps:
  - "Test de política: escanear las suites del repositorio"
  - "Aplicar la misma regla a un contenido de fixture sin el helper"
expected_result:
  - "Las suites del repositorio cumplen la regla"
  - "El fixture hace fallar la regla indicando el archivo"
created: 2026-10-20
updated: 2026-10-20
---

# TC-PLATFORM-PIPELINE-019 — Una suite de benchmarks que configura la API con las cuotas por defecto hace fallar el test de política

## Intención

Impide que una suite nueva vuelva a medir la política de cuotas en lugar de la latencia.

## Escenario

```gherkin
Dada una suite nueva que configura la API con las cuotas por defecto
Cuando corre el test de política en el gate de PR
Entonces falla indicando el archivo de la suite
```

## Notas

- Change `fix-nightly-pipeline` (diagnóstico de la corrida nightly #12, 2026-10-17).
- Automatizado (2026-10-20): `nightly-policy.test.ts` escanea `apps/api/test/perf/*.perf.ts` (exige `perfApiEnv` o `PERF_RATE_LIMITS`; rechaza `baseEnv(` directo salvo `workerConfig(baseEnv(`) y la regla falla con un fixture indicando el archivo.
