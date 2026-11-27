# 85: Preguntas para el owner sobre los lotes de UI L6, L7 y la navegación del cliente

> **Fecha:** 2026-11-27 · **Changes:** [`add-pwa-install`](../openspec/changes/add-pwa-install/proposal.md) (82, L6), [`refine-perceived-performance`](../openspec/changes/refine-perceived-performance/proposal.md) (83, L7) y [`adopt-client-navigation`](../openspec/changes/adopt-client-navigation/proposal.md) (84) · **Relacionado:** [docs/78](78-propuesta-mejora-ui-ux-modern-web.md) (propuesta y viabilidad, § 11), [docs/79](79-ui-ux-modern-web-decisions.md) (D500–D512, D516), [docs/82](82-ui-lotes-l3-l5-questions.md) (pregunta 7, paginación), [docs/03](03-openspec-strategy.md) §7, [docs/38](38-estado-y-pendientes.md)

Al redactar los changes 82 a 84 quedaron seis puntos que D500–D516 no cubren. Cada pregunta trae contexto, opciones y una recomendación. Las respuestas irán en el `docs/NN-…-decisions.md` siguiente.

**Dato de partida (change 81, L5).** Medición local de INP en Chromium con 2 000 filas cargadas en la vista previa del import, mediana de 3 corridas: abrir fila 200 ms, filtrar 136 ms, aprobar ≈ 72 ms, edición masiva ≈ 30 ms. Ninguna supera los 200 ms de NFR-PERF-004. **No se midió la navegación entre secciones.**

## Resumen

| # | Change | Tema | ¿Bloquea? | Recomendación |
|---|---|---|---|---|
| 1 | 82 (L6) | Diseño de los íconos de la app | **Sí: tareas 5.2 y 5.3 del 82** (sin íconos no se puede instalar ni archivar) | (A) Los diseña el agente `ui-ux` y el owner los aprueba |
| 2 | 82 (L6) | Dominio definitivo antes de instalar | No | (A) Implementar ya; instalar solo desde el dominio de D452 |
| 3 | 82 (L6) | Ayuda para instalar en iPhone | No | (B) Texto breve en Mis preferencias |
| 4 | 83 (L7) | Margen de «abrir fila» y medición con procesador lento | No | (A) No optimizar; medir con la CPU ×4 |
| 5 | 84 | ¿Se hace `adopt-client-navigation`? | **Sí: grupos 5 a 7 del 84 y grupo 6 del 83** | (B) Medir la navegación primero y migrar solo si incumple |
| 6 | 83 / 84 | M-29 si se mantiene la navegación por documento | No (depende de la 5) | (A) Agregarla en el 83 como mejora progresiva |

**Bloquean:** la 1, dentro del change 82, y la 5, dentro de los changes 84 (etapa 2) y 83 (solo M-29). El resto de cada change avanza sin ellas: el 82 puede implementar el manifiesto, el botón y las pruebas; el 83 todo salvo M-29; el 84 su etapa 1 (medición). Ninguna cambia el orden de docs/03 §7.

## L6: `add-pwa-install`

### 1. Diseño de los íconos de la app

**Contexto.** Chromium solo ofrece instalar si el manifiesto declara íconos de 192 y 512 px, y Android usa uno adaptable que recorta en círculo u otra forma. Hoy no existe ningún ícono ni logotipo de PFOS (docs/78 § 11.1 punto 10: «eso, no el código, es la tarea más lenta»). D504 decidió que la app sea instalable, pero no quién diseña el ícono.

**Opciones.**
- **(A)** El agente `ui-ux` diseña un monograma simple («PF» o similar) sobre el color primario, con su fuente SVG en el repositorio; el agente `frontend` genera los PNG. El owner aprueba una captura en el PR antes de fusionar.
- **(B)** El owner trae el diseño (o un logotipo existente) y el change lo adapta a los tamaños.
- **(C)** Un ícono genérico provisional ahora y el definitivo en otro change.

**Recomendación: (A).** Es lo más rápido y deja la fuente editable. (C) obligaría a cambiar el ícono ya instalado en los teléfonos, que los sistemas actualizan tarde.

**¿Bloquea?** Sí: tareas 5.2 y 5.3 del change 82. El resto del change avanza.

### 2. Dominio definitivo antes de instalar

**Contexto.** Una app instalada queda atada a su origen; si después cambia el dominio, hay que migrarla (M-34, guía `pwa/migrate-web-app-origin`). docs/03 §7 dejó como dependencia del 82 «el dominio público definitivo». D452 ya decidió un dominio propio para PFOS que el owner registra, y el despliegue N1 todavía no ocurrió. El manifiesto del change usa solo rutas relativas (`id: '/'`, `start_url: '/'`), así que **el código no depende del dominio**.

**Opciones.**
- **(A)** Implementar ya. El manifiesto se publica con el despliegue N1, que usa el dominio de D452 desde el primer día; el runbook de N1 dice que se instala solo desde ese dominio.
- **(B)** Esperar a que el dominio esté registrado y N1 desplegado para implementar el 82.

**Recomendación: (A).** No hay usuarios que puedan instalar desde un origen provisional (no hay despliegue), y esperar no cambia el código.

**¿Bloquea?** No.

**Aplicada (2026-11-27):** el change 82 se implementó con la opción (A), por indicación de la sesión principal, sin esperar la confirmación explícita del owner. El runbook de N1 (fase 9) dice que se instala solo desde el dominio de D452.

### 3. Ayuda para instalar en iPhone

**Contexto.** Safari en iOS no emite el aviso `beforeinstallprompt`: en un iPhone el botón «Instalar la aplicación» no aparece nunca y la instalación es por «Compartir → Agregar a pantalla de inicio». La regla del change es no mostrar nunca un control de instalación que no funcione. Detectar «es un iPhone» exigiría leer el agente de usuario, que la guía desaconseja.

**Opciones.**
- **(A)** Sin ayuda: en iPhone no se muestra nada.
- **(B)** Un texto breve fijo en Mis preferencias, visible cuando no hay botón y la app no corre instalada: «En iPhone o iPad: Compartir → Agregar a pantalla de inicio». Sin detectar el navegador; en es, en y pt.
- **(C)** Un aviso en Inicio la primera vez.

**Recomendación: (B).** Cuesta una línea de texto, no interrumpe y sirve también en otros navegadores sin aviso. (C) es ruido para una función Could.

**¿Bloquea?** No. Si se elige (B), se agrega un scenario al requirement «Botón “Instalar” solo cuando el navegador lo ofrece» antes de implementar la tarea 5.4.

**Aplicada (2026-11-27):** se implementó la opción (B), por indicación de la sesión principal, sin esperar la confirmación explícita del owner: el delta ganó el scenario «Ayuda para iPhone y iPad» y el TC-PLATFORM-PWA-017. El texto («En iPhone o iPad: Compartir → Agregar a pantalla de inicio.») se muestra solo si no hay aviso del navegador y la app no corre instalada; en es, en y pt.

## L7: `refine-perceived-performance`

### 4. Margen de «abrir fila» y medición con procesador lento

**Contexto.** «Abrir fila» con 2 000 filas dio 200 ms de mediana (una corrida en 208 ms): justo en el objetivo, medido en un escritorio. Un teléfono modesto tiene un procesador varias veces más lento, y NFR-PERF-004 pide INP ≤ 200 ms con «Fast 4G» emulada. Docs/78 M-30 decía «donde haya tareas > 50 ms, ceder el hilo», pero ningún flujo incumple hoy.

**Opciones.**
- **(A)** No optimizar ahora. El change 83 agrega a la medición informativa una columna con el procesador ralentizado ×4 (requirement «Medición de la respuesta con un procesador lento») y la decisión se toma con esos datos.
- **(B)** Optimizar ya «abrir fila» (ceder el hilo con `scheduler.yield()` y respaldo `setTimeout`, o memorizar la fila) con objetivo ≤ 200 ms también con la CPU ×4.
- **(C)** Nada: ni medir con CPU lenta ni optimizar.

**Recomendación: (A).** La medición cuesta poco y evita optimizar a ciegas; si la columna lenta pasa claramente de 200 ms, (B) se vuelve un change chico con datos.

**¿Bloquea?** No. Con (C), el requirement de la medición lenta se retira del delta del 83 antes de archivar.

## Navegación: `adopt-client-navigation` y M-29

### 5. ¿Se hace el change 84 y con qué alcance?

**Contexto.** D511 dejó la migración a `next/link` para después de «medir INP y navegación». El change 81 midió INP y **no hay incumplimiento**; además, esas interacciones ocurren dentro de una página y la navegación del cliente no las mejora. Lo que sí mejoraría es el costo de cambiar de sección (documento nuevo, rehidratación y otra llamada a `/me`), que **no está medido**. Migrar es de esfuerzo L (unas 200 anclas, 12 `location.assign`, los specs E2E que esperan `ready`), cambia cómo se navega en toda la app y deja inerte M-29.

**Opciones.**
- **(A)** No hacerlo. Se cierra D511 con la navegación por documento, el change 84 se retira de docs/03 §7 y M-29 entra en el 83 (pregunta 6).
- **(B)** Reducido, en dos etapas (lo que está redactado): **etapa 1** mide la navegación (tiempo hasta el contenido propio y LCP, escritorio y teléfono modesto con «Fast 4G» y CPU ×4, mediana de 3 corridas) contra los 2.5 s de NFR-PERF-004; **etapa 2** migra solo si el perfil de teléfono modesto incumple en algún destino. Si cumple, se retiran los requirements de la etapa 2 y M-29 queda habilitado.
- **(C)** Migrar completo ahora, sin medir.

**Recomendación: (B).** La etapa 1 es de esfuerzo S, no toca la app y da la línea de base de LCP que NFR-PERF-004 hoy no tiene; la decisión cara se toma con datos y con un criterio que ya está en los NFR. (C) gasta un change L sin evidencia; (A) es razonable si el owner prefiere no medir.

**¿Bloquea?** Sí: los grupos 5 a 7 del change 84 (etapa 2) y el grupo 6 del change 83 (M-29). La etapa 1 del 84 y el resto del 83 no esperan.

### 6. M-29 si se mantiene la navegación por documento

**Contexto.** M-29 es una regla de CSS, `@view-transition { navigation: auto }`, que anima el paso entre documentos. Es Limited (en navegadores sin soporte no hace nada), sin script ni cambio de CSP, y de esfuerzo S. D511 la sacó del lote L7 hasta resolver el 84, porque con navegación del cliente queda inerte. El change 83 la incluye como requirement condicionado.

**Opciones.**
- **(A)** Si la pregunta 5 termina en navegación por documento (opción A, u opción B con la medición dentro del objetivo), agregarla en el 83 dentro de `prefers-reduced-motion: no-preference`.
- **(B)** No agregarla en ningún caso.

**Recomendación: (A).** Da continuidad visual sin costo ni riesgo en los navegadores que no la soportan. Con la pregunta 5 en (C), o en (B) con migración, el requirement se retira del 83.

**¿Bloquea?** No (depende de la 5).

## L7: preguntas surgidas al implementar `refine-perceived-performance` (2026-11-27)

### 7. Formato de los montos en la tabla alternativa de los gráficos

**Contexto.** El scenario «Valor exacto de un punto del gráfico» (y TC-PLATFORM-PERCEIVED-014) espera «Bs 1.234,56», pero las tablas de los reportes muestran el monto con el código ISO («1.234,56 BOB»), como manda [docs/28](28-ui-ux-design-system.md) § 8.2 para tablas y reportes (el símbolo «Bs» queda para listas y KPIs de la moneda base). La implementación conserva el código y la prueba verifica «1.234,56 BOB» (el valor exacto está en la tabla).

**Opciones.**
- **(A)** Mantener el código ISO en los reportes y corregir el texto del scenario y de TC-PLATFORM-PERCEIVED-014 antes de archivar.
- **(B)** Mostrar «Bs» en las tablas de reportes de una sola moneda (cambia muchas pruebas de reportes y contradice docs/28 § 8.2).

**Recomendación: (A).** El valor exacto ya está en la tabla; solo el texto del scenario es impreciso.

**¿Bloquea?** No. Hay que resolverla antes de archivar el 83.

### 8. Respuesta con la CPU ×4 de «abrir fila» y «filtrar» (dato de la opción A de la pregunta 4)

**Contexto.** La columna con el procesador ralentizado ×4 (mediana de 3 corridas locales, 2 000 filas, transiciones activas) dio: abrir fila 736 ms (1112 / 688 / 736), filtrar 640 ms (856 / 640 / 528), aprobar 144 ms y edición masiva 136 ms. Las dos primeras pasan del aviso de 500 ms; en escritorio ninguna pasa de 200 ms (abrir fila 128, filtrar 96, aprobar 32, edición masiva 32). La medición de INP solo cubre el cuadro de la interacción: no incluye lo que tarda la lista en actualizarse cuando la respuesta del servidor llega después.

**Opciones.**
- **(A)** No hacer nada hasta tener datos de un teléfono real.
- **(B)** Un change chico que ceda el hilo (`scheduler.yield()` con respaldo `setTimeout`) o memorice la fila en «abrir fila» y «filtrar», con objetivo ≤ 500 ms con la CPU ×4.

**Recomendación: (B).** Con datos en la mano, el costo es bajo y el riesgo es medible con la misma suite `inp`.

**¿Bloquea?** No.
