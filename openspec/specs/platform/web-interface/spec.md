# platform/web-interface Specification

## Purpose
TBD - created by archiving change refine-web-accessibility-foundations. Update Purpose after archive.

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
