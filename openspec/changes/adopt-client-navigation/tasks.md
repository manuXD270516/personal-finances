# Tareas

> Change 84 (P12 de [docs/78](../../../docs/78-propuesta-mejora-ui-ux-modern-web.md)); decisiones D500, D511 y D512 en [docs/79](../../../docs/79-ui-ux-modern-web-decisions.md); preguntas en [docs/85](../../../docs/85-ui-lotes-l6-l7-questions.md) (**la 5 bloquea los grupos 5 a 7**; la etapa 1, grupos 1 a 4, no espera). **Lo implementa el agente `frontend` (D512).** Depende del change 81 (medición de INP, archivado). Gates: los de `CLAUDE.md`, más `pnpm test:e2e` con `PF_E2E_PROJECT=pfos-e2e-<nombre>` y puertos con prefijo 3 o 4 si cambia la UI (etapa 2). Reglas comunes: ningún `<style>` ni `<script>` en línea ni dependencia nueva (CSP de `apps/web/proxy.ts`); política de navegadores de D500; claves i18n nuevas en `messages/{es,en,pt}.json` en el mismo commit.

## 1. SPEC y TEST CASES

- [x] 1.1 Revisar el delta de `platform/web-interface` contra D511, el resultado de M-30 del change 81 y docs/78 § 11.1 punto 6; `openspec validate adopt-client-navigation --strict`
- [x] 1.2 Revisar TC-PLATFORM-CLIENTNAV-001 y -002 y pasarlos a `ready` (quedan `automated`); 003..014 quedan en `draft` hasta la pregunta 5

## 2. DOMAIN

- [x] 2.1 Sin lógica de dominio: el change es de la capa interface de `apps/web` y de `tests/e2e`

## 3. Etapa 1: medición (sin condición)

- [x] 3.1 `tests/e2e/src/navigation-timing.ts` (design, decisión 1): marca del clic, espera del contenido propio por `data-testid`, LCP con `PerformanceObserver` en `addInitScript`, perfiles de escritorio y de teléfono modesto por CDP (`Network.emulateNetworkConditions` «Fast 4G» y `Emulation.setCPUThrottlingRate` ×4), mediana de 3 corridas e informe puro que nunca lanza. Criterio: test unitario del informe (`navigation-timing.test.ts`): TC-PLATFORM-CLIENTNAV-001 (parte unitaria)
- [x] 3.2 `tests/e2e/specs/navigation.spec.ts` en el proyecto `inp` (fuera del job de PR): Inicio → Transacciones, Presupuestos, Reportes y lista → detalle de un gasto de 45.00 BOB, en los dos perfiles; adjunta el informe con `testInfo.attach`. Criterio: TC-PLATFORM-CLIENTNAV-001, -002

## 4. Etapa 1: resultado y decisión

- [x] 4.1 Correr la medición 3 veces en local con `PF_E2E_PROJECT=pfos-e2e-<nombre> … --project=inp --no-deps` y anotar aquí las medianas por destino y perfil **Resultado (2026-11-27):** Medianas de 3 corridas por destino (mediana de las medianas de tres corridas completas de la spec, Chromium local, usuario nuevo con un gasto de 45.00 BOB, tras una pasada de calentamiento no contada), contenido propio / LCP en ms. Escritorio: Inicio → Transacciones 180 / 164, Inicio → Presupuestos 146 / 152, Inicio → Reportes 127 / 152, lista → detalle de gasto 187 / 200. Teléfono modesto («Fast 4G» y CPU ×4): 1 663 / 1 421, 1 386 / 1 397, 1 388 / 1 613 y 1 718 / 1 745. El peor valor aislado fue 2 392 / 2 424 (detalle de gasto, una de las tres corridas completas, con el PC compartido con otro agente), por debajo de 2.5 s. **Ningún destino supera 2.5 s en el teléfono modesto.** Corridas: 1.ª: 1 663 / 1 376 / 1 343 / 1 637 de contenido en el teléfono; 2.ª: 1 648 / 1 411 / 1 430 / 2 392; 3.ª: 1 664 / 1 386 / 1 388 / 1 718. Notas: TTFB es la llegada de las cabeceras y la emulación de latencia de CDP no la afecta (≈ 25 ms en ambos perfiles; sí afecta al cuerpo y a los recursos); caché de HTTP caliente tras la pasada de calentamiento; «Presupuestos» sale del enlace del widget de Inicio, no de la navegación principal.
- [ ] 4.2 Aplicar la respuesta de la pregunta 5: con (B), migrar solo si alguna mediana del perfil de teléfono modesto supera 2.5 s. **Si no se migra:** retirar del delta los requirements «Navegación entre secciones sin recargar el documento», «Foco y anuncio al cambiar de sección», «Historial y posición de desplazamiento», «Documento nuevo al cambiar de contexto» y «Sesión y seguridad en la navegación sin documento nuevo»; pasar TC-PLATFORM-CLIENTNAV-003..014 a `deprecated`; marcar los grupos 5 a 7 `[x]` con esta nota; avisar al change 83 (tarea 6.1, M-29) y actualizar D511 en docs/03 §7

## 5. Etapa 2: UI (`apps/web`), **condicionada a la tarea 4.2**

- [ ] 5.1 `src/ui/common/AppLink.tsx` sobre el `Link` de `createNavigation(routing)` de next-intl, con `prefetch={false}` (decisión 3); test estático que rechaza `<a href="/…">` internos sin la marca `full-load:`. Recontar las anclas internas y anotar la cuenta. Criterio: TC-PLATFORM-CLIENTNAV-003..005
- [ ] 5.2 Migrar las anclas internas a `AppLink` por dominio (marco y navegación; transacciones; plan; reportes; deudas; resto), un PR por dominio. Criterio: TC-PLATFORM-CLIENTNAV-003, -014 y los specs E2E del dominio en verde
- [ ] 5.3 Documento nuevo para idioma, workspace y cierre de sesión; revisar uno por uno los `location.assign` tras crear un recurso (decisión 4) y anotar cuáles pasan a `router.push` y cuáles quedan con `full-load:`. Criterio: TC-PLATFORM-CLIENTNAV-011, -012
- [ ] 5.4 `AppFrame`: vaciar los avisos al cambiar de ruta (decisión 5), foco a `<main tabIndex={-1}>` tras cada cambio de ruta y anunciador de rutas presente (decisión 6); inventario del estado del marco que hoy se reiniciaba con la recarga. Criterio: TC-PLATFORM-CLIENTNAV-006..008
- [ ] 5.5 Sesión vencida en una navegación del cliente (decisión 8): redirección al login sin datos. Criterio: TC-PLATFORM-CLIENTNAV-013

## 6. Etapa 2: E2E, **condicionada a la tarea 4.2**

Spec nuevo `tests/e2e/specs/client-navigation.spec.ts`, con el TC-id al inicio de cada `test(...)`:

- [ ] 6.1 Helper `waitForSection(page, testId)` y specs existentes que esperaban `ready` tras navegar migrados a él (decisión 9), por dominio junto con 5.2
- [ ] 6.2 Sin documento nuevo (`performance.getEntriesByType('navigation')` sin cambios y sin petición nueva a `/api/v1/me`), Ctrl + clic en pestaña nueva con sesión, ruta en inglés, avisos vaciados tras registrar un gasto de 25.00 BOB: TC-PLATFORM-CLIENTNAV-003..006
- [ ] 6.3 Foco al principio del contenido y título del documento solo con teclado; región en vivo del anunciador con el título de Transacciones: TC-PLATFORM-CLIENTNAV-007, -008
- [ ] 6.4 Atrás con la posición de desplazamiento restaurada y sección nueva desde el principio: TC-PLATFORM-CLIENTNAV-009, -010
- [ ] 6.5 Cambio de workspace de «Casa» a «Negocio» sin el gasto de 45.00 BOB y cierre de sesión con Atrás sin datos: TC-PLATFORM-CLIENTNAV-011, -012
- [ ] 6.6 Cookie de sesión borrada antes del clic (login sin transacciones) y recorrido sin eventos `securitypolicyviolation`: TC-PLATFORM-CLIENTNAV-013, -014
- [ ] 6.7 Repetir la medición de la etapa 1 con la navegación del cliente y anotar la comparación
- [ ] 6.8 Suite E2E completa en verde dos veces con `PF_E2E_PROJECT=pfos-e2e-<nombre>` (incluido el subconjunto WebKit del job `e2e`); actualizar el front matter de los TC automatizados

## 7. Etapa 2: AUTOMATED TESTS de componentes, **condicionada a la tarea 4.2**

- [ ] 7.1 Tests unitarios de `AppLink` (prefijo de idioma, `prefetch={false}`), del vaciado de avisos y del test estático de anclas, con el TC-id al inicio del nombre

## 8. DOCUMENTATION

- [ ] 8.1 docs/78 § 11.1 punto 6 y D511: resultado de la medición y decisión tomada
- [ ] 8.2 docs/28: navegación (documento o cliente) al as-built; NFR-PERF-004 en docs/02 con la medición de navegación como verificación informativa
- [ ] 8.3 `pnpm spec:validate`, `pnpm traceability:check` y `pnpm format:check`; docs/38 y la fila 84 de docs/03 §7 con el estado del change
