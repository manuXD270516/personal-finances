---
id: TC-PLATFORM-PIPELINE-007
title: "El servicio de actualización respeta la antigüedad mínima y no abre excepciones de supply-chain en el lockfile"
spec: platform/delivery-pipeline
related_specs: []
requirement: "Antigüedad mínima y lockfile verificable"
scenario: "Versión publicada hace un día"
requirement_status: provisional
fr: []
nfr: [NFR-SEC-013]
invariants: []
priority: high
type: platform
level: smoke
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 5
tags: ["ci", "dependencies", "renovate", "supply-chain"]
error_code: null
preconditions:
  - "Configuración del servicio de actualización versionada en la raíz del repositorio"
  - "Antigüedad mínima efectiva de pnpm verificada (tarea 2.1)"
input:
  - release_age: "1 día"
    expected: "no se propone"
  - release_age: "3 días"
    expected: "se propone en la siguiente ventana semanal"
  - change: "dependencia transitiva nueva con script de instalación no permitido"
    expected: "el bot no la agrega a la lista permitida; si la instalación congelada falla, la PR queda en rojo"
steps:
  - "Test de política: antigüedad mínima >= 3 días y >= la de pnpm; filtro estricto de checks internos; las rutas de la lista de scripts permitidos, de las excepciones de antigüedad y del archivo de excepciones de vulnerabilidades quedan fuera de las actualizaciones del bot"
expected_result:
  - "La antigüedad mínima configurada no es menor que 3 días ni que la de pnpm"
  - "El bot no puede editar allowBuilds, minimumReleaseAgeExclude ni .trivyignore.yaml"
  - "Una PR cuyo lockfile no pasa la instalación congelada o dependency-scan queda en rojo y no se fusiona"
created: 2026-10-13
updated: 2026-10-13
---

# TC-PLATFORM-PIPELINE-007 — El servicio de actualización respeta la antigüedad mínima y no abre excepciones de supply-chain en el lockfile

## Intención

La antigüedad mínima mitiga paquetes comprometidos recién publicados (docs/23 §10, RISK-024). Si la del bot fuera menor que la de pnpm, propondría versiones que `pnpm install --frozen-lockfile` rechaza; si el bot pudiera editar las listas de excepciones, saltaría la verificación de supply-chain.

## Escenario

```gherkin
Dada una dependencia del workspace con una versión publicada hace 1 día
Cuando llega la ventana semanal
Entonces el servicio no la propone
  Y la propone en la primera ventana en que la versión tiene al menos 3 días
```

## Notas

- El valor de 3 días depende de la pregunta 6 de design.md.
