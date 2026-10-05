# Spec Delta

## Purpose

Responde "¿cuánto valgo hoy?" como activos menos pasivos de las cuentas incluidas en el patrimonio, valorados en la moneda de reporte con la tasa vigente a la fecha de valoración y con desglose por moneda y tipo de cuenta. En Phase 1 solo existe el patrimonio neto actual; la evolución histórica llega en fases posteriores.

## ADDED Requirements

### Requirement: Patrimonio neto actual en la moneda de reporte
El sistema DEBE (MUST) calcular el patrimonio neto actual como la suma de los saldos de las cuentas de activo menos la deuda de las cuentas de pasivo incluidas en el patrimonio, valorando cada moneda con la tasa vigente a la fecha de valoración (para USD y USDT, la tasa `PARALLEL` del provider de mercado con su fallback a la última tasa conocida o manual) e informando cada tasa usada con su fuente con atribución, su vigencia y su antigüedad.
Trace: FR-REPORTING-005, FR-FX-006, FR-FX-010, FR-FX-014 · Priority: Must

#### Scenario: Activos en BOB y USDT con tarjeta de crédito
- **CUANDO** "Banco BOB" tiene 685.00 BOB, "Caja BOB" 120.50 BOB, "Wallet USDT" 50.000000 USDT, la tarjeta "Visa" debe 400.00 BOB y la tasa `PARALLEL` USDT/BOB vigente es 12.02 de paralelo.bo
- **ENTONCES** los activos son 1406.50 BOB, los pasivos 400.00 BOB y el patrimonio neto 1006.50 BOB
- **Y** se informa la tasa USDT/BOB 12.02 usada con "Fuente: paralelo.bo", su vigencia y su antigüedad

### Requirement: Desglose del patrimonio por moneda y tipo de cuenta
El patrimonio neto DEBE (MUST) desglosarse por moneda original (activos, pasivos y neto en esa moneda, más su equivalente en la moneda de reporte) y por tipo de cuenta en la moneda de reporte.
Trace: FR-REPORTING-005 · Priority: Must

#### Scenario: Desglose del ejemplo
- **CUANDO** se consulta el patrimonio del ejemplo con 685.00 BOB en banco, 120.50 BOB en efectivo, 50.000000 USDT en wallet y 400.00 BOB adeudados en tarjeta
- **ENTONCES** por moneda se informa BOB: activos 805.50, pasivos 400.00, neto 405.50 BOB; USDT: 50.000000 USDT equivalentes a 601.00 BOB
- **Y** por tipo: banco 685.00 BOB, efectivo 120.50 BOB, wallet cripto 601.00 BOB, tarjeta de crédito −400.00 BOB

### Requirement: Cuentas excluidas del patrimonio
Las cuentas marcadas como no incluidas en el patrimonio NO DEBEN (MUST NOT) sumar en activos, pasivos ni patrimonio neto, aunque sigan apareciendo en la lista de saldos por cuenta.
Trace: FR-REPORTING-005, FR-ACCOUNTS-011 · Priority: Must

#### Scenario: Caja de terceros excluida
- **CUANDO** además existe la cuenta "Caja oficina" con 1000.00 BOB marcada como no incluida en el patrimonio
- **ENTONCES** el patrimonio neto sigue siendo 1006.50 BOB
- **Y** "Caja oficina" aparece con 1000.00 BOB en los saldos por cuenta

### Requirement: Patrimonio incompleto por falta de tasa
Si una moneda con saldo no tiene tasa vigente hacia la moneda de reporte, el patrimonio neto DEBE (MUST) excluir esos saldos del total, mostrarlos en su moneda original y marcarse como incompleto con una advertencia; NO DEBE (MUST NOT) usar 1:1 ni una tasa fuera de la ventana de vigencia.
Trace: FR-REPORTING-005, FR-FX-004 · Priority: Must

#### Scenario: Wallet BTC sin tasa
- **CUANDO** además existe "Wallet BTC" con 0.01000000 BTC y no hay tasa BTC/BOB vigente
- **ENTONCES** el patrimonio neto informado es 1006.50 BOB marcado como incompleto
- **Y** se lista 0.01000000 BTC como no valorado con la advertencia correspondiente

### Requirement: Transferencias y pagos de tarjeta no cambian el patrimonio
Una transferencia entre cuentas propias incluidas en el patrimonio, incluido el pago de una tarjeta de crédito, NO DEBE (MUST NOT) cambiar el patrimonio neto salvo por el fee explícito; una conversión lo cambia exactamente en sus fees y spread valorados a la tasa usada para valorar.
Trace: FR-REPORTING-005, FR-TRANSACTIONS-018 · Priority: Must

#### Scenario: Pago de tarjeta
- **CUANDO** el usuario paga 400.00 BOB de la "Visa" desde "Banco BOB" sin fee
- **ENTONCES** el patrimonio neto sigue siendo 1006.50 BOB

#### Scenario: Conversión canónica valorada a la referencia
- **CUANDO** el patrimonio se valora con USDT/BOB 6.95 y el usuario convierte 100.000000 USDT en 685.00 BOB con fee de 5.00 BOB a cotizada 6.90
- **ENTONCES** el patrimonio neto baja exactamente 10.00 BOB (5.00 BOB de fee + 5.00 BOB de spread)
