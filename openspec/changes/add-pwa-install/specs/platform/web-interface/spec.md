## ADDED Requirements

### Requirement: Manifiesto de la aplicación instalable
La aplicación DEBE (MUST) publicar un único manifiesto en el mismo origen que la interfaz, enlazado desde todas sus páginas, con una identidad estable que no dependa del dominio, el nombre del producto y uno corto, el inicio y el alcance en la raíz, presentación como aplicación independiente, idioma español de Bolivia, los íconos de la aplicación y un atajo a «Registrar gasto» que abra el alta de transacción. El manifiesto DEBE (MUST) servirse sin sesión, sin redirecciones y con un tipo de contenido JSON, y NO DEBE (MUST NOT) exigir cambios en la política de seguridad de contenido. La falta de soporte de manifiestos en un navegador NO DEBE (MUST NOT) impedir usar la aplicación.
Trace: NFR-USAB-005, NFR-USAB-006, NFR-SEC-008 · Priority: Could

#### Scenario: Manifiesto sin sesión
- **CUANDO** una persona sin sesión pide el manifiesto de la aplicación
- **ENTONCES** recibe el manifiesto con estado 200, tipo de contenido JSON y sin redirección al inicio de sesión
- **Y** el manifiesto declara la identidad «/», el inicio «/», el alcance «/», la presentación independiente y el idioma «es-BO»

#### Scenario: Enlace al manifiesto desde las páginas
- **CUANDO** el OWNER abre Inicio, Transacciones y la página de error de inicio de sesión en es, en y pt
- **ENTONCES** las tres páginas enlazan el mismo manifiesto
- **Y** no se registra ninguna violación de la política de seguridad de contenido

#### Scenario: Atajo para registrar un gasto
- **CUANDO** se lee el manifiesto
- **ENTONCES** declara un atajo «Registrar gasto» que abre el alta de transacción dentro del alcance de la aplicación

### Requirement: Íconos de la aplicación instalada
El manifiesto DEBE (MUST) declarar íconos PNG de 192 × 192 y 512 × 512 px y un ícono adaptable de 512 × 512 px cuyo motivo quede dentro de la zona segura central, y las páginas DEBEN (MUST) declarar un ícono para la pantalla de inicio de iOS de 180 × 180 px. Cada ícono declarado DEBE (MUST) existir, servirse sin sesión y tener el tamaño que declara. El motivo DEBE (MUST) distinguirse de su fondo con un contraste de al menos 3:1.
Trace: NFR-USAB-005, NFR-USAB-103 · Priority: Could

#### Scenario: Íconos declarados y servidos
- **CUANDO** se piden sin sesión todos los íconos que declaran el manifiesto y las páginas
- **ENTONCES** cada uno responde con estado 200, tipo de imagen PNG y las dimensiones que declara

#### Scenario: Ícono adaptable recortado en círculo
- **CUANDO** el ícono adaptable se recorta con la máscara circular más chica que admite la zona segura
- **ENTONCES** el motivo completo queda dentro del círculo

### Requirement: Botón «Instalar» solo cuando el navegador lo ofrece
Mis preferencias DEBE (MUST) mostrar el botón «Instalar la aplicación» solo después de que el navegador avise que la aplicación se puede instalar, y al usarlo DEBE (MUST) abrir el diálogo de instalación del propio navegador. El botón NO DEBE (MUST NOT) mostrarse cuando el navegador no lo ofrece, cuando la aplicación ya corre instalada ni después de instalarla, y la interfaz NO DEBE (MUST NOT) mostrar en ningún momento un control de instalación que no funcione. Mientras el navegador no ofrezca la instalación y la aplicación no corra instalada, Mis preferencias DEBE (MUST) mostrar un texto fijo (no un botón ni un enlace) con los pasos para instalar desde iPhone o iPad («Compartir → Agregar a pantalla de inicio»), sin detectar el navegador. Los textos DEBEN (MUST) estar en es, en y pt.
Trace: NFR-USAB-005, NFR-USAB-001, NFR-USAB-102 · Priority: Could

#### Scenario: El navegador ofrece la instalación
- **CUANDO** el EDITOR abre Mis preferencias y el navegador avisa que la aplicación se puede instalar
- **ENTONCES** aparece el botón «Instalar la aplicación», operable con el teclado
- **Y** al usarlo se abre el diálogo de instalación del navegador

#### Scenario: Navegador sin aviso de instalación
- **CUANDO** el EDITOR abre Mis preferencias en un navegador que no avisa que la aplicación se puede instalar
- **ENTONCES** no aparece ningún botón ni enlace de instalación

#### Scenario: Aplicación ya instalada
- **CUANDO** el EDITOR abre Mis preferencias desde la aplicación instalada
- **ENTONCES** no aparece el botón «Instalar la aplicación»

#### Scenario: Instalación aceptada
- **CUANDO** el EDITOR acepta el diálogo de instalación del navegador
- **ENTONCES** el botón «Instalar la aplicación» desaparece sin recargar la página

#### Scenario: Ayuda para iPhone y iPad
- **CUANDO** el EDITOR abre Mis preferencias en un navegador que no avisa que la aplicación se puede instalar
- **ENTONCES** aparece un texto fijo con los pasos «Compartir → Agregar a pantalla de inicio», sin detectar el navegador
- **Y** el texto no es un botón ni un enlace y no aparece con la aplicación ya instalada

### Requirement: Instalación sin funcionamiento sin conexión
La aplicación NO DEBE (MUST NOT) registrar un service worker ni guardar páginas, respuestas de la API o datos financieros para usarlos sin conexión. La política de seguridad de contenido NO DEBE (MUST NOT) cambiar para la instalación. Sin conexión, la aplicación instalada DEBE (MUST) comportarse como el navegador sin conexión, sin mostrar datos guardados.
Trace: NFR-SEC-008, NFR-SEC-001 · Priority: Must

#### Scenario: Sin service worker
- **CUANDO** el OWNER recorre Inicio, Transacciones, el alta y Mis preferencias
- **ENTONCES** el navegador no tiene ningún service worker registrado para el origen de la aplicación

#### Scenario: Política de seguridad sin cambios
- **CUANDO** se comparan las directivas de la política de seguridad de contenido antes y después del change
- **ENTONCES** son idénticas

#### Scenario: Sin conexión
- **CUANDO** el OWNER, tras ver un gasto de 45.00 BOB en Transacciones, pierde la conexión y recarga la página
- **ENTONCES** no se muestra el gasto de 45.00 BOB ni ningún otro dato guardado

### Requirement: Sesión en la aplicación instalada
Al abrir la aplicación instalada sin una sesión válida, el usuario DEBE (MUST) pasar por el inicio de sesión habitual y volver dentro de la aplicación al inicio. La instalación NO DEBE (MUST NOT) cambiar el nombre, los atributos ni la duración de la cookie de sesión, ni guardar tokens fuera de ella.
Trace: FR-IDENTITY-001, NFR-SEC-001 · Priority: Could

#### Scenario: Abrir la aplicación instalada sin sesión
- **CUANDO** el OWNER abre la aplicación instalada con la sesión vencida
- **ENTONCES** ve el inicio de sesión y, al completarlo, vuelve a Inicio dentro de la aplicación

#### Scenario: Cookie de sesión sin cambios
- **CUANDO** el OWNER inicia sesión con el manifiesto publicado
- **ENTONCES** la cookie de sesión conserva su nombre y sus atributos

### Requirement: Barra de la aplicación instalada acorde al tema
En la aplicación instalada, la barra de título o de estado DEBE (MUST) seguir el tema vigente de la página igual que la barra del navegador. Los colores del manifiesto DEBEN (MUST) ser los del tema claro y solo valer como respaldo mientras carga la primera página.
Trace: NFR-USAB-103 · Priority: Could

#### Scenario: Colores del manifiesto
- **CUANDO** se leen los colores del manifiesto
- **ENTONCES** el color del tema y el de fondo son los de la superficie del tema claro

#### Scenario: Tema oscuro en la aplicación instalada
- **CUANDO** el OWNER, con el tema «Oscuro», abre Inicio en la aplicación instalada
- **ENTONCES** la barra de la aplicación usa el color del tema oscuro
