# 79: Decisiones del owner sobre la propuesta de UI/UX con Modern Web Guidance

> **Fecha:** 2026-11-25 · **Preguntas:** [docs/78](78-propuesta-mejora-ui-ux-modern-web.md) § 10 (P1–P12), con la viabilidad técnica de § 11 · **Relacionado:** [docs/03](03-openspec-strategy.md) §7, [docs/38](38-estado-y-pendientes.md), [docs/28](28-ui-ux-design-system.md), [docs/02](02-non-functional-requirements.md) (NFR-USAB-005, NFR-USAB-101..108), [CLAUDE.md](../CLAUDE.md) (sección Código)

El owner contestó el 2026-11-25, en el chat: adopta **todas las recomendaciones** de docs/78 («toma las recomendaciones principales del criterio de UI designer senior»). Eso cubre P1–P9, del agente `ui-ux`, y P10–P12, que agregó el agente `frontend` en la revisión de viabilidad. Hay una excepción en P10 y un pedido adicional sobre quién implementa los lotes.

## Numeración

Los ids siguen al último usado en `origin/main` (D483, docs/77). En paralelo, otro change de diseño agrega ids a docs/77 (D484–D487 en su rama, con posibilidad de sumar más). Para no chocar, este documento arranca en **D500** y deja **D488–D499 reservados para docs/77**. Si docs/77 llegara a necesitar más de doce ids, sigue después de D512. D516, agregado después con la respuesta al spike de WebKit, salta D513–D515, que toma la calibración de anomalías (docs/81, PR #293).

## Decisiones

| Id | Pregunta de docs/78 | Decisión | Efecto |
|---|---|---|---|
| D500 | P1: política de soporte de navegadores | (B) Baseline Widely available como piso. Una función Newly available se usa si su ausencia no impide completar la tarea (mejora progresiva), o con un respaldo propio de ≤ 20 líneas y sin dependencias. Sin polyfills. Limited availability solo como mejora opcional que no cambia la tarea. | Regla de código en `CLAUDE.md` (sección Código) y nota en NFR-USAB-005. Se aplica a todos los lotes L1–L7. |
| D501 | P2: tema oscuro | (B) Sistema por defecto, con override Claro u Oscuro en Preferencias. Sin interruptor permanente en la barra. | Lote L3 `add-dark-theme`: `preferences.theme` de `/me` (sin cambio de contrato) más la cookie espejo `pfos_theme` leída en el layout raíz (docs/78 § 11.1 punto 4). |
| D502 | P3: qué pasa después de registrar un gasto | (B) Se queda en el formulario limpio, con un aviso «Deshacer · Ver». | Lote L2 `add-quick-capture`. Queda «Registrar e ir al detalle» como acción secundaria. |
| D503 | P4: navegación móvil | (B) Barra inferior de 5 destinos (Inicio · Transacciones · ＋ Registrar · Plan · Más) y «Más» como cajón modal con los grupos de docs/28 §2.1. | Lote L4 `refine-mobile-navigation`, después de L2 (botón ＋). |
| D504 | P5: PWA | (B) Solo instalable: manifiesto e íconos, sin service worker ni funcionamiento sin conexión. La cola de altas sin conexión sería un change aparte. | Lote L6 `add-pwa-install`. Antes de publicar el manifiesto hay que fijar el dominio definitivo (M-34) y diseñar los íconos. |
| D505 | P6: tipografía | (A) Fuentes del sistema (as-built). | Cierra la pregunta 6 de docs/28: no se autohospeda Inter. M-25 no aplica. |
| D506 | P7: docs/28 frente al as-built | (A) Se actualiza docs/28 al as-built (CSS propio, gráficos SVG propios). No se migra a Tailwind, shadcn/ui ni ECharts. | Tarea de documentación del lote L1. |
| D507 | P8: matriz de E2E | (B) Se agrega WebKit; P10 fija la forma concreta. | Ver D509. |
| D508 | P9: límite de tiempo de «Deshacer» | (B) Persistente hasta cerrar el aviso o salir de la página. Después se anula desde el detalle. Sin el límite de 10 s de docs/28 §4.1. | Lote L2. docs/28 §4.1 se corrige en la tarea de documentación del lote L1. |
| D509 | P10: cómo se cubre Safari/WebKit en E2E | (B) Un proyecto `webkit` de Playwright con ≈ 5 specs (`app-shell`, `a11y`, `transactions`, `auth`, `content-security-policy`) dentro del job `e2e` existente, **después de un spike** que confirme que el login funciona en WebKit con la cookie de sesión `Secure` sobre `http` de loopback. **Excepción del owner:** si el spike falla, cambiar el atributo de la cookie en pruebas (o cualquier otra alternativa que toque la sesión, como servir el stack del E2E por HTTPS) es una decisión de seguridad que **vuelve al owner**. Ninguna sesión la toma por su cuenta. | Lote L1, grupo condicionado. Si el spike falla, se registra el resultado, se abre la pregunta en un `docs/NN-…-questions.md` y el resto de L1 sigue sin WebKit. |
| D510 | P11: dónde se guarda la última cuenta usada | (B) `localStorage` por usuario y workspace (por dispositivo, sin auditoría y sin tocar `Me.version`). | Lote L2. Si más adelante el owner quiere que viaje entre dispositivos, se pasa a `preferences` de `/me` con escritura solo al cambiar (opción A). |
| D511 | P12: navegación del cliente o por documento completo | (B) Change aparte `adopt-client-navigation`, después de medir INP y navegación (M-30, lote L5). Mientras tanto se mantiene la navegación por documento completo **sin** construir M-29 (`@view-transition`), porque las dos vías se excluyen. | Fila propia en docs/03 §7, después de L5. M-29 sale del lote L7 hasta que se resuelva `adopt-client-navigation`. |
| D512 | Pedido del owner: quién implementa | Los lotes L1–L7 y `adopt-client-navigation` los implementa el agente **`frontend`**. El agente `arquitecto` redacta los changes y el `implementador` puede archivar y cerrar los PR, como en el resto del proyecto. | Cada tarea de implementación de L1 y L2 está escrita para que la ejecute `frontend`, con criterios comprobables (E2E de Playwright, axe, i18n es/en/pt y la CSP de `apps/web/proxy.ts`). |
| D516 | Respuesta a la excepción de D509 ([docs/84](84-webkit-e2e-questions.md), P1), contestada el 2026-11-25 en el chat tras el spike fallido | (B) **El stack de E2E se sirve por HTTPS** con un certificado de prueba. La cookie de sesión **no se toca**: ni su nombre `__Host-`, ni `Secure`, ni ningún otro atributo, ni `bff.ts`. Se descartan (A) posponer WebKit y (C) relajar la cookie en pruebas. | Change aparte `add-e2e-https` (fila 86 de docs/03 §7) que sirve el stack por HTTPS y agrega el subconjunto de ≈ 5 specs en WebKit dentro del job `e2e` (la forma de D509). Spike en Linux del 2026-11-25: WebKit no envía la cookie `Secure` sobre `http://localhost` pero sí sobre HTTPS con certificado autofirmado (docs/84). Ningún check obligatorio nuevo. |

## Decisiones de diseño derivadas (del arquitecto, no del owner)

Estas no son decisiones del owner: las toma el diseño de los changes para aplicar las de arriba. Se pueden revisar en la revisión de cada change.

- **Capability nueva `platform/web-interface`** (ARCHITECTURE §14): patrones transversales de la interfaz web, como la accesibilidad de formularios, los diálogos de confirmación, la región de avisos, el movimiento y la cobertura de navegadores. Hoy no existe ninguna capability de UI transversal; los lotes L3–L7 la reutilizan. Lo propio de un flujo de negocio (por ejemplo, el alta rápida) sigue en la capability de su contexto (`transactions/transaction-recording`).
- **Numeración en docs/03 §7:** los changes de UI/UX ocupan las filas 77 a 84, en un bloque propio separado de Phase 9 de producto. No hay migraciones ni contratos de API en L1 y L2, así que no compiten con los changes 72–76.
- **Hasta 3 avisos visibles** en la región de avisos de L2: el más antiguo sale cuando entra el cuarto. La misma información queda en el detalle de cada transacción, desde donde se anula.

## Qué cambia en la práctica

- **Se redactan L1 y L2** (Must): [`refine-web-accessibility-foundations`](../openspec/changes/refine-web-accessibility-foundations/proposal.md) y [`add-quick-capture`](../openspec/changes/add-quick-capture/proposal.md). L2 depende de L1 solo por la utilidad de foco al primer error (M-01) y se archiva después.
- **L3–L7 y `adopt-client-navigation`** quedan como filas de docs/03 §7 con su dependencia y su orden. Se redactan cuando toque implementarlos.
- **`CLAUDE.md`** gana la línea «Soporte de navegadores» (D500).
- **docs/28** se actualiza en el lote L1: as-built sin Tailwind, shadcn/ui ni ECharts (D506), fuentes del sistema (D505) y «Deshacer» persistente (D508).
- **Pendiente del owner:** solo el resultado del spike de WebKit, si falla (D509). **Resuelto por D516:** el spike falló y el owner eligió servir el E2E por HTTPS (change `add-e2e-https`).
