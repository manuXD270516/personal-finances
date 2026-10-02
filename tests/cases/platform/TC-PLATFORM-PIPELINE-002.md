---
id: TC-PLATFORM-PIPELINE-002
title: El pipeline falla ante una vulnerabilidad crítica con corrección disponible y sin excepción registrada
spec: platform/delivery-pipeline
related_specs: []
requirement: Vulnerabilidades críticas bloquean el gate
scenario: CVE crítico con corrección
requirement_status: confirmed
fr: []
nfr:
- NFR-SEC-013
invariants: []
priority: critical
type: security
level: smoke
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: false
phase: 1
tags:
- ci
- cve
- trivy
error_code: null
preconditions:
- Imagen fixture con un paquete afectado por un CVE crítico con versión corregida publicada
- Archivo de excepciones (.trivyignore.yaml) con motivo y fecha de vencimiento
input:
- case: sin excepción
  expected: fail
- case: excepción documentada y vigente
  expected: pass
- case: excepción vencida
  expected: fail
steps:
- Ejecutar el escaneo de imagen sobre la imagen fixture sin excepciones
- Repetir con una excepción documentada y vigente para ese CVE
- Repetir con la excepción vencida
expected_result:
- 'Sin excepción: el job de escaneo termina con código distinto de cero e identifica el CVE y el paquete'
- 'Con excepción vigente: el job pasa y reporta la excepción aplicada'
- 'Con excepción vencida: el job falla'
created: 2026-10-02
updated: 2026-10-02
---

# TC-PLATFORM-PIPELINE-002 — El pipeline falla ante una vulnerabilidad crítica con corrección disponible y sin excepción registrada

## Intención

Ninguna imagen con un CVE crítico corregible llega a la rama principal sin una excepción explícita y con vencimiento.

## Escenario

```gherkin
Dado que el escaneo de imagen reporta una vulnerabilidad crítica con corrección disponible
  Y no hay excepción registrada
Cuando se ejecuta el pipeline
Entonces el pipeline falla
```

## Notas

- El escaneo de dependencias aplica la misma política.
