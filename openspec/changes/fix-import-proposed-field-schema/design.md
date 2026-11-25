# Diseño

## Contexto

El change 54 (`add-import-pipeline`, implementado y sin archivar) publica en la vista previa la propuesta de clasificación de cada fila con el esquema común `ImportProposedField`, cuyo `value` es `oneOf [Uuid, array<Uuid>, string, null]`. `Uuid` es `type: string, format: uuid`, así que un id satisface dos ramas y `oneOf` falla con el validador del contrato que usan los tests de API (`contract.validateResponse`). La aplicación ya distingue los tipos por campo (`toProposalView` en `packages/contexts/imports/src/application/views.ts`): la categoría y la contraparte son ids, las etiquetas una lista y la descripción un texto.

## Objetivos / No objetivos

**Objetivos**
- Que toda respuesta de la vista previa valide contra el contrato sin filtros.
- Un cambio que `oasdiff` considere compatible, sin MAJOR del contrato.

**No objetivos**
- Cambiar qué se propone o cómo se edita una fila.

## Decisiones

1. **Esquemas por tipo de campo (opción c de la pregunta 6 de docs/76).** Es la única opción que, además de pasar `oasdiff`, describe el contrato real: cada campo tiene un solo tipo. *Alternativas:* (a) `anyOf`: incompatible para `oasdiff` (`response-property-any-of-added`, ERR) y obliga a una versión mayor; (b) `pattern` con lookahead negativo que excluya los UUID en la rama `string`: compatible, pero una descripción con forma de UUID dejaría de ser representable y el tipo de cada campo seguiría siendo ambiguo para un cliente generado; (b') `not: Uuid` en la rama `string`: mismo problema; (d) un discriminador nuevo (`valueType`) aditivo: no arregla el `oneOf` si no se cambia también la unión.

2. **Retirar `ImportProposedField`.** Queda sin referencias; quitar un componente no referenciado no cambia ninguna operación (`oasdiff` limpio) y evita la advertencia de componente sin uso de Spectral.

3. **Tipos de la aplicación.** `ProposedFieldView` se reemplaza por `ProposedIdFieldView`, `ProposedIdListFieldView` y `ProposedTextFieldView` (genérico sobre el tipo de `value`); `toProposalView` ya arma cada campo con su tipo y deja de necesitar los `as ProposedFieldView`.

## Contratos

En `contracts/openapi/finance-api.v1.yaml`, `components.schemas`:

```yaml
ImportProposedIdField:
  type: object
  additionalProperties: false
  required: [value, origin]
  properties:
    value:
      description: The proposed id.
      oneOf:
        - $ref: '#/components/schemas/Uuid'
        - type: 'null'
    origin: { $ref: '#/components/schemas/ImportRowFieldOrigin' }
    ruleId:
      oneOf:
        - $ref: '#/components/schemas/Uuid'
        - type: 'null'
    ruleVersion:
      oneOf:
        - type: integer
          minimum: 1
        - type: 'null'
```

`ImportProposedIdListField` igual con `value: oneOf [{type: array, items: {$ref: Uuid}}, {type: 'null'}]` («The proposed list of ids.») e `ImportProposedTextField` con `value: oneOf [{type: string}, {type: 'null'}]` («The proposed text.»). En `ImportRowProposal`: `categoryId` y `counterpartyId` → `ImportProposedIdField`, `tagIds` → `ImportProposedIdListField`, `description` → `ImportProposedTextField`. Se elimina `ImportProposedField`.

Verificación hecha al redactar (2026-11-25): `oasdiff breaking base.yaml revision.yaml --fail-on ERR` con la imagen fijada en `scripts/contract/src/oasdiff.ts` → «No breaking changes to report» para esta forma, también sin `ImportProposedField`.

## Riesgos / Trade-offs

- **Clientes con el nombre del esquema** → no hay clientes externos; la web usa tipos a mano que se actualizan en el mismo PR.

## Plan de migración

Sin migraciones. Se fusiona después de `add-import-pipeline` o de forma independiente (no modifica sus requirements); se archiva después de él porque agrega un requirement a `imports/import-pipeline`.

## Preguntas abiertas

Pregunta 6 de [docs/76](../../../docs/76-phase-9-and-card-interest-questions.md) (no bloquea): el change usa la recomendación (c).
