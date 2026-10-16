# Fichas de formato de extractos bancarios (Bolivia)

> **Estado:** Registrado · **Fecha:** 2026-10-16 · **Origen:** tarea 8.3 de `add-exchange-house-rate-providers` (design.md decisión 10, D255) · **Relacionado:** [docs/13](../13-import-architecture.md) (§2 `StagedTransaction`, `StatementBalance`, `MappingProfile`; etapas Parse y Normalize), [docs/41](../41-phase-5-consolidation-decisions.md), [docs/38](../38-estado-y-pendientes.md)

Estas fichas describen **cómo es** el extracto en PDF de cuatro entidades, a partir de una muestra que el owner compartió en la conversación. **Los PDF nunca entraron al repositorio y ninguna ficha, fixture o test contiene un dato real** (nombres, cuentas, comercios, importes, saldos, fechas, referencias): todo valor es inventado y está marcado SINTÉTICO. Los nombres de las entidades reales aparecen solo para identificar el formato; los fixtures usan entidades ficticias "… Demo".

| Ficha | Entidad | Generador del PDF | Moneda de la muestra | Fixture sintético |
|---|---|---|---|---|
| [BCP.md](BCP.md) | Banco de Crédito de Bolivia (BCP) | Microsoft Reporting Services | BOB | `tests/fixtures/imports/statements-bo/bcp` |
| [GANADERO.md](GANADERO.md) | Banco Ganadero | jsPDF | BOB | `tests/fixtures/imports/statements-bo/ganadero` |
| [BISA.md](BISA.md) | Banco BISA | iText | USD | `tests/fixtures/imports/statements-bo/bisa` |
| [BNB.md](BNB.md) | Banco Nacional de Bolivia (BNB) | wkhtmltopdf | BOB | `tests/fixtures/imports/statements-bo/bnb` |

Cada carpeta de fixture tiene `statement.txt` (imita la salida de `pdftotext -layout`) y `expected.json` (los movimientos canónicos). El oráculo es `packages/contexts/imports/src/infrastructure/statement-fixtures.test.ts` (TC-IMPORTS-STMT-001 a 005): verifica la marca sintética, que `saldo inicial + créditos - débitos = saldo final`, el saldo corrido, los totales y que el texto contiene los mismos importes, saldos y fechas que el `expected`. **No es un parser de producto** (Phase 6/11).

## Conclusiones comunes

1. **Las cuatro muestras son PDF con texto extraíble** (ninguna es solo imagen): `IMAGE_ONLY_STATEMENT` no aplica a ninguna. No hace falta OCR.
2. **Extracción recomendada:** `pdftotext -layout` conserva las columnas y alcanza para BCP, Ganadero y BISA. Para BNB el diseño por columnas se desordena entre líneas (ver la ficha): conviene extraer con coordenadas (`pdftotext -bbox-layout` o una librería que entregue cada palabra con su posición) y reconstruir las filas por posición. Es una hipótesis a validar con el parser de Phase 6, no una decisión.
3. **Formatos de número y fecha por entidad** (no hay un estándar; el perfil de mapeo debe declararlos):

   | | Fecha | Hora | Miles | Decimal | Signo |
   |---|---|---|---|---|---|
   | BCP | `AAAAMMDD` | `HH:MM:SS` | ninguno | `.` | un solo monto con signo (negativo = débito) |
   | Ganadero | `DD/MM/AAAA` | `HH:MM:SS` | `,` | `.` | columnas Débito y Crédito (`0.00` en la que no aplica) |
   | BISA | `DD-MM-AAAA` | columna `Hora` | no observado | `,` | columnas Débitos y Créditos |
   | BNB | `DD/MM/AAAA` | `HH:MM` (en otra línea) | `,` | `.` | dos secciones: Depósitos (créditos) y Retiros (débitos) |

4. **Mapeo común a docs/13:** `fecha` → fecha de negocio (zona America/La_Paz; el extracto no trae zona), `descripción` → descripción limpia (colapsar líneas y espacios), `monto` → `Money` con signo (débito negativo, crédito positivo; siempre string → `Decimal`), `saldo` → saldo corrido cuando existe (ayuda a validar y a ordenar), `referencia` → `external id` solo si es único, `contraparte` → solo en texto libre de la descripción (no hay columna). `StatementBalance` sale del encabezado (saldo inicial y final y periodo).
5. **Riesgos transversales de parseo:**
   - El id de transacción no siempre es único (Ganadero y BNB repiten referencia entre un interés y su retención): el `RowFingerprint` no puede depender solo de él.
   - Las descripciones son multilínea y se cortan en el salto de página; las filas pueden no ser cronológicas: el saldo corrido sigue el **orden impreso**, no la fecha.
   - Textos libres con nombres de terceros: tratarlos como datos no confiables (docs/13, requirement "Textos importados como datos no confiables") y no copiarlos a fixtures.
   - Los meses vienen en texto español (BCP, BISA, BNB): la lectura debe ser por tabla de meses, no por locale del sistema.
   - Los encabezados traen datos personales (titular, dirección, cuenta, operador): el parser debe descartarlos del staging salvo el número de cuenta para casar con la cuenta destino.
   - Los metadatos del PDF (autor, creador) pueden traer datos personales; no se conservan.
6. **Valor recomendado de `statementImport`** (vocabulario de design.md decisión 5; ver cada ficha): las cuatro quedan `PENDING_SAMPLE`. Con esta información no se puede declarar `GENERIC_ONLY` (exige un CSV o XLS exportable compatible con el CSV básico y no hay evidencia de que la entidad lo ofrezca) ni `NOT_ELIGIBLE` (`IMAGE_ONLY_STATEMENT` es falso: el texto es extraíble). Pasan a `GENERIC_ONLY` si el owner confirma que el banco exporta CSV o XLS, y a `SUPPORTED` cuando Phase 6/11 entregue un perfil o parser de PDF. **La actualización en el archivo real del catálogo (`reference/institutions/BO.json`) queda para la tarea 4.2**; estas recomendaciones no modifican ningún archivo de catálogo.

## Procedimiento para sumar una entidad

1. El owner comparte el PDF solo en la conversación; nunca se guarda en el repositorio.
2. Se extrae el texto fuera del repositorio y se describe el formato en una ficha nueva.
3. Se fabrica un fixture con entidad, personas, cuentas, comercios, importes y fechas inventados, con la marca `*** SINTETICO` en la primera línea, y su `expected.json`.
4. Se revisa el diff buscando cualquier dato real antes de fusionar, y se borra el PDF del entorno de trabajo.
