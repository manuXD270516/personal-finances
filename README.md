# Personal Finance Operating System (PFOS)

Sistema integral de finanzas personales multi-moneda (fiat + cripto) con ledger de doble entrada interno, planificación mensual, presupuestos, compromisos recurrentes, deudas, metas, imports, reportes y —en fases tardías— forecasting y un asistente IA de solo lectura.

> **Estado: Phase 0 — DESIGN GATE aprobado (2026-10-01); Implementation Gate en curso (spikes).** Aún no hay código productivo; ver [docs/DESIGN-GATE.md](docs/DESIGN-GATE.md).

## Por dónde empezar

1. [docs/DESIGN-GATE.md](docs/DESIGN-GATE.md) — checklist de readiness y preguntas abiertas.
2. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — decisiones canónicas (fuente de verdad transversal).
3. [docs/03-openspec-strategy.md](docs/03-openspec-strategy.md) — cómo trabajamos con Spec Driven Development.
4. [docs/09-ledger-design.md](docs/09-ledger-design.md) — modelo financiero e invariantes.
5. [docs/adr/README.md](docs/adr/README.md) — índice de ADRs.

## Estructura actual

```
openspec/          specs y changes (OpenSpec 1.14.0, schema spec-driven)
docs/              00–30 + ARCHITECTURE + DESIGN-GATE, adr/
contracts/         openapi/finance-api.v1.yaml, events/*.schema.json
tests/cases/       catálogo versionado de test cases (TC-*)
.claude/           skills/commands OpenSpec para Claude Code (/opsx:*)
```

## Validar specs

```bash
npx @fission-ai/openspec@1.14.0 validate --all --strict --no-interactive
```
