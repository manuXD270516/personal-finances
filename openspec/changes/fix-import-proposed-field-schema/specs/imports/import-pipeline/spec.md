## ADDED Requirements

### Requirement: Propuesta de la vista previa con un tipo de valor por campo
La propuesta de clasificación de cada fila de la vista previa DEBE (MUST) publicar cada campo con un tipo de valor propio: la categoría y la contraparte, un id o nulo; las etiquetas, una lista de ids o nulo; la descripción, un texto o nulo; cada uno con su origen y, si lo propuso una regla, la regla y su versión. Toda respuesta de la vista previa y de la edición de una fila DEBE (MUST) validar contra el contrato publicado sin excepciones, de modo que cada valor coincida con una sola de las alternativas de su campo, incluso cuando una descripción tiene la forma de un id.
Trace: FR-IMPORTS-009, NFR-MAINT-009 · Priority: Should

#### Scenario: Propuesta con los cuatro campos
- **CUANDO** una regla propone para la fila "DEB AUT 0412" la categoría "Seguros", la contraparte "Aseguradora Andina", las etiquetas "auto" y "anual" y la descripción "Seguro del auto", y un VIEWER pide la vista previa
- **ENTONCES** la fila publica la categoría y la contraparte como un id cada una, las etiquetas como una lista de dos ids y la descripción como texto, todas con origen regla, y la respuesta valida contra el contrato sin errores

#### Scenario: Descripción con forma de id
- **CUANDO** la descripción propuesta de una fila es el texto "0192f3c4-7b2e-7c1a-9d8e-3f2a1b0c9d8e"
- **ENTONCES** la descripción se publica como texto y la respuesta valida contra el contrato sin errores

#### Scenario: Edición de una fila validada
- **CUANDO** el EDITOR cambia la categoría de la fila "DEB AUT 0412" a "Seguros" con la versión vigente de la importación
- **ENTONCES** la fila devuelta publica la categoría propuesta como un id y la respuesta valida contra el contrato sin errores
