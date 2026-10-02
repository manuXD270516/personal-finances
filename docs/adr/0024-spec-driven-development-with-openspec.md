# ADR-0024: Spec Driven Development con OpenSpec y trazabilidad spec → test

- Estado: Aceptado (2026-10-02, tras SPIKE-01; decisión del owner)
- Fecha: 2026-10-01
- Decisores: Owner (Product/Tech Lead)
- Relacionado: docs/ARCHITECTURE.md §12, §14; docs/03-openspec-strategy.md; docs/16-testing-strategy.md; docs/17-test-traceability.md; openspec/config.yaml; ADR-0001, ADR-0015, ADR-0016, ADR-0022; OpenSpec capability `quality/test-traceability`; SPIKE-01

## Contexto y problema

PFOS se construye por una persona con fuerte apoyo de agentes de IA. Los agentes producen código rápido, pero sin una especificación explícita y versionada tienden a: inventar comportamiento, olvidar reglas financieras no obvias (periodos cerrados, HALF_EVEN, reversas), y modificar comportamiento existente sin dejar rastro. Además, el producto tiene ~18 contextos y cientos de requisitos (`docs/01-functional-requirements.md`) cuya cobertura por tests debe ser demostrable.

Necesitamos: (1) una fuente de verdad de **comportamiento** separada del código, (2) un flujo de cambio que obligue a pensar specs → diseño → tareas antes de implementar, (3) validación automática en CI, y (4) trazabilidad desde el requisito funcional hasta el test automatizado.

## Drivers de decisión

- Comportamiento explícito y revisable antes del código.
- Formato consumible por agentes de IA (Markdown + CLI) y por humanos.
- Validación automática (estructura, palabras normativas).
- Trazabilidad FR → Requirement → Scenario → TC → test.
- Bajo costo y sin lock-in (archivos en el repo).
- Compatibilidad con ADRs (ADR-0001) y con el pipeline (ADR-0015).

## Opciones consideradas

1. **OpenSpec** (CLI `@fission-ai/openspec`, schema `spec-driven`) + catálogo de test cases + matriz generada (elegida).
2. **GitHub Spec Kit** (spec → plan → tasks con plantillas y comandos para agentes).
3. **BDD con Gherkin/Cucumber** como especificación ejecutable.
4. Documentos de requisitos libres en `docs/` + issues (sin herramienta).
5. Sin especificación formal (tests como única especificación).

## Decisión

Se adopta **OpenSpec CLI v1.14.0** (fijada como devDependency raíz; actualizaciones vía change dedicado) con el schema **`spec-driven`**:

- **Artefactos por change** (`openspec/changes/<change-id>/`): **proposal.md → specs (deltas) → design.md → tasks.md**; `apply` requiere `tasks`; al completarse, **archive** (`openspec archive`) fusiona los deltas en `openspec/specs/` y mueve el change a `changes/archive/`.
- **Specs vigentes** en `openspec/specs/<context>/<capability>/spec.md` según la taxonomía canónica (ARCHITECTURE §14). `specs/` describe **solo lo implementado**; lo pendiente vive como delta en un change.
- **Deltas** con `## ADDED Requirements`, `## MODIFIED Requirements`, `## REMOVED Requirements`, `## RENAMED Requirements`; `### Requirement:` y `#### Scenario:` (WHEN/THEN); texto normativo **SHALL/MUST** en **inglés**; requisitos financieros con al menos un scenario con montos y monedas concretos con escala explícita (`685.00 BOB`, `100.000000 USDT`).
- **`openspec/config.yaml`** contiene el contexto condensado del proyecto y reglas por artefacto (ya creado en Phase 0).
- **Impact obligatorio en `proposal.md`**, cada punto con etiqueta propia: specs impactadas; componentes/contextos; **APIs impactadas** (`contracts/openapi`); **tablas impactadas** (`schema.table`); **eventos impactados** (`contracts/events`, con versión); **migraciones** (expand/contract, ¿destructiva?); **TEST CASES ADDED / MODIFIED / DEPRECATED** (por TC-ID); **REGRESSION IMPACT**; **riesgos** introducidos (RISK-NNN); invariantes INV-NNN afectadas si toca dinero/ledger/FX/periodos/redondeo; fuera de alcance explícito.
- **CI:** `openspec validate --all --strict --no-interactive` es check **requerido** en PR (ADR-0015).
- **Trazabilidad** (ARCHITECTURE §12; detalle en docs/17):
  - Cadena **FR-<CONTEXT>-NNN → `### Requirement:` → `#### Scenario:` → TC-<CONTEXT>-<FEATURE>-NNN (`tests/cases/<context>/TC-*.md`) → test automatizado** cuyo nombre contiene el TC-ID (`it('[TC-LEDGER-TRANSFER-001] …')`).
  - Un generador (script TS) escanea specs (vía `openspec show --json`), `tests/cases` y archivos de test, produce la matriz en `tests/traceability/` y falla CI ante: scenario sin TC, TC sin test (cuando su estado lo exige), TC-ID huérfano o duplicado. Severidad progresiva (warning → error) según docs/17.
- **Flujo por vertical slice** (tasks.md): SPEC → TEST CASE → DOMAIN → APPLICATION → INFRASTRUCTURE → API → UI → AUTOMATED TESTS → E2E → DOCUMENTATION; lógica financiera crítica en TDD.
- **Relación con ADRs:** un change que contradiga ARCHITECTURE.md o un ADR debe incluir un ADR nuevo o que reemplace (ADR-0001). Las specs no nombran librerías, clases ni tablas (eso va en `design.md`).
- Cambios sin efecto de comportamiento (tooling, refactor, docs) pueden usar `skip_specs: true` en `.openspec.yaml`.

## Análisis de opciones

### 1. OpenSpec (elegida)
- **Pros:** modelo explícito de "specs vigentes + deltas por change" que encaja con un producto evolutivo; validación estricta por CLI; artefactos Markdown legibles por agentes; integración con Claude Code (comandos `/opsx:*`); archivado como historial de decisiones de comportamiento; reglas de proyecto en `config.yaml` inyectadas en cada artefacto.
- **Contras:** herramienta joven con evolución rápida (v1.x): riesgo de cambios de formato; sintaxis propia (deltas) que aprender; el CLI no conoce TC-IDs → la trazabilidad requiere generador propio.
- **Costo:** 0 (OSS). **Complejidad operativa:** baja.

### 2. GitHub Spec Kit
- **Pros:** buen flujo spec → plan → tasks orientado a agentes; respaldado por GitHub.
- **Contras:** centrado en features nuevas (greenfield por feature) más que en mantener un corpus de specs vigentes con deltas; menor énfasis en validación estricta de estructura normativa.
- **Costo:** 0. **Complejidad:** baja.

### 3. Gherkin/Cucumber
- **Pros:** especificación ejecutable; formato Given/When/Then conocido.
- **Contras:** capa de step definitions costosa de mantener; acopla la spec a la implementación de tests; no cubre proposal/design/tasks; Cucumber-js con TS/ESM añade fricción. Los scenarios OpenSpec ya usan WHEN/THEN y se materializan en TCs + tests Vitest/Playwright sin glue code.
- **Costo:** 0. **Complejidad:** media-alta.

### 4. Documentos libres + issues
- **Pros:** cero herramientas.
- **Contras:** sin validación, sin noción de "comportamiento vigente", trazabilidad manual.
- **Complejidad:** baja; calidad baja.

### 5. Tests como única especificación
- **Pros:** siempre ejecutable.
- **Contras:** no sirve para revisar comportamiento antes de implementar; ilegible para producto; los agentes no tienen guía previa.
- Descartada.

## Consecuencias

**Positivas**
- Ningún comportamiento entra sin spec revisada; los agentes trabajan contra un contrato.
- Impacto de cada cambio (APIs, tablas, eventos, migraciones, tests, regresión) visible en la propuesta.
- Cobertura de requisitos demostrable con una matriz generada.

**Negativas**
- Overhead por cambio (proposal + deltas + design + tasks + TCs), significativo para cambios pequeños (mitigado con `skip_specs` donde aplica).
- Generador de trazabilidad propio a mantener.

**Riesgos**
- Cambios incompatibles en futuras versiones del CLI. *Mitigación:* versión pinneada (1.14.0); upgrade solo vía change dedicado con validación de todo el corpus.
- Specs y código divergen. *Mitigación:* regla "spec primero" (docs/03 §9), archive solo con tareas completas y TCs actualizados, matriz en CI.
- Fatiga de proceso → atajos. *Mitigación:* plantillas, comandos `/opsx:*` y reglas en `config.yaml` que reducen fricción.

## Validación

- **SPIKE-01 (0.5 d):** flujo propose → apply → archive con un change real (`bootstrap-platform-foundation`); `openspec validate --all --strict --no-interactive` como check requerido en GitHub Actions; un delta inválido (sin SHALL/MUST o scenario mal formado) hace fallar CI.
- Generador de trazabilidad: en Phase 1, 100% de scenarios de capabilities implementadas tienen TC y test automatizado (o manual justificado).
- Métrica: 0 PRs de comportamiento mergeados sin change OpenSpec asociado (verificable por convención de título/label).

## Notas

- Verificado en el repositorio 2026-10-01 (docs/03-openspec-strategy.md §1): `@fission-ai/openspec` 1.14.0, schema `spec-driven` único incluido, rutas de capability anidadas permitidas, `openspec/project.md`/`AGENTS.md` ya no existen en v1.x (el rol lo cumplen `config.yaml` + ARCHITECTURE.md).
- Idioma: todo en español (decisión del owner, 2026-10-01); solo los encabezados estructurales que el CLI parsea quedan en inglés y el texto normativo usa `DEBE (MUST)` (ARCHITECTURE §12, verificado con OpenSpec 1.14.0).

## Resultado del spike (SPIKE-01, 2026-10-01)

Verificado con OpenSpec 1.14.0: `validate --all --strict --no-interactive` devuelve exit 0/1 y `--json` entrega totales por tipo, apto como gate de CI; specs en español pasan `--strict` usando `DEBE (MUST)` y scenarios `**CUANDO**/**ENTONCES**`, y el ciclo validate → archive funciona. La CLI tiene telemetría: desactivar con `OPENSPEC_TELEMETRY=0`, `DO_NOT_TRACK=1` y `OPENSPEC_NO_UPDATE_CHECK=1`. Pendiente solo la ejecución real en GitHub Actions (no hay remoto aún). **Recomendación:** aceptar. Evidencia: [spikes/SPIKE-01-openspec-ci](../../spikes/SPIKE-01-openspec-ci/README.md).
