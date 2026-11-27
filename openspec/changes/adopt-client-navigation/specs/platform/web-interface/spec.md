## ADDED Requirements

### Requirement: Medición de la navegación entre secciones
La suite DEBE (MUST) medir, de forma informativa, el tiempo entre el clic en un enlace de la navegación y la aparición del contenido propio de la sección de destino, y la mayor pintura de contenido de esa sección, para al menos Inicio, Transacciones, Presupuestos, Reportes y el detalle de una transacción. Cada medición DEBE (MUST) tomarse en un perfil de escritorio y en uno de teléfono modesto (red rápida 4G emulada y procesador ralentizado cuatro veces), como mediana de tres corridas, y compararse con el objetivo de 2.5 s de NFR-PERF-004. La medición NO DEBE (MUST NOT) hacer fallar la suite.
Trace: NFR-PERF-004, NFR-USAB-006 · Priority: Should

#### Scenario: Informe de la navegación
- **CUANDO** termina la medición de la navegación desde Inicio hacia Transacciones, Presupuestos, Reportes y el detalle de un gasto de 45.00 BOB
- **ENTONCES** el informe muestra para cada destino el tiempo hasta el contenido propio y la mayor pintura de contenido en ms, en los dos perfiles, con su estado frente a 2.5 s
- **Y** la suite no falla aunque un valor supere 2.5 s

#### Scenario: Perfil de teléfono modesto
- **CUANDO** se mide la navegación de Inicio a Transacciones con red rápida 4G emulada y el procesador ralentizado cuatro veces
- **ENTONCES** el informe registra la mediana de tres corridas para ese perfil

### Requirement: Navegación entre secciones sin recargar el documento
Los enlaces internos de la aplicación DEBEN (MUST) cambiar de sección sin cargar un documento nuevo, conservando la sesión cargada y el marco de la aplicación, y con la dirección del navegador actualizada en el idioma vigente. Abrir un enlace en otra pestaña o ventana DEBE (MUST) seguir funcionando como un enlace normal. Los avisos de la región de avisos DEBEN (MUST) descartarse al cambiar de sección, igual que con la carga de un documento.
Trace: NFR-PERF-004, NFR-USAB-001, NFR-USAB-102 · Priority: Could

#### Scenario: De Inicio a Transacciones sin recargar
- **CUANDO** el OWNER, en Inicio, usa el enlace Transacciones de la navegación
- **ENTONCES** Transacciones se muestra sin cargar un documento nuevo ni volver a pedir su perfil

#### Scenario: Enlace en otra pestaña
- **CUANDO** el OWNER abre el enlace Presupuestos con Ctrl + clic
- **ENTONCES** Presupuestos se abre en una pestaña nueva con la sesión activa

#### Scenario: Idioma conservado
- **CUANDO** el OWNER, con la interfaz en inglés, pasa de Inicio a Reportes
- **ENTONCES** la dirección del navegador queda en la ruta en inglés de Reportes y la página se muestra en inglés

#### Scenario: Avisos descartados al cambiar de sección
- **CUANDO** el EDITOR registra un gasto de 25.00 BOB y, con el aviso visible, pasa a Presupuestos
- **ENTONCES** la región de avisos está vacía en Presupuestos

### Requirement: Foco y anuncio al cambiar de sección
Tras cada cambio de sección sin documento nuevo, el título del documento DEBE (MUST) pasar al de la sección de destino, las tecnologías de asistencia DEBEN (MUST) anunciar la sección nueva y el foco DEBE (MUST) quedar al principio del contenido de la sección, de modo que Tab lleve al primer elemento operable de ese contenido.
Trace: NFR-USAB-102, NFR-USAB-108, NFR-USAB-101 · Priority: Could

#### Scenario: Cambio de sección con el teclado
- **CUANDO** el OWNER, solo con el teclado, activa el enlace Presupuestos de la navegación
- **ENTONCES** el título del documento es el de Presupuestos y el foco queda al principio del contenido de Presupuestos

#### Scenario: Anuncio de la sección nueva
- **CUANDO** el OWNER pasa de Inicio a Transacciones
- **ENTONCES** una región en vivo anuncia el título de Transacciones

### Requirement: Historial y posición de desplazamiento
Atrás y Adelante del navegador DEBEN (MUST) volver a la sección anterior o siguiente con su contenido y su posición de desplazamiento. Una sección a la que se llega por un enlace DEBE (MUST) mostrarse desde el principio.
Trace: NFR-USAB-102, NFR-USAB-006 · Priority: Could

#### Scenario: Volver atrás
- **CUANDO** el OWNER desplaza Transacciones hasta la mitad, pasa a Presupuestos y usa Atrás
- **ENTONCES** vuelve a Transacciones en la misma posición de desplazamiento

#### Scenario: Sección nueva desde el principio
- **CUANDO** el OWNER, con Transacciones desplazada hasta la mitad, pasa a Reportes
- **ENTONCES** Reportes se muestra desde el principio

### Requirement: Documento nuevo al cambiar de contexto
Cambiar de workspace, cerrar sesión, cambiar el idioma y las acciones que hoy fuerzan una carga completa tras modificar datos DEBEN (MUST) seguir cargando un documento nuevo. Tras cambiar de workspace NO DEBE (MUST NOT) verse ningún dato del workspace anterior.
Trace: FR-IDENTITY-002, NFR-SEC-001 · Priority: Could

#### Scenario: Cambio de workspace
- **CUANDO** el OWNER, con un gasto de 45.00 BOB visible en Transacciones del workspace «Casa», cambia al workspace «Negocio»
- **ENTONCES** se carga un documento nuevo y Transacciones no muestra el gasto de 45.00 BOB

#### Scenario: Cierre de sesión
- **CUANDO** el OWNER cierra sesión desde Transacciones
- **ENTONCES** se carga un documento nuevo sin sesión y Atrás no muestra Transacciones con datos

### Requirement: Sesión y seguridad en la navegación sin documento nuevo
Cada cambio de sección sin documento nuevo DEBE (MUST) validar la sesión igual que una carga completa. Con la sesión vencida, el cambio de sección DEBE (MUST) llevar al inicio de sesión y NO DEBE (MUST NOT) mostrar una página rota ni datos. La navegación NO DEBE (MUST NOT) producir violaciones de la política de seguridad de contenido ni requerir relajarla.
Trace: FR-IDENTITY-001, NFR-SEC-001, NFR-SEC-008 · Priority: Could

#### Scenario: Sesión vencida
- **CUANDO** la sesión del OWNER vence con Inicio abierto y usa el enlace Transacciones
- **ENTONCES** ve el inicio de sesión y no ve ninguna transacción

#### Scenario: Sin violaciones de la política de seguridad
- **CUANDO** el OWNER recorre Inicio, Transacciones, Presupuestos, Reportes y Mis preferencias con los enlaces de la navegación
- **ENTONCES** no se registra ninguna violación de la política de seguridad de contenido
