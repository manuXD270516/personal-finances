## ADDED Requirements

### Requirement: Tema según la preferencia del sistema
Sin una preferencia de tema guardada, o con la preferencia «Sistema», toda página de la aplicación, incluidas las públicas de inicio de sesión y de error, DEBE (MUST) mostrarse con el esquema de color claro u oscuro que indique el sistema operativo o el navegador, y DEBE (MUST) pasar al otro esquema sin recargar cuando el sistema cambia. Los controles nativos (casillas, listas y barras de desplazamiento) DEBEN (MUST) acompañar el esquema vigente.
Trace: NFR-USAB-103, NFR-USAB-005 · Priority: Should

#### Scenario: Sistema en oscuro sin preferencia guardada
- **CUANDO** el sistema está en modo oscuro, el OWNER no guardó ninguna preferencia de tema y abre Inicio
- **ENTONCES** la página se muestra con fondo oscuro y texto claro
- **Y** las casillas y las listas desplegables también se muestran en oscuro

#### Scenario: El sistema cambia con la página abierta
- **CUANDO** con Transacciones abierta y la preferencia «Sistema», el sistema pasa de claro a oscuro
- **ENTONCES** la página pasa a oscuro sin recargarse y sin perder lo escrito en el filtro de búsqueda

#### Scenario: Página pública en oscuro
- **CUANDO** una persona sin sesión, con el sistema en oscuro, abre la página de error de inicio de sesión
- **ENTONCES** la página se muestra en oscuro

### Requirement: Preferencia de tema en Preferencias
El usuario autenticado, con cualquier rol, DEBE (MUST) poder elegir en Preferencias el tema «Sistema», «Claro» u «Oscuro». La elección DEBE (MUST) guardarse en su perfil, aplicarse en la página abierta sin recargar y valer en todos sus workspaces y dispositivos. La barra superior NO DEBE (MUST NOT) tener un control de tema. Guardar las preferencias sin cambiar el tema NO DEBE (MUST NOT) escribir el tema en el perfil.
Trace: FR-IDENTITY-003, NFR-USAB-103 · Priority: Should

#### Scenario: Elegir el tema oscuro
- **CUANDO** con el sistema en claro el EDITOR elige «Oscuro» en Preferencias y guarda
- **ENTONCES** la página pasa a oscuro sin recargarse
- **Y** su perfil guarda el tema «Oscuro» con una versión nueva y queda un registro de auditoría del cambio de preferencias

#### Scenario: Volver a seguir al sistema
- **CUANDO** con el tema «Oscuro» guardado y el sistema en claro, el EDITOR elige «Sistema» y guarda
- **ENTONCES** la página pasa a claro y desde entonces sigue al sistema

#### Scenario: Sin control de tema en la barra superior
- **CUANDO** un EDITOR recorre Inicio, Transacciones y Presupuestos
- **ENTONCES** la barra superior no ofrece ningún control para cambiar el tema

#### Scenario: El VIEWER también elige su tema
- **CUANDO** un VIEWER del workspace elige «Claro» en Preferencias y guarda
- **ENTONCES** el tema se guarda en su perfil y la página se muestra en claro

#### Scenario: Guardar sin cambiar el tema
- **CUANDO** con el tema «Claro» guardado el usuario cambia solo su zona horaria a "America/Sao_Paulo" y guarda
- **ENTONCES** el perfil guarda la zona horaria y el tema sigue en «Claro», sin un segundo guardado por el tema

### Requirement: Tema aplicado desde la primera pintura
Con una preferencia «Claro» u «Oscuro», el documento que entrega el servidor DEBE (MUST) declarar ese tema, de modo que la primera pintura de cada página ya use el esquema elegido, sin un destello del otro esquema. El tema NO DEBE (MUST NOT) aplicarse con scripts en línea ni relajando la política de seguridad de contenido. Si la preferencia del perfil difiere de la que recuerda el navegador, la página DEBE (MUST) pasar al tema del perfil en cuanto lo lee, y los documentos siguientes DEBEN (MUST) salir con ese tema desde la primera pintura.
Trace: NFR-USAB-103, NFR-SEC-008 · Priority: Should

#### Scenario: Claro elegido con el sistema en oscuro
- **CUANDO** el sistema está en oscuro, el perfil del OWNER tiene el tema «Claro» y abre Reportes
- **ENTONCES** el documento que entrega el servidor ya declara el tema claro y el esquema claro
- **Y** la primera captura de la página, tomada al terminar de cargar el documento, es clara

#### Scenario: Sin violaciones de la política de seguridad de contenido
- **CUANDO** el OWNER recorre Inicio, Transacciones, Reportes y Preferencias con el tema «Oscuro»
- **ENTONCES** no se registra ninguna violación de la política de seguridad de contenido y la página no tiene scripts en línea sin nonce

#### Scenario: Tema cambiado en otro dispositivo
- **CUANDO** el OWNER eligió «Oscuro» en otro dispositivo y abre Inicio en un navegador con sesión abierta que recuerda «Claro»
- **ENTONCES** la página pasa a oscuro al leer su perfil
- **Y** la siguiente página que abre sale en oscuro desde la primera pintura

### Requirement: Tema recordado al iniciar sesión
Al completar el inicio de sesión, el sistema DEBE (MUST) dejar en el navegador una marca no sensible con el tema guardado en el perfil (claro u oscuro), o quitar la marca si el perfil dice «Sistema» o no tiene tema, sin una consulta adicional al perfil. La marca DEBE (MUST) admitir solo los valores claro y oscuro y NO DEBE (MUST NOT) contener identificadores del usuario o de la sesión ni tokens.
Trace: FR-IDENTITY-001, NFR-SEC-001, NFR-USAB-103 · Priority: Should

#### Scenario: Inicio de sesión con el tema oscuro guardado
- **CUANDO** el OWNER, con el tema «Oscuro» en su perfil, inicia sesión en un navegador que nunca usó
- **ENTONCES** la primera página después del inicio de sesión sale en oscuro desde la primera pintura
- **Y** la marca del tema dice oscuro y no contiene ningún identificador ni token

#### Scenario: Inicio de sesión con «Sistema» tras otro usuario
- **CUANDO** en un navegador cuya marca del tema dice claro inicia sesión un EDITOR con el tema «Sistema»
- **ENTONCES** la marca del tema se quita y la página sigue al sistema

### Requirement: Contraste en los temas claro y oscuro
En los dos temas, el texto DEBE (MUST) tener un contraste de al menos 4.5:1 con su fondo (3:1 el texto grande), y los bordes de los controles, el indicador de foco y los elementos de los gráficos de al menos 3:1. El análisis automático de accesibilidad de las pantallas principales en tema oscuro NO DEBE (MUST NOT) informar violaciones serias ni críticas.
Trace: NFR-USAB-103, NFR-USAB-101 · Priority: Must

#### Scenario: Pares de colores del tema
- **CUANDO** se calcula el contraste de los pares de colores del tema (texto y texto atenuado sobre cada superficie, borde de control sobre la superficie elevada, foco sobre la superficie y cada color financiero sobre la superficie) en claro y en oscuro
- **ENTONCES** todos los pares alcanzan su umbral

#### Scenario: Análisis de accesibilidad en oscuro
- **CUANDO** se analizan con el esquema oscuro Inicio, Transacciones, el alta, el detalle de un gasto de 60.00 BOB, Presupuestos, Reportes, el recorrido de una transacción y Preferencias
- **ENTONCES** el análisis no informa violaciones serias ni críticas

### Requirement: Colores de la interfaz solo desde el tema
Todo color de la interfaz, incluidos los gráficos, el diagrama de recorrido, las tarjetas del Home y los indicadores de categoría, DEBE (MUST) salir de los colores del tema vigente. NO DEBE (MUST NOT) quedar ningún color fijo en los componentes ni en sus hojas de estilo que ignore el tema. Los estados que hoy se distinguen por color DEBEN (MUST) seguir distinguiéndose también por texto o forma en los dos temas.
Trace: NFR-USAB-103, NFR-USAB-104 · Priority: Should

#### Scenario: Home en oscuro
- **CUANDO** el OWNER abre Inicio con el tema «Oscuro» y un gasto de 245.30 BOB en el mes
- **ENTONCES** las tarjetas, las barras y los montos del Home usan las superficies y los colores del tema oscuro, sin ninguna tarjeta con fondo blanco

#### Scenario: Recorrido en oscuro
- **CUANDO** el OWNER abre el recorrido de un gasto anulado con el tema «Oscuro»
- **ENTONCES** los estados recorrido, actual y no alcanzado se distinguen con un contraste de al menos 3:1 sobre el fondo y con su texto

#### Scenario: Sin colores fijos fuera del tema
- **CUANDO** se revisan los componentes y las hojas de estilo de la interfaz
- **ENTONCES** ningún color literal aparece fuera de la hoja que define los colores del tema

### Requirement: Barra del navegador acorde al tema
Cada página DEBE (MUST) indicar al navegador el esquema de color y el color de su barra según el tema vigente: con «Sistema», un color por esquema; con «Claro» u «Oscuro», el del tema elegido. La indicación DEBE (MUST) salir en el documento que entrega el servidor, sin scripts en línea.
Trace: NFR-USAB-103, NFR-SEC-008 · Priority: Could

#### Scenario: Tema oscuro elegido
- **CUANDO** el OWNER con el tema «Oscuro» abre Transacciones
- **ENTONCES** el documento declara el esquema oscuro y un color de barra igual al fondo oscuro

#### Scenario: Tema del sistema
- **CUANDO** el OWNER con el tema «Sistema» abre Transacciones
- **ENTONCES** el documento declara los esquemas claro y oscuro y un color de barra para cada uno

### Requirement: Impresión en esquema claro
Al imprimir cualquier página, la salida DEBE (MUST) usar el esquema claro, con fondo claro y texto oscuro, sea cual sea el tema vigente.
Trace: NFR-USAB-103 · Priority: Could

#### Scenario: Imprimir un reporte con el tema oscuro
- **CUANDO** el OWNER, con el tema «Oscuro», imprime el reporte de gastos por categoría
- **ENTONCES** la impresión sale con fondo claro y texto oscuro
