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
Los datos de demostración DEBEN (MUST) usar solo instituciones, comercios y personas ficticios con apariencia real, sin números de cuenta reales, y DEBEN (MUST) generarse de forma determinista desde el dataset versionado y la fecha ancla, por los mismos casos de uso que la operación real, de modo que todas las invariantes del ledger se cumplan.
Trace: FR-IDENTITY-014, FR-LEDGER-001 · Priority: Must

#### Scenario: Dos cargas con la misma ancla producen los mismos saldos
- **CUANDO** se cargan dos veces los datos de demostración con la versión de dataset 1 y la fecha ancla 2026-09-30, en dos workspaces de demostración distintos
- **ENTONCES** ambos workspaces tienen las mismas cuentas con los mismos saldos por moneda, iguales al resumen de referencia del dataset
- **Y** en ambos los movimientos de cada asiento suman 0.00 por moneda

#### Scenario: Instituciones ficticias
- **CUANDO** se cargan los datos de demostración
- **ENTONCES** las instituciones tienen nombres ficticios como "Banco Andino Demo" y los identificadores de cuenta llevan el prefijo `DEMO-`

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
Tras la limpieza, el sistema DEBE (MUST) purgar físicamente todos los datos del workspace de demostración (cuentas, ledger, transacciones, tasas, clasificación, auditoría, eventos pendientes y datos derivados), conservar solo una lápida sin datos de negocio y un registro de la purga con las filas eliminadas por tabla.
Trace: FR-IDENTITY-015, NFR-DATA-012 · Priority: Must

#### Scenario: No queda ningún dato del workspace demo
- **CUANDO** la purga del workspace de demostración termina
- **ENTONCES** no existe ninguna fila de negocio, de auditoría, de eventos ni derivada con su identificador de workspace
- **Y** existe un registro de purga con el instante y la cantidad de filas eliminadas por tabla

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
