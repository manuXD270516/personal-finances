# transactions/transaction-recording Specification

## Purpose
Define cómo el usuario registra, consulta, edita y anula ingresos, gastos, reembolsos y ajustes en una sola moneda por cuenta, con un ciclo de estados explícito y una traducción automática y balanceada al ledger interno, sin que el usuario vea débitos ni créditos.

## Requirements

### Requirement: Registro de un ingreso
El sistema DEBE (MUST) registrar un ingreso sobre una cuenta del usuario de modo que, al quedar posteado, aumente el saldo de esa cuenta por el monto exacto y quede reconocido como ingreso en la categoría de sus splits.
Trace: FR-TRANSACTIONS-001, FR-TRANSACTIONS-007 · Priority: Must

#### Scenario: Salario depositado en el banco
- **CUANDO** el usuario registra un ingreso posteado de 8000.00 BOB en "Bank A" (saldo 1000.00 BOB) con categoría "Salary" y fecha 2026-03-01
- **ENTONCES** el saldo de "Bank A" es 9000.00 BOB
- **Y** el ingreso del mes de marzo de 2026 en "Salary" es 8000.00 BOB
- **Y** el asiento generado cuadra en BOB (suma de postings 0.00 BOB)

### Requirement: Registro de un gasto
El sistema DEBE (MUST) registrar un gasto sobre una cuenta del usuario de modo que, al quedar posteado, disminuya el saldo presentado de la cuenta por el monto exacto y quede reconocido como gasto en la categoría de sus splits.
Trace: FR-TRANSACTIONS-001, FR-TRANSACTIONS-007 · Priority: Must

#### Scenario: Gasto de supermercado desde el banco
- **CUANDO** el usuario registra un gasto posteado de 150.00 BOB en "Bank A" (saldo 1000.00 BOB) con categoría "Groceries" y fecha 2026-03-10
- **ENTONCES** el saldo de "Bank A" es 850.00 BOB
- **Y** el gasto de marzo de 2026 en "Groceries" es 150.00 BOB

#### Scenario: Gasto con tarjeta de crédito aumenta la deuda
- **CUANDO** el usuario registra un gasto posteado de 350.00 BOB en "Credit Card" (deuda 0.00 BOB) con categoría "Household"
- **ENTONCES** la deuda presentada de "Credit Card" es 350.00 BOB
- **Y** el gasto en "Household" aumenta en 350.00 BOB

### Requirement: Datos de la transacción
El sistema DEBE (MUST) aceptar, persistir y devolver para cada transacción: fecha de negocio, fecha de posteo bancaria opcional, descripción, contraparte opcional, monto con moneda, cuenta, splits con categoría, tags y valores de custom fields de transacción, notas, estado, origen (`manual`, `import`, `recurring`, `system`) y referencia externa opcional (origen + identificador).
Trace: FR-TRANSACTIONS-002, FR-TRANSACTIONS-003, FR-TRANSACTIONS-026 · Priority: Must

#### Scenario: Ida y vuelta de todos los campos
- **CUANDO** el usuario registra un gasto de 45.90 BOB en "Bank A" con fecha de negocio 2026-03-10, fecha de posteo 2026-03-11, descripción "Compra semanal", contraparte "Supermercado Demo", notas "con factura", un split "Groceries" con tag "familia" y referencia externa ("bank-csv", "TX-998")
- **ENTONCES** al consultarla se devuelven exactamente esos valores, el monto 45.90 BOB y el origen `manual`

#### Scenario: Ida y vuelta con custom fields
- **CUANDO** existen los custom fields de transacción "centro_costo" (`SELECT`) y "factura" (`TEXT`) y el usuario registra un gasto de 45.90 BOB con un split "Groceries" con "centro_costo" = "casa" y "factura" = "F-001234"
- **ENTONCES** al consultarlo el split devuelve exactamente "centro_costo" = "casa" y "factura" = "F-001234"

### Requirement: Medio de pago de la transacción
Toda transacción DEBE (MUST) admitir un medio de pago opcional entre `CASH`, `QR`, `DEBIT_CARD`, `CREDIT_CARD`, `BANK_TRANSFER`, `DIGITAL_WALLET` y `OTHER`, que se persiste, se devuelve, permite filtrar y NO DEBE (MUST NOT) alterar los asientos del ledger ni los saldos.
Trace: FR-TRANSACTIONS-034 · Priority: Must

#### Scenario: Mismo gasto con distinto medio de pago
- **CUANDO** el usuario registra dos gastos de 45.90 BOB en "Bank A" en "Groceries", uno con medio de pago `QR` y otro con `DEBIT_CARD`
- **ENTONCES** ambos debitan 45.90 BOB de "Bank A" con asientos idénticos salvo la referencia a su transacción
- **Y** filtrar por medio de pago `QR` devuelve solo el primero

#### Scenario: Medio de pago ausente
- **CUANDO** el usuario registra un gasto de 20.00 BOB en "Cash" sin indicar medio de pago
- **ENTONCES** la transacción se registra con medio de pago vacío y el saldo de "Cash" baja 20.00 BOB

### Requirement: Pagos y cobros con QR
Una compra pagada con QR DEBE (MUST) registrarse como gasto que debita la cuenta de origen del pago QR, y un cobro recibido por QR DEBE (MUST) registrarse como ingreso en la cuenta que recibe el dinero; en ambos casos con medio de pago `QR` y contraparte opcional del comercio o pagador.
Trace: FR-TRANSACTIONS-035 · Priority: Must

#### Scenario: Compra en comercio pagada con QR
- **CUANDO** "Bank A" tiene 1000.00 BOB y el usuario paga 85.50 BOB con QR al comercio "Farmacia Demo" en "Health" el 2026-03-12
- **ENTONCES** el saldo de "Bank A" es 914.50 BOB, el gasto de marzo en "Health" aumenta 85.50 BOB y la transacción tiene medio de pago `QR` y contraparte "Farmacia Demo"

#### Scenario: Cobro recibido por QR
- **CUANDO** "Bank A" tiene 1000.00 BOB y el usuario recibe 300.00 BOB por QR de "Cliente Demo" como "Freelance" el 2026-03-14
- **ENTONCES** el saldo de "Bank A" es 1300.00 BOB, el ingreso de marzo en "Freelance" aumenta 300.00 BOB y la transacción tiene medio de pago `QR`

### Requirement: Fecha de negocio y fecha de posteo
El sistema DEBE (MUST) contabilizar cada transacción en la fecha de negocio indicada por el usuario; la fecha de posteo bancaria es informativa y NO DEBE (MUST NOT) alterar la fecha del asiento ni los saldos a una fecha.
Trace: FR-TRANSACTIONS-002, FR-LEDGER-009 · Priority: Must

#### Scenario: Gasto de fin de mes posteado por el banco al mes siguiente
- **CUANDO** el usuario registra un gasto posteado de 200.00 BOB en "Bank A" (saldo 1000.00 BOB) con fecha de negocio 2026-03-31 y fecha de posteo 2026-04-02
- **ENTONCES** el saldo de "Bank A" al 2026-03-31 es 800.00 BOB
- **Y** el gasto cuenta en marzo de 2026 y no en abril de 2026

### Requirement: Moneda de la transacción igual a la moneda de la cuenta
El sistema DEBE (MUST) rechazar con `CURRENCY_MISMATCH` un ingreso, gasto, reembolso o ajuste cuya moneda difiera de la moneda de la cuenta; los movimientos entre monedas DEBEN (MUST) registrarse como conversión.
Trace: FR-TRANSACTIONS-004 · Priority: Must

#### Scenario: Gasto en bolivianos sobre una cuenta en dólares
- **CUANDO** el usuario registra un gasto de 50.00 BOB en "USD Savings" (USD, saldo 500.00 USD)
- **ENTONCES** se rechaza con el código `CURRENCY_MISMATCH`
- **Y** el saldo de "USD Savings" sigue en 500.00 USD y no se persiste ninguna transacción

### Requirement: Escala del monto según la moneda
El sistema DEBE (MUST) recibir los montos como decimal en texto y rechazar con `AMOUNT_SCALE_EXCEEDED` cualquier monto con más decimales que la escala de su moneda, sin redondearlo en silencio.
Trace: FR-TRANSACTIONS-005, NFR-DATA-001 · Priority: Must

#### Scenario: Tres decimales en bolivianos
- **CUANDO** el usuario registra un gasto de 10.555 BOB en "Bank A"
- **ENTONCES** se rechaza con el código `AMOUNT_SCALE_EXCEEDED` señalando el campo del monto

#### Scenario: Seis decimales en USDT son válidos
- **CUANDO** el usuario registra un gasto de 1.234567 USDT en "USDT Wallet" (saldo 100.000000 USDT)
- **ENTONCES** se registra y el saldo de "USDT Wallet" es 98.765433 USDT

### Requirement: Monto positivo obligatorio
El sistema DEBE (MUST) exigir un monto estrictamente positivo en ingresos, gastos, reembolsos y ajustes (la dirección la da el tipo) y rechazar montos cero o negativos con `AMOUNT_NOT_POSITIVE`.
Trace: FR-TRANSACTIONS-005, INV-005 · Priority: Must

#### Scenario: Gasto en cero
- **CUANDO** el usuario registra un gasto de 0.00 BOB en "Bank A"
- **ENTONCES** se rechaza con el código `AMOUNT_NOT_POSITIVE` y no se persiste nada

### Requirement: Estados y transiciones válidas
El sistema DEBE (MUST) manejar los estados `pending`, `posted`, `cleared`, `reconciled` y `void` permitiendo solo pending→posted, posted→cleared, cleared→posted, cleared→reconciled, reconciled→cleared (des-reconciliación explícita) y pending/posted/cleared→void; toda otra transición DEBE (MUST) rechazarse con `INVALID_STATUS_TRANSITION`.
Trace: FR-TRANSACTIONS-006 · Priority: Must

#### Scenario: Una transacción posteada no vuelve a pendiente
- **CUANDO** el usuario intenta pasar a `pending` un gasto posteado de 60.00 BOB
- **ENTONCES** se rechaza con el código `INVALID_STATUS_TRANSITION` y el estado sigue `posted`

#### Scenario: Una transacción anulada es terminal
- **CUANDO** el usuario intenta postear un gasto anulado de 60.00 BOB
- **ENTONCES** se rechaza con el código `INVALID_STATUS_TRANSITION`

### Requirement: Transacción pendiente sin asiento
Una transacción `pending` NO DEBE (MUST NOT) tener asiento en el ledger ni alterar el saldo contable; al pasar a `posted` el sistema DEBE (MUST) crear exactamente un asiento con su fecha de negocio.
Trace: FR-TRANSACTIONS-006, FR-TRANSACTIONS-007, FR-LEDGER-006, INV-023 · Priority: Must

#### Scenario: Gasto pendiente luego posteado
- **CUANDO** el usuario registra un gasto pendiente de 80.00 BOB en "Bank A" (saldo contable 1000.00 BOB)
- **ENTONCES** no existe asiento para el gasto y el saldo contable sigue en 1000.00 BOB
- **Y** al postearlo existe exactamente un asiento activo y el saldo contable es 920.00 BOB

### Requirement: Posteo atómico con asiento, auditoría y evento
Al quedar posteada una transacción, el sistema DEBE (MUST) persistir en una única transacción de base de datos la transacción, su asiento balanceado, el registro de auditoría y los eventos `transactions.TransactionCreated.v1` (si es nueva) y `transactions.TransactionPosted.v1`; si cualquiera falla, nada DEBE (MUST) persistir.
Trace: FR-TRANSACTIONS-007, FR-AUDIT-001, INV-004, INV-029 · Priority: Must

#### Scenario: Todo o nada al registrar un gasto
- **CUANDO** el usuario registra un gasto posteado de 75.00 BOB en "Bank A" (saldo 1000.00 BOB)
- **ENTONCES** existen juntos la transacción, un asiento con postings que suman 0.00 BOB, un registro de auditoría y los eventos de transacción creada y posteada
- **Y** si la escritura del asiento falla, no existe ninguno de ellos y el saldo sigue en 1000.00 BOB

### Requirement: Edición financiera de una transacción posteada
Editar monto, fecha, cuenta o montos de splits de una transacción posteada o cleared DEBE (MUST) generar un asiento de reversa del asiento activo más un asiento nuevo, incrementar la revisión y la versión, auditar el diff antes/después y dejar la transacción en `posted`; el asiento original NO DEBE (MUST NOT) modificarse.
Trace: FR-TRANSACTIONS-008, FR-LEDGER-005, INV-007, INV-008, INV-023 · Priority: Must

#### Scenario: Corregir el monto de un gasto
- **CUANDO** el usuario cambia de 120.00 BOB a 102.00 BOB un gasto posteado en "Bank A" (saldo 1000.00 BOB antes del gasto)
- **ENTONCES** existen el asiento original sin cambios, su reversa y un asiento nuevo de 102.00 BOB
- **Y** el saldo de "Bank A" es 898.00 BOB y la versión de la transacción aumenta en 1

#### Scenario: Editar el monto de una transacción cleared la devuelve a posted
- **CUANDO** el usuario cambia de 60.00 BOB a 65.00 BOB un gasto en estado `cleared`
- **ENTONCES** la transacción queda en `posted` con un asiento activo de 65.00 BOB

### Requirement: Edición de datos descriptivos sin impacto en el ledger
Editar solo descripción, notas, contraparte o tags de una transacción DEBE (MUST) actualizarla y auditar el diff sin crear, modificar ni revertir asientos.
Trace: FR-TRANSACTIONS-008, INV-033 · Priority: Must

#### Scenario: Cambiar la contraparte de un gasto
- **CUANDO** el usuario cambia la contraparte y la descripción de un gasto posteado de 150.00 BOB
- **ENTONCES** el número de asientos y el saldo de la cuenta no cambian
- **Y** el historial registra los valores anterior y nuevo

### Requirement: Bloqueo optimista en la edición
Toda edición, cambio de estado o anulación DEBE (MUST) indicar la versión esperada de la transacción; si falta DEBE (MUST) rechazarse con `PRECONDITION_REQUIRED` y si no coincide con la vigente DEBE (MUST) rechazarse con `PRECONDITION_FAILED` sin aplicar cambios.
Trace: FR-TRANSACTIONS-011, NFR-DATA-014 · Priority: Must

#### Scenario: Dos ediciones con la misma versión
- **CUANDO** dos ediciones de un gasto de 120.00 BOB en versión 1 se envían, la primera cambia el monto a 102.00 BOB y la segunda a 110.00 BOB, ambas con versión esperada 1
- **ENTONCES** la primera se aplica y la segunda se rechaza con `PRECONDITION_FAILED`
- **Y** el monto vigente es 102.00 BOB

### Requirement: Anulación de transacciones
Anular una transacción `pending`, `posted` o `cleared` DEBE (MUST) dejarla en `void` con motivo y consultable; si tenía asiento activo, el sistema DEBE (MUST) crear su reversa enlazada sin borrar ni modificar el original. No existe borrado físico.
Trace: FR-TRANSACTIONS-009, FR-LEDGER-005, INV-008, INV-023 · Priority: Must

#### Scenario: Anular un gasto posteado
- **CUANDO** el usuario anula con motivo "registrado por error" un gasto posteado de 60.00 BOB en "Bank A" (saldo 940.00 BOB)
- **ENTONCES** la transacción queda `void`, existe una reversa del asiento original y el saldo de "Bank A" es 1000.00 BOB
- **Y** se publica el evento de transacción anulada

#### Scenario: Anular un gasto pendiente
- **CUANDO** el usuario anula un gasto pendiente de 80.00 BOB
- **ENTONCES** la transacción queda `void` y no se crea ningún asiento

#### Scenario: Anular dos veces
- **CUANDO** el usuario anula una transacción ya anulada
- **ENTONCES** se rechaza con el código `INVALID_STATUS_TRANSITION`

### Requirement: Creación idempotente de transacciones
Toda solicitud que crea una transacción DEBE (MUST) incluir una clave de idempotencia; repetirla con la misma clave y el mismo contenido DEBE (MUST) devolver el resultado original sin efectos duplicados, y con contenido distinto DEBE (MUST) rechazarse con `IDEMPOTENCY_KEY_REUSED`.
Trace: FR-TRANSACTIONS-010, NFR-REL-007, INV-027 · Priority: Must

#### Scenario: Reintento de red al registrar un gasto
- **CUANDO** el cliente envía dos veces la creación de un gasto de 75.00 BOB en "Bank A" con la misma clave de idempotencia
- **ENTONCES** ambas respuestas contienen el mismo identificador de transacción
- **Y** existe una sola transacción y el saldo de "Bank A" baja una sola vez a 925.00 BOB

### Requirement: Reembolsos
Un reembolso DEBE (MUST) aumentar el saldo de la cuenta y reducir el gasto de la categoría indicada (la del gasto original), sin contarse como ingreso, y PUEDE vincularse a la transacción original.
Trace: FR-TRANSACTIONS-016, FR-TRANSACTIONS-001 · Priority: Must

#### Scenario: Devolución parcial de una compra
- **CUANDO** existe un gasto de 200.00 BOB en "Groceries" del 2026-03-05 en "Bank A" (saldo 800.00 BOB) y el usuario registra un reembolso vinculado de 50.00 BOB en "Groceries" el 2026-03-12
- **ENTONCES** el gasto neto de "Groceries" en marzo de 2026 es 150.00 BOB
- **Y** los ingresos de marzo no cambian y el saldo de "Bank A" es 850.00 BOB

### Requirement: Reembolso que excede el original
Si el total reembolsado vinculado a un gasto superaría su monto, el sistema DEBE (MUST) rechazarlo con `REFUND_EXCEEDS_ORIGINAL` salvo confirmación explícita del usuario en la misma solicitud.
Trace: FR-TRANSACTIONS-016 · Priority: Must

#### Scenario: Segundo reembolso que supera la compra
- **CUANDO** un gasto de 200.00 BOB ya tiene un reembolso vinculado de 150.00 BOB y el usuario registra otro reembolso vinculado de 60.00 BOB sin confirmar
- **ENTONCES** se rechaza con el código `REFUND_EXCEEDS_ORIGINAL`
- **Y** con confirmación explícita el reembolso se registra y el gasto neto de la categoría queda en -10.00 BOB

### Requirement: Ajustes de saldo
Un ajuste DEBE (MUST) exigir un motivo y una dirección (aumento o disminución del saldo presentado), contabilizarse contra la cuenta de ajustes de patrimonio de la moneda sin afectar ingresos ni gastos, y quedar identificado como ajuste en consultas y reportes.
Trace: FR-TRANSACTIONS-017, FR-ACCOUNTS-006 · Priority: Must

#### Scenario: Ajuste por diferencia con el extracto
- **CUANDO** el usuario registra en "Bank A" (saldo 1250.00 BOB) un ajuste de disminución de 15.44 BOB con motivo "diferencia con extracto de marzo"
- **ENTONCES** el saldo de "Bank A" es 1234.56 BOB
- **Y** ingresos y gastos del mes no cambian y el asiento cuadra en BOB contra ajustes de patrimonio

#### Scenario: Ajuste sin motivo
- **CUANDO** el usuario registra un ajuste de 15.44 BOB sin motivo
- **ENTONCES** se rechaza con el código `VALIDATION_FAILED`

### Requirement: Cuentas no activas no admiten movimientos
El sistema DEBE (MUST) rechazar registrar, postear, editar financieramente o anular una transacción que genere asientos sobre una cuenta archivada (`ACCOUNT_ARCHIVED`) o cerrada (`ACCOUNT_CLOSED`), incluidas las reversas; la cuenta debe reactivarse primero.
Trace: FR-ACCOUNTS-007, INV-026 · Priority: Must

#### Scenario: Gasto en una cuenta archivada
- **CUANDO** el usuario registra un gasto de 20.00 BOB en "Bank B" archivada (saldo 0.00 BOB)
- **ENTONCES** se rechaza con el código `ACCOUNT_ARCHIVED` y el saldo sigue en 0.00 BOB

#### Scenario: Anular un gasto de una cuenta archivada después
- **CUANDO** el usuario anula un gasto posteado de 30.00 BOB cuya cuenta fue archivada después de registrarlo
- **ENTONCES** se rechaza con el código `ACCOUNT_ARCHIVED` y la transacción sigue `posted`

### Requirement: Listado y filtrado de transacciones
El sistema DEBE (MUST) listar las transacciones del workspace con filtros combinables por rango de fechas, cuentas, tipo, estado, categoría (incluidas subcategorías), tag, contraparte, rango de monto, moneda, origen y valor de custom field (igualdad, y rango para números, decimales y fechas), con orden configurable y paginación por cursor estable.
Trace: FR-TRANSACTIONS-012, FR-CLASSIFICATION-009, NFR-PERF-001 · Priority: Must

#### Scenario: Gastos de marzo en una cuenta y categoría
- **CUANDO** el usuario filtra por cuenta "Bank A", tipo gasto, categoría "Groceries" y fechas del 2026-03-01 al 2026-03-31 con límite 2 y existen 3 gastos que cumplen (45.90 BOB, 150.00 BOB y 200.00 BOB)
- **ENTONCES** la primera página trae 2 transacciones ordenadas por fecha descendente y un cursor
- **Y** la segunda página trae la restante sin repetir ni omitir ninguna

#### Scenario: Filtrar por centro de costo
- **CUANDO** en marzo de 2026 hay gastos de 45.90 BOB y 150.00 BOB con "centro_costo" = "oficina" y uno de 200.00 BOB con "casa", y el usuario filtra por "centro_costo" = "oficina"
- **ENTONCES** obtiene solo los gastos de 45.90 BOB y 150.00 BOB

### Requirement: Búsqueda de texto en transacciones
El sistema DEBERÍA ofrecer búsqueda de texto libre en descripción, notas y nombre de contraparte, insensible a acentos y mayúsculas; cuando se ofrece, DEBE (MUST) respetar el resto de filtros.
Trace: FR-TRANSACTIONS-013, NFR-PERF-002 · Priority: Should

#### Scenario: Búsqueda sin acentos
- **CUANDO** existe un gasto de 30.00 BOB con descripción "Farmacia Pública" y el usuario busca "farmacia publica"
- **ENTONCES** el gasto aparece en los resultados

### Requirement: Historial de cambios de la transacción
El detalle de una transacción DEBE (MUST) permitir consultar su historial de cambios con actor, fecha, acción y diff antes/después, incluidas creación, ediciones, cambios de estado y anulación, a todo miembro que pueda ver la transacción, incluido VIEWER.
Trace: FR-TRANSACTIONS-014, FR-AUDIT-004 · Priority: Must

#### Scenario: Historial tras editar y anular
- **CUANDO** el usuario registra un gasto de 120.00 BOB, cambia su monto a 102.00 BOB y luego lo anula
- **ENTONCES** el historial muestra tres entradas en orden: creación, edición (120.00 BOB → 102.00 BOB) y anulación con su motivo

#### Scenario: VIEWER consulta el historial de una transacción
- **CUANDO** un usuario VIEWER de "W1" abre el detalle de un gasto de 120.00 BOB que un EDITOR editó a 102.00 BOB
- **ENTONCES** ve el historial con actor, fecha y cambio de 120.00 BOB a 102.00 BOB
- **Y** el historial no incluye registros de otras entidades ni de otros workspaces

### Requirement: Duplicar una transacción como nueva
El sistema PUEDE ofrecer duplicar una transacción existente como una nueva; cuando lo hace, DEBE (MUST) copiar cuenta, monto, splits, contraparte y descripción, usar por defecto la fecha de hoy del workspace y dejar elegir `pending` o `posted`, sin vínculo contable con la original.
Trace: FR-TRANSACTIONS-015 · Priority: Could

#### Scenario: Duplicar el pago del alquiler
- **CUANDO** el usuario duplica un gasto de 2500.00 BOB en "Rent" del 2026-02-01 el día 2026-03-01 eligiendo `pending`
- **ENTONCES** existe un gasto nuevo pendiente de 2500.00 BOB en "Rent" con fecha 2026-03-01 y el original no cambia
