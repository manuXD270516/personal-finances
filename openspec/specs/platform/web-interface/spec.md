# platform/web-interface Specification

## Purpose
Define el comportamiento transversal de la interfaz web: accesibilidad (foco, errores, diálogos, movimiento reducido), alta rápida de transacciones, tema claro y oscuro, tablas de datos y cobertura de navegadores (WebKit), de modo que toda vista cumpla un mismo contrato verificable.

## Requirements

### Requirement: Foco al primer campo inválido tras un envío fallido
Todo formulario de la interfaz que valida antes de enviar DEBE (MUST), tras un envío rechazado por la validación, mover el foco al primer campo inválido según el orden visual del formulario, mostrar junto a cada campo inválido su mensaje y marcarlo como inválido para las tecnologías de asistencia, con el mensaje asociado al campo. El mensaje de error del campo NO DEBE (MUST NOT) ser una región viva, para que no se anuncie dos veces. El foco NO DEBE (MUST NOT) quedar en el botón de envío.
Trace: NFR-USAB-101, NFR-USAB-102, NFR-USAB-009 · Priority: Must

#### Scenario: Gasto sin monto ni cuenta
- **CUANDO** el usuario envía el formulario de gasto sin monto y sin cuenta
- **ENTONCES** el foco queda en el primero de esos dos campos según el orden visual
- **Y** ambos campos muestran su mensaje, quedan marcados como inválidos y el mensaje se anuncia al enfocar el campo

#### Scenario: Transferencia con la misma cuenta de origen y destino
- **CUANDO** el usuario envía una transferencia de 100.00 BOB con "Banco BOB" como origen y como destino
- **ENTONCES** el foco queda en el campo de destino con el mensaje de cuentas iguales
- **Y** no se envía ninguna solicitud de registro

### Requirement: Resumen de errores en formularios largos
Los formularios largos (alta y edición de préstamo, alta y edición de tarjeta y mapeo de columnas del import) DEBEN (MUST), tras un envío rechazado por la validación, mostrar al inicio del formulario un resumen con la cantidad de errores y un enlace por campo inválido, y mover el foco al resumen. Activar un enlace del resumen DEBE (MUST) llevar el foco al campo correspondiente.
Trace: NFR-USAB-101, NFR-USAB-102 · Priority: Must

#### Scenario: Alta de préstamo con tres errores
- **CUANDO** el usuario envía el alta de un préstamo sin monto, sin tasa y sin fecha de inicio
- **ENTONCES** al inicio del formulario aparece el resumen "Hay 3 errores" con un enlace por cada campo y el foco queda en el resumen

#### Scenario: Ir al campo desde el resumen
- **CUANDO** el usuario activa el enlace "Tasa" del resumen
- **ENTONCES** el foco queda en el campo de la tasa, que muestra su mensaje

### Requirement: Validación de montos al salir del campo
Los campos de monto de los formularios de transacción, transferencia y conversión DEBEN (MUST) validar formato y escala de la moneda al salir del campo y mostrar el mensaje sin esperar al envío; mientras el usuario corrige, el mensaje DEBE (MUST) desaparecer en cuanto el valor es válido, y el estado visual y el estado para las tecnologías de asistencia DEBEN (MUST) coincidir. Un campo obligatorio vacío que el usuario no modificó NO DEBE (MUST NOT) mostrar error al salir; el error de obligatorio aparece al enviar.
Trace: NFR-USAB-003, NFR-USAB-101 · Priority: Should

#### Scenario: Escala de USDT al salir del campo
- **CUANDO** el usuario escribe "10.1234567" en el monto de un gasto en una cuenta USDT y sale del campo
- **ENTONCES** el campo muestra "USDT admite hasta 6 decimales" y queda marcado como inválido, sin que se haya enviado el formulario

#### Scenario: Corrección mientras escribe
- **CUANDO** con ese error visible el usuario borra el último dígito y el monto queda en 10.123456 USDT
- **ENTONCES** el mensaje desaparece y el campo deja de estar marcado como inválido

#### Scenario: Campo obligatorio sin tocar
- **CUANDO** el usuario entra al monto vacío y sale con Tab sin escribir
- **ENTONCES** el campo no muestra ningún error hasta que se envía el formulario

### Requirement: Confirmación de acciones irreversibles en un diálogo modal
Las acciones irreversibles o con efecto contable (anular, revertir un import, reabrir un periodo, eliminar, archivar, descartar, revocar, cancelar o terminar un plan, una meta, una suscripción o una recurrencia) DEBEN (MUST) confirmarse en un diálogo modal con rol de diálogo de alerta y nombre igual a su título. Al abrirse, el foco DEBE (MUST) quedar en "Cancelar", que DEBE (MUST) preceder a la acción de confirmar en el orden de tabulación, y el resto de la página NO DEBE (MUST NOT) ser alcanzable con el teclado ni con el puntero. Escape o "Cancelar" DEBEN (MUST) cerrarlo sin ejecutar la acción y devolver el foco al control que lo abrió. El diálogo NO DEBE (MUST NOT) tener violaciones serias ni críticas de accesibilidad.
Trace: NFR-USAB-101, NFR-USAB-102, NFR-USAB-108 · Priority: Must

#### Scenario: Anular un gasto
- **CUANDO** el usuario pulsa "Anular" en el detalle de un gasto posteado de 60.00 BOB en "Banco BOB"
- **ENTONCES** se abre un diálogo modal de alerta con el título de la anulación, el foco queda en "Cancelar" y la página de fondo no recibe el foco con Tab
- **Y** el análisis de accesibilidad no informa violaciones serias ni críticas

#### Scenario: Cancelar con Escape
- **CUANDO** con ese diálogo abierto el usuario pulsa Escape
- **ENTONCES** el diálogo se cierra, el foco vuelve al botón "Anular" y el gasto sigue posteado con el saldo de "Banco BOB" en 940.00 BOB

#### Scenario: Revertir un import
- **CUANDO** el usuario pulsa "Revertir" en un import aplicado
- **ENTONCES** la confirmación se abre como diálogo modal de alerta con el foco en "Cancelar"
- **Y** confirmar ejecuta la reversión con las mismas reglas de siempre

### Requirement: Confirmaciones en línea que devuelven el foco
Las confirmaciones de acciones reversibles que se muestran en línea (pausar o reanudar una suscripción o una recurrencia, aprobar, omitir, vincular o editar una ocurrencia, solicitar una exportación, cargar los datos de demostración) DEBEN (MUST) poner el foco inicial en la acción segura, ordenar "Cancelar" antes de la acción de confirmar y, al cancelar, devolver el foco al control que las abrió.
Trace: NFR-USAB-102 · Priority: Must

#### Scenario: Cancelar la pausa de una suscripción
- **CUANDO** el usuario pulsa "Pausar" en una suscripción activa y luego "Cancelar" en la confirmación en línea
- **ENTONCES** la confirmación desaparece, el foco vuelve al botón "Pausar" y la suscripción sigue activa

### Requirement: Movimiento reducido declarado por componente
Cada animación o transición de la interfaz DEBE (MUST) declarar junto a su regla su comportamiento con la preferencia de movimiento reducido: con la preferencia activa, NO DEBE (MUST NOT) desplazar, escalar ni girar elementos, y PUEDE reducirse a un cambio de opacidad. Las animaciones DEBEN (MUST) limitarse a opacidad y transformación. NO DEBE (MUST NOT) existir una anulación global que fuerce duraciones mínimas a todos los elementos.
Trace: NFR-USAB-107 · Priority: Must

#### Scenario: Preferencia de menos movimiento
- **CUANDO** el usuario con la preferencia de movimiento reducido abre el Home mientras sus tarjetas cargan
- **ENTONCES** los esqueletos de carga no tienen animación de desplazamiento

#### Scenario: Sin preferencia de movimiento
- **CUANDO** el usuario sin esa preferencia abre el Home mientras sus tarjetas cargan
- **ENTONCES** los esqueletos de carga muestran su animación

#### Scenario: Revisión de las hojas de estilo
- **CUANDO** se analizan las hojas de estilo de la interfaz
- **ENTONCES** no existe una regla universal que fuerce duraciones de animación o de transición
- **Y** toda animación o transición declarada queda dentro de una consulta de preferencia de movimiento o anima solo opacidad

### Requirement: Sección actual visible en colores forzados
El ítem de la navegación que corresponde a la página actual DEBE (MUST) distinguirse con un borde o un contorno visibles también en modo de colores forzados, sin depender solo del fondo ni de sombras.
Trace: NFR-USAB-101, NFR-USAB-104 · Priority: Should

#### Scenario: Alto contraste de Windows
- **CUANDO** el usuario abre "Transacciones" con colores forzados activos
- **ENTONCES** el ítem "Transacciones" de la navegación tiene un borde visible que los demás ítems no tienen

### Requirement: Pestañas en una sola fila
Los grupos de pestañas DEBEN (MUST) mostrarse en una sola fila con desplazamiento horizontal cuando no entran, sin cambiar el ancho de una pestaña al seleccionarla, y con la pestaña seleccionada indicada por un borde además del texto. La navegación con flechas, Inicio y Fin DEBE (MUST) mantenerse y la pestaña enfocada DEBE (MUST) quedar visible.
Trace: NFR-USAB-006, NFR-USAB-102 · Priority: Should

#### Scenario: Detalle de préstamo en el teléfono
- **CUANDO** el usuario abre el detalle de un préstamo con una ventana de 360 px de ancho
- **ENTONCES** las pestañas ocupan una sola fila con desplazamiento horizontal
- **Y** seleccionar otra pestaña no cambia el ancho de ninguna

#### Scenario: Pestaña fuera de la vista con el teclado
- **CUANDO** el usuario pulsa Fin en la fila de pestañas con 360 px de ancho
- **ENTONCES** la última pestaña queda seleccionada, enfocada y visible

### Requirement: Enter durante la composición de texto
Los campos que ejecutan una acción al pulsar Enter NO DEBEN (MUST NOT) ejecutarla mientras hay una composición de texto en curso (método de entrada o tecla muerta).
Trace: NFR-USAB-001, NFR-USAB-102 · Priority: Could

#### Scenario: Búsqueda de transacción para vincular una ocurrencia
- **CUANDO** el usuario compone "café" con una tecla muerta en el buscador del panel de vincular y pulsa Enter para confirmar la composición
- **ENTONCES** no se dispara la búsqueda
- **Y** un segundo Enter, ya sin composición, busca "café"

### Requirement: Cobertura de la interfaz en WebKit
La suite E2E que corre en cada pull request DEBE (MUST) ejecutar en el motor WebKit un subconjunto de los flujos críticos (marco de la aplicación, accesibilidad, transacciones, inicio de sesión y política de seguridad de contenido), además de la ejecución completa en Chromium. La sesión en WebKit DEBE (MUST) usar la cookie de sesión con los mismos atributos que en producción; NO DEBE (MUST NOT) relajarse ningún atributo solo para las pruebas sin una decisión del owner.
Trace: NFR-USAB-005, NFR-SEC-001 · Priority: Should

#### Scenario: Subconjunto en WebKit en cada pull request
- **CUANDO** corre el job de E2E de un pull request
- **ENTONCES** los specs del marco, accesibilidad, transacciones, inicio de sesión y política de contenido corren también en WebKit y el job termina dentro de su límite de tiempo

#### Scenario: Inicio de sesión en WebKit con la cookie de producción
- **CUANDO** el usuario de prueba inicia sesión en WebKit contra el stack de E2E
- **ENTONCES** la sesión persiste entre páginas con la cookie de sesión `Secure`, `HttpOnly` y con prefijo de host
- **Y** ningún atributo de la cookie difiere del de producción

### Requirement: Región de avisos de la sesión
La aplicación DEBE (MUST) tener una única región de avisos con nombre accesible, presente en todas las páginas autenticadas. Un aviso DEBE (MUST) permanecer visible hasta que el usuario lo cierre, active una acción que navega o lleguen tres avisos más recientes; NO DEBE (MUST NOT) desaparecer por tiempo. Mostrar un aviso NO DEBE (MUST NOT) mover el foco, y cada aviso DEBE (MUST) anunciarse una sola vez a las tecnologías de asistencia en el idioma de la interfaz y tener un botón "Cerrar" enfocable. Los avisos NO DEBEN (MUST NOT) conservarse al recargar o al cambiar de página.
Trace: NFR-USAB-101, NFR-USAB-102, NFR-USAB-108, NFR-USAB-001 · Priority: Must

#### Scenario: Aviso persistente sin robar el foco
- **CUANDO** el EDITOR registra un gasto de 45.00 BOB desde el alta y espera 5 minutos
- **ENTONCES** el aviso sigue visible y el foco sigue en el monto del formulario
- **Y** al pulsar "Cerrar" del aviso, el aviso desaparece

#### Scenario: Anuncio en el idioma de la interfaz
- **CUANDO** el usuario con la interfaz en inglés registra un gasto de 45.00 BOB
- **ENTONCES** el aviso se anuncia una sola vez con el texto del catálogo en inglés

#### Scenario: Recarga de la página
- **CUANDO** con un aviso de registro visible el usuario recarga la página
- **ENTONCES** la región de avisos está vacía

#### Scenario: Cuarto aviso
- **CUANDO** el EDITOR registra cuatro gastos seguidos de 10.00 BOB, 20.00 BOB, 30.00 BOB y 40.00 BOB sin cerrar los avisos
- **ENTONCES** la región muestra los avisos de 20.00 BOB, 30.00 BOB y 40.00 BOB

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

### Requirement: Tablas desplazables con nombre y alcanzables por teclado
Toda tabla de datos de la interfaz DEBE (MUST) estar dentro de una región cuyo nombre es el título de la tabla. Cuando el contenido de la tabla no entra a lo ancho o a lo alto, la región DEBE (MUST) poder recibir el foco con el teclado y desplazarse con las flechas. El análisis automático de accesibilidad NO DEBE (MUST NOT) informar regiones desplazables inalcanzables con el teclado.
Trace: NFR-USAB-102, NFR-USAB-101 · Priority: Must

#### Scenario: Cronograma de un préstamo en el teléfono
- **CUANDO** a 360 px el OWNER abre el cronograma de un préstamo de 12000.00 BOB a 36 cuotas
- **ENTONCES** la tabla está en una región con el nombre de su título, que recibe el foco con Tab
- **Y** con la flecha derecha la región se desplaza a lo ancho

#### Scenario: Todas las tablas pasan por la región común
- **CUANDO** se revisan los componentes de la interfaz que dibujan tablas de datos
- **ENTONCES** todas las tablas están dentro de la región común con nombre y ninguna usa un envoltorio propio

#### Scenario: Análisis de accesibilidad de las tablas
- **CUANDO** se analizan a 360 px Transacciones, Presupuestos, un reporte, el cronograma de un préstamo y la vista previa de un import
- **ENTONCES** el análisis no informa regiones desplazables inalcanzables ni otras violaciones serias o críticas

### Requirement: Cabecera fija en tablas de mucho volumen
Las tablas de mucho volumen, al menos la vista previa de un import, el cronograma de un préstamo y los cargos de un estado de cuenta de tarjeta, DEBEN (MUST) tener un alto máximo con desplazamiento propio y mantener visible su fila de encabezados, alineada con las columnas y con fondo opaco, mientras se desplazan. Las demás tablas NO DEBEN (MUST NOT) tener desplazamiento vertical propio.
Trace: NFR-USAB-006, NFR-USAB-101 · Priority: Should

#### Scenario: Vista previa con 200 filas
- **CUANDO** el OWNER desplaza la vista previa de un import de 200 filas hasta la fila 150
- **ENTONCES** los encabezados Fecha, Descripción y Monto siguen visibles en el borde superior de la tabla, alineados con sus columnas, y las filas no se ven a través de ellos

#### Scenario: Tabla corta sin desplazamiento propio
- **CUANDO** el OWNER abre el presupuesto de un periodo con 6 líneas
- **ENTONCES** la tabla no tiene desplazamiento vertical propio y se lee completa con el desplazamiento de la página

### Requirement: Columna de identificación fija en tablas anchas
En la vista previa de un import y en el cronograma de un préstamo, la columna que identifica cada fila (la fecha o el número de cuota) DEBE (MUST) quedar fija al desplazar la tabla a lo ancho y DEBE (MUST) estar marcada como encabezado de su fila.
Trace: NFR-USAB-006, NFR-USAB-108 · Priority: Could

#### Scenario: Desplazar la vista previa a lo ancho
- **CUANDO** a 360 px el OWNER desplaza a lo ancho la vista previa de un import hasta la última columna
- **ENTONCES** la columna Fecha sigue visible a la izquierda
- **Y** al leer una celda de monto, las tecnologías de asistencia anuncian la fecha de su fila como encabezado

### Requirement: Tablas completas al imprimir
Al imprimir, toda tabla DEBE (MUST) mostrarse completa, sin alto máximo ni desplazamiento propio, y su fila de encabezados DEBE (MUST) repetirse en cada página impresa.
Trace: NFR-USAB-101 · Priority: Should

#### Scenario: Imprimir el cronograma de un préstamo
- **CUANDO** el OWNER imprime el cronograma de un préstamo de 12000.00 BOB a 36 cuotas
- **ENTONCES** la impresión contiene las 36 cuotas, sin ninguna recortada
- **Y** cada página impresa empieza con la fila de encabezados

### Requirement: Semántica de tabla en pantallas angostas
En pantallas angostas las tablas DEBEN (MUST) conservar su estructura de filas, columnas y encabezados para las tecnologías de asistencia y desplazarse a lo ancho dentro de su propia región. NO DEBEN (MUST NOT) convertirse en listas apiladas ni producir desplazamiento horizontal de la página.
Trace: NFR-USAB-006, NFR-USAB-107, NFR-USAB-108 · Priority: Should

#### Scenario: Transacciones a 360 px
- **CUANDO** el OWNER abre Transacciones con un ancho de 360 px
- **ENTONCES** las tecnologías de asistencia reciben una tabla con encabezados de columna y filas
- **Y** la página no se desplaza a lo ancho; solo la región de la tabla lo hace

### Requirement: Pista de desplazamiento horizontal
Cuando una tabla tiene columnas fuera de la vista a la derecha, su región DEBE (MUST) mostrar una pista visual de que hay más contenido en ese borde, y la pista DEBE (MUST) desaparecer al llegar al final. Si el navegador no admite la pista, la barra de desplazamiento DEBE (MUST) seguir visible.
Trace: NFR-USAB-006 · Priority: Could

#### Scenario: Columnas fuera de la vista
- **CUANDO** a 360 px el OWNER abre el cronograma de un préstamo con más columnas que las que entran
- **ENTONCES** el borde derecho de la tabla muestra la pista de que hay más contenido

#### Scenario: Al final de la tabla
- **CUANDO** el OWNER desplaza esa tabla hasta la última columna
- **ENTONCES** la pista del borde derecho desaparece

### Requirement: Orden por columna en tablas comparativas
Las tablas comparativas (los reportes, el presupuesto contra lo real y el costo de las suscripciones) DEBEN (MUST) permitir ordenar por columna con un botón en el encabezado. Solo la columna activa DEBE (MUST) declarar su sentido de orden. Los montos DEBEN (MUST) ordenarse por su valor y no por el texto formateado. El nuevo orden DEBE (MUST) anunciarse una sola vez, y el foco DEBE (MUST) quedar en el botón del encabezado.
Trace: NFR-USAB-102, NFR-USAB-108 · Priority: Could

#### Scenario: Ordenar montos por su valor
- **CUANDO** el reporte de gastos por categoría tiene Alimentación con 1234.56 BOB, Transporte con 999.00 BOB y Salud con 45.30 BOB, y el OWNER ordena por Monto de mayor a menor
- **ENTONCES** el orden es Alimentación, Transporte y Salud

#### Scenario: Indicador y anuncio del orden
- **CUANDO** el OWNER ordena esa tabla por Monto
- **ENTONCES** solo el encabezado Monto declara el sentido del orden
- **Y** se anuncia una sola vez "Ordenado por Monto, de mayor a menor"

#### Scenario: Ordenar con el teclado
- **CUANDO** el OWNER llega con Tab al botón del encabezado Categoría y pulsa Enter
- **ENTONCES** la tabla queda ordenada por Categoría y el foco sigue en ese botón

### Requirement: Medidas y procesos con su rol propio
La utilización de una tarjeta de crédito y el avance de una meta DEBEN (MUST) exponerse como medidas, no como progreso de un proceso, con su valor y su texto visible. El avance del procesamiento de un import DEBE (MUST) exponerse como progreso de un proceso.
Trace: NFR-USAB-101, NFR-USAB-104, NFR-USAB-108 · Priority: Could

#### Scenario: Utilización de una tarjeta
- **CUANDO** el OWNER abre una tarjeta con 850.00 BOB usados de un límite de 1000.00 BOB
- **ENTONCES** la utilización se expone como una medida de 85 % con el texto "85 %" visible y sin rol de barra de progreso

#### Scenario: Avance de una meta
- **CUANDO** el OWNER abre una meta con 5000.00 BOB ahorrados de 15000.00 BOB
- **ENTONCES** el avance se expone como una medida de 33,33 % con su texto visible

#### Scenario: Procesamiento de un import
- **CUANDO** un import está en procesamiento
- **ENTONCES** su avance se expone como progreso de un proceso con un nombre que dice qué se procesa

### Requirement: Medición de la respuesta a interacciones
La suite E2E DEBE (MUST) medir el tiempo de respuesta a la interacción (INP) en abrir una fila de la vista previa de un import, filtrar la vista previa, aprobar el import y aplicar una edición masiva de transacciones, con un extracto sintético de 2 000 filas. DEBE (MUST) informar el valor por flujo junto al objetivo de 200 ms y el aviso de 500 ms, y NO DEBE (MUST NOT) hacer fallar la suite por el valor medido.
Trace: NFR-PERF-004 · Priority: Should

#### Scenario: Informe de la medición
- **CUANDO** corre la medición con el extracto sintético de 2 000 filas
- **ENTONCES** el informe de la suite incluye el INP de los cuatro flujos en milisegundos, con el objetivo y el aviso

#### Scenario: Valor por encima del aviso
- **CUANDO** un flujo mide 650 ms
- **ENTONCES** el informe lo marca como por encima del aviso y la suite no falla por eso

### Requirement: Filas de tabla dibujadas completas
Las filas y los grupos de filas de las tablas NO DEBEN (MUST NOT) diferir su dibujo con contención de contenido: esa técnica no actúa sobre filas de tabla, y el costo de las tablas largas se reduce con páginas.
Trace: NFR-PERF-004 · Priority: Should

#### Scenario: Sin contención en filas de tabla
- **CUANDO** se revisan las hojas de estilo y los componentes de la interfaz
- **ENTONCES** ninguna regla difiere el dibujo de una fila o de un grupo de filas de tabla

### Requirement: Detalle de un préstamo sin desbordamiento horizontal
A 360 px de ancho, el detalle de un préstamo, incluida su sección «Detalle» con los saldos y los totales pagados, NO DEBE (MUST NOT) producir desplazamiento horizontal de la página: los montos y sus rótulos DEBEN (MUST) acomodarse al ancho disponible sin recortarse y sin dejar de leerse completos.
Trace: NFR-USAB-006, NFR-USAB-107 · Priority: Should

#### Scenario: Saldos de un préstamo a 360 px
- **CUANDO** a 360 px el OWNER abre el detalle de un préstamo de 12000.00 BOB con una diferencia no registrada de 150.00 BOB
- **ENTONCES** la página no se desplaza a lo ancho
- **Y** el principal pendiente, el saldo de la cuenta, la diferencia y los totales pagados se leen completos
