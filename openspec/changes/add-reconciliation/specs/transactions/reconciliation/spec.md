# Spec Delta

## Purpose

Completa la reconciliación de Phase 2 (FR-TRANSACTIONS-030): sesiones por cuenta contra la fecha y el saldo de un extracto, diferencia en vivo que debe llegar a cero para finalizar, ajuste auditado cuando hace falta, evento dedicado de transacción confirmada (docs/31 D47), estado de reconciliación por cuenta para el cierre de mes y respeto de los periodos cerrados.

## ADDED Requirements

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
Con diferencia 0, finalizar la sesión DEBE (MUST) pasar a `reconciled` todas las transacciones `cleared` de la cuenta con fecha de negocio menor o igual a la fecha del extracto, registrar cuáles se reconciliaron en esa sesión, guardar el saldo confirmado y dejar la sesión `COMPLETED`, en una sola transacción de base de datos junto con la auditoría, los registros de transición y los eventos; NO DEBE (MUST NOT) crear, modificar ni revertir asientos.
Trace: FR-TRANSACTIONS-030, FR-AUDIT-001, INV-023, INV-029 · Priority: Must

#### Scenario: Finalizar la reconciliación de marzo
- **CUANDO** la sesión de "Bank A" al 2026-03-31 por 3350.00 BOB tiene diferencia 0.00 BOB y el usuario la finaliza
- **ENTONCES** el gasto de 150.00 BOB y el ingreso de 2500.00 BOB quedan `reconciled` y vinculados a la sesión, que queda `COMPLETED` con saldo confirmado 3350.00 BOB
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
El sistema DEBE (MUST) informar, para una cuenta y una fecha de corte, la fecha y el saldo del extracto de su última sesión completada con fecha menor o igual al corte, si tiene una sesión en curso y cuántas transacciones `posted` o `cleared` con fecha de negocio menor o igual al corte siguen sin reconciliar; esta consulta es la fuente del ítem "cuentas sin reconciliar" del checklist de cierre de mes.
Trace: FR-TRANSACTIONS-030, FR-PLANNING-003 · Priority: Must

#### Scenario: Estado de "Bank A" al cierre de marzo
- **CUANDO** "Bank A" completó una sesión al 2026-03-31 por 3350.00 BOB, el gasto de 45.90 BOB del 2026-03-20 sigue `posted` y se consulta el estado con corte 2026-03-31
- **ENTONCES** se informa reconciliada al 2026-03-31 con saldo 3350.00 BOB, sin sesión en curso y 1 transacción sin reconciliar

#### Scenario: Cuenta nunca reconciliada
- **CUANDO** se consulta el estado de "Caja BOB", que nunca tuvo una sesión completada
- **ENTONCES** se informa sin reconciliación previa y el número de transacciones sin reconciliar hasta el corte

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
Ninguna operación de reconciliación DEBE (MUST) cambiar en silencio un periodo cerrado: confirmar o desconfirmar una transacción, reconciliarla al finalizar una sesión o des-reconciliarla DEBE (MUST) rechazarse con `PERIOD_CLOSED` cuando su fecha de negocio cae en un periodo cerrado, y el ajuste de una sesión cuya fecha de extracto cae en un periodo cerrado también; el rechazo DEBE (MUST) dejar todo sin cambios.
Trace: FR-TRANSACTIONS-030, FR-PLANNING-005, INV-015 · Priority: Must

#### Scenario: Finalizar con una transacción de un mes cerrado
- **CUANDO** marzo de 2026 está cerrado y el usuario finaliza una sesión de "Bank A" al 2026-04-30 que incluiría un gasto `cleared` de 80.00 BOB del 2026-03-28 aún no reconciliado
- **ENTONCES** se rechaza con `PERIOD_CLOSED` indicando ese gasto y la sesión sigue en curso sin transacciones reconciliadas

#### Scenario: Ajuste fechado en un mes cerrado
- **CUANDO** marzo de 2026 está cerrado y el usuario finaliza con ajuste una sesión al 2026-03-31 con diferencia −5.00 BOB
- **ENTONCES** se rechaza con `PERIOD_CLOSED` y no se crea el ajuste ni se reconcilia ninguna transacción

### Requirement: Bloqueo optimista de la sesión
Las operaciones que modifican una sesión (confirmar o desconfirmar en la sesión, finalizar y cancelar) DEBERÍAN exigir la versión vigente de la sesión; cuando se exige, una versión obsoleta DEBE (MUST) rechazarse con `PRECONDITION_FAILED` sin efectos, y finalizar DEBE (MUST) evaluar el estado vigente de las transacciones incluidas en el momento de la finalización.
Trace: FR-TRANSACTIONS-011, FR-TRANSACTIONS-030, NFR-DATA-014 · Priority: Should

#### Scenario: Finalizar con una versión obsoleta
- **CUANDO** dos pestañas tienen abierta la sesión de "Bank A" en la versión 3, una confirma un gasto (versión 4) y la otra intenta finalizar con la versión 3
- **ENTONCES** la finalización se rechaza con `PRECONDITION_FAILED` y la sesión sigue en curso

#### Scenario: Gasto incluido editado antes de finalizar
- **CUANDO** el gasto `cleared` de 150.00 BOB se corrige a 155.00 BOB (vuelve a `posted`) antes de finalizar la sesión con extracto 3350.00 BOB
- **ENTONCES** al finalizar el saldo confirmado es 3500.00 BOB, la diferencia −150.00 BOB y la finalización sin ajuste se rechaza con `RECONCILIATION_DIFFERENCE_NOT_ZERO`

## MODIFIED Requirements

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

### Requirement: Marcar una transacción como reconciliada
Una transacción DEBE (MUST) pasar a `reconciled` solo al finalizar una sesión de reconciliación de su cuenta, y solo desde `cleared`, sin cambios en el ledger; el marcado directo de una transacción como `reconciled` fuera de una sesión DEBE (MUST) rechazarse con `RECONCILIATION_SESSION_REQUIRED`.
Trace: FR-TRANSACTIONS-006, FR-TRANSACTIONS-030 · Priority: Must

#### Scenario: Reconciliar un gasto confirmado
- **CUANDO** un gasto `cleared` de 150.00 BOB está incluido en una sesión que se finaliza con diferencia 0.00 BOB
- **ENTONCES** la transacción queda `reconciled` y el saldo de la cuenta no cambia

#### Scenario: Reconciliar un gasto solo posteado
- **CUANDO** una sesión con diferencia 0.00 BOB se finaliza y la cuenta tiene un gasto `posted` de 150.00 BOB con fecha anterior al extracto
- **ENTONCES** ese gasto sigue `posted`

#### Scenario: Marcado directo como reconciliada
- **CUANDO** el usuario intenta marcar directamente como `reconciled` un gasto `cleared` de 150.00 BOB sin finalizar una sesión
- **ENTONCES** se rechaza con `RECONCILIATION_SESSION_REQUIRED` y el gasto sigue `cleared`

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

#### Scenario: Des-reconciliar en un mes cerrado
- **CUANDO** marzo de 2026 está cerrado y el usuario intenta des-reconciliar un gasto `reconciled` del 2026-03-05
- **ENTONCES** se rechaza con `PERIOD_CLOSED` y el gasto sigue `reconciled`
