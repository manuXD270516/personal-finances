# Propuesta: fix-import-proposed-field-schema

## Why

`ImportProposedField.value` (vista previa del import, change 54 `add-import-pipeline`) es un `oneOf` de cuatro alternativas: `Uuid`, lista de `Uuid`, `string` y `null`. Un id cumple a la vez `Uuid` y `string`, así que toda propuesta con categoría, contraparte o descripción incumple `oneOf` («coincide con más de una alternativa») y la respuesta no valida contra el contrato publicado. El hallazgo salió en `add-banking-providers` (docs/38 §4) y hoy los tests de API de las conexiones descartan ese error con un filtro (`apps/api/test/api/imports-connections.api.test.ts`). Pasar el `oneOf` a `anyOf` lo marca `oasdiff` como incompatible (`response-property-any-of-added`, nivel ERR, en `getImportPreview` y en la edición de una fila).

## What Changes

- **Un esquema por tipo de campo** en `contracts/openapi/finance-api.v1.yaml`: `ImportProposedIdField` (`value`: `Uuid` o `null`) para `categoryId` y `counterpartyId`, `ImportProposedIdListField` (`value`: lista de `Uuid` o `null`) para `tagIds` e `ImportProposedTextField` (`value`: `string` o `null`) para `description`, con los mismos `origin`, `ruleId` y `ruleVersion`. `ImportRowProposal` apunta a ellos y se retira `ImportProposedField`, que deja de usarse.
- Las alternativas de cada campo son disjuntas: el `oneOf` de cada uno siempre coincide con una sola.
- **Sin cambio de comportamiento:** la aplicación ya produce esos tipos por campo (`toProposalView` en IMPORTS); solo cambian el contrato, los tipos TypeScript de la API y de la web, y el test de las conexiones deja de descartar el error.
- **Verificado con `oasdiff` v1.32.1** (imagen fijada de `pnpm contract:breaking`) sobre una copia del contrato: «No breaking changes». `anyOf` dio 4 errores y 4 advertencias; un `pattern` que excluye UUID en la rama `string` y un `not: Uuid` también salieron limpios (alternativas de la pregunta 6 de docs/76).
- **Fuera de alcance:** cambiar `ImportRowEdits` (entrada, ya tipada por campo) o el resto de los `oneOf` con `null` del contrato, que no se solapan.

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities
- `imports/import-pipeline`: 1 ADDED (Should).

## Impact

**Specs impactadas:** `imports/import-pipeline` (1 ADDED).

**Componentes/contextos impactados:** `contracts/openapi/finance-api.v1.yaml` (esquemas); IMPORTS (`ProposedFieldView` se reemplaza por tres vistas tipadas; sin cambio de datos); `apps/web/src/ui/imports/types.ts` y `pipeline-logic.ts` (tipos); `apps/api/test/api/imports-connections.api.test.ts` (sin filtro de errores).

**APIs impactadas:** `getImportPreview` y `decideImportRow` (y toda respuesta que incluya `ImportPreviewRow`): el esquema de cada campo de `proposal` se estrecha a su tipo. Aditivo según `oasdiff` (respuestas más estrictas); sin códigos de error nuevos.

**Tablas impactadas:** ninguna.

**Eventos impactados:** ninguno.

**Migraciones requeridas:** ninguna.

**Test cases:** AÑADIDOS — TC-IMPORTS-PIPELINE-072..074 (3). MODIFICADOS — ninguno. DEPRECADOS — ninguno.

**Impacto de regresión:** bajo; clientes generados desde el contrato ven tipos más precisos por campo. El SDK de la web no se genera (tipos a mano).

**Riesgos introducidos:** un cliente externo que dependiera del nombre `ImportProposedField` (no hay: el contrato no se publica a terceros todavía).

**Invariantes afectadas:** ninguna.
