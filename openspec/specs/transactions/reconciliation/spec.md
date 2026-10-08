# transactions/reconciliation Specification

## Purpose
Define el cotejo simple de transacciones contra el extracto en Phase 1: marcar transacciones como confirmadas por el banco (`cleared`), marcarlas como reconciliadas y protegerlas contra cambios accidentales; las sesiones de reconciliación con saldo de extracto llegan en Phase 2.

## Requirements

### Requirement: Marcar una transacción como cleared
El usuario DEBE (MUST) poder marcar una transacción `posted` como `cleared` y desmarcarla (volver a `posted`) sin que el sistema cree, modifique ni revierta asientos ni cambie los saldos contables; cada cambio DEBE (MUST) publicar el hecho dedicado "transacción confirmada" y DEBE (MUST) rechazarse con `PERIOD_CLOSED` si la fecha de negocio de la transacción cae en un periodo cerrado.
Trace: FR-TRANSACTIONS-029, FR-TRANSACTIONS-006, INV-015 · Priority: Must

#### Scenario: Confirmar un gasto contra el extracto
- **CUANDO** el usuario marca como `cleared` un gasto posteado de 150.00 BOB en "Bank A" (saldo 850.00 BOB)
- **ENTONCES** la transacción queda `cleared`, sigue teniendo el mismo único asiento activo y el saldo de "Bank A" sigue en 850.00 BOB
- **Y** se publica el hecho "transacción confirmada"

#### Scenario: Marcar como cleared una transacción pendiente
- **CUANDO** el usuario intenta marcar como `cleared` un gasto pendiente de 80.00 BOB
- **ENTONCES** se rechaza con el código `INVALID_STATUS_TRANSITION`

#### Scenario: Confirmar un gasto de un mes cerrado
- **CUANDO** marzo de 2026 está cerrado y el usuario intenta marcar como `cleared` un gasto posteado de 80.00 BOB del 2026-03-28
- **ENTONCES** se rechaza con `PERIOD_CLOSED` y el gasto sigue `posted`

### Requirement: Marcar transacciones como cleared en lote
El usuario DEBE (MUST) poder marcar o desmarcar como `cleared` una selección de transacciones en una sola operación atómica: si alguna no admite la transición o su versión no coincide, ninguna DEBE (MUST) cambiar; cada transacción cambiada DEBE (MUST) auditarse con un identificador de operación común.
Trace: FR-TRANSACTIONS-029, FR-AUDIT-001 · Priority: Must

#### Scenario: Lote de tres gastos posteados
- **CUANDO** el usuario marca como `cleared` en lote tres gastos posteados de 45.90, 150.00 y 200.00 BOB
- **ENTONCES** los tres quedan `cleared` y existen tres registros de auditoría con el mismo identificador de operación

#### Scenario: Lote con una transacción anulada
- **CUANDO** el lote incluye dos gastos posteados de 45.90 y 150.00 BOB y un gasto anulado de 60.00 BOB
- **ENTONCES** se rechaza con el código `INVALID_STATUS_TRANSITION` indicando la transacción anulada y ninguna de las tres cambia de estado

### Requirement: Marcar una transacción como reconciliada
Una transacción DEBE (MUST) pasar a `reconciled` solo desde `cleared` y sin cambios en el ledger, por una de dos vías explícitas: al finalizar una sesión de reconciliación de su cuenta (modo contra extracto) o por el marcado directo que indica el modo "conciliada sin extracto"; toda transacción `reconciled` DEBE (MUST) informar su modo de conciliación, y las reconciliadas antes de existir las sesiones DEBEN (MUST) informarse como conciliadas sin extracto.
Trace: FR-TRANSACTIONS-006, FR-TRANSACTIONS-030 · Priority: Must

#### Scenario: Reconciliar un gasto confirmado
- **CUANDO** un gasto `cleared` de 150.00 BOB está incluido en una sesión que se finaliza con diferencia 0.00 BOB
- **ENTONCES** la transacción queda `reconciled` en modo contra extracto y el saldo de la cuenta no cambia

#### Scenario: Reconciliar un gasto solo posteado
- **CUANDO** una sesión con diferencia 0.00 BOB se finaliza y la cuenta tiene un gasto `posted` de 150.00 BOB con fecha anterior al extracto
- **ENTONCES** ese gasto sigue `posted`

#### Scenario: Marcado directo como conciliada sin extracto
- **CUANDO** el usuario marca directamente como `reconciled` un gasto `cleared` de 150.00 BOB indicando el modo "conciliada sin extracto", sin una sesión
- **ENTONCES** la transacción queda `reconciled` en modo sin extracto, con la marca de seguimiento, y el saldo de la cuenta no cambia

#### Scenario: Reconciliada antes de las sesiones
- **CUANDO** un gasto de 60.00 BOB quedó `reconciled` por marcado directo antes de existir las sesiones de reconciliación
- **ENTONCES** se informa como conciliado sin extracto, con la marca de seguimiento, sin cambiar su estado ni su historia

### Requirement: Protección de transacciones reconciliadas
Una transacción `reconciled` NO DEBE (MUST NOT) admitir cambios de monto, fecha, cuenta, montos de splits ni anulación (`TRANSACTION_RECONCILED`); los cambios de clasificación y textos descriptivos DEBEN (MUST) seguir permitidos.
Trace: FR-TRANSACTIONS-006, FR-TRANSACTIONS-008 · Priority: Must

#### Scenario: Editar el monto de un gasto reconciliado
- **CUANDO** el usuario intenta cambiar de 150.00 BOB a 155.00 BOB un gasto `reconciled`
- **ENTONCES** se rechaza con el código `TRANSACTION_RECONCILED` y el monto sigue en 150.00 BOB

#### Scenario: Anular un gasto reconciliado
- **CUANDO** el usuario intenta anular un gasto `reconciled` de 150.00 BOB
- **ENTONCES** se rechaza con el código `TRANSACTION_RECONCILED`

#### Scenario: Recategorizar un gasto reconciliado
- **CUANDO** el usuario cambia la categoría del único split de un gasto `reconciled` de 150.00 BOB
- **ENTONCES** el cambio se aplica sin crear asientos

### Requirement: Des-reconciliación explícita y auditada
El usuario DEBE (MUST) poder devolver una transacción `reconciled` a `cleared` solo mediante una acción explícita de des-reconciliación con motivo obligatorio, que DEBE (MUST) quedar auditada; si la transacción fue reconciliada en una sesión, la sesión DEBE (MUST) conservar su resultado y registrar la des-reconciliación posterior, y la acción DEBE (MUST) rechazarse con `PERIOD_CLOSED` si la fecha de negocio cae en un periodo cerrado.
Trace: FR-TRANSACTIONS-006, FR-AUDIT-001, INV-015 · Priority: Must

#### Scenario: Des-reconciliar para corregir un monto
- **CUANDO** el usuario des-reconcilia con motivo "monto mal conciliado" un gasto `reconciled` de 150.00 BOB
- **ENTONCES** la transacción queda `cleared` y el historial registra la acción con el actor y el motivo
- **Y** a partir de ese momento puede editar su monto

#### Scenario: Des-reconciliar sin motivo
- **CUANDO** el usuario des-reconcilia un gasto `reconciled` sin indicar motivo
- **ENTONCES** se rechaza con el código `VALIDATION_FAILED` y la transacción sigue `reconciled`

#### Scenario: Des-reconciliar una transacción de una sesión completada
- **CUANDO** el gasto de 150.00 BOB fue reconciliado en la sesión de "Bank A" al 2026-03-31 y el usuario lo des-reconcilia con motivo "duplicado en extracto"
- **ENTONCES** la sesión sigue `COMPLETED` con saldo confirmado 3350.00 BOB y muestra ese gasto como des-reconciliado después de completarse
- **Y** el estado de reconciliación de "Bank A" con corte 2026-03-31 cuenta ese gasto como no reconciliado

#### Scenario: Des-reconciliar una conciliada sin extracto
- **CUANDO** el usuario des-reconcilia con motivo "falta el comprobante" el gasto de 80.00 BOB de "Caja BOB" conciliado sin extracto
- **ENTONCES** el gasto queda `cleared`, sin modo de conciliación ni marca de seguimiento, y el historial registra la acción con el actor y el motivo

#### Scenario: Des-reconciliar en un mes cerrado
- **CUANDO** marzo de 2026 está cerrado y el usuario intenta des-reconciliar un gasto `reconciled` del 2026-03-05
- **ENTONCES** se rechaza con `PERIOD_CLOSED` y el gasto sigue `reconciled`

### Requirement: Iniciar una sesión de reconciliación
Un miembro EDITOR u OWNER DEBE (MUST) poder iniciar una sesión de reconciliación para una cuenta activa indicando la fecha del extracto y su saldo en la moneda y escala de la cuenta; DEBE (MUST) existir como máximo una sesión en curso por cuenta (`RECONCILIATION_IN_PROGRESS`) y la fecha del extracto NO DEBE (MUST NOT) ser posterior a hoy en la zona horaria del workspace ni anterior o igual a la fecha del extracto de la última sesión completada de la cuenta (`RECONCILIATION_STATEMENT_DATE_INVALID`). Una cuenta archivada o cerrada NO DEBE (MUST NOT) admitir sesiones nuevas (`ACCOUNT_ARCHIVED`, `ACCOUNT_CLOSED`) y un VIEWER NO DEBE (MUST NOT) iniciarlas (`INSUFFICIENT_ROLE`).
Trace: FR-TRANSACTIONS-030, FR-IDENTITY-006 · Priority: Must

#### Scenario: Iniciar la reconciliación de marzo
- **CUANDO** hoy es 2026-04-05 en La Paz y el usuario inicia una sesión para "Bank A" (BOB) con fecha de extracto 2026-03-31 y saldo 3350.00 BOB
- **ENTONCES** la sesión queda en curso con esos datos y sin transacciones reconciliadas todavía

#### Scenario: Segunda sesión en curso para la misma cuenta
- **CUANDO** "Bank A" ya tiene una sesión en curso y el usuario intenta iniciar otra con fecha 2026-03-31
- **ENTONCES** se rechaza con `RECONCILIATION_IN_PROGRESS` y no se crea ninguna sesión

#### Scenario: Fecha de extracto no posterior a la última completada
- **CUANDO** la última sesión completada de "Bank A" tiene fecha de extracto 2026-03-31 y el usuario inicia una con fecha 2026-03-15
- **ENTONCES** se rechaza con `RECONCILIATION_STATEMENT_DATE_INVALID`

#### Scenario: Saldo del extracto con más decimales que la moneda
- **CUANDO** el usuario inicia una sesión para "Bank A" con saldo 3350.005 BOB
- **ENTONCES** se rechaza con `AMOUNT_SCALE_EXCEEDED`

#### Scenario: VIEWER intenta iniciar una sesión
- **CUANDO** un VIEWER del workspace intenta iniciar una sesión para "Bank A"
- **ENTONCES** se rechaza con `INSUFFICIENT_ROLE`

### Requirement: Saldo confirmado y diferencia de la sesión
Mientras la sesión está en curso, el sistema DEBE (MUST) informar el saldo confirmado —saldo inicial de la cuenta más el efecto en esa cuenta de todas sus transacciones `cleared` y `reconciled` con fecha de negocio menor o igual a la fecha del extracto— y la diferencia = saldo del extracto − saldo confirmado, recalculados ante cada cambio; las transacciones `pending`, `posted` y `void`, y las de fecha posterior al extracto, NO DEBEN (MUST NOT) sumar. En una cuenta de pasivo los saldos DEBEN (MUST) expresarse como deuda positiva.
Trace: FR-TRANSACTIONS-030, FR-LEDGER-012 · Priority: Must

#### Scenario: Diferencia cero en una cuenta de activo
- **CUANDO** "Bank A" tiene saldo inicial 1000.00 BOB, un gasto `cleared` de 150.00 BOB del 2026-03-05, un ingreso `cleared` de 2500.00 BOB del 2026-03-10, un gasto `posted` de 45.90 BOB del 2026-03-20 y un gasto `cleared` de 200.00 BOB del 2026-04-02, y la sesión tiene extracto al 2026-03-31 por 3350.00 BOB
- **ENTONCES** el saldo confirmado es 3350.00 BOB y la diferencia 0.00 BOB
- **Y** el saldo contable de "Bank A" sigue siendo 3104.10 BOB

#### Scenario: Diferencia negativa
- **CUANDO** en la misma situación el saldo del extracto es 3345.00 BOB
- **ENTONCES** la diferencia es −5.00 BOB

#### Scenario: Tarjeta de crédito expresada como deuda
- **CUANDO** la tarjeta "Visa" (pasivo, BOB) sin saldo inicial tiene gastos `cleared` de 400.00 BOB y 120.00 BOB con fecha anterior al extracto y la sesión tiene extracto por una deuda de 520.00 BOB
- **ENTONCES** el saldo confirmado es una deuda de 520.00 BOB y la diferencia 0.00 BOB

### Requirement: Confirmar transacciones dentro de la sesión
Dentro de una sesión en curso, el usuario DEBE (MUST) poder confirmar (`posted` → `cleared`) y desconfirmar (`cleared` → `posted`) transacciones de la cuenta de la sesión con fecha de negocio menor o igual a la fecha del extracto, con las mismas reglas que el marcado `cleared` individual (sin crear, modificar ni revertir asientos); una transacción de otra cuenta o con fecha posterior al extracto DEBE (MUST) rechazarse con `VALIDATION_FAILED` y una `pending`, `void` o `reconciled` con `INVALID_STATUS_TRANSITION`.
Trace: FR-TRANSACTIONS-029, FR-TRANSACTIONS-030, INV-033 · Priority: Must

#### Scenario: Confirmar el gasto pendiente de confirmar
- **CUANDO** en la sesión de "Bank A" al 2026-03-31 con extracto 3304.10 BOB el usuario confirma el gasto `posted` de 45.90 BOB del 2026-03-20
- **ENTONCES** el gasto queda `cleared`, el saldo confirmado pasa de 3350.00 BOB a 3304.10 BOB y la diferencia a 0.00 BOB
- **Y** el número de asientos y el saldo contable de "Bank A" no cambian

#### Scenario: Confirmar una transacción posterior al extracto
- **CUANDO** el usuario intenta confirmar dentro de la sesión al 2026-03-31 un gasto `posted` del 2026-04-03
- **ENTONCES** se rechaza con `VALIDATION_FAILED` y el gasto sigue `posted`

### Requirement: Finalizar una sesión con diferencia cero
Con diferencia 0, finalizar la sesión DEBE (MUST) pasar a `reconciled` en modo contra extracto todas las transacciones `cleared` de la cuenta con fecha de negocio menor o igual a la fecha del extracto, registrar cuáles se reconciliaron en esa sesión, guardar el saldo confirmado y dejar la sesión `COMPLETED`, en una sola transacción de base de datos junto con la auditoría, los registros de transición y los eventos; NO DEBE (MUST NOT) crear, modificar ni revertir asientos.
Trace: FR-TRANSACTIONS-030, FR-AUDIT-001, INV-023, INV-029 · Priority: Must

#### Scenario: Finalizar la reconciliación de marzo
- **CUANDO** la sesión de "Bank A" al 2026-03-31 por 3350.00 BOB tiene diferencia 0.00 BOB y el usuario la finaliza
- **ENTONCES** el gasto de 150.00 BOB y el ingreso de 2500.00 BOB quedan `reconciled` en modo contra extracto y vinculados a la sesión, que queda `COMPLETED` con saldo confirmado 3350.00 BOB
- **Y** el gasto `posted` de 45.90 BOB y el gasto `cleared` de 200.00 BOB del 2026-04-02 no cambian de estado
- **Y** el número de asientos y el saldo contable de "Bank A" (3104.10 BOB) no cambian

#### Scenario: Falla al escribir la auditoría
- **CUANDO** al finalizar la sesión anterior falla la escritura de la auditoría
- **ENTONCES** la sesión sigue en curso y ninguna transacción cambia de estado

### Requirement: Diferencia distinta de cero y ajuste de reconciliación
Finalizar una sesión con diferencia distinta de cero DEBE (MUST) rechazarse con `RECONCILIATION_DIFFERENCE_NOT_ZERO` salvo que el usuario confirme explícitamente un ajuste con motivo obligatorio; en ese caso el sistema DEBE (MUST) crear, en la misma operación, una transacción de ajuste en la cuenta por el valor absoluto de la diferencia, con la dirección que la anula, fechada en la fecha del extracto, contabilizada contra el ajuste de patrimonio de la moneda, vinculada a la sesión y reconciliada junto con las demás.
Trace: FR-TRANSACTIONS-030, FR-TRANSACTIONS-017, INV-004, INV-005 · Priority: Must

#### Scenario: Finalizar con diferencia sin ajuste
- **CUANDO** la sesión de "Bank A" al 2026-03-31 tiene extracto 3345.00 BOB y diferencia −5.00 BOB y el usuario la finaliza sin confirmar un ajuste
- **ENTONCES** se rechaza con `RECONCILIATION_DIFFERENCE_NOT_ZERO` informando la diferencia −5.00 BOB y la sesión sigue en curso

#### Scenario: Finalizar con ajuste confirmado
- **CUANDO** el usuario finaliza esa sesión confirmando un ajuste con motivo "comisión bancaria no registrada"
- **ENTONCES** se crea un ajuste de disminución de 5.00 BOB en "Bank A" fechado 2026-03-31 cuyo asiento acredita 5.00 BOB a "Bank A" y debita 5.00 BOB al ajuste de patrimonio en BOB
- **Y** el ajuste, el gasto de 150.00 BOB y el ingreso de 2500.00 BOB quedan `reconciled`, la sesión `COMPLETED` con saldo confirmado 3345.00 BOB y el saldo contable de "Bank A" pasa a 3099.10 BOB

#### Scenario: Ajuste sin motivo
- **CUANDO** el usuario confirma el ajuste sin indicar motivo
- **ENTONCES** se rechaza con `VALIDATION_FAILED` y no se crea ninguna transacción

### Requirement: Cancelar una sesión de reconciliación
El usuario DEBERÍA poder cancelar una sesión en curso; cuando se ofrece, la sesión DEBE (MUST) quedar `CANCELLED` sin reconciliar ninguna transacción, las marcas `cleared` hechas durante la sesión DEBEN (MUST) conservarse y la cuenta DEBE (MUST) admitir una sesión nueva.
Trace: FR-TRANSACTIONS-030 · Priority: Should

#### Scenario: Cancelar y empezar de nuevo
- **CUANDO** el usuario confirmó el gasto de 45.90 BOB dentro de una sesión de "Bank A" y luego la cancela
- **ENTONCES** la sesión queda `CANCELLED`, el gasto de 45.90 BOB sigue `cleared` y ninguna transacción quedó `reconciled`
- **Y** el usuario puede iniciar otra sesión para "Bank A"

#### Scenario: Cancelar una sesión completada
- **CUANDO** el usuario intenta cancelar una sesión `COMPLETED`
- **ENTONCES** se rechaza con `INVALID_STATUS_TRANSITION`

### Requirement: Estado de reconciliación por cuenta
El sistema DEBE (MUST) informar, para una o varias cuentas, una fecha de corte y opcionalmente una fecha de inicio, la fecha y el saldo del extracto de la última sesión completada de cada cuenta, si tiene una sesión en curso, cuántas transacciones `posted` o `cleared` con fecha de negocio menor o igual al corte siguen sin reconciliar, cuántas transacciones conciliadas sin extracto tiene entre la fecha de inicio y el corte, si la cuenta está reconciliada al corte y con qué base. Una cuenta DEBE (MUST) considerarse reconciliada al corte solo si no le quedan transacciones `posted` ni `cleared` con fecha hasta el corte y, además, tiene un extracto completado con fecha igual o posterior al corte o alguna transacción conciliada sin extracto con fecha posterior a su último extracto completado (o sin extracto previo); la base DEBE (MUST) ser "sin extracto" cuando la cuenta reconciliada tiene conciliadas sin extracto en el rango consultado y "extracto" en otro caso. Es la fuente de los ítems "cuentas sin conciliar" y "conciliada sin extracto — pendiente de revisión" del checklist de cierre.
Trace: FR-TRANSACTIONS-030, FR-PLANNING-003 · Priority: Must

#### Scenario: Estado de "Bank A" al cierre de marzo
- **CUANDO** "Bank A" completó una sesión al 2026-03-31 por 3350.00 BOB, el gasto de 45.90 BOB del 2026-03-20 sigue `posted` y se consulta el estado con corte 2026-03-31
- **ENTONCES** se informa la última sesión al 2026-03-31 con saldo 3350.00 BOB, sin sesión en curso, 1 transacción sin reconciliar y la cuenta no reconciliada al corte

#### Scenario: Cuenta nunca reconciliada
- **CUANDO** se consulta el estado de "Caja BOB", que nunca tuvo una sesión completada
- **ENTONCES** se informa sin reconciliación previa y el número de transacciones sin reconciliar hasta el corte

#### Scenario: Cuenta conciliada sin extracto
- **CUANDO** "Caja BOB", sin sesiones completadas, tiene saldo inicial 500.00 BOB y como única transacción hasta el 2026-03-31 un gasto de 80.00 BOB del 2026-03-12 conciliado sin extracto, y se consulta el estado del 2026-03-01 al 2026-03-31
- **ENTONCES** se informa la cuenta reconciliada al corte con base "sin extracto", 1 transacción conciliada sin extracto en el rango y 0 sin reconciliar

#### Scenario: Extracto completado con una conciliada sin extracto posterior
- **CUANDO** "Bank A" completó una sesión al 2026-03-31, después se registró, confirmó y concilió sin extracto un gasto de 12.00 BOB del 2026-03-30 y no le quedan transacciones `posted` ni `cleared` hasta el 2026-03-31
- **ENTONCES** con corte 2026-03-31 e inicio 2026-03-01 la cuenta se informa reconciliada al corte con base "sin extracto" y 1 conciliada sin extracto en el rango

### Requirement: Evento dedicado de transacción confirmada
Cada transición `posted` → `cleared` y `cleared` → `posted` de una transacción, sea individual, en lote, dentro de una sesión o desde una edición masiva, DEBE (MUST) publicar exactamente un hecho "transacción confirmada" con el nuevo estado de confirmación, el estado anterior, la revisión y la sesión de reconciliación si la hay, además del hecho de transacción actualizada; los consumidores DEBEN (MUST) poder aplicarlo una sola vez ante reentregas.
Trace: FR-TRANSACTIONS-029, FR-TRANSACTIONS-030 · Priority: Must

#### Scenario: Confirmar un gasto publica el hecho dedicado
- **CUANDO** el usuario marca como `cleared` un gasto `posted` de 150.00 BOB
- **ENTONCES** se publica un único hecho "transacción confirmada" con confirmación verdadera y estado anterior `posted`, y un hecho de transacción actualizada con el campo de estado cambiado

#### Scenario: Reentrega del hecho
- **CUANDO** el hecho "transacción confirmada" de ese gasto se entrega dos veces a un consumidor
- **ENTONCES** el consumidor aplica su efecto una sola vez

### Requirement: Reconciliación y periodos cerrados
Ninguna operación de reconciliación DEBE (MUST) cambiar en silencio un periodo cerrado (alcance de la edición en periodos cerrados de `planning/month-closing`): confirmar o desconfirmar una transacción, reconciliarla al finalizar una sesión, conciliarla sin extracto o des-reconciliarla DEBE (MUST) rechazarse con `PERIOD_CLOSED` cuando su fecha de negocio cae en un periodo cerrado, y el ajuste de una sesión cuya fecha de extracto cae en un periodo cerrado también; el rechazo DEBE (MUST) dejar todo sin cambios.
Trace: FR-TRANSACTIONS-030, FR-PLANNING-005, INV-015 · Priority: Must

#### Scenario: Finalizar con una transacción de un mes cerrado
- **CUANDO** marzo de 2026 está cerrado y el usuario finaliza una sesión de "Bank A" al 2026-04-30 que incluiría un gasto `cleared` de 80.00 BOB del 2026-03-28 aún no reconciliado
- **ENTONCES** se rechaza con `PERIOD_CLOSED` indicando ese gasto y la sesión sigue en curso sin transacciones reconciliadas

#### Scenario: Ajuste fechado en un mes cerrado
- **CUANDO** marzo de 2026 está cerrado y el usuario finaliza con ajuste una sesión al 2026-03-31 con diferencia −5.00 BOB
- **ENTONCES** se rechaza con `PERIOD_CLOSED` y no se crea el ajuste ni se reconcilia ninguna transacción

#### Scenario: Conciliar sin extracto en un mes cerrado
- **CUANDO** marzo de 2026 está cerrado y el usuario intenta conciliar sin extracto un gasto `cleared` de 80.00 BOB del 2026-03-12 en "Caja BOB"
- **ENTONCES** se rechaza con `PERIOD_CLOSED` y el gasto sigue `cleared`, sin marca de seguimiento

### Requirement: Bloqueo optimista de la sesión
Las operaciones que modifican una sesión (confirmar o desconfirmar en la sesión, finalizar y cancelar) DEBERÍAN exigir la versión vigente de la sesión; cuando se exige, una versión obsoleta DEBE (MUST) rechazarse con `PRECONDITION_FAILED` sin efectos, y finalizar DEBE (MUST) evaluar el estado vigente de las transacciones incluidas en el momento de la finalización.
Trace: FR-TRANSACTIONS-011, FR-TRANSACTIONS-030, NFR-DATA-014 · Priority: Should

#### Scenario: Finalizar con una versión obsoleta
- **CUANDO** dos pestañas tienen abierta la sesión de "Bank A" en la versión 3, una confirma un gasto (versión 4) y la otra intenta finalizar con la versión 3
- **ENTONCES** la finalización se rechaza con `PRECONDITION_FAILED` y la sesión sigue en curso

#### Scenario: Gasto incluido editado antes de finalizar
- **CUANDO** el gasto `cleared` de 150.00 BOB se corrige a 155.00 BOB (vuelve a `posted`) antes de finalizar la sesión con extracto 3350.00 BOB
- **ENTONCES** al finalizar el saldo confirmado es 3500.00 BOB, la diferencia −150.00 BOB y la finalización sin ajuste se rechaza con `RECONCILIATION_DIFFERENCE_NOT_ZERO`

### Requirement: Conciliación sin extracto
Un miembro EDITOR u OWNER DEBE (MUST) poder pasar una transacción `cleared` a `reconciled` fuera de una sesión solo indicando explícitamente el modo "conciliada sin extracto"; la transacción DEBE (MUST) quedar `reconciled` en ese modo sin crear, modificar ni revertir asientos, con auditoría y con su propia transición del recorrido, y DEBE (MUST) distinguirse en la API y en la UI de una transacción conciliada contra un extracto. Un marcado directo sin el modo explícito DEBE (MUST) rechazarse con `VALIDATION_FAILED`, uno sobre una transacción que no está `cleared` con `INVALID_STATUS_TRANSITION` y uno de un VIEWER con `INSUFFICIENT_ROLE`, en todos los casos sin cambios.
Trace: FR-TRANSACTIONS-006, FR-TRANSACTIONS-030, FR-AUDIT-001, INV-033 · Priority: Must

#### Scenario: Conciliar sin extracto un gasto en efectivo
- **CUANDO** el usuario marca como conciliado sin extracto un gasto `cleared` de 80.00 BOB del 2026-03-12 en "Caja BOB" (saldo 420.00 BOB)
- **ENTONCES** el gasto queda `reconciled` en modo sin extracto, con su mismo único asiento activo, y "Caja BOB" sigue en 420.00 BOB
- **Y** la auditoría registra el cambio de estado y el modo con el actor, y la respuesta lo muestra como "conciliada sin extracto"

#### Scenario: Marcado directo sin indicar el modo
- **CUANDO** el usuario intenta marcar directamente como `reconciled` ese gasto `cleared` sin indicar el modo sin extracto
- **ENTONCES** se rechaza con `VALIDATION_FAILED` y el gasto sigue `cleared`

#### Scenario: Conciliar sin extracto un gasto solo posteado
- **CUANDO** el usuario intenta conciliar sin extracto un gasto `posted` de 45.90 BOB
- **ENTONCES** se rechaza con `INVALID_STATUS_TRANSITION` y el gasto sigue `posted`

### Requirement: Marca de seguimiento de las conciliadas sin extracto
Toda transacción conciliada sin extracto DEBE (MUST) exponer la marca de sistema `RECONCILED_WITHOUT_STATEMENT` ("conciliada sin extracto — pendiente de revisión"), derivada de su modo de conciliación, que el usuario NO DEBE (MUST NOT) poder agregar ni quitar a mano, con tags ni con una edición masiva; el listado de transacciones DEBE (MUST) permitir filtrar por esa marca combinada con cuenta y rango de fechas, y la marca DEBE (MUST) desaparecer solo cuando la transacción se des-reconcilia o cuando una sesión posterior la coteja contra un extracto.
Trace: FR-TRANSACTIONS-030, FR-TRANSACTIONS-012 · Priority: Must

#### Scenario: Listar las conciliadas sin extracto pendientes de revisión
- **CUANDO** "Caja BOB" tiene el gasto de 80.00 BOB conciliado sin extracto, "Bank A" tiene el gasto de 150.00 BOB reconciliado en la sesión al 2026-03-31 y el usuario filtra el listado por la marca "conciliada sin extracto"
- **ENTONCES** obtiene solo el gasto de 80.00 BOB de "Caja BOB", con la marca visible

#### Scenario: Intento de quitar la marca a mano
- **CUANDO** el usuario intenta quitar la marca "conciliada sin extracto" del gasto de 80.00 BOB editando la transacción
- **ENTONCES** se rechaza con `VALIDATION_FAILED` y el gasto conserva la marca y su modo

### Requirement: Cotejo posterior de las conciliadas sin extracto
Al finalizar una sesión, las transacciones de la cuenta conciliadas sin extracto con fecha de negocio menor o igual a la fecha del extracto y fuera de periodos cerrados DEBEN (MUST) pasar a modo contra extracto vinculadas a esa sesión, en la misma transacción de base de datos, sin cambiar de estado ni crear asientos y con una anotación en su recorrido; las que caen en un periodo cerrado DEBEN (MUST) conservar su modo y su marca sin impedir la finalización.
Trace: FR-TRANSACTIONS-030, FR-AUDIT-010, INV-015 · Priority: Must

#### Scenario: Sesión que coteja un gasto conciliado sin extracto
- **CUANDO** el gasto de 45.90 BOB del 2026-03-20 de "Bank A" está conciliado sin extracto y el usuario finaliza la sesión de "Bank A" al 2026-03-31 por 3304.10 BOB con diferencia 0.00 BOB
- **ENTONCES** ese gasto sigue `reconciled`, ahora en modo contra extracto, vinculado a la sesión y sin la marca de seguimiento
- **Y** el número de asientos y el saldo contable de "Bank A" no cambian

#### Scenario: Conciliada sin extracto en un mes cerrado
- **CUANDO** marzo de 2026 está cerrado, "Bank A" tiene un gasto de 30.00 BOB del 2026-03-28 conciliado sin extracto y ninguna transacción `cleared` de marzo, y el usuario finaliza con diferencia 0.00 BOB una sesión de "Bank A" al 2026-04-30
- **ENTONCES** la sesión queda `COMPLETED` y el gasto de 30.00 BOB conserva el modo sin extracto y la marca de seguimiento
