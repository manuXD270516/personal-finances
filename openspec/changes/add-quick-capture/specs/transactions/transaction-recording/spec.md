## ADDED Requirements

### Requirement: Monto primero en el alta
En el alta de una transacción, el monto DEBE (MUST) ser el primer campo del formulario, recibir el foco al abrir la página de alta y pedir el teclado decimal. La tecla de acción del teclado virtual DEBE (MUST) indicar que sigue otro campo. En la edición de una transacción existente, ningún campo DEBE (MUST) recibir el foco automáticamente.
Trace: FR-TRANSACTIONS-002, NFR-USAB-006, NFR-USAB-007 · Priority: Must

#### Scenario: Abrir el alta en el teléfono
- **CUANDO** el EDITOR abre la página de alta de transacción con una ventana de 360 px de ancho
- **ENTONCES** el monto es el primer campo del formulario y tiene el foco
- **Y** el campo pide el teclado decimal y su tecla de acción es "siguiente"

#### Scenario: Editar una transacción
- **CUANDO** el EDITOR abre la edición de un gasto de 120.00 BOB
- **ENTONCES** ningún campo del formulario tiene el foco al cargar

### Requirement: Registrar y seguir registrando
Tras registrar una transacción desde la página de alta con la acción principal, el sistema DEBE (MUST) quedarse en el formulario y dejarlo listo para otra: conservar el tipo, la cuenta, la fecha y el estado; vaciar el monto y los demás datos; usar una clave de idempotencia nueva y llevar el foco al monto. DEBE (MUST) mostrar un aviso con el tipo y el monto registrados y las acciones "Deshacer" y "Ver". La acción secundaria "Registrar e ir al detalle" DEBE (MUST) registrar y abrir el detalle de la transacción.
Trace: FR-TRANSACTIONS-001, FR-TRANSACTIONS-010, NFR-USAB-007 · Priority: Must

#### Scenario: Dos gastos seguidos
- **CUANDO** "Banco BOB" tiene saldo 1000.00 BOB y el EDITOR registra el 2026-11-25 un gasto de 45.00 BOB en "Alimentación" con la acción principal
- **ENTONCES** el formulario sigue abierto con el monto vacío, "Banco BOB" como cuenta, la fecha 2026-11-25 y el foco en el monto
- **Y** aparece el aviso "Gasto de Bs 45,00 registrado" con "Deshacer" y "Ver"
- **Y** al registrar luego un gasto de 30.00 BOB en "Transporte" existen dos gastos distintos y el saldo de "Banco BOB" es 925.00 BOB

#### Scenario: Registrar e ir al detalle
- **CUANDO** el EDITOR registra un gasto de 45.00 BOB en "Banco BOB" con "Registrar e ir al detalle"
- **ENTONCES** se abre el detalle de ese gasto con el aviso de registrada

#### Scenario: Ver desde el aviso
- **CUANDO** el EDITOR pulsa "Ver" en el aviso del gasto de 45.00 BOB
- **ENTONCES** se abre el detalle de ese gasto y el aviso deja de mostrarse

### Requirement: Deshacer un registro desde el aviso
La acción "Deshacer" del aviso de registro DEBE (MUST) anular la transacción registrada con las mismas reglas que la anulación desde el detalle (versión esperada, reversa del asiento, auditoría y evento) y un motivo predefinido en el idioma de la interfaz; NO DEBE (MUST NOT) borrar la transacción. DEBE (MUST) estar disponible mientras el aviso siga visible, sin límite de tiempo, y ejecutar una sola anulación aunque se active varias veces. Si la anulación se rechaza, el aviso DEBE (MUST) mostrar el mensaje del catálogo de errores y la transacción DEBE (MUST) quedar como estaba.
Trace: FR-TRANSACTIONS-009, FR-LEDGER-005, INV-008, NFR-USAB-009 · Priority: Must

#### Scenario: Deshacer un gasto
- **CUANDO** "Banco BOB" quedó en 955.00 BOB tras registrar un gasto de 45.00 BOB y el EDITOR pulsa "Deshacer" en su aviso
- **ENTONCES** el gasto queda anulado con el motivo "Deshecho desde el aviso de registro" y existe la reversa de su asiento
- **Y** el saldo de "Banco BOB" vuelve a 1000.00 BOB y el aviso dice "Registro anulado" sin la acción "Deshacer"

#### Scenario: Periodo cerrado entre el registro y el deshacer
- **CUANDO** se registró un gasto de 45.00 BOB del 2026-10-31, después se cerró el periodo "2026-10" y el EDITOR pulsa "Deshacer"
- **ENTONCES** el aviso muestra el mensaje de periodo cerrado del catálogo
- **Y** el gasto sigue posteado y el saldo de "Banco BOB" sigue en 955.00 BOB

#### Scenario: Doble activación de Deshacer
- **CUANDO** el EDITOR activa "Deshacer" dos veces seguidas sobre el gasto de 45.00 BOB
- **ENTONCES** existe una sola anulación y una sola reversa
- **Y** no se muestra ningún error

#### Scenario: Deshacer varios minutos después
- **CUANDO** pasan 10 minutos desde el registro del gasto de 45.00 BOB sin cerrar el aviso
- **ENTONCES** "Deshacer" sigue disponible y anula el gasto

### Requirement: Cuenta recordada en el dispositivo
Al abrir el alta sin una cuenta indicada en el enlace, el sistema DEBE (MUST) preseleccionar la última cuenta con la que el mismo usuario registró en ese workspace desde ese dispositivo, si la cuenta sigue activa. Una cuenta indicada en el enlace DEBE (MUST) tener prioridad. Recordar la cuenta NO DEBE (MUST NOT) modificar el perfil del usuario ni generar registros de auditoría, y la falta de almacenamiento en el navegador NO DEBE (MUST NOT) impedir el alta.
Trace: NFR-USAB-007 · Priority: Should

#### Scenario: Siguiente alta en el mismo dispositivo
- **CUANDO** el EDITOR registró un gasto de 45.00 BOB en "Banco BOB" y vuelve a abrir el alta en el mismo navegador y workspace
- **ENTONCES** "Banco BOB" está preseleccionada
- **Y** en otro workspace del mismo usuario el alta no preselecciona ninguna cuenta

#### Scenario: Cuenta indicada en el enlace
- **CUANDO** la cuenta recordada es "Banco BOB" y el EDITOR abre el alta desde el detalle de "Caja USD"
- **ENTONCES** "Caja USD" está preseleccionada

#### Scenario: Cuenta recordada archivada
- **CUANDO** la cuenta recordada "Banco BOB" se archivó y el EDITOR abre el alta
- **ENTONCES** ninguna cuenta está preseleccionada

#### Scenario: Sin cambios en el perfil
- **CUANDO** el EDITOR registra tres gastos de 10.00 BOB en cuentas distintas
- **ENTONCES** la versión de su perfil no cambia y no hay registros de auditoría de cambio de preferencias

### Requirement: Acceso directo para registrar
Quien puede editar en el workspace DEBE (MUST) tener en la barra superior de todas las páginas de la aplicación, salvo la propia página de alta, un acceso "Registrar" que abre el alta de transacción. Quien solo puede ver NO DEBE (MUST NOT) verlo.
Trace: FR-TRANSACTIONS-001, NFR-USAB-006 · Priority: Should

#### Scenario: Acceso del EDITOR
- **CUANDO** un EDITOR está en "Presupuestos"
- **ENTONCES** la barra superior muestra "Registrar" y al activarlo se abre el alta de transacción con el foco en el monto

#### Scenario: Sin acceso para el VIEWER
- **CUANDO** un VIEWER está en "Transacciones"
- **ENTONCES** la barra superior no muestra "Registrar"
