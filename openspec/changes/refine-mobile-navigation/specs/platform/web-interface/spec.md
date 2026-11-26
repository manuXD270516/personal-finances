## ADDED Requirements

### Requirement: Barra de navegación inferior en pantallas angostas
Por debajo de 768 px de ancho, toda página autenticada DEBE (MUST) mostrar una barra inferior fija con los destinos Inicio, Transacciones, «＋ Registrar», Plan y Más, en ese orden, con texto visible, un objetivo táctil de al menos 44 × 44 px por destino y la sección actual marcada para las tecnologías de asistencia. Quien solo puede ver en el workspace NO DEBE (MUST NOT) ver «＋ Registrar». «＋ Registrar» DEBE (MUST) abrir el alta de transacción. Si la sección actual está dentro de «Más», «Más» DEBE (MUST) indicarlo con una marca visible y en su nombre accesible. Desde 768 px la barra inferior NO DEBE (MUST NOT) mostrarse.
Trace: NFR-USAB-006, NFR-USAB-106, NFR-USAB-102 · Priority: Should

#### Scenario: EDITOR en el teléfono
- **CUANDO** un EDITOR abre Presupuestos con un ancho de 360 px
- **ENTONCES** la barra inferior muestra Inicio, Transacciones, «＋ Registrar», Plan y Más, en ese orden, con Plan marcado como la sección actual
- **Y** cada destino mide al menos 44 × 44 px y la página no se desplaza a lo ancho

#### Scenario: VIEWER en el teléfono
- **CUANDO** un VIEWER abre Transacciones con un ancho de 360 px
- **ENTONCES** la barra inferior muestra Inicio, Transacciones, Plan y Más, sin «＋ Registrar»

#### Scenario: Escritorio sin barra inferior
- **CUANDO** el OWNER abre Inicio con un ancho de 1280 px
- **ENTONCES** no hay barra inferior y la navegación está en la barra lateral

#### Scenario: Registrar desde la barra inferior
- **CUANDO** un EDITOR, a 360 px en Inicio, activa «＋ Registrar»
- **ENTONCES** se abre el alta de transacción con el foco en el monto

#### Scenario: Sección actual dentro de «Más»
- **CUANDO** el OWNER abre Reportes con un ancho de 360 px
- **ENTONCES** «Más» muestra la marca de sección actual y su nombre accesible incluye "Reportes"

### Requirement: Cajón «Más» con las secciones agrupadas
«Más» DEBE (MUST) abrir un cajón modal con nombre que lista las demás secciones habilitadas, agrupadas bajo los encabezados Día a día, Planificar, Analizar, Organizar y Ajustes, con la sección actual marcada. Mientras está abierto, el resto de la página NO DEBE (MUST NOT) ser alcanzable con el teclado ni con el puntero. Escape, el botón «Cerrar» o un toque fuera del cajón DEBEN (MUST) cerrarlo y devolver el foco a «Más». Elegir una sección DEBE (MUST) abrirla y no dejar el cajón abierto. El cajón NO DEBE (MUST NOT) tener violaciones serias ni críticas de accesibilidad.
Trace: NFR-USAB-102, NFR-USAB-101, NFR-USAB-006 · Priority: Should

#### Scenario: Abrir el cajón
- **CUANDO** el OWNER, a 360 px en Inicio, activa «Más»
- **ENTONCES** se abre un cajón modal con nombre, con los grupos Día a día, Planificar, Analizar, Organizar y Ajustes y sus secciones
- **Y** con Tab el foco no sale del cajón y el análisis de accesibilidad no informa violaciones serias ni críticas

#### Scenario: Cerrar con Escape
- **CUANDO** con el cajón abierto el OWNER pulsa Escape
- **ENTONCES** el cajón se cierra y el foco vuelve a «Más»

#### Scenario: Ir a una sección desde el cajón
- **CUANDO** con el cajón abierto el OWNER elige Reportes
- **ENTONCES** se abre Reportes y el cajón queda cerrado

### Requirement: Secciones agrupadas en la barra lateral
Desde 768 px, la barra lateral DEBE (MUST) mostrar las secciones habilitadas con los mismos grupos y encabezados que el cajón «Más», empezando por Día a día, y la navegación DEBE (MUST) seguir siendo un punto de referencia con nombre.
Trace: NFR-USAB-102, NFR-USAB-101 · Priority: Should

#### Scenario: Barra lateral agrupada
- **CUANDO** el OWNER abre Inicio con un ancho de 1280 px
- **ENTONCES** la barra lateral muestra los encabezados Día a día, Planificar, Analizar, Organizar y Ajustes, en ese orden
- **Y** Transacciones aparece bajo Día a día y Reportes bajo Analizar

### Requirement: Alto de pantalla dinámico y áreas seguras
El marco de la aplicación DEBE (MUST) ocupar el alto visible real de la pantalla aunque cambie el tamaño de la barra del navegador. La barra inferior DEBE (MUST) quedar por encima del área que el sistema reserva para gestos o para la muesca. Un elemento con foco NO DEBE (MUST NOT) quedar tapado, ni siquiera en parte, por la barra inferior ni por la superior.
Trace: NFR-USAB-006, NFR-USAB-102 · Priority: Should

#### Scenario: Foco no tapado por la barra inferior
- **CUANDO** a 360 × 640 px el OWNER recorre con Tab la lista de Transacciones hasta los enlaces del final de la pantalla
- **ENTONCES** cada elemento que recibe el foco queda entero por encima de la barra inferior

#### Scenario: Cambio del alto visible
- **CUANDO** con Inicio abierto a 360 px el alto visible pasa de 640 a 720 px
- **ENTONCES** el marco se ajusta al nuevo alto, sin franja vacía y sin desplazamiento extra

#### Scenario: Área segura inferior
- **CUANDO** se abre cualquier página autenticada en un teléfono con área de gestos
- **ENTONCES** la página declara que ocupa toda la pantalla y la barra inferior deja libre el área segura inferior

### Requirement: Barra inferior oculta mientras se escribe
La barra inferior NO DEBE (MUST NOT) mostrarse mientras un campo de texto, una lista desplegable o un área de texto tiene el foco, ni en la página de alta de transacción. DEBE (MUST) volver a mostrarse cuando el foco sale del campo.
Trace: NFR-USAB-006, NFR-USAB-007 · Priority: Should

#### Scenario: Escribir en la búsqueda
- **CUANDO** a 360 px el OWNER enfoca la búsqueda de Transacciones
- **ENTONCES** la barra inferior no se muestra
- **Y** al salir de la búsqueda la barra inferior vuelve a mostrarse

#### Scenario: Página de alta
- **CUANDO** a 360 px un EDITOR abre el alta de transacción
- **ENTONCES** la barra inferior no se muestra en ningún momento y la acción de registrar es la del formulario

### Requirement: Barra superior de una fila en pantallas angostas
Por debajo de 640 px, la barra superior DEBE (MUST) ocupar una sola fila. El selector de workspace NO DEBE (MUST NOT) ocupar una fila propia y DEBE (MUST) quedar accesible en el cajón «Más», donde cambiar de workspace funciona igual que hoy.
Trace: NFR-USAB-006 · Priority: Could

#### Scenario: Barra superior a 360 px
- **CUANDO** el OWNER, con dos workspaces, abre Inicio con un ancho de 360 px
- **ENTONCES** la barra superior ocupa una sola fila y no muestra el selector de workspace

#### Scenario: Cambiar de workspace desde «Más»
- **CUANDO** a 360 px el OWNER abre «Más» y elige el workspace "W2 Other Demo"
- **ENTONCES** la aplicación pasa a "W2 Other Demo" como con el selector de escritorio

### Requirement: Menú de usuario con cierre nativo
El menú de usuario DEBE (MUST) cerrarse con Escape y con un clic o toque fuera de él; al cerrarse con Escape DEBE (MUST) devolver el foco al botón que lo abrió. Sus opciones no cambian.
Trace: NFR-USAB-102 · Priority: Could

#### Scenario: Cerrar el menú con Escape
- **CUANDO** el OWNER abre el menú de usuario y pulsa Escape
- **ENTONCES** el menú se cierra y el foco vuelve al botón del menú

#### Scenario: Cerrar el menú con un clic fuera
- **CUANDO** con el menú de usuario abierto el OWNER hace clic en el contenido de la página
- **ENTONCES** el menú se cierra

### Requirement: Entrada y salida suaves de la capa superior
Sin preferencia de movimiento reducido, el cajón «Más», el diálogo de confirmación y los avisos DEBEN (MUST) entrar y salir con una transición de opacidad o desplazamiento de 200 ms como máximo. Con movimiento reducido NO DEBEN (MUST NOT) desplazarse al entrar ni al salir. Si el navegador no admite la transición, DEBEN (MUST) aparecer y desaparecer sin animación y seguir operables.
Trace: NFR-USAB-107 · Priority: Could

#### Scenario: Cajón sin preferencia de movimiento
- **CUANDO** sin preferencia de movimiento reducido el OWNER abre «Más» a 360 px
- **ENTONCES** el cajón entra con una transición de opacidad y desplazamiento de 200 ms como máximo

#### Scenario: Cajón con movimiento reducido
- **CUANDO** con movimiento reducido el OWNER abre y cierra «Más»
- **ENTONCES** el cajón aparece y desaparece sin desplazarse
