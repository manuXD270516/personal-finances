## ADDED Requirements

### Requirement: Registro de los intereses y cargos de una tarjeta
El EDITOR DEBE (MUST) poder registrar para una cuenta de una tarjeta activa los intereses y cargos que cobra el banco, con fecha de negocio (por omisión la fecha de cierre del último estado de cuenta emitido de esa cuenta) y montos no negativos por componente: interés, comisiones, seguro e impuestos, en la moneda de la cuenta y a su escala, con al menos un componente positivo. Registrarlo DEBE (MUST), en una sola unidad de trabajo, crear un gasto posteado en la cuenta de la tarjeta por la suma de los componentes, con una porción por cada componente positivo en la categoría de sistema que le corresponde ("Intereses pagados", "Comisiones", "Seguros" e "Impuestos") e identificada como cargo de la tarjeta, de modo que la deuda de la cuenta aumente por esa suma y el cargo cuente en las compras del ciclo que contiene su fecha. Una fecha posterior a hoy en la zona del workspace o anterior a la apertura de la cuenta, una cuenta que no es de la tarjeta, una tarjeta archivada o un cargo sin ningún componente positivo DEBEN (MUST) rechazarse con `CARD_CHARGE_INVALID`; un componente negativo con `AMOUNT_NOT_POSITIVE`; un monto con más decimales que la escala de la moneda con `AMOUNT_SCALE_EXCEEDED`; una fecha en un periodo cerrado con `PERIOD_CLOSED`; en todos los casos sin crear nada.
Trace: FR-DEBT-013, FR-REPORTING-008, INV-001, INV-002, INV-003, INV-004, INV-021 · Priority: Should

#### Scenario: Interés y seguro del estado de cuenta de octubre
- **CUANDO** el 2026-10-28 el EDITOR registra en "Visa Oro BOB", que adeuda 1520.50 BOB, un cargo con fecha 2026-10-25 de 4.00 BOB de interés y 0.80 BOB de seguro
- **ENTONCES** se crea un gasto posteado de 4.80 BOB en "Visa Oro BOB" con una porción de 4.00 BOB en "Intereses pagados" y otra de 0.80 BOB en "Seguros", ambas identificadas como cargo de la tarjeta
- **Y** "Visa Oro BOB" adeuda 1525.30 BOB y las compras del ciclo del 2026-09-26 al 2026-10-25 pasan de 1170.50 BOB a 1175.30 BOB

#### Scenario: Cargo en dólares
- **CUANDO** el EDITOR registra en "Visa Oro USD" un cargo con fecha 2026-10-25 de 1.25 USD de interés
- **ENTONCES** se crea un gasto posteado de 1.25 USD en "Visa Oro USD" con una porción de 1.25 USD en "Intereses pagados" y la deuda de "Visa Oro USD" aumenta 1.25 USD

#### Scenario: Cargo sin componentes positivos o con fecha futura
- **CUANDO** el 2026-10-28 el EDITOR registra en "Visa Oro BOB" un cargo con todos los componentes en 0.00 BOB, o un cargo de 4.00 BOB de interés con fecha 2026-10-30
- **ENTONCES** se rechaza con `CARD_CHARGE_INVALID` y no se crea ninguna transacción

#### Scenario: Interés con más decimales que la moneda
- **CUANDO** el EDITOR registra en "Visa Oro USD" un cargo de 1.255 USD de interés
- **ENTONCES** se rechaza con `AMOUNT_SCALE_EXCEEDED` y no se crea ninguna transacción

### Requirement: Cargos registrados en el estado de cuenta
El detalle de un estado de cuenta DEBE (MUST) listar los cargos vigentes de la tarjeta cuya fecha cae en su ciclo, con sus componentes y su total, y sus cifras recalculadas DEBEN (MUST) incluirlos en las compras; cuando hay montos informados por el banco, la diferencia con el cálculo del sistema DEBE (MUST) reflejar los cargos registrados. Los cargos anulados NO DEBEN (MUST NOT) listarse ni contarse.
Trace: FR-DEBT-013 · Priority: Should

#### Scenario: Diferencia con el banco cubierta por el cargo
- **CUANDO** el estado de cuenta cerrado el 2026-10-25 de "Visa Oro BOB" se emitió con saldo facturado 1120.50 BOB, el banco informó 1125.30 BOB y se registra el cargo de 4.00 BOB de interés y 0.80 BOB de seguro con fecha 2026-10-25
- **ENTONCES** el detalle lista ese cargo con total 4.80 BOB, el saldo facturado recalculado es 1125.30 BOB, la diferencia con lo emitido es 4.80 BOB y la diferencia con lo informado por el banco es 0.00 BOB

### Requirement: Propuesta de cargos desde la diferencia con el banco
Cuando el saldo facturado informado por el banco supera el saldo facturado recalculado de un estado de cuenta, el sistema DEBE (MUST) ofrecer al EDITOR registrar un cargo con fecha de cierre del estado de cuenta y con el total igual a esa diferencia para repartir entre componentes; la propuesta NO DEBE (MUST NOT) crear asientos ni transacciones hasta que el EDITOR la confirme, y una diferencia nula o negativa NO DEBE (MUST NOT) ofrecerla.
Trace: FR-DEBT-013 · Priority: Could

#### Scenario: Propuesta de 4.80 BOB
- **CUANDO** el estado de cuenta cerrado el 2026-10-25 tiene saldo facturado recalculado 1120.50 BOB y el banco informó 1125.30 BOB
- **ENTONCES** se ofrece registrar un cargo con fecha 2026-10-25 por un total de 4.80 BOB a repartir entre componentes
- **Y** no se registra ningún asiento hasta que el EDITOR confirma el reparto

### Requirement: Anular un cargo de la tarjeta
El EDITOR DEBE (MUST) poder anular un cargo vigente de la tarjeta con un motivo; anularlo DEBE (MUST) anular su transacción con la reversa de su asiento, sin borrar ni modificar asientos existentes, de modo que la deuda de la cuenta vuelva a su valor anterior y el cargo deje de contarse en el ciclo y en los reportes. Anular un cargo ya anulado DEBE (MUST) ser idempotente, y anular uno cuya fecha cae en un periodo cerrado DEBE (MUST) rechazarse con `PERIOD_CLOSED` sin cambiar nada.
Trace: FR-DEBT-013, INV-007, INV-008, INV-015 · Priority: Should

#### Scenario: Cargo registrado por error
- **CUANDO** el EDITOR anula con el motivo "monto equivocado" el cargo de 4.80 BOB del 2026-10-25 de "Visa Oro BOB", que adeuda 1525.30 BOB
- **ENTONCES** la transacción del cargo queda anulada con la reversa de su asiento y "Visa Oro BOB" adeuda 1520.50 BOB
- **Y** las compras del ciclo del 2026-09-26 al 2026-10-25 vuelven a 1170.50 BOB

#### Scenario: Cargo de un mes cerrado
- **CUANDO** el periodo 2026-10 está cerrado y el EDITOR anula el cargo de 4.80 BOB del 2026-10-25
- **ENTONCES** se rechaza con `PERIOD_CLOSED` y el cargo y su transacción siguen vigentes

### Requirement: Adoptar un gasto existente como cargo de la tarjeta
El EDITOR DEBE (MUST) poder declarar como cargo de la tarjeta un gasto posteado ya existente de una cuenta de la tarjeta (registrado a mano o importado), indicando sus componentes; la suma de los componentes DEBE (MUST) ser igual al monto del gasto. Adoptarlo DEBE (MUST) registrar una nueva revisión de la transacción con una porción por componente en su categoría de sistema, identificadas como cargo de la tarjeta, sin cambiar su monto, cuenta, fecha ni moneda y sin crear otra transacción, de modo que el saldo de la cuenta no cambie. Un gasto que no es de una cuenta de la tarjeta, no está posteado, ya es un cargo, está administrado por otro contexto o cuyos componentes no suman su monto DEBE (MUST) rechazarse con `CARD_CHARGE_INVALID`.
Trace: FR-DEBT-013, FR-REPORTING-008, INV-021 · Priority: Should

#### Scenario: Interés cargado a mano antes del change
- **CUANDO** "Visa Oro BOB" tiene un gasto manual "Interés Visa" de 4.80 BOB del 2026-10-25 en "Intereses pagados" y el EDITOR lo adopta como cargo con 4.80 BOB de interés
- **ENTONCES** la transacción conserva su monto de 4.80 BOB, su cuenta y su fecha, su porción de 4.80 BOB queda identificada como cargo de la tarjeta y "Visa Oro BOB" no cambia de saldo
- **Y** no se crea ninguna transacción nueva

#### Scenario: Componentes que no suman el gasto
- **CUANDO** el EDITOR adopta el gasto "Interés Visa" de 4.80 BOB con 4.00 BOB de interés y 1.00 BOB de seguro
- **ENTONCES** se rechaza con `CARD_CHARGE_INVALID` y la transacción no cambia

### Requirement: Permisos, auditoría e idempotencia de los cargos de la tarjeta
Todo miembro activo DEBE (MUST) poder consultar los cargos de una tarjeta; solo OWNER y EDITOR DEBEN (MUST) poder registrarlos, adoptarlos y anularlos (un VIEWER recibe `INSUFFICIENT_ROLE`). Cada registro, adopción y anulación DEBE (MUST) auditarse en la misma unidad de trabajo que su transacción, con actor, componentes y motivo; el registro DEBE (MUST) ser idempotente con `Idempotency-Key` y crear una sola transacción aunque se reintente; un cargo de otro workspace DEBE (MUST) responder `RESOURCE_NOT_FOUND`.
Trace: FR-DEBT-012, FR-AUDIT-001, NFR-SEC-003 · Priority: Should

#### Scenario: VIEWER intenta registrar un cargo
- **CUANDO** un VIEWER registra en "Visa Oro BOB" un cargo de 4.00 BOB de interés
- **ENTONCES** se rechaza con `INSUFFICIENT_ROLE` y no se crea ninguna transacción

#### Scenario: Cargo auditado
- **CUANDO** el EDITOR registra el cargo de 4.00 BOB de interés y 0.80 BOB de seguro del 2026-10-25 en "Visa Oro BOB"
- **ENTONCES** la auditoría de "Visa Oro" registra al EDITOR como actor y los componentes interés 4.00 BOB y seguro 0.80 BOB

#### Scenario: Reintento con la misma clave
- **CUANDO** el cliente reintenta con la misma `Idempotency-Key` el registro del cargo de 4.80 BOB
- **ENTONCES** la respuesta es el mismo cargo y existe una sola transacción de 4.80 BOB

### Requirement: Cargos de la tarjeta en la exportación del workspace
El export del workspace DEBE (MUST) incluir los cargos de las tarjetas, vigentes y anulados, con sus componentes, su origen (registrado o adoptado) y su transacción, y la marca de cargo de la tarjeta de cada transacción; importar el export en un workspace nuevo DEBE (MUST) restaurarlos con la misma relación entre cargo y transacción.
Trace: FR-IDENTITY-010, FR-DEBT-013 · Priority: Should

#### Scenario: Ida y vuelta con un cargo vigente y uno anulado
- **CUANDO** "W1" tiene en "Visa Oro BOB" el cargo vigente de 4.80 BOB del 2026-10-25 y un cargo anulado de 2.00 BOB del 2026-09-25, y el OWNER exporta e importa en un workspace nuevo
- **ENTONCES** el workspace nuevo tiene los dos cargos con sus componentes y estados, cada uno vinculado a su transacción, y "Visa Oro BOB" adeuda lo mismo que en "W1"
