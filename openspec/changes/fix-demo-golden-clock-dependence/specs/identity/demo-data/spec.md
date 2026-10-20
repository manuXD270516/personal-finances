## ADDED Requirements

### Requirement: Resumen de referencia independiente del reloj real
La comparación de un workspace de demostración con el resumen de referencia del dataset, o con el oráculo de su fecha ancla, DEBE (MUST) depender solo de la versión del dataset y de la fecha ancla, y DEBE (MUST) dar el mismo resultado con cualquier fecha y hora real de la instalación en que se ejecute. Toda verificación de calidad que haga esa comparación NO DEBE (MUST NOT) incluir efectos de tareas programadas que evalúan "hoy" con el reloj real, y DEBE (MUST) hacerse después de que terminen las reacciones asíncronas a la carga. Una tarea programada nueva de la instalación DEBE (MUST) quedar excluida de esas verificaciones sin enumerarla a mano.
Trace: FR-IDENTITY-014, FR-LEDGER-001 · Priority: Must

#### Scenario: La comparación no depende de la hora de la corrida
- **CUANDO** se cargan dos workspaces de demostración con la versión de dataset 2 y la fecha ancla 2026-09-30, el 2026-10-20 a las 07:09 en America/La_Paz, y durante la comparación llega el minuto en que la instalación ejecuta sus tareas programadas por hora
- **ENTONCES** en ambos "Banco Andino Demo — Cuenta corriente" tiene 117519.90 BOB y "Efectivo" tiene 9073.69 BOB, iguales al resumen de referencia
- **Y** ninguno tiene un "Retiro de efectivo" con fecha posterior a la ancla

#### Scenario: La comparación no depende de la fecha de la corrida
- **CUANDO** se carga la demo con la fecha ancla 2026-09-30 mientras el reloj de los procesos que reaccionan a la carga marca 2027-10-30, y se espera a que terminen sus reacciones
- **ENTONCES** las 14 cuentas tienen los saldos del resumen de referencia, entre ellos 117519.90 BOB en "Banco Andino Demo — Cuenta corriente" y 9073.69 BOB en "Efectivo"
- **Y** los movimientos de cada asiento suman 0.00 por moneda

#### Scenario: Ninguna tarea programada actúa durante la verificación
- **CUANDO** se ejecutan las verificaciones de calidad de la demo y la instalación tiene registradas tareas programadas, incluida una agregada después de este requirement
- **ENTONCES** ninguna de esas tareas se ejecuta mientras corren esas verificaciones

### Requirement: Verificación de la carga antes de publicar sus datos
La carga de datos de demostración DEBE (MUST) verificar los saldos de las cuentas contra el oráculo de su fecha ancla, y que los movimientos de cada asiento sumen cero por moneda, antes de que los datos del plan sean visibles para cualquier otro proceso. El resultado de la carga NO DEBE (MUST NOT) depender de lo que otro proceso haga en el workspace de demostración después de que esos datos se publican.
Trace: FR-IDENTITY-014, FR-LEDGER-001 · Priority: Should

#### Scenario: Una tarea programada justo después de publicar el plan no hace fallar la carga
- **CUANDO** se cargan los datos de demostración con la fecha ancla 2026-09-30 y, justo después de publicarse los datos del plan y antes de que termine la carga, el motor de recurrencia corre con la fecha 2026-10-02 en America/La_Paz
- **ENTONCES** la carga termina en estado `READY`, no en `FAILED` con `DEMO_GOLDEN_MISMATCH`
- **Y** la verificación de la carga encontró 117519.90 BOB en "Banco Andino Demo — Cuenta corriente" y 9073.69 BOB en "Efectivo"

### Requirement: El workspace demo sigue el reloj de la instalación después de la carga
Después de quedar en estado `READY`, el workspace de demostración DEBE (MUST) recibir las tareas programadas de la instalación igual que un workspace real: cada ocurrencia en modo de creación automática que vence después de la fecha ancla DEBE (MUST) materializarse una sola vez cuando su fecha llega en la zona horaria del workspace, y una ocurrencia con fecha igual o anterior a la ancla NO DEBE (MUST NOT) materializarse de nuevo.
Trace: FR-IDENTITY-014, FR-COMMITMENTS-007 · Priority: Should

#### Scenario: El retiro automático del día 2 llega con su fecha
- **CUANDO** una demo cargada con la fecha ancla 2026-09-30 tiene la definición "Retiro de efectivo" de 600.00 BOB, automática, los días 2 de cada mes, de "Banco Andino Demo — Cuenta corriente" a "Efectivo", y el motor de recurrencia corre el 2026-10-02 a las 12:00 en America/La_Paz
- **ENTONCES** se crea exactamente una transferencia "Retiro de efectivo" de 600.00 BOB con fecha 2026-10-02
- **Y** "Banco Andino Demo — Cuenta corriente" queda en 116919.90 BOB, "Efectivo" en 9673.69 BOB y las demás cuentas sin cambios

#### Scenario: Repetir el motor el mismo día no duplica el retiro
- **CUANDO** el motor de recurrencia vuelve a correr el 2026-10-02 sobre esa demo
- **ENTONCES** no se crea ninguna transferencia nueva y los saldos siguen en 116919.90 BOB y 9673.69 BOB

#### Scenario: El día de la ancla no hay nada que materializar
- **CUANDO** el motor de recurrencia corre el 2026-09-30 a las 12:00 en America/La_Paz sobre una demo recién cargada con esa ancla
- **ENTONCES** no se crea ningún movimiento y los saldos son los del resumen de referencia
