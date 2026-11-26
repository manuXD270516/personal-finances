# 84: Preguntas del owner sobre WebKit en E2E (spike del change `refine-web-accessibility-foundations`)

> **Fecha:** 2026-11-25 · **Origen:** tarea 6.1 del change `refine-web-accessibility-foundations` (D509 en [docs/79](79-ui-ux-modern-web-decisions.md)) · **Respuesta:** P1 contestada el 2026-11-25 (D516 en [docs/79](79-ui-ux-modern-web-decisions.md)); P2 abierta · **Relacionado:** change [`add-e2e-https`](../openspec/changes/add-e2e-https/proposal.md), `apps/web/src/bff/bff.ts` (cookies `__Host-pfos_sid` y `__Host-pfos_login`), `tests/e2e/playwright.config.ts`, NFR-USAB-005, D500.

D509 dejó el proyecto `webkit` de Playwright condicionado a un spike de una hora: si la cookie `Secure` de sesión no persiste en WebKit sobre `http://localhost`, **no se toca la cookie ni el esquema** del stack de E2E (es una decisión de seguridad del owner) y la pregunta vuelve al owner. El spike falló, así que este documento la plantea. No se cambió ningún atributo de cookie, ni `bff.ts`, ni el stack de E2E. TC-PLATFORM-WEBUI-019 y -020 siguen en `draft` y las tareas 6.1 a 6.3 del change quedan marcadas «espera al owner (D509)».

> **Numeración:** este documento se creó como `docs/80-webkit-e2e-questions.md` y se renumeró a 84 el 2026-11-25: el 80 ya lo usa [docs/80](80-anomaly-calibration-questions.md) (calibración de anomalías), y el 81 y el 82 los toman ramas abiertas en paralelo (decisiones de la calibración, PR #293, y preguntas de los lotes L3–L5, PR #294). El 83 queda libre para las decisiones de L3–L5. Por la misma razón la respuesta del owner es **D516**: D513–D515 los usa la calibración de anomalías.

## Resultado del spike

Entorno: Playwright 1.63.0, WebKit de Playwright en **Windows 11** (el spike se corre en la PC del owner; el job `e2e` de CI corre en Linux y **no se probó**). Stack `pfos-e2e-uil1` (proyecto desechable, puertos con prefijo 3), proyecto `webkit` temporal con `auth.spec.ts`.

| Prueba | Chromium | WebKit |
|---|---|---|
| Login OIDC contra el stack (`/api/bff/auth/login` → Keycloak → `/api/bff/auth/callback`) | funciona | el callback llega **sin cabecera `Cookie`**; el BFF redirige a `/auth/error?reason=state` y no se crea la sesión |
| Control aislado: un servidor HTTP mínimo en `http://localhost:<puerto>` que responde `Set-Cookie: __Host-sec=1; Path=/; HttpOnly; Secure; SameSite=Lax` y `plain=1; Path=/; HttpOnly; SameSite=Lax`; el servidor lee `Cookie` en la petición siguiente | recibe `__Host-sec=1; plain=1` | recibe solo `plain=1` |

Conclusión: WebKit guarda la cookie `Secure` pero **no la envía sobre `http://localhost`**, con independencia de la aplicación (el control aislado lo reproduce sin código de PFOS). Chromium aplica la excepción de loopback; WebKit, en esta plataforma, no. Con la cookie de producción tal cual (`__Host-`, `Secure`, `HttpOnly`, `Path=/`, `SameSite=Lax`) ninguna sesión sobrevive en WebKit en el stack de E2E actual.

Qué no se pudo comprobar: si WebKit sobre **Linux** (el motor que usaría el job `e2e` de GitHub Actions) tiene la misma restricción. Es probable, pero no está verificado. Una forma barata de saberlo es una corrida de prueba en una rama descartable con el proyecto `webkit`, sin fusionarla.

## Pregunta única

**P1. ¿Cómo se cubre WebKit en E2E dado que la cookie `Secure` no viaja sobre `http://localhost`?**

| Opción | Qué implica | Costo y riesgo |
|---|---|---|
| (A) **Posponer WebKit en E2E** y dejar NFR-USAB-005 como está: Chromium en CI más la verificación manual en Safari (escritorio y iPhone) antes de cada lote de UI que toque diálogos, formularios o pestañas. | Sin cambios de código ni de seguridad. TC-PLATFORM-WEBUI-019 y -020 pasan a `deprecated` o quedan `draft` hasta nueva decisión. | Cero costo de CI. La cobertura de Safari depende de una revisión manual y los fallos de WebKit se descubren tarde. |
| (B) **Servir el stack de E2E por HTTPS** (certificado de prueba autofirmado, o un proxy TLS delante de `finance-web` y Keycloak) para el proyecto `webkit` y, si hace falta, para todos. | La cookie de producción queda idéntica (`Secure`). Cambia el esquema del stack de E2E: `WEB_PUBLIC_URL`, `OIDC_ISSUER_URL`, redirecciones del realm y confianza del certificado en el navegador y en los contenedores. | Es un change de infraestructura de E2E (estimación: 1 a 2 días) con riesgo de romper el resto de la suite al cambiar de esquema. Es la única opción que prueba la cookie real en WebKit. |
| (C) **Relajar un atributo solo en pruebas** (p. ej. emitir la cookie sin `Secure` ni prefijo `__Host-` cuando `E2E_INSECURE_COOKIES=1`). | WebKit funcionaría sobre `http`. Introduce una rama de código de seguridad que existe solo para pruebas. | Contradice el escenario «sin relajar ningún atributo para las pruebas» de la spec y D509; el riesgo es que la bandera llegue a producción. No se recomienda. |

**Recomendación: (A) ahora, con (B) como change aparte si el owner quiere cobertura automática de Safari.** La cookie `__Host-pfos_sid` no se toca. WebKit aporta valor sobre todo en diálogos, foco y formularios, que L1 ya cubre en Chromium con los TC 001 a 018; mientras no haya sesión en WebKit, un proyecto que no puede iniciar sesión solo agregaría falsos rojos. Si el owner elige (B), conviene antes confirmar en una rama descartable si WebKit sobre Linux tiene la misma restricción: si no la tiene, el subconjunto puede correr en CI sin cambiar el esquema y la opción (B) deja de hacer falta para el job de GitHub (seguiría haciendo falta para correrlo en la PC del owner).

## Qué queda hecho y qué espera

- Hecho: el spike y su evidencia (arriba); el resto del change (`ConfirmDialog`, foco al error, movimiento, colores forzados, pestañas, Enter con composición) no depende de esto.
- Espera al owner: las tareas 6.1 (cierre con la nota del resultado), 6.2 y 6.3 del change, los TC-PLATFORM-WEBUI-019 y -020 (`draft`) y el texto de verificación de NFR-USAB-005 en docs/02 (se dejó con la nota de que espera al owner).
- **El change no se archiva** mientras estas tareas sigan abiertas. Si el owner elige (A), se cierran 6.1 a 6.3 como diferidas por decisión del owner y se archiva.

## Respuesta del owner a P1 (D516)

El owner contestó el 2026-11-25 en el chat: **(B), servir el E2E por HTTPS**, sin tocar la cookie ni ninguno de sus atributos. Queda registrado como **D516** en [docs/79](79-ui-ux-modern-web-decisions.md) y lo implementa el change [`add-e2e-https`](../openspec/changes/add-e2e-https/proposal.md) (fila 86 de docs/03 §7).

## Spike en Linux (2026-11-25)

Antes de redactar el change se repitió el control aislado en el motor del job `e2e`: un workflow temporal en una rama descartable (sin PR, borrada al terminar) sobre `ubuntu-latest`, con Playwright 1.63.0 (WebKit 26.6 y Chromium 153). El servidor mínimo emite la misma cookie que el BFF (`__Host-`, `Path=/`, `HttpOnly`, `Secure`, `SameSite=Lax`) y una sin `Secure`; un segundo caso imita el login (cookie `__Host-login` en `/login`, 302 al proveedor de identidad y 302 de vuelta al callback). El certificado autofirmado se generó en el runner y se descartó con él.

| Caso | Chromium | WebKit |
|---|---|---|
| `http://localhost` y `http://127.0.0.1` | envía las dos cookies | envía solo la que no es `Secure` |
| `https://localhost` autofirmado con `ignoreHTTPSErrors` | envía las dos | envía las dos |
| Login: web `http`, proveedor `http` | la cookie llega al callback | el callback llega **sin cookie** |
| Login: web `https`, proveedor `http` | llega | llega |
| Login: web `https`, proveedor `https` | llega | llega |

Conclusión: en Linux pasa lo mismo que en Windows sobre `http`, así que la opción (B) también hace falta para el job de GitHub. Sobre HTTPS con un certificado de prueba la cookie de producción viaja sin cambios. Falta comprobar WebKit en Windows sobre HTTPS (tarea 1.2 del change `add-e2e-https`).

## Pregunta nueva

**P2. ¿Cómo se cierra el change 77 (`refine-web-accessibility-foundations`)?** No bloquea la implementación de `add-e2e-https`; bloquea solo el archivado del 77.

| Opción | Qué implica | Costo y riesgo |
|---|---|---|
| (A) **Archivar el 77 ya.** 6.1 se cierra con el resultado de los dos spikes; 6.2 y 6.3 se marcan `[x]` como «diferidas por decisión del owner (D516) al change `add-e2e-https`». El requirement «Cobertura de la interfaz en WebKit» entra a la spec principal y TC-PLATFORM-WEBUI-019 y -020 quedan `draft` hasta que el 86 los automatice. | Es una excepción a la regla de archivar con los TC automatizados: dos TC `draft` de un change archivado, con el change que los automatiza nombrado en la tarea y en el TC. | Bajo. `pnpm traceability:check` lo admite (solo exige que el TC exista y que el requirement esté cubierto). El 86 queda independiente del orden de archivado. |
| (B) **El 77 espera al 86.** Se archiva cuando el 86 esté fusionado, con 6.1 a 6.3 hechas y los TC `automated`. | Cumple la regla al pie de la letra. | El 77, ya fusionado, queda abierto uno o más días más y el 86 debe archivarse antes. Si el 86 se demora, el requirement de WebKit no entra a la spec principal. |

**Recomendación: (A).** El trabajo del 77 está hecho y en `main`; lo único pendiente pasa a un change con nombre, tareas y TC propios, y la trazabilidad no se pierde.
