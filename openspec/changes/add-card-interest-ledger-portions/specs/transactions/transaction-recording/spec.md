## ADDED Requirements

### Requirement: Transacciones de cargos de tarjeta administradas por la tarjeta
Los gastos que son cargos de una tarjeta (registrados o adoptados desde la tarjeta) DEBEN (MUST) aparecer en el listado, los filtros y el detalle de transacciones como gastos, con sus porciones por componente identificadas como cargo de la tarjeta y la tarjeta de origen; editar su monto, cuenta, fecha, moneda o la categoría de sus porciones, o anularlos fuera de la tarjeta, DEBE (MUST) rechazarse con `TRANSACTION_MANAGED_EXTERNALLY` indicando la tarjeta; editar la descripción, las notas, los tags y la contraparte DEBE (MUST) seguir permitido sin tocar el ledger. Las porciones de un cargo DEBEN (MUST) sumar el monto de la transacción.
Trace: FR-DEBT-013, FR-TRANSACTIONS-009, INV-021 · Priority: Should

#### Scenario: Cargo de la tarjeta en el listado
- **CUANDO** el usuario lista las transacciones de "Visa Oro BOB" de octubre de 2026
- **ENTONCES** ve el gasto de 4.80 BOB del 2026-10-25 con las porciones interés 4.00 BOB en "Intereses pagados" y seguro 0.80 BOB en "Seguros", identificado como cargo de "Visa Oro"

#### Scenario: Cambiar el monto del cargo desde transacciones
- **CUANDO** el EDITOR cambia desde transacciones el monto del cargo de 4.80 BOB a 5.00 BOB
- **ENTONCES** se rechaza con `TRANSACTION_MANAGED_EXTERNALLY` y el cargo sigue en 4.80 BOB

#### Scenario: Nota en el cargo
- **CUANDO** el EDITOR agrega la nota "interés por pago parcial de septiembre" al cargo de 4.80 BOB
- **ENTONCES** la nota queda registrada y el asiento del cargo no cambia
