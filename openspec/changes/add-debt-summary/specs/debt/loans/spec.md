## ADDED Requirements

### Requirement: Total adeudado por moneda y en moneda base
El resumen de deudas DEBE (MUST) listar cada cuenta de pasivo no archivada con saldo adeudado distinto de cero (préstamos, tarjetas por moneda y otros pasivos), con su saldo derivado del ledger a hoy, y totalizar lo adeudado por moneda y consolidado en la moneda base con la tasa de valoración de hoy; una moneda sin tasa NO DEBE (MUST NOT) convertirse 1:1: queda sin convertir y el consolidado se marca incompleto. Un saldo a favor (pasivo con saldo negativo) DEBE (MUST) mostrarse aparte y NO DEBE (MUST NOT) restarse del total adeudado. El resumen DEBE (MUST) calcularse al consultarlo, reflejando de inmediato las transacciones posteadas.
Trace: FR-DEBT-018, FR-FX-006 · Priority: Could

#### Scenario: Préstamo, tarjeta bimoneda y otro pasivo
- **CUANDO** el 2026-10-28, con moneda base BOB y tasa de valoración USD/BOB 9.80, "Préstamo auto" adeuda 45000.00 BOB, "Visa Oro BOB" 1120.50 BOB, "Visa Oro USD" 100.00 USD y "Deuda familiar" (`manual_liability`) 2000.00 BOB
- **ENTONCES** el total adeudado es 48120.50 BOB y 100.00 USD por moneda y 49100.50 BOB consolidado
- **Y** el resumen agrupa "Préstamo auto" como préstamo, "Visa Oro" como tarjeta con sus dos monedas y "Deuda familiar" como otro pasivo

#### Scenario: Sin tasa para el dólar
- **CUANDO** no hay tasa de valoración USD/BOB vigente
- **ENTONCES** el consolidado es 48120.50 BOB marcado incompleto con 100.00 USD sin convertir

#### Scenario: Saldo a favor en la tarjeta en dólares
- **CUANDO** "Visa Oro USD" tiene un saldo a favor de 30.00 USD
- **ENTONCES** el total adeudado en USD es 0.00 USD, el consolidado es 48120.50 BOB y el resumen muestra aparte 30.00 USD a favor en "Visa Oro USD"

#### Scenario: Pago reflejado de inmediato
- **CUANDO** se postea una transferencia de 1120.50 BOB de "Banco BOB" a "Visa Oro BOB" y se vuelve a consultar el resumen
- **ENTONCES** el total adeudado en BOB es 47000.00 BOB y "Visa Oro BOB" deja de listarse

### Requirement: Interés pagado en el año
El resumen DEBE (MUST) informar el interés pagado desde el 1 de enero del año en curso hasta hoy, en la zona del workspace, como la suma de los gastos de la categoría de sistema "Intereses pagados" neta de reembolsos, por moneda y consolidado en la moneda base con la tasa de la fecha de cada gasto, y DEBE (MUST) desglosarlo por préstamo, por tarjeta y en "otros intereses" para el resto, de modo que el desglose sume el total por moneda.
Trace: FR-DEBT-018, FR-DEBT-007 · Priority: Could

#### Scenario: Interés del préstamo y de la tarjeta
- **CUANDO** al 2026-10-28 los pagos de "Préstamo auto" de 2026 imputaron 3250.40 BOB de interés y "Visa Oro USD" tiene un gasto de interés de 12.00 USD del 2026-08-25, con tasa USD/BOB de ese día 9.75
- **ENTONCES** el interés pagado en el año es 3250.40 BOB y 12.00 USD por moneda y 3367.40 BOB consolidado
- **Y** el desglose atribuye 3250.40 BOB a "Préstamo auto" y 12.00 USD a "Visa Oro"

#### Scenario: Interés del año anterior excluido
- **CUANDO** además existe un gasto de interés de 300.00 BOB del 2025-12-28 en "Préstamo auto"
- **ENTONCES** el interés pagado en el año sigue siendo 3367.40 BOB consolidado

#### Scenario: Interés sin deuda asociada
- **CUANDO** además existe un gasto de 25.00 BOB en "Intereses pagados" pagado desde "Banco BOB" por un sobregiro, sin préstamo ni tarjeta
- **ENTONCES** el interés en BOB es 3275.40 BOB, con 25.00 BOB en "otros intereses"

### Requirement: Fecha estimada libre de deudas
El resumen DEBE (MUST) estimar para cada deuda con saldo adeudado la fecha en que terminaría de pagarse: para un préstamo, el vencimiento de su última cuota no pagada según el cronograma vigente; para una cuenta de tarjeta, suponiendo que se paga el total facturado y no hay compras nuevas, el vencimiento del ciclo que facturará la última cuota pendiente o, sin cuotas, el del estado de cuenta que factura el saldo actual; un otro pasivo sin cronograma DEBE (MUST) informarse como no estimable. La fecha libre de deudas DEBE (MUST) ser la mayor de las estimadas y, si hay deudas no estimables, DEBE (MUST) indicar cuáles quedaron fuera.
Trace: FR-DEBT-018 · Priority: Could

#### Scenario: Con un pasivo no estimable
- **CUANDO** el 2026-10-28 la última cuota no pagada de "Préstamo auto" vence el 2029-06-05, todo el saldo de "Visa Oro BOB" y "Visa Oro USD" está facturado en el estado de cuenta que vence el 2026-11-15 y "Deuda familiar" adeuda 2000.00 BOB sin cronograma
- **ENTONCES** la fecha estimada libre de deudas es 2029-06-05 sin contar "Deuda familiar"
- **Y** "Visa Oro" se estima saldada el 2026-11-15

#### Scenario: Todas las deudas estimables
- **CUANDO** además "Deuda familiar" se salda
- **ENTONCES** la fecha estimada libre de deudas es 2029-06-05 sin deudas excluidas

#### Scenario: Tarjeta con cuotas pendientes
- **CUANDO** "Visa Oro BOB" solo adeuda la compra "Laptop" de 1000.00 BOB en 3 cuotas, cuya última se factura en el ciclo que vence el 2027-01-15
- **ENTONCES** "Visa Oro" se estima saldada el 2027-01-15

#### Scenario: Sin deudas
- **CUANDO** ninguna cuenta de pasivo tiene saldo adeudado
- **ENTONCES** el resumen informa que no hay deudas pendientes y no muestra fecha estimada

### Requirement: Próximos vencimientos de deudas
El resumen DEBE (MUST) listar el próximo vencimiento de cada deuda ordenado por fecha: para un préstamo, su primera cuota no pagada con fecha, monto pendiente y si está atrasada; para una cuenta de tarjeta, el estado de cuenta emitido con saldo por pagar (fecha de vencimiento, lo que falta para no generar intereses y el pago mínimo) o, si no hay, el vencimiento del ciclo abierto con su monto estimado; las deudas sin vencimiento conocido NO DEBEN (MUST NOT) listarse.
Trace: FR-DEBT-018, FR-DEBT-013, FR-DEBT-011 · Priority: Could

#### Scenario: Cuota y estados de cuenta de noviembre
- **CUANDO** el 2026-10-28 la cuota 13 de "Préstamo auto" vence el 2026-11-05 por 1850.00 BOB y los estados de cuenta de "Visa Oro BOB" (1120.50 BOB, mínimo 56.02 BOB) y "Visa Oro USD" (100.00 USD, mínimo 10.00 USD) vencen el 2026-11-15
- **ENTONCES** los próximos vencimientos son, en este orden, "Préstamo auto" 2026-11-05 1850.00 BOB, "Visa Oro" 2026-11-15 1120.50 BOB (mínimo 56.02 BOB) y "Visa Oro" 2026-11-15 100.00 USD (mínimo 10.00 USD)
- **Y** "Deuda familiar" no aparece

#### Scenario: Cuota atrasada primero
- **CUANDO** el 2026-11-07 la cuota 13 del 2026-11-05 sigue sin pagar
- **ENTONCES** "Préstamo auto" aparece primero marcado como atrasado 2 días con 1850.00 BOB pendientes

### Requirement: Permisos y aislamiento del resumen de deudas
Todo miembro activo del workspace DEBE (MUST) poder consultar el resumen de deudas; el resumen NO DEBE (MUST NOT) incluir cuentas, préstamos, tarjetas ni transacciones de otro workspace.
Trace: FR-DEBT-018, NFR-SEC-003 · Priority: Must

#### Scenario: VIEWER consulta el resumen
- **CUANDO** un VIEWER consulta el resumen de deudas
- **ENTONCES** obtiene el total adeudado de 49100.50 BOB consolidado

#### Scenario: Deudas de otro workspace
- **CUANDO** el workspace B tiene un préstamo de 9000.00 BOB y un miembro del workspace A consulta su resumen
- **ENTONCES** el total adeudado de A sigue siendo 49100.50 BOB consolidado
