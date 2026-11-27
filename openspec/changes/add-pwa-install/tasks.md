# Tareas

> Change 82, lote L6 de [docs/78](../../../docs/78-propuesta-mejora-ui-ux-modern-web.md); decisiones D500, D504 y D512 en [docs/79](../../../docs/79-ui-ux-modern-web-decisions.md); preguntas en [docs/85](../../../docs/85-ui-lotes-l6-l7-questions.md) (**la 1 bloquea las tareas 5.2 y 5.3**). **Lo implementa el agente `frontend` (D512).** Depende del change 79 (`theme-color` por esquema, ya archivado). Gates: los de `CLAUDE.md`, más `pnpm test:e2e` con `PF_E2E_PROJECT=pfos-e2e-<nombre>` y puertos con prefijo 3 o 4 (cambia la UI). Reglas comunes: claves i18n nuevas en `messages/{es,en,pt}.json` en el mismo commit (`src/i18n.test.ts` en verde); ningún `<style>` ni `<script>` en línea ni dependencia nueva (CSP de `apps/web/proxy.ts`); política de navegadores de D500; capturas a 360 × 800 y a 1280 × 800 con `testInfo.outputPath` en cada spec de UI nuevo.

## 1. SPEC y TEST CASES

- [x] 1.1 Revisar el delta de `platform/web-interface` contra D504 y docs/78 § 11.1 punto 10; `openspec validate add-pwa-install --strict`
- [x] 1.2 Revisar TC-PLATFORM-PWA-001..017 contra los scenarios y pasarlos a `ready` (el 017 es nuevo: ayuda fija para iPhone y iPad, pregunta 3 de docs/85, opción B; el delta ganó el scenario «Ayuda para iPhone y iPad»)

## 2. DOMAIN

- [x] 2.1 Sin lógica de dominio: el change es de la capa interface de `apps/web`

## 3. APPLICATION (utilidades de la UI, test-first)

- [x] 3.1 `src/ui/common/install.ts` (design, decisión 4): almacén del evento `beforeinstallprompt` (registrar, consumir, limpiar con `appinstalled`), `isStandalone(matchMedia)` y la interfaz local `BeforeInstallPromptEvent`. Criterio: test unitario con un `window` simulado (evento antes y después de montar, `appinstalled`, `standalone`): TC-PLATFORM-PWA-006..009 (parte unitaria)
- [x] 3.2 Test unitario de los íconos (en `src/ui/brand/pwa.test.tsx`, junto al del manifiesto y al marcado del botón): cada PNG declarado por el manifiesto existe, tiene la firma PNG y las dimensiones del manifiesto (lee el encabezado IHDR, sin dependencias). Criterio: falla sin los PNG y pasa tras 5.3: TC-PLATFORM-PWA-004 (parte unitaria)

## 4. INFRASTRUCTURE

- [x] 4.1 Sin cambios de BFF, CSP ni Docker: comprobar que `docker/web.Dockerfile` copia `apps/web/public` (ya lo hace) y que `proxy.ts` no necesita tocarse. Criterio: TC-PLATFORM-PWA-001 y -011 en verde

## 5. UI (`apps/web`)

- [x] 5.1 `app/manifest.ts` (decisiones 1 y 2) con los campos de la tabla, `THEME_COLOR.light` importado de `src/ui/common/theme.ts` y el atajo «Registrar gasto». Criterio: TC-PLATFORM-PWA-001, -003, -015
- [ ] 5.2 **(Espera la pregunta 1 de docs/85; hoy hay un marcador PROVISIONAL neutro en el SVG: un anillo y un disco blancos sobre el azul primario, sin texto ni marca.)** Fuente SVG del ícono en `src/ui/brand/app-icon.svg` con el diseño aprobado, motivo dentro de la zona segura y contraste ≥ 3:1 con su fondo. Criterio: captura del ícono en claro y en oscuro adjuntada al PR y aprobada por el owner
- [ ] 5.3 **(Espera la pregunta 1; los PNG actuales son PROVISIONALES, generados con `node apps/web/scripts/generate-app-icons.mjs`, que renderiza el SVG con el Chromium de Playwright de `tests/e2e` sin dependencia nueva. Al llegar el diseño definitivo: reemplazar el SVG y volver a correr el script.)** Generar una vez los PNG (`public/icons/icon-192.png`, `icon-512.png`, `icon-maskable-512.png` y `app/apple-icon.png` de 180 px) con un script documentado en esta tarea, sin dependencia nueva. Criterio: 3.2 en verde y TC-PLATFORM-PWA-005
- [x] 5.4 `InstallApp` (`src/ui/common/InstallApp.tsx`) en la sección «Aplicación» de Mis preferencias, cargado desde `AppFrame` para no perder el evento (decisión 4); claves `Preferences.install.*` en es/en/pt y texto fijo para iPhone y iPad sin aviso (pregunta 3, opción B). Criterio: TC-PLATFORM-PWA-006..009
- [x] 5.5 Comprobar que ninguna parte del código registra un service worker (`grep` de `serviceWorker` en `apps/web/src` y `app`), y anotarlo en la tarea. Hecho (2026-11-27): cero coincidencias fuera de las pruebas; lo vigila `pwa.test.tsx` (TC-PLATFORM-PWA-010). Criterio: TC-PLATFORM-PWA-010

## 6. AUTOMATED TESTS de componentes

- [x] 6.1 Tests unitarios de 3.1 y 3.2 con el TC-id al inicio del nombre (`it('[TC-PLATFORM-PWA-006] …')`); test de marcado estático del botón oculto por omisión

## 7. E2E (Playwright, Chromium)

Spec nuevo `tests/e2e/specs/pwa.spec.ts` (decisión 8), con el TC-id al inicio de cada `test(...)`:

- [x] 7.1 Manifiesto sin cookies (estado, `Content-Type`, sin redirección y campos), enlace desde Inicio, Transacciones y `/auth/error` en es/en/pt sin eventos `securitypolicyviolation`, y atajo: TC-PLATFORM-PWA-001, -002, -003
- [x] 7.2 Íconos declarados por el manifiesto y por la página pedidos sin cookies: estado 200, `image/png` y dimensiones: TC-PLATFORM-PWA-004
- [x] 7.3 Botón con un `beforeinstallprompt` sintético (aparece, se opera con teclado y llama a `prompt()`), ausente sin el evento, ausente con `display-mode: standalone` simulado y desaparición con `appinstalled`: TC-PLATFORM-PWA-006..009
- [x] 7.4 Sin service worker tras recorrer Inicio, Transacciones, el alta y Mis preferencias; directivas de la CSP idénticas a la base; sin conexión, la recarga no muestra el gasto de 45.00 BOB: TC-PLATFORM-PWA-010, -011, -012
- [x] 7.5 Cookie de sesión con su nombre y atributos tras iniciar sesión, y colores del manifiesto iguales a la superficie del tema claro: TC-PLATFORM-PWA-014, -015
- [ ] 7.6 Suite E2E completa en verde dos veces con `PF_E2E_PROJECT=pfos-e2e-<nombre>`; actualizar el front matter de los TC automatizados (`automated_tests`, `status: automated`, `automation_status: automated`)
- [ ] 7.7 Verificación manual en un Android (Chrome) y un iPhone (Safari) con el stack servido por HTTPS: instalar, abrir sin sesión, iniciar sesión y volver a Inicio, atajo «Registrar gasto» y barra en tema oscuro. Anotar dispositivo, versión y resultado en TC-PLATFORM-PWA-013 y -016 (quedan `manual`). Si no hay dispositivo antes de archivar, la tarea se cierra con la nota y el owner la prueba tras el despliegue N1

## 8. DOCUMENTATION

- [x] 8.1 docs/28 §11 al as-built: manifiesto, íconos, botón en Mis preferencias y sin service worker (D504)
- [x] 8.2 Runbook del despliegue N1 (`docs/despliegue/`): instalar solo desde el dominio definitivo (M-34, pregunta 2 de docs/85)
- [x] 8.3 Preguntas 2 y 3 de docs/85: aplicadas las recomendaciones (2: implementar sin depender del dominio, instalar solo desde el dominio de D452; 3: texto fijo para iPhone y iPad en Mis preferencias) por indicación de la sesión principal el 2026-11-27, anotado en docs/85. Siguen sin confirmación explícita del owner
- [ ] 8.4 `pnpm spec:validate`, `pnpm traceability:check` y `pnpm format:check`; docs/38 y la fila 82 de docs/03 §7 con el estado del change
