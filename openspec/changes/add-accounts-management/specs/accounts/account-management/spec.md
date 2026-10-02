# Spec Delta

## Purpose

Permite al usuario registrar y administrar sus cuentas (bancos, efectivo, billeteras, tarjetas, préstamos, cripto, inversiones y activos/pasivos manuales), cada una en una sola moneda, con saldo siempre derivado del ledger interno, saldo inicial contabilizado como asiento de apertura y un ciclo de vida (activa, cerrada, archivada) que nunca borra historia.

## ADDED Requirements

### Requirement: Tipos de cuenta y su naturaleza
El sistema DEBE (MUST) permitir crear cuentas de los tipos `bank`, `cash`, `digital_wallet`, `credit_card`, `loan`, `crypto_wallet`, `investment`, `savings`, `virtual`, `manual_asset` y `manual_liability`, y DEBE (MUST) derivar su naturaleza del tipo: pasivo para `credit_card`, `loan` y `manual_liability`; activo para todos los demás.
Trace: FR-ACCOUNTS-001, FR-ACCOUNTS-003 · Priority: Must

#### Scenario: Cuenta bancaria es un activo
- **CUANDO** un usuario EDITOR crea la cuenta "Bank C" de tipo `bank` en BOB
- **ENTONCES** la cuenta queda activa con naturaleza activo y saldo 0.00 BOB

#### Scenario: Préstamo es un pasivo
- **CUANDO** un usuario EDITOR crea la cuenta "Préstamo vehicular" de tipo `loan` en BOB
- **ENTONCES** la cuenta queda activa con naturaleza pasivo

#### Scenario: Tipo desconocido
- **CUANDO** un usuario intenta crear una cuenta de tipo `checking`
- **ENTONCES** se rechaza con `VALIDATION_FAILED` y no se crea ninguna cuenta

### Requirement: Tipo de cuenta inmutable
El tipo de una cuenta, y por ende su naturaleza, NO DEBE (MUST NOT) poder cambiarse después de crearla; para usar otro tipo el usuario archiva la cuenta y crea una nueva.
Trace: FR-ACCOUNTS-003 · Priority: Must

#### Scenario: Intento de convertir un banco en tarjeta
- **CUANDO** un usuario intenta cambiar el tipo de "Bank A" (`bank`, saldo 1000.00 BOB) a `credit_card`
- **ENTONCES** se rechaza con `VALIDATION_FAILED`
- **Y** "Bank A" sigue siendo de tipo `bank`, naturaleza activo y saldo 1000.00 BOB

### Requirement: Tarjeta de crédito como cuenta de pasivo
Una cuenta `credit_card` DEBE (MUST) comportarse como pasivo: una compra aumenta la deuda y reduce el patrimonio neto, el pago desde una cuenta propia es una transferencia que reduce la deuda sin cambiar el patrimonio neto, y su saldo DEBE (MUST) presentarse como monto adeudado positivo.
Trace: FR-ACCOUNTS-003, FR-ACCOUNTS-002 · Priority: Must

#### Scenario: Compra y pago con tarjeta
- **CUANDO** "Bank A" tiene 1000.00 BOB, "Credit Card" adeuda 0.00 BOB, el usuario compra 350.00 BOB con "Credit Card" y luego paga 350.00 BOB desde "Bank A" a "Credit Card"
- **ENTONCES** tras la compra "Credit Card" adeuda 350.00 BOB y el patrimonio neto es 650.00 BOB
- **Y** tras el pago "Bank A" tiene 650.00 BOB, "Credit Card" adeuda 0.00 BOB y el patrimonio neto sigue en 650.00 BOB
- **Y** el gasto del mes es 350.00 BOB, contado una sola vez

### Requirement: Una sola moneda por cuenta
Toda cuenta DEBE (MUST) tener exactamente una moneda, habilitada en el workspace, y todo movimiento sobre la cuenta DEBE (MUST) estar expresado en esa moneda; un movimiento en otra moneda NO DEBE (MUST NOT) aceptarse (los cambios de moneda se registran como conversiones).
Trace: FR-ACCOUNTS-002 · Priority: Must

#### Scenario: Gasto en moneda distinta
- **CUANDO** un usuario registra un gasto de 50.00 BOB en "USD Savings" (cuenta en USD con saldo 500.00 USD)
- **ENTONCES** se rechaza con `CURRENCY_MISMATCH`
- **Y** el saldo de "USD Savings" sigue siendo 500.00 USD y no se escribe transacción, asiento ni auditoría

#### Scenario: Moneda no habilitada
- **CUANDO** un usuario crea una cuenta en EUR y EUR no está habilitada en el workspace
- **ENTONCES** se rechaza con `CURRENCY_NOT_ENABLED`

### Requirement: Moneda inmutable con movimientos
La moneda de una cuenta NO DEBE (MUST NOT) poder cambiarse una vez que la cuenta tenga algún movimiento contable; mientras no tenga ninguno, el cambio DEBE (MUST) permitirse.
Trace: FR-ACCOUNTS-005 · Priority: Must

#### Scenario: Cuenta con movimientos
- **CUANDO** "Bank C" (BOB) tiene un ingreso registrado de 200.00 BOB y el usuario intenta cambiar su moneda a USD
- **ENTONCES** se rechaza con `ACCOUNT_CURRENCY_IMMUTABLE` y la cuenta sigue en BOB con saldo 200.00 BOB

#### Scenario: Cuenta sin movimientos
- **CUANDO** "Bank D" fue creada en BOB sin saldo inicial ni movimientos y el usuario cambia su moneda a USD
- **ENTONCES** la cuenta queda en USD con saldo 0.00 USD

### Requirement: Cuenta respaldada por una cuenta contable
Toda cuenta DEBE (MUST) estar respaldada por exactamente una cuenta contable interna de su misma naturaleza y moneda, creada a más tardar en la misma transacción que su primer movimiento; NO DEBE (MUST NOT) existir más de una cuenta contable para la misma cuenta.
Trace: FR-ACCOUNTS-003 · Priority: Must

#### Scenario: Primer movimiento de una cuenta bancaria
- **CUANDO** el usuario crea "Bank C" (`bank`, BOB) y registra un ingreso de 200.00 BOB
- **ENTONCES** "Bank C" está respaldada por exactamente una cuenta contable de activo en BOB
- **Y** su saldo es 200.00 BOB

#### Scenario: Tarjeta respaldada por un pasivo
- **CUANDO** el usuario crea "Card Y" (`credit_card`, BOB) con saldo inicial adeudado 100.00 BOB
- **ENTONCES** "Card Y" está respaldada por exactamente una cuenta contable de pasivo en BOB

### Requirement: Saldo inicial registrado como asiento de apertura
Un saldo inicial distinto de cero DEBE (MUST) registrarse como un asiento de apertura balanceado contra el patrimonio de apertura de la misma moneda, con fecha igual a la fecha del saldo inicial; un saldo inicial cero NO DEBE (MUST NOT) generar asiento.
Trace: FR-ACCOUNTS-004 · Priority: Must

#### Scenario: Apertura de un activo
- **CUANDO** el usuario crea "Banco BOB" (`bank`, BOB) con saldo inicial 10000.00 BOB al 2026-01-01
- **ENTONCES** existe un asiento de apertura fechado 2026-01-01 con +10000.00 BOB en "Banco BOB" y −10000.00 BOB en el patrimonio de apertura BOB
- **Y** el saldo de "Banco BOB" es 10000.00 BOB

#### Scenario: Apertura de un pasivo
- **CUANDO** además el usuario crea "Visa BOB" (`credit_card`, BOB) con saldo inicial adeudado 2000.00 BOB al 2026-01-01
- **ENTONCES** existe un asiento de apertura con −2000.00 BOB en "Visa BOB" y +2000.00 BOB en el patrimonio de apertura BOB
- **Y** "Visa BOB" adeuda 2000.00 BOB y el patrimonio neto es 8000.00 BOB

#### Scenario: Apertura en cripto
- **CUANDO** el usuario crea "USDT Wallet" (`crypto_wallet`, USDT) con saldo inicial 100.000000 USDT
- **ENTONCES** el asiento de apertura suma 0.000000 USDT y el saldo de "USDT Wallet" es 100.000000 USDT

#### Scenario: Saldo inicial cero
- **CUANDO** el usuario crea "Bank B" (`savings`, BOB) con saldo inicial 0.00 BOB
- **ENTONCES** no se genera ningún asiento y el saldo es 0.00 BOB

### Requirement: Apertura de cuenta atómica
La creación de una cuenta con saldo inicial DEBE (MUST) ser atómica: si el saldo inicial no puede contabilizarse, NO DEBE (MUST NOT) quedar creada la cuenta, ni su asiento, ni su auditoría, ni sus eventos.
Trace: FR-ACCOUNTS-004, FR-AUDIT-001 · Priority: Must

#### Scenario: Saldo inicial con escala inválida
- **CUANDO** el usuario crea "Bank E" (`bank`, BOB) con saldo inicial 10.005 BOB
- **ENTONCES** se rechaza con `AMOUNT_SCALE_EXCEEDED`
- **Y** no existe la cuenta "Bank E", ni asiento de apertura, ni registro de auditoría, ni evento publicado

### Requirement: Apertura de cuenta idempotente
Reintentar la creación de una cuenta con la misma clave de idempotencia y el mismo contenido DEBE (MUST) devolver la misma cuenta sin crear una segunda cuenta ni un segundo asiento de apertura; reutilizar la clave con contenido distinto DEBE (MUST) rechazarse.
Trace: NFR-REL-007, FR-ACCOUNTS-004 · Priority: Must

#### Scenario: Reintento tras un corte de red
- **CUANDO** el usuario envía dos veces la creación de "Bank F" (`bank`, BOB) con saldo inicial 500.00 BOB y la misma clave de idempotencia
- **ENTONCES** existe una sola cuenta "Bank F" con saldo 500.00 BOB y un solo asiento de apertura
- **Y** la segunda respuesta indica que es una repetición

#### Scenario: Clave reutilizada con otro contenido
- **CUANDO** el usuario reutiliza esa clave para crear "Bank F" con saldo inicial 600.00 BOB
- **ENTONCES** se rechaza con `IDEMPOTENCY_KEY_REUSED`

### Requirement: Saldo derivado del ledger
El saldo mostrado de una cuenta DEBE (MUST) ser siempre la suma de sus movimientos contables; el sistema NO DEBE (MUST NOT) permitir editar el saldo directamente (las correcciones se hacen con una transacción de ajuste).
Trace: FR-ACCOUNTS-006 · Priority: Must

#### Scenario: Saldo tras movimientos
- **CUANDO** "Bank A" se abrió con 1000.00 BOB y luego se registró un gasto de 75.00 BOB
- **ENTONCES** el saldo mostrado de "Bank A" es 925.00 BOB

#### Scenario: Intento de editar el saldo
- **CUANDO** un usuario intenta fijar el saldo de "Bank A" en 2000.00 BOB editando la cuenta
- **ENTONCES** se rechaza con `VALIDATION_FAILED` y el saldo sigue siendo 925.00 BOB

### Requirement: Nombre único entre cuentas activas
El nombre de una cuenta DEBE (MUST) ser único, sin distinguir mayúsculas, entre las cuentas no archivadas del workspace; una cuenta archivada NO DEBE (MUST NOT) bloquear el nombre.
Trace: FR-ACCOUNTS-002 · Priority: Must

#### Scenario: Nombre repetido
- **CUANDO** existe la cuenta activa "Bank A" y el usuario crea otra cuenta llamada "bank a"
- **ENTONCES** se rechaza con `ACCOUNT_NAME_TAKEN`

#### Scenario: Nombre de una cuenta archivada
- **CUANDO** la cuenta "Old Bank" está archivada y el usuario crea una cuenta nueva "Old Bank"
- **ENTONCES** la nueva cuenta se crea

### Requirement: Identificador de cuenta enmascarado
El identificador opcional de una cuenta (número de cuenta, tarjeta o dirección) DEBE (MUST) conservarse y mostrarse solo como sus últimos 4 caracteres; el sistema NO DEBE (MUST NOT) almacenar el identificador completo.
Trace: FR-ACCOUNTS-002 · Priority: Must

#### Scenario: Identificador ingresado completo
- **CUANDO** el usuario ingresa el identificador "DEMO-000123456789" para "Bank A"
- **ENTONCES** la cuenta muestra el identificador como "•••• 6789"
- **Y** el identificador completo no queda almacenado en ningún registro, auditoría ni evento

### Requirement: Institución opcional de la cuenta
Una cuenta PUEDE asociarse a una institución del mismo workspace y DEBE (MUST) rechazarse la asociación a una institución inexistente o de otro workspace.
Trace: FR-ACCOUNTS-002 · Priority: Must

#### Scenario: Cuenta asociada a una institución
- **CUANDO** el usuario crea "Bank C" asociada a la institución "Banco Andino Demo"
- **ENTONCES** "Bank C" muestra la institución "Banco Andino Demo"

#### Scenario: Institución de otro workspace
- **CUANDO** el usuario de "W1" crea una cuenta asociada a una institución de "W2"
- **ENTONCES** se rechaza con `REFERENCE_NOT_FOUND`

### Requirement: Liquidez de la cuenta
Toda cuenta DEBE (MUST) tener una liquidez `LIQUID`, `SEMI_LIQUID` o `ILLIQUID`, editable, con valor por defecto según tipo: `LIQUID` para `bank`, `cash`, `digital_wallet`, `crypto_wallet` y `savings`; `SEMI_LIQUID` para `investment`; `ILLIQUID` para los demás. Solo las cuentas `LIQUID` DEBEN (MUST) contar como dinero disponible.
Trace: FR-ACCOUNTS-011 · Priority: Must

#### Scenario: Liquidez por defecto y dinero disponible
- **CUANDO** existen "Bank A" (`bank`, 1000.00 BOB) e "Inversión" (`investment`, 5000.00 BOB) con su liquidez por defecto
- **ENTONCES** "Bank A" es `LIQUID`, "Inversión" es `SEMI_LIQUID` y el dinero disponible en BOB es 1000.00 BOB

#### Scenario: Cambio de liquidez
- **CUANDO** el usuario marca "Inversión" como `LIQUID`
- **ENTONCES** el dinero disponible en BOB es 6000.00 BOB y no se genera ningún asiento

### Requirement: Inclusión en patrimonio neto
Toda cuenta DEBE (MUST) tener un indicador de inclusión en el patrimonio neto, activado por defecto; una cuenta excluida NO DEBE (MUST NOT) sumarse al patrimonio neto, aunque conserve su saldo.
Trace: FR-ACCOUNTS-011 · Priority: Must

#### Scenario: Cuenta excluida
- **CUANDO** existen "Bank A" (1000.00 BOB, incluida) y "Préstamo a familiar" (`manual_asset`, 500.00 BOB, excluida)
- **ENTONCES** el patrimonio neto en BOB es 1000.00 BOB
- **Y** el saldo de "Préstamo a familiar" sigue siendo 500.00 BOB

### Requirement: Archivar cuenta
El usuario DEBE (MUST) poder archivar una cuenta indicando un motivo opcional; una cuenta archivada NO DEBE (MUST NOT) aparecer en los listados por defecto, pero DEBE (MUST) seguir consultable con su saldo e historial.
Trace: FR-ACCOUNTS-007 · Priority: Must

#### Scenario: Archivar una cuenta
- **CUANDO** el usuario archiva "Bank B" (saldo 0.00 BOB) con el motivo "Cuenta cerrada en el banco"
- **ENTONCES** "Bank B" no aparece en el listado por defecto
- **Y** aparece al pedir también las archivadas, con estado archivada y saldo 0.00 BOB

### Requirement: Cuenta archivada o cerrada no recibe movimientos
Una cuenta archivada o cerrada NO DEBE (MUST NOT) recibir ningún movimiento nuevo, incluidas las reversas o anulaciones de transacciones previas que la afecten; primero debe reactivarse.
Trace: FR-ACCOUNTS-007 · Priority: Must

#### Scenario: Gasto en cuenta archivada
- **CUANDO** "Old Bank" (saldo 300.00 BOB) está archivada y el usuario registra un gasto de 20.00 BOB en ella
- **ENTONCES** se rechaza con `ACCOUNT_ARCHIVED` y el saldo sigue en 300.00 BOB

#### Scenario: Anulación que afectaría una cuenta archivada
- **CUANDO** el usuario anula una transacción de 50.00 BOB registrada en "Old Bank" antes de archivarla
- **ENTONCES** se rechaza con `ACCOUNT_ARCHIVED` y no se crea ninguna reversa

#### Scenario: Movimiento en cuenta cerrada
- **CUANDO** "Bank B" está cerrada y el usuario registra un ingreso de 10.00 BOB en ella
- **ENTONCES** se rechaza con `ACCOUNT_CLOSED`

### Requirement: Reactivar cuenta
El usuario DEBE (MUST) poder reactivar una cuenta archivada o cerrada, quedando auditada la reactivación; la reactivación DEBE (MUST) rechazarse si otra cuenta activa ya usa su nombre.
Trace: FR-ACCOUNTS-007 · Priority: Must

#### Scenario: Reactivar y registrar
- **CUANDO** el usuario reactiva "Old Bank" (archivada, saldo 300.00 BOB) y luego registra un gasto de 20.00 BOB
- **ENTONCES** "Old Bank" queda activa con saldo 280.00 BOB
- **Y** existe un registro de auditoría de la reactivación

#### Scenario: Nombre ocupado
- **CUANDO** "Old Bank" está archivada, existe otra cuenta activa "Old Bank" y el usuario reactiva la archivada
- **ENTONCES** se rechaza con `ACCOUNT_NAME_TAKEN`

### Requirement: Cierre de cuenta con saldo cero
El usuario DEBE (MUST) poder cerrar una cuenta con una fecha de cierre solo si su saldo es exactamente cero en su moneda; con saldo distinto de cero, el cierre DEBE (MUST) rechazarse hasta registrar una transferencia o ajuste.
Trace: FR-ACCOUNTS-007 · Priority: Must

#### Scenario: Cierre con saldo cero
- **CUANDO** el usuario cierra "Bank B" (saldo 0.00 BOB) con fecha 2026-03-31
- **ENTONCES** "Bank B" queda cerrada con fecha de cierre 2026-03-31

#### Scenario: Cierre con saldo pendiente
- **CUANDO** el usuario intenta cerrar "USDT Wallet" con saldo 0.000001 USDT
- **ENTONCES** se rechaza con `ACCOUNT_BALANCE_NOT_ZERO` y la cuenta sigue activa

### Requirement: Las cuentas no se eliminan
El sistema NO DEBE (MUST NOT) eliminar físicamente una cuenta ni ofrecer una operación de borrado; la única forma de retirarla es archivarla o cerrarla, conservando sus movimientos y su historial.
Trace: FR-ACCOUNTS-008, NFR-DATA-012 · Priority: Must

#### Scenario: Cuenta archivada conserva su historia
- **CUANDO** "Old Bank" tuvo movimientos por 300.00 BOB y fue archivada
- **ENTONCES** sus transacciones, su saldo de 300.00 BOB y su historial de auditoría siguen consultables
- **Y** no existe operación para borrar "Old Bank"

### Requirement: Edición de metadatos sin efecto contable
Editar nombre, institución, icono, color, notas, etiquetas, identificador, liquidez o inclusión en patrimonio de una cuenta NO DEBE (MUST NOT) crear, modificar ni revertir asientos, y DEBE (MUST) quedar auditado con las diferencias antes/después.
Trace: FR-ACCOUNTS-009 · Priority: Must

#### Scenario: Renombrar y cambiar color
- **CUANDO** el usuario renombra "Bank A" (saldo 925.00 BOB) a "Banco principal" y cambia su color
- **ENTONCES** el saldo sigue siendo 925.00 BOB y no se creó ningún asiento
- **Y** existe un registro de auditoría con antes "Bank A" y después "Banco principal"

#### Scenario: Edición concurrente
- **CUANDO** dos usuarios editan "Bank A" partiendo de la misma versión y el primero guarda
- **ENTONCES** la edición del segundo se rechaza con `PRECONDITION_FAILED`

### Requirement: Listado de cuentas con saldo y equivalente en moneda base
El listado de cuentas DEBE (MUST) mostrar el saldo de cada cuenta en su moneda y su equivalente en la moneda base del workspace con la fecha y la fuente de la tasa usada; si no hay tasa disponible, DEBE (MUST) indicarlo sin inventar un equivalente.
Trace: FR-ACCOUNTS-010 · Priority: Must

#### Scenario: Equivalente con tasa registrada
- **CUANDO** "USD Savings" tiene 500.00 USD y la tasa USD→BOB más reciente es 6.96 con fecha 2026-03-14 y fuente manual
- **ENTONCES** el listado muestra 500.00 USD y su equivalente 3480.00 BOB con tasa del 2026-03-14 y fuente manual

#### Scenario: Sin tasa disponible
- **CUANDO** "BTC Wallet" tiene 0.01250000 BTC y no existe tasa BTC→BOB
- **ENTONCES** el listado muestra 0.01250000 BTC e indica que no hay equivalente en BOB disponible

### Requirement: Filtros y agrupación del listado de cuentas
El listado de cuentas DEBE (MUST) poder filtrarse por tipo, moneda, estado, institución y etiqueta, y agruparse por tipo o por institución.
Trace: FR-ACCOUNTS-010 · Priority: Must

#### Scenario: Filtro por moneda y tipo
- **CUANDO** el workspace tiene "Bank A" (`bank`, BOB), "USD Savings" (`savings`, USD) y "Credit Card" (`credit_card`, BOB) y el usuario filtra moneda BOB y tipo `bank`
- **ENTONCES** el listado contiene solo "Bank A"

#### Scenario: Agrupación por institución
- **CUANDO** el usuario agrupa por institución
- **ENTONCES** cada cuenta aparece bajo su institución y las cuentas sin institución aparecen en un grupo propio

### Requirement: Cuentas cripto con moneda cripto
Una cuenta `crypto_wallet` DEBE (MUST) usar una moneda de tipo cripto y respetar su escala (por ejemplo USDT 6, BTC 8); una moneda fiat NO DEBE (MUST NOT) aceptarse para ese tipo.
Trace: FR-ACCOUNTS-014 · Priority: Should

#### Scenario: Billetera cripto en moneda fiat
- **CUANDO** el usuario crea una cuenta `crypto_wallet` en BOB
- **ENTONCES** se rechaza con `ACCOUNT_CURRENCY_KIND_MISMATCH`

#### Scenario: Escala de USDT
- **CUANDO** el usuario crea "USDT Wallet 2" (`crypto_wallet`, USDT) con saldo inicial 1.0000001 USDT
- **ENTONCES** se rechaza con `AMOUNT_SCALE_EXCEEDED`

### Requirement: Red de una cuenta cripto
Una cuenta `crypto_wallet` PUEDE registrar como metadato opcional su red o protocolo (por ejemplo TRC20, ERC20, BEP20), y ese dato NO DEBE (MUST NOT) afectar saldos ni asientos.
Trace: FR-ACCOUNTS-014 · Priority: Should

#### Scenario: Registrar la red
- **CUANDO** el usuario indica la red TRC20 para "USDT Wallet" (saldo 100.000000 USDT)
- **ENTONCES** la cuenta muestra la red TRC20 y su saldo sigue siendo 100.000000 USDT

### Requirement: Cuentas virtuales
Una cuenta `virtual` DEBE (MUST) comportarse como un activo real: el dinero entra y sale mediante transferencias desde cuentas propias, y por defecto NO DEBE (MUST NOT) contar como dinero disponible para evitar doble conteo, aunque el usuario puede cambiar su liquidez.
Trace: FR-ACCOUNTS-015 · Priority: Should

#### Scenario: Fondear una cuenta virtual
- **CUANDO** el usuario transfiere 400.00 BOB de "Bank A" (1000.00 BOB) a la cuenta virtual "Sobre viaje"
- **ENTONCES** "Bank A" tiene 600.00 BOB, "Sobre viaje" tiene 400.00 BOB y el patrimonio neto no cambia
- **Y** el dinero disponible en BOB es 600.00 BOB

### Requirement: Orden manual de cuentas
El usuario PUEDE definir un orden manual de sus cuentas, y el listado por defecto DEBE (MUST) respetarlo.
Trace: FR-ACCOUNTS-016 · Priority: Could

#### Scenario: Reordenar
- **CUANDO** el usuario ordena "Credit Card", "Bank A", "USD Savings"
- **ENTONCES** el listado por defecto muestra las cuentas en ese orden
