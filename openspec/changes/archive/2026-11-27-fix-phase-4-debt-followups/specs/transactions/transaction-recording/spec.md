# Spec Delta

## ADDED Requirements

### Requirement: Edición descriptiva de transacciones administradas desde la pantalla
El detalle de una transacción de desembolso o de pago de préstamo no anulada DEBE (MUST) ofrecer a los roles con edición editar su descripción y sus notas desde la pantalla, sin mostrar campos financieros. El de un cargo de tarjeta DEBE (MUST) ofrecer editar su descripción, notas, tags y contraparte, con el monto, la cuenta, la fecha, la moneda y la categoría de sus porciones visibles como solo lectura e indicando la tarjeta que lo administra. Guardar esos datos NO DEBE (MUST NOT) crear, modificar ni revertir asientos. Un VIEWER y una transacción anulada NO DEBEN (MUST NOT) ofrecer la edición.
Trace: FR-DEBT-002, FR-DEBT-007, FR-DEBT-013, FR-TRANSACTIONS-009 · Priority: Should

#### Scenario: Nota en un pago de préstamo desde la pantalla
- **CUANDO** el EDITOR abre el pago de 2342.02 BOB del 2026-11-15 del "Préstamo vehicular" y elige editar la descripción y las notas
- **ENTONCES** el formulario muestra solo la descripción y las notas
- **Y** al guardar la nota "pagado en ventanilla" la nota queda registrada y el asiento del pago no cambia

#### Scenario: Cargo de tarjeta con campos financieros de solo lectura
- **CUANDO** el EDITOR abre para editar el cargo de 4.80 BOB del 2026-10-25 de "Visa Oro BOB"
- **ENTONCES** el monto 4.80 BOB, la cuenta, la fecha y las categorías "Intereses pagados" y "Seguros" se muestran como solo lectura, indicando que los administra "Visa Oro"
- **Y** al guardar la nota "interés por pago parcial de septiembre" la nota queda registrada y el cargo sigue en 4.80 BOB

#### Scenario: VIEWER sin edición
- **CUANDO** un VIEWER abre el pago de 2342.02 BOB del "Préstamo vehicular"
- **ENTONCES** ve el desglose y el préstamo de origen, y no se le ofrece editar

#### Scenario: Pago de préstamo anulado
- **CUANDO** el EDITOR abre un pago de préstamo que se anuló desde el préstamo
- **ENTONCES** no se le ofrece editar la descripción ni las notas
