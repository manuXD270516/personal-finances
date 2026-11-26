## ADDED Requirements

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
