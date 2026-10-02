# Catálogo de test cases (`tests/cases/`)

> **Estado:** Propuesto · **Fecha:** 2026-10-01 · **Relacionado:** [docs/16-testing-strategy.md](../../docs/16-testing-strategy.md) · [docs/17-test-traceability.md](../../docs/17-test-traceability.md) · [docs/29-seed-datasets.md](../../docs/29-seed-datasets.md) · [docs/09-ledger-design.md](../../docs/09-ledger-design.md) · [ARCHITECTURE.md §12](../../docs/ARCHITECTURE.md)

Este directorio es el **catálogo versionado de test cases** de PFOS. Cada test case (TC) es un archivo Markdown con YAML front matter que describe **un comportamiento verificable**. Es el eslabón entre los Scenarios de OpenSpec y los tests automatizados:

```
FR (docs/01) → ### Requirement (openspec) → #### Scenario → TC (este catálogo) → it('[TC-…] …')
```

**Los test cases se escriben en español** (decisión del owner: todos los artefactos del proyecto en español), igual que las specs de OpenSpec y los nombres de los tests automatizados. Se mantienen como códigos/identificadores: los IDs (`TC-*`, `FR-*`, `NFR-*`, `INV-*`), las **claves** del YAML front matter y sus valores enumerados (`critical`, `domain`, `not_automated`…), los capability paths, los códigos de error, las cuentas tipo `FX_TRADING:USDT`, los nombres de fixtures de la Minimal Seed ([docs/29](../../docs/29-seed-datasets.md)) y los identificadores de código fuente, que siguen en inglés (el glosario de lenguaje ubicuo de [docs/04](../../docs/04-domain-model.md) mapea español↔inglés).

## Organización

```
tests/cases/
├─ README.md            # esta guía
├─ _template.md         # plantilla para TCs nuevos
├─ ledger/              # TC-LEDGER-*  (incluye TC-LEDGER-MONEY-* del shared-kernel, provisional)
├─ accounts/            # TC-ACCOUNTS-*
├─ transactions/        # TC-TRANSACTIONS-*
├─ classification/      # TC-CLASSIFICATION-*
├─ fx/                  # TC-FX-*
├─ audit/               # TC-AUDIT-*
├─ identity/            # TC-IDENTITY-*
├─ security/            # TC-SECURITY-*   (código transversal propuesto)
└─ platform/            # TC-PLATFORM-*   (código transversal propuesto)
```

- Un archivo por TC: `tests/cases/<context-lowercase>/<TC-ID>.md`.
- ID: `TC-<CONTEXT>-<FEATURE>-NNN` (regex `^TC-[A-Z]+-[A-Z0-9]+-\d{3}$`). El correlativo nunca se reutiliza.

## Cómo crear un TC

1. Copiar `_template.md` a `tests/cases/<context>/<TC-ID>.md`.
2. Completar el front matter (todos los campos obligatorios, ver abajo). Montos **siempre como string decimal** (`"300.00"`), nunca números.
3. Escribir el cuerpo: *Intención*, *Escenario* (Gherkin en español: **Dado** / **Cuando** / **Entonces** / **Y**) y *Notas*.
4. Declarar el TC en la sección **Test Impact** del change de OpenSpec que lo introduce (`TEST CASES ADDED`).
5. Al automatizarlo, poner el ID al inicio del nombre del test: `it('[TC-LEDGER-TRANSFER-001] la transferencia preserva el patrimonio neto', …)` y cambiar `status: automated`, `automation_status: automated`.

## Front matter — campos

El schema canónico (JSON Schema) está en [docs/17-test-traceability.md §4.1](../../docs/17-test-traceability.md). Resumen:

| Campo | Obligatorio | Valores / formato | Descripción |
|---|---|---|---|
| `id` | sí | `TC-<CONTEXT>-<FEATURE>-NNN` | Igual al nombre de archivo |
| `title` | sí | español, 10–140 caracteres | Se reutiliza como nombre del test |
| `spec` | sí | `<context>/<capability>` | Capability de [ARCHITECTURE §14](../../docs/ARCHITECTURE.md) |
| `related_specs` | no | lista de capabilities | Otras capabilities implicadas |
| `requirement` | sí | texto (español) | Nombre exacto del `### Requirement:` |
| `scenario` | no | texto (español) o `null` | Nombre del `#### Scenario:` |
| `requirement_status` | sí | `provisional` \| `confirmed` | `provisional` hasta que las specs de Phase 1 existan (post Design Gate) |
| `fr` / `nfr` | sí (al menos uno) | `FR-<CONTEXT>-NNN` / `NFR-<CAT>-NNN` | Requerimientos de origen (provisionales en Phase 0) |
| `invariants` | sí (puede ser `[]`) | `INV-001`..`INV-034` | Invariantes financieras protegidas ([docs/09](../../docs/09-ledger-design.md)) |
| `priority` | sí | `critical` \| `high` \| `medium` \| `low` | `critical` = integridad financiera o seguridad |
| `type` | sí | `unit` \| `domain` \| `property` \| `integration` \| `api` \| `e2e` \| `security` \| `platform` | Familia del test |
| `level` | sí | ver [docs/16 §5](../../docs/16-testing-strategy.md) | Nivel concreto de la estrategia |
| `automation_status` | sí | `not_automated` \| `automated` \| `manual` | |
| `automated_tests` | no | rutas | Lo verifica el generador de trazabilidad |
| `status` | sí | `draft` \| `ready` \| `automated` \| `deprecated` | Ciclo de vida ([docs/17 §5](../../docs/17-test-traceability.md)) |
| `regression_suite` | no | bool | Pertenece a la Financial Regression Suite |
| `phase` | no | 0–10 | Fase del roadmap en que se automatiza |
| `tags` | no | lista | p. ej. `money`, `multi-currency`, `regression` |
| `error_code` | no | `LEDGER_UNBALANCED_ENTRY`, `PERIOD_CLOSED`… | Código RFC 9457 esperado en casos de rechazo |
| `preconditions` | sí | lista | Estado previo |
| `input` | sí | objeto/lista | Datos de entrada |
| `steps` | sí | lista | Acciones |
| `expected_result` | sí | lista | Resultados observables |
| `deprecated_by_change`, `deprecation_reason`, `superseded_by` | si `deprecated` | | Ver reglas de deprecación |
| `created`, `updated` | sí | `YYYY-MM-DD` | |

## Reglas del catálogo

- **Nunca borrar** un TC: se depreca (`status: deprecated`) mediante un change de OpenSpec. Ver [docs/17 §5](../../docs/17-test-traceability.md).
- Toda invariante `INV-001..INV-034` debe tener al menos un TC activo.
- Los ejemplos numéricos de un TC **deben cuadrar** (Σ postings = 0 por moneda) — se revisan en el PR.
- Fechas de ejemplo fijas (nunca "hoy"); el test usa `FixedClock`.
- Datos de ejemplo siempre ficticios; preferir los de la Minimal Seed ([docs/29](../../docs/29-seed-datasets.md)).

## Plantilla

Ver [`_template.md`](./_template.md).
