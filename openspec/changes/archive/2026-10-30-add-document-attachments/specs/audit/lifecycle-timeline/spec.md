## ADDED Requirements

### Requirement: Recorrido de un documento
El documento DEBE (MUST) declarar su máquina de estados (pendiente de subida, subido, disponible, rechazado, eliminado y contenido pendiente de restaurar) con las transiciones solicitar subida, confirmar, aceptar, rechazar, expirar, eliminar, purgar y restaurar contenido, cada una con actor, instante y motivo; archivar, desarchivar, vincular y desvincular DEBEN (MUST) mostrarse como anotaciones del recorrido. Todo miembro que puede ver el documento DEBE (MUST) poder consultar su recorrido.
Trace: FR-AUDIT-009, FR-AUDIT-010 · Priority: Should

#### Scenario: Recorrido de un comprobante adjuntado y eliminado
- **CUANDO** un EDITOR subió y confirmó "ticket-supermercado.jpg", lo adjuntó a un gasto de 150.00 BOB y el OWNER lo eliminó
- **ENTONCES** el recorrido muestra las transiciones solicitar subida, confirmar, aceptar y eliminar con sus actores e instantes
- **Y** muestra la vinculación con el gasto como anotación
