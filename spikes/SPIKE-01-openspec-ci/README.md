# SPIKE-01 — OpenSpec en CI

> **Fecha:** 2026-10-01 · **ADR:** [0024](../../docs/adr/0024-spec-driven-development-with-openspec.md) · **Estado:** Completado localmente; verificación en GitHub Actions pendiente de que exista el repositorio remoto.

## Pregunta

¿`openspec validate --strict` sirve como gate de CI (código de salida, salida procesable, sin interacción) y el flujo propose → validate → archive funciona con specs en español?

## Resultados (OpenSpec 1.14.0, Node 22, Windows 11)

| Verificación | Resultado |
|---|---|
| `openspec validate --all --strict --no-interactive` con todo válido | exit **0** |
| Mismo comando con un change inválido (MODIFIED sin scenario) | exit **1**, mensaje `✗ [ERROR] … must include at least one scenario` |
| `--json` | Objeto con `items`, `summary.totals {items, passed, failed}`, `summary.byType`, `version`, `root` → apto para anotaciones de PR |
| Requirement sin SHALL/MUST en `--strict` | Falla (warning elevado a error). Con `DEBE (MUST)` pasa |
| Scenarios con `**CUANDO**/**ENTONCES**/**Y**` | Aceptados |
| Encabezados de proposal en español (`## Por qué`, `## Impacto`) | Aceptados |
| `archive` de un change en español → spec principal | Funciona; la spec principal resultante valida en `--strict` |
| Rutas anidadas `specs/<context>/<capability>/spec.md` | Aceptadas |
| `validate --archived` | Disponible para verificar que los changes archivados tienen todas las tareas `[x]` |
| Telemetría | El CLI tiene telemetría; se desactiva con `OPENSPEC_TELEMETRY=0` y/o `DO_NOT_TRACK=1`. También `OPENSPEC_NO_UPDATE_CHECK=1` evita chequeos de versión en CI |

## Paso de CI recomendado (se materializa en la tarea 5.3 del change `bootstrap-platform-foundation`)

```yaml
# .github/workflows/pr.yml (fragmento)
- name: OpenSpec strict validation
  env:
    OPENSPEC_TELEMETRY: "0"
    DO_NOT_TRACK: "1"
    OPENSPEC_NO_UPDATE_CHECK: "1"
  run: |
    pnpm exec openspec validate --all --strict --no-interactive --json > openspec-report.json || STATUS=$?
    node scripts/ci/openspec-annotate.mjs openspec-report.json   # emite ::error por item fallido
    exit ${STATUS:-0}
```

La CLI se fija como devDependency raíz (`@fission-ai/openspec@1.14.0`); las actualizaciones pasan por un change propio.

## Pendiente

- Ejecutar el workflow real en GitHub Actions cuando exista el remoto (no hay `act` instalado; no se considera necesario).

## Recomendación

Aceptar ADR-0024 con: CLI fijada, `--all --strict --no-interactive` como gate, telemetría desactivada en CI y en scripts locales, convención de idioma de [03 §5](../../docs/03-openspec-strategy.md).
