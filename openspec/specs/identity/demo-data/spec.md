# identity/demo-data Specification

## Purpose
Permite ver PFOS con datos financieros de demostración realistas (bancos, comercios y personas ficticios) solo cuando el OWNER lo pide explícitamente desde la app, en un workspace de demostración dedicado, marcado de forma visible y completamente removible, sin tocar jamás los datos reales del usuario ni las invariantes del ledger de un workspace real (docs/31 D36, ADR-0026).

## Requirements

### Requirement: Carga de datos demo solo por acción explícita del OWNER
El sistema DEBE (MUST) cargar datos de demostración únicamente cuando un miembro con rol OWNER del workspace actual ejecuta la acción "Cargar datos de demostración"; NO DEBE (MUST NOT) cargarlos al arrancar, al migrar, al iniciar sesión ni al crear un workspace, y un miembro EDITOR o VIEWER DEBE (MUST) recibir `INSUFFICIENT_ROLE`.
Trace: FR-IDENTITY-013, FR-IDENTITY-006 · Priority: Must

#### Scenario: El OWNER carga los datos de demostración
- **CUANDO** el OWNER de "W1 Personal Demo" ejecuta "Cargar datos de demostración"
- **ENTONCES** se crea un workspace nuevo de demostración cuyo único miembro es ese usuario con rol OWNER
- **Y** al terminar la carga el workspace de demostración queda en estado `READY` con cuentas, transacciones, transferencias, conversiones y tasas de demostración

#### Scenario: Un EDITOR no puede cargar datos de demostración
- **CUANDO** el EDITOR de "W1 Personal Demo" ejecuta "Cargar datos de demostración"
- **ENTONCES** se rechaza con `INSUFFICIENT_ROLE` y no se crea ningún workspace

#### Scenario: Nada se carga automáticamente
- **CUANDO** se aplican las migraciones, arranca la aplicación y un usuario nuevo inicia sesión por primera vez
- **ENTONCES** no existe ningún workspace de demostración ni ningún dato de demostración

### Requirement: Datos demo aislados en un workspace dedicado
Los datos de demostración DEBEN (MUST) escribirse solo en un workspace de demostración dedicado, creado por la acción de carga y marcado como demo desde su creación; la carga NO DEBE (MUST NOT) crear, modificar ni revertir ningún dato de un workspace real, y la marca demo de un workspace NO DEBE (MUST NOT) poder activarse ni desactivarse después de su creación.
Trace: FR-IDENTITY-013, NFR-SEC-003 · Priority: Must

#### Scenario: El workspace real no cambia
- **CUANDO** "W1 Personal Demo" tiene la cuenta "Banco Real" con 1500.00 BOB y su OWNER carga los datos de demostración
- **ENTONCES** "Banco Real" sigue con 1500.00 BOB, "W1 Personal Demo" no tiene asientos, transacciones ni registros de auditoría nuevos salvo el registro de la acción de carga

#### Scenario: La marca demo es inmutable
- **CUANDO** cualquier proceso intenta marcar como demo a "W1 Personal Demo" o quitar la marca demo al workspace de demostración
- **ENTONCES** la operación se rechaza y ambas marcas quedan como estaban

### Requirement: Datos demo identificados como demo
Todo workspace de demostración DEBE (MUST) exponerse como demo en la API (lista de workspaces y detalle) y la UI DEBE (MUST) mostrar un indicador persistente "Datos de demostración" en toda pantalla de ese workspace, incluidos los reportes y las exportaciones visibles.
Trace: FR-IDENTITY-014 · Priority: Must

#### Scenario: El workspace demo se ve como demo
- **CUANDO** el usuario lista sus workspaces después de cargar los datos de demostración y abre el Home del workspace de demostración
- **ENTONCES** la lista marca el workspace de demostración como demo y "W1 Personal Demo" como no demo
- **Y** el Home del workspace de demostración muestra el indicador "Datos de demostración"

### Requirement: Contenido demo ficticio, realista y determinista
Los datos de demostración DEBEN (MUST) usar solo instituciones, comercios y personas ficticios con apariencia real, sin números de cuenta reales, y DEBEN (MUST) generarse de forma determinista desde el dataset versionado y la fecha ancla, por los mismos casos de uso que la operación real, de modo que todas las invariantes del ledger se cumplan. El dataset DEBE (MUST) incluir, además de cuentas, transacciones, transferencias, conversiones y tasas, suscripciones y compromisos recurrentes, tarjetas de crédito con sus ciclos, préstamos con su cronograma y metas de ahorro, todos creados por los casos de uso de sus contextos. Las fechas de esos elementos DEBEN (MUST) calcularse respecto de la fecha ancla de modo que sus estados se conserven con cualquier ancla. Las instituciones de la demo NO DEBEN (MUST NOT) tomarse del catálogo de referencia de instituciones del entorno, y las tasas de la demo DEBEN (MUST) ser tasas manuales ficticias, sin observaciones de proveedores de tasas.
Trace: FR-IDENTITY-014, FR-LEDGER-001 · Priority: Must

#### Scenario: Dos cargas con la misma ancla producen los mismos saldos
- **CUANDO** se cargan dos veces los datos de demostración con la versión de dataset 2 y la fecha ancla 2026-09-30, en dos workspaces de demostración distintos
- **ENTONCES** ambos workspaces tienen las mismas cuentas con los mismos saldos por moneda, iguales al resumen de referencia del dataset
- **Y** en ambos los movimientos de cada asiento suman 0.00 por moneda
- **Y** ambos tienen las mismas suscripciones, tarjetas, préstamos y metas con los mismos estados y cifras del resumen de referencia

#### Scenario: Instituciones ficticias
- **CUANDO** se cargan los datos de demostración
- **ENTONCES** las instituciones tienen nombres ficticios como "Banco Andino Demo" y los identificadores de cuenta llevan el prefijo `DEMO-`

#### Scenario: Instituciones independientes del catálogo de referencia
- **CUANDO** se cargan los datos de demostración en un entorno cuyo catálogo de referencia de instituciones contiene entidades reales
- **ENTONCES** ninguna institución del workspace de demostración proviene de ese catálogo y todas tienen nombres ficticios terminados en "Demo"

#### Scenario: Otra fecha ancla conserva los estados
- **CUANDO** se cargan los datos de demostración con la fecha ancla 2026-10-05 en lugar de 2026-09-30
- **ENTONCES** la demo tiene las mismas suscripciones en los mismos estados (5 activas, 1 en trial, 1 pausada y 1 cancelada), el estado de cuenta en USD de "Tarjeta Kantuta Demo" anterior al último está vencido y el último está emitido sin vencer
- **Y** el "Préstamo de consumo" tiene al menos una cuota en mora, el "Préstamo familiar" está saldado, "Viaje" está atrasada respecto del plan y "Laptop" está alcanzada
- **Y** ningún movimiento de la demo tiene fecha posterior a la ancla, salvo las ocurrencias, cuotas y cargos futuros que generan los propios cronogramas

### Requirement: Estado de la carga observable y sin resultados parciales
La carga DEBE (MUST) ejecutarse de forma asíncrona y exponer su estado (`LOADING`, `READY`, `FAILED`); si la carga falla, el workspace de demostración DEBE (MUST) quedar en `FAILED`, NO DEBE (MUST NOT) presentarse como `READY` con datos parciales y DEBE (MUST) poder limpiarse.
Trace: FR-IDENTITY-013 · Priority: Must

#### Scenario: Carga fallida
- **CUANDO** la carga de datos de demostración falla a mitad de la generación
- **ENTONCES** el estado del workspace de demostración es `FAILED` y la UI ofrece "Limpiar datos de demostración"
- **Y** el workspace de demostración no aparece como listo para usar

### Requirement: Un workspace demo activo por usuario
El sistema DEBE (MUST) permitir como máximo un workspace de demostración no limpiado por usuario; una nueva carga mientras exista otro DEBE (MUST) rechazarse con `DEMO_WORKSPACE_ALREADY_EXISTS`.
Trace: FR-IDENTITY-016 · Priority: Should

#### Scenario: Segunda carga rechazada
- **CUANDO** el OWNER ya tiene un workspace de demostración en estado `READY` y vuelve a ejecutar "Cargar datos de demostración"
- **ENTONCES** se rechaza con `DEMO_WORKSPACE_ALREADY_EXISTS` y no se crea otro workspace

### Requirement: Limpieza inmediata del workspace demo
El OWNER del workspace de demostración DEBE (MUST) poder ejecutar "Limpiar datos de demostración"; desde ese momento el workspace de demostración DEBE (MUST) dejar de listarse y toda consulta o comando sobre él DEBE (MUST) responder como si no existiera.
Trace: FR-IDENTITY-015 · Priority: Must

#### Scenario: Limpiar oculta el workspace al instante
- **CUANDO** el OWNER ejecuta "Limpiar datos de demostración" sobre su workspace de demostración con "Banco Andino Demo" y 12000.00 BOB de saldo
- **ENTONCES** el workspace de demostración ya no aparece en su lista de workspaces
- **Y** consultar el saldo de "Banco Andino Demo" responde como un recurso inexistente

### Requirement: Purga completa del workspace demo
Tras la limpieza, el sistema DEBE (MUST) purgar físicamente todos los datos del workspace de demostración (cuentas, ledger, transacciones, tasas, clasificación, compromisos, suscripciones, tarjetas, préstamos, metas, notificaciones y sus preferencias, auditoría, eventos pendientes y datos derivados), conservar solo una lápida sin datos de negocio y un registro de la purga con las filas eliminadas por tabla.
Trace: FR-IDENTITY-015, NFR-DATA-012 · Priority: Must

#### Scenario: No queda ningún dato del workspace demo
- **CUANDO** la purga del workspace de demostración termina
- **ENTONCES** no existe ninguna fila de negocio, de auditoría, de eventos ni derivada con su identificador de workspace
- **Y** existe un registro de purga con el instante y la cantidad de filas eliminadas por tabla

#### Scenario: Purga con compromisos, deudas y metas
- **CUANDO** se limpia un workspace de demostración cargado con la versión de dataset 2, con 8 suscripciones, 2 tarjetas, 4 préstamos y 4 metas, y la purga termina
- **ENTONCES** no queda ninguna suscripción, definición recurrente, ocurrencia, tarjeta, estado de cuenta, plan de cuotas, préstamo, cronograma, meta ni movimiento de meta con su identificador de workspace
- **Y** el registro de purga informa filas eliminadas mayores que cero en las tablas de compromisos, deudas y metas

### Requirement: La purga nunca afecta a un workspace real
El sistema NO DEBE (MUST NOT) limpiar ni purgar un workspace que no sea de demostración: la acción de limpieza sobre un workspace real DEBE (MUST) rechazarse con `WORKSPACE_NOT_DEMO` y la purga física DEBE (MUST) negarse en la base de datos para cualquier workspace no demo, aunque se invoque directamente.
Trace: FR-IDENTITY-015, FR-LEDGER-005, INV-007, INV-029 · Priority: Must

#### Scenario: Limpiar un workspace real
- **CUANDO** el OWNER de "W1 Personal Demo" (workspace real con "Banco Real" en 1500.00 BOB) ejecuta "Limpiar datos de demostración" sobre "W1 Personal Demo"
- **ENTONCES** se rechaza con `WORKSPACE_NOT_DEMO`
- **Y** "Banco Real" sigue con 1500.00 BOB y todos sus asientos y registros de auditoría siguen existiendo

#### Scenario: Purga directa de un workspace real
- **CUANDO** se invoca directamente la purga física sobre "W1 Personal Demo"
- **ENTONCES** la base de datos la rechaza sin borrar ninguna fila

### Requirement: Carga de datos demo habilitable por entorno
La acción de carga DEBE (MUST) poder deshabilitarse por configuración de entorno; deshabilitada, la UI NO DEBE (MUST NOT) ofrecerla y la API DEBE (MUST) rechazarla con `DEMO_DATA_DISABLED`, mientras la limpieza de workspaces de demostración existentes DEBE (MUST) seguir disponible.
Trace: FR-IDENTITY-016 · Priority: Should

#### Scenario: Carga deshabilitada
- **CUANDO** la carga de datos de demostración está deshabilitada y el OWNER intenta cargarlos por la API
- **ENTONCES** se rechaza con `DEMO_DATA_DISABLED`
- **Y** la configuración del workspace no muestra "Cargar datos de demostración"

### Requirement: Auditoría de la carga y de la limpieza
Las acciones "Cargar datos de demostración" y "Limpiar datos de demostración" DEBEN (MUST) auditarse en el workspace real desde el que se originó la carga, con actor, instante y workspace de demostración afectado, y esa evidencia DEBE (MUST) sobrevivir a la purga.
Trace: FR-IDENTITY-015, FR-AUDIT-001, FR-AUDIT-005 · Priority: Must

#### Scenario: La evidencia sobrevive a la purga
- **CUANDO** el OWNER de "W1 Personal Demo" carga los datos de demostración, luego los limpia y la purga termina
- **ENTONCES** el historial de auditoría de "W1 Personal Demo" contiene la carga y la limpieza con su actor, instante e identificador del workspace de demostración

### Requirement: Suscripciones y compromisos recurrentes de demostración
La demo DEBE (MUST) incluir suscripciones en distintos estados, cadencias y monedas, con historial de precios, y definiciones recurrentes con historia de ocurrencias resueltas y al menos una ocurrencia atrasada, creadas por los casos de uso de los compromisos, de modo que el costo mensualizado, los próximos pagos y las ocurrencias por aprobar muestren cifras no triviales.
Trace: FR-IDENTITY-014, FR-COMMITMENTS-001, FR-COMMITMENTS-012, FR-COMMITMENTS-015 · Priority: Could

#### Scenario: Suscripciones de la demo al 2026-09-30
- **CUANDO** se cargan los datos de demostración con la fecha ancla 2026-09-30, cuyas tasas de cierre del 2026-09-29 son USD/BOB 7.00 y USDT/BOB 6.95 paralelas, y se consultan las suscripciones ese día
- **ENTONCES** hay 8 suscripciones: 5 activas ("StreamFlix Demo" 11.99 USD mensual, "NubeSegura Demo" 2.99 USD mensual, "Antivirus Escudo Demo" 39.99 USD anual, "VPN Cóndor Demo" 5.000000 USDT mensual y "Gimnasio Sajama Demo" 250.00 BOB mensual), 1 en trial, 1 pausada y 1 cancelada
- **Y** el historial de precios de "StreamFlix Demo" tiene 9.99 USD hasta 2025-10-02 y 11.99 USD desde 2025-10-03
- **Y** el costo total es 412.94 BOB al mes y 4955.25 BOB al año, y "Curso Kantuta Demo" en trial figura aparte con 105.00 BOB al mes

#### Scenario: Ocurrencia atrasada de la demo
- **CUANDO** se consultan las ocurrencias de la demo el 2026-09-30
- **ENTONCES** la ocurrencia "Internet Fibra Kantuta Demo" de 199.00 BOB del 2026-09-28 está por aprobar y atrasada
- **Y** las 6 definiciones recurrentes de la demo tienen resueltas todas sus ocurrencias anteriores al 2026-09-28

### Requirement: Tarjetas de crédito de demostración
La demo DEBE (MUST) incluir tarjetas de crédito con perfil de tarjeta, creadas por los casos de uso de las deudas: al menos una tarjeta bimoneda con una compra en cuotas, un estado de cuenta emitido sin vencer, uno pagado parcialmente y uno vencido sin cubrir el pago mínimo, y una tarjeta con pago administrado como compromiso.
Trace: FR-IDENTITY-014, FR-DEBT-012, FR-DEBT-013, FR-DEBT-016, FR-DEBT-017 · Priority: Could

#### Scenario: Tarjeta bimoneda con cuotas y un estado de cuenta vencido
- **CUANDO** se consulta el 2026-09-30 "Tarjeta Kantuta Demo" (cierre el día 18, vencimiento el día 8, mínimo del 5.00 % con piso de 50.00 BOB y de 10.00 USD), con la compra "Refrigerador" de 4800.00 BOB del 2026-07-25 en 6 cuotas sin interés, una compra de 320.50 BOB del 2026-08-10, una de 150.00 BOB del 2026-08-25, una de 200.00 USD del 2026-08-05 y un pago de 500.00 BOB del 2026-09-01
- **ENTONCES** el estado de cuenta en BOB cerrado el 2026-08-18 tiene saldo facturado 1120.50 BOB y pago mínimo 56.02 BOB y queda `PARTIALLY_PAID` con 620.50 BOB pendientes
- **Y** el estado de cuenta en USD cerrado el 2026-08-18 queda `OVERDUE` con 10.00 USD pendientes del pago mínimo
- **Y** el estado de cuenta en BOB cerrado el 2026-09-18 está `ISSUED` con saldo al cierre 4770.50 BOB, saldo facturado 1570.50 BOB, pago mínimo 78.52 BOB y vencimiento 2026-10-08
- **Y** el calendario de cargos futuros lista 800.00 BOB al 2026-11-08, 2026-12-08, 2027-01-08 y 2027-02-08

### Requirement: Metas de ahorro de demostración
La demo DEBE (MUST) incluir metas de ahorro creadas por los casos de uso de las metas, con aportes reales y reservas: al menos una meta con aporte mensual planificado y programado que va según el plan, una atrasada respecto del plan, una alcanzada y una cuenta que pasó por un episodio de sobre-asignación ya resuelto.
Trace: FR-IDENTITY-014, FR-GOALS-001, FR-GOALS-003, FR-GOALS-004, FR-GOALS-009 · Priority: Could

#### Scenario: Metas de la demo al 2026-09-30
- **CUANDO** se consultan las metas de la demo el 2026-09-30
- **ENTONCES** "Fondo de emergencia" (30000.00 BOB, del 2025-10-01 al 2027-05-31) tiene 18000.00 BOB aportados en 12 aportes de 1500.00 BOB, 60.00 % completado y estado `on-track` (+0.05 % sobre 17990.12 BOB esperados)
- **Y** "Viaje" (2000.00 USD, del 2026-04-01 al 2026-12-31) tiene 550.00 USD reservados y estado `behind` (−58.60 % sobre 1328.47 USD esperados), con 100.00 USD pendientes de su aporte planificado de 150.00 USD del periodo
- **Y** "Laptop" (8000.00 BOB) está `achieved` y "Regalos" tuvo un único episodio de sobre-asignación con faltante de 200.00 BOB que hoy está resuelto

### Requirement: Préstamos de demostración
La demo DEBE (MUST) incluir préstamos creados por los casos de uso de las deudas, con desembolso, pagos con su desglose y cronograma: al menos uno francés y uno alemán, uno con cuotas en mora, uno saldado y uno con un pago extraordinario registrado, en más de una moneda.
Trace: FR-IDENTITY-014, FR-DEBT-001, FR-DEBT-003, FR-DEBT-004, FR-DEBT-007, FR-DEBT-008 · Priority: Could

#### Scenario: Préstamos de la demo al 2026-09-30
- **CUANDO** se consultan los préstamos de la demo el 2026-09-30
- **ENTONCES** "Préstamo vehicular" (francés, 50000.00 BOB al 9.00 % anual, 36 cuotas de 1589.99 BOB) tiene la cuota 1 con interés 375.00 BOB y principal 1214.99 BOB, 19 cuotas pagadas, principal pendiente 25288.74 BOB y próxima cuota la 20 del 2026-10-01
- **Y** "Préstamo de consumo" (alemán, 12000.00 BOB al 12.00 % anual, 12 cuotas) tiene pagadas las cuotas de 1120.00, 1110.00, 1100.00 y 1090.00 BOB, principal pendiente 8000.00 BOB y en mora las cuotas de 1080.00 BOB del 2026-08-21 y de 1070.00 BOB del 2026-09-21
- **Y** "Préstamo familiar" (1000.00 BOB, 3 cuotas) está saldado
- **Y** "Crédito educativo" (francés, 12000.00 USD al 12.00 % anual, 12 cuotas de 1066.19 USD) tiene la versión 2 de su cronograma por un pago extraordinario de 3000.00 USD del 2026-04-10 reduciendo el plazo, principal pendiente 1007.15 USD y última cuota de 1017.22 USD el 2026-10-10

### Requirement: Resumen de deudas y disponible para gastar con la demo
Con los datos de demostración cargados, el resumen de deudas y el disponible para gastar DEBEN (MUST) mostrar cifras no triviales en más de una moneda, derivadas solo de los elementos de la demo y de sus tasas ficticias, sin ningún cálculo propio de la carga.
Trace: FR-IDENTITY-014, FR-DEBT-018, FR-PLANNING-024 · Priority: Could

#### Scenario: Resumen de deudas de la demo
- **CUANDO** se consulta el resumen de deudas de la demo el 2026-09-30 con la tasa de cierre USD/BOB 7.00
- **ENTONCES** el total adeudado en USD es 1207.15 USD (1007.15 del "Crédito educativo" y 200.00 de "Tarjeta Kantuta Demo") y su parte consolidada es 8450.05 BOB
- **Y** lista "Préstamo vehicular" con 25288.74 BOB, "Préstamo de consumo" con 8000.00 BOB y "Tarjeta Kantuta Demo" con 4770.50 BOB, y no lista "Préstamo familiar"
- **Y** el interés pagado en 2026 es 2596.98 BOB y 536.67 USD, del que 2166.91 BOB corresponden a "Préstamo vehicular" y 420.00 BOB a "Préstamo de consumo"
- **Y** la fecha estimada libre de deudas es 2028-02-01

#### Scenario: Disponible para gastar de la demo
- **CUANDO** se consulta el disponible para gastar de la demo el 2026-09-30, en el periodo de septiembre de 2026
- **ENTONCES** el término comprometido en BOB es 2349.00 BOB (cuotas en mora de 1080.00 y 1070.00 BOB y la ocurrencia atrasada de 199.00 BOB)
- **Y** el término reservado para metas es 26500.00 BOB y 550.00 USD, y el de aportes planificados es 100.00 USD
