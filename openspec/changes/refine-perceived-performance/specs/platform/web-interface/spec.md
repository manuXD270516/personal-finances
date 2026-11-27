## ADDED Requirements

### Requirement: Transición al cambiar de pestaña o de filtro
Cuando el navegador lo admite y el usuario no pidió movimiento reducido, el cambio de pestaña y la aplicación de un filtro en una lista o tabla DEBEN (MUST) mostrar una transición breve entre el contenido anterior y el nuevo. Con movimiento reducido o sin soporte, el contenido DEBE (MUST) cambiar al instante, sin animación y con el mismo resultado. La transición NO DEBE (MUST NOT) mover el foco, cambiar lo que anuncian las tecnologías de asistencia ni impedir usar la página mientras dura.
Trace: NFR-USAB-107, NFR-USAB-005, NFR-USAB-102 · Priority: Could

#### Scenario: Cambio de pestaña con movimiento permitido
- **CUANDO** en el detalle de un préstamo de 12000.00 BOB el OWNER, sin pedir movimiento reducido y en un navegador con soporte, pasa de la primera pestaña a la segunda
- **ENTONCES** el contenido cambia con una transición que dura como máximo 300 ms
- **Y** el foco queda en la segunda pestaña

#### Scenario: Movimiento reducido
- **CUANDO** el OWNER, con movimiento reducido en el sistema, aplica el filtro «Gastos» en Transacciones
- **ENTONCES** la lista cambia sin ninguna transición

#### Scenario: Navegador sin soporte de transiciones
- **CUANDO** el OWNER aplica el filtro «Gastos» en Transacciones en un navegador sin soporte de transiciones
- **ENTONCES** la lista muestra solo los gastos, igual que con soporte

### Requirement: Respuesta a la interacción sin empeorar
Las transiciones y demás mejoras de este lote NO DEBEN (MUST NOT) llevar por encima de 200 ms la mediana de tres mediciones locales de la respuesta a la interacción de los flujos medidos con 2 000 filas cargadas en la vista previa del import: abrir una fila, filtrar, aprobar y la edición masiva. Una vista en la que la transición supere ese valor DEBE (MUST) funcionar sin transición. La medición DEBE (MUST) quedar en el informe de la suite y NO DEBE (MUST NOT) hacer fallar la suite por el valor medido.
Trace: NFR-PERF-004, NFR-USAB-006 · Priority: Should

#### Scenario: Filtrar la vista previa con las mejoras activas
- **CUANDO** con 2 000 filas cargadas en la vista previa del import se mide tres veces la respuesta al filtrar con las transiciones activas
- **ENTONCES** la mediana no supera 200 ms o la vista previa filtra sin transición

#### Scenario: Informe de la medición
- **CUANDO** termina la medición de los cuatro flujos
- **ENTONCES** el informe muestra cada flujo con su valor en ms y su estado frente a 200 ms y a 500 ms
- **Y** la suite no falla aunque un valor supere 200 ms

### Requirement: Consultas periódicas en pausa con la pestaña oculta
Las consultas que se repiten para seguir el avance de una tarea (persistencia del import, conexiones de importación, corrida de pronósticos, datos de demostración y exportación del workspace) DEBEN (MUST) dejar de enviarse mientras la página está oculta y DEBEN (MUST) reanudarse con una consulta inmediata al volver a ser visible. Una página que se abre ya oculta NO DEBE (MUST NOT) empezar a consultar hasta hacerse visible. Al volver, el estado mostrado DEBE (MUST) ser el actual, sin pasos perdidos.
Trace: NFR-USAB-006, NFR-PERF-004 · Priority: Could

#### Scenario: Persistencia del import con la pestaña oculta
- **CUANDO** el OWNER confirma un import de 2 000 filas y pasa a otra pestaña durante 30 s
- **ENTONCES** en esos 30 s la página no consulta el estado del import

#### Scenario: Volver a la pestaña
- **CUANDO** el import terminó mientras la pestaña estaba oculta y el OWNER vuelve a ella
- **ENTONCES** la página consulta enseguida y muestra el import terminado con sus 2 000 filas

#### Scenario: Página abierta en segundo plano
- **CUANDO** el OWNER abre Pronósticos en una pestaña de fondo con una corrida en curso
- **ENTONCES** la página no consulta la corrida hasta que el OWNER la mira

### Requirement: Consultas de fondo con prioridad baja
Las consultas que no responden a una acción del usuario, como los contadores de la barra y el de notificaciones sin leer, DEBEN (MUST) pedirse con prioridad baja cuando el navegador lo admite, para no demorar las consultas que el usuario espera. Las consultas que responden a una acción del usuario NO DEBEN (MUST NOT) bajar su prioridad. Sin soporte, las consultas DEBEN (MUST) funcionar igual.
Trace: NFR-PERF-004, NFR-USAB-005 · Priority: Could

#### Scenario: Contador de notificaciones
- **CUANDO** Inicio pide el número de notificaciones sin leer
- **ENTONCES** la petición sale con prioridad baja

#### Scenario: Consulta pedida por el usuario
- **CUANDO** el OWNER busca «supermercado» en Transacciones
- **ENTONCES** la petición de la búsqueda no sale con prioridad baja

### Requirement: Explicaciones accesibles sin depender del puntero
Ninguna explicación de la interfaz DEBE (MUST) depender solo de pasar el puntero por encima. Una explicación corta DEBE (MUST) mostrarse como texto visible o detrás de un botón de información con nombre accesible que la abra y la cierre con el teclado, con un toque y con Escape, y cuyo contenido lean las tecnologías de asistencia. En un navegador sin soporte de capas emergentes, la explicación DEBE (MUST) quedar visible junto al botón. El valor exacto de cada punto de un gráfico DEBE (MUST) estar en su tabla alternativa.
Trace: NFR-USAB-101, NFR-USAB-102, NFR-USAB-105, NFR-USAB-006 · Priority: Should

#### Scenario: Explicación con el teclado
- **CUANDO** en Transacciones el EDITOR llega con Tab al botón de información de una transacción conciliada sin extracto y pulsa Enter
- **ENTONCES** se abre la explicación de por qué aparece así
- **Y** Escape la cierra y devuelve el foco al botón

#### Scenario: Explicación en el teléfono
- **CUANDO** a 360 px el EDITOR toca el botón de información de una tasa de cambio
- **ENTONCES** la explicación se abre sin necesidad de un puntero

#### Scenario: Navegador sin capas emergentes
- **CUANDO** el EDITOR abre Transacciones en un navegador sin soporte de capas emergentes
- **ENTONCES** la explicación se ve como texto junto al botón de información

#### Scenario: Valor exacto de un punto del gráfico
- **CUANDO** el OWNER abre el reporte de gastos con un mes de 1234.56 BOB
- **ENTONCES** la tabla alternativa del gráfico muestra «Bs 1.234,56» para ese mes

#### Scenario: Sin explicaciones solo en el atributo de título
- **CUANDO** se revisan los componentes de la interfaz
- **ENTONCES** ningún texto explicativo vive solo en un atributo de título, salvo las excepciones marcadas y justificadas

### Requirement: Títulos y párrafos legibles
Los títulos DEBEN (MUST) repartir sus palabras en líneas equilibradas y los párrafos y elementos de lista DEBEN (MUST) evitar una palabra sola en la última línea cuando el navegador lo admite; sin soporte, el texto DEBE (MUST) mostrarse como hasta ahora. Los textos de ayuda NO DEBEN (MUST NOT) superar un ancho de unos 70 caracteres por línea.
Trace: NFR-USAB-001, NFR-USAB-005 · Priority: Could

#### Scenario: Título largo en español
- **CUANDO** el OWNER abre a 360 px una página cuyo título ocupa dos líneas en español
- **ENTONCES** el título declara el reparto equilibrado de líneas

#### Scenario: Ancho de los textos de ayuda
- **CUANDO** el OWNER abre Mis preferencias a 1280 px
- **ENTONCES** ningún texto de ayuda mide más de 70 caracteres de ancho

### Requirement: Diseño que respeta el tamaño de texto del sistema
Los cambios de diseño por ancho DEBEN (MUST) expresarse en relación con el tamaño del texto, de modo que con el texto del sistema al 200 % la página pase al diseño angosto sin desplazamiento horizontal. Los bloques de texto NO DEBEN (MUST NOT) impedir el salto de línea; los montos y las fechas DEBEN (MUST) seguir sin partirse.
Trace: NFR-USAB-107, NFR-USAB-006 · Priority: Could

#### Scenario: Texto al 200 % en escritorio
- **CUANDO** el OWNER abre Transacciones a 1280 px con el tamaño de texto del navegador al 200 %
- **ENTONCES** la página usa el diseño angosto y no tiene desplazamiento horizontal

#### Scenario: Monto sin partir
- **CUANDO** con el texto al 200 % se muestra un gasto de 12345.67 BOB en una columna angosta
- **ENTONCES** «Bs 12.345,67» queda en una sola línea

### Requirement: Campos de texto largos que crecen con su contenido
Los campos de texto de varias líneas, como las notas y el motivo de una anulación, DEBEN (MUST) crecer con su contenido entre un alto mínimo y uno máximo cuando el navegador lo admite, y desplazarse a partir del máximo. Sin soporte, DEBEN (MUST) conservar el alto actual con desplazamiento.
Trace: NFR-USAB-006, NFR-USAB-005 · Priority: Could

#### Scenario: Motivo de anulación largo
- **CUANDO** el EDITOR escribe un motivo de anulación de seis líneas para un gasto de 80.00 BOB en un navegador con soporte
- **ENTONCES** el campo crece hasta mostrar las seis líneas sin desplazamiento interno, sin superar su alto máximo

#### Scenario: Navegador sin soporte
- **CUANDO** el EDITOR escribe el mismo motivo en un navegador sin soporte
- **ENTONCES** el campo mantiene su alto actual y se puede desplazar

### Requirement: Medición de la respuesta con un procesador lento
La medición informativa de la respuesta a la interacción DEBE (MUST) repetir los flujos medidos con el procesador ralentizado cuatro veces, para estimar un teléfono modesto, y mostrar ese valor junto al de escritorio. Esa medición NO DEBE (MUST NOT) hacer fallar la suite.
Trace: NFR-PERF-004, NFR-USAB-006 · Priority: Could

#### Scenario: Informe con procesador lento
- **CUANDO** termina la medición de los cuatro flujos
- **ENTONCES** el informe muestra para cada flujo el valor de escritorio y el valor con el procesador ralentizado cuatro veces

### Requirement: Transición entre secciones por documento
Mientras la navegación entre secciones cargue un documento nuevo, el cambio de sección DEBE (MUST) mostrar una transición breve cuando el navegador la admite y el usuario no pidió movimiento reducido. Sin soporte o con movimiento reducido, la navegación DEBE (MUST) funcionar como hasta ahora. La transición NO DEBE (MUST NOT) requerir scripts en línea ni cambios en la política de seguridad de contenido.
Trace: NFR-USAB-107, NFR-USAB-005, NFR-SEC-008 · Priority: Could

#### Scenario: Cambio de sección con soporte
- **CUANDO** el OWNER, sin movimiento reducido y en un navegador con soporte, pasa de Inicio a Presupuestos
- **ENTONCES** Presupuestos aparece con una transición desde Inicio

#### Scenario: Cambio de sección con movimiento reducido
- **CUANDO** el OWNER, con movimiento reducido, pasa de Inicio a Presupuestos
- **ENTONCES** Presupuestos aparece sin transición
- **Y** no se registra ninguna violación de la política de seguridad de contenido
