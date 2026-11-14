# Decisión de despliegue: PFOS

**Fecha:** 2026-11-14. **Método:** panel de 9 agentes con la skill `estrategia-despliegue`, profundidad `normal`. Tres agentes defendieron una plataforma cada uno, tres críticos atacaron cada propuesta verificando sus supuestos contra el repo y la documentación oficial, y tres jueces con lentes distintas (costo, seguridad y operación) puntuaron, ordenaron y votaron sin verse entre sí. El conteo lo hizo el script del panel. No hizo falta árbitro: hubo consenso.

**Esta decisión ratifica [ADR-0027](../adr/0027-destino-de-despliegue-inicial-vps-compose.md) y no lo reemplaza.** El panel tomó el N1 de ADR-0027 como candidato obligado y lo enfrentó con dos alternativas distintas de verdad: el fallback N1-F del mismo ADR (Oracle A1) y una PaaS (Fly.io). El resultado confirma N1 y agrega condiciones que hay que cumplir antes del primer `tofu apply` y antes de cargar datos reales. Están en el [runbook](RUNBOOK-DESPLIEGUE.md).

## Resultado

Gana **AWS Lightsail 2 GB en São Paulo con Docker Compose (`lightsail-n1`, N1 de ADR-0027)**: es el único candidato con IaC, cloud-init, timers de respaldo, `deploy.yml` y runbook ya escritos, tiene el mejor modelo de acceso del panel y entra en el tope de costo. Costo: **≈ USD 14,5 por mes** (≈ 16 con impuestos estimados). Plan B: **Oracle Cloud A1 en Santiago (`oracle-a1`, N1-F)**, si el PoC de 48 h muestra que 2 GB no alcanza y el owner no amplía el presupuesto para N2.

| Criterio | Peso | Por qué pesa | lightsail-n1 | oracle-a1 | fly |
|---|---:|---|---:|---:|---:|
| Costo | 20 | Tope duro de USD 20 por mes, todo incluido | 3,33 | 3,67 | 1,00 |
| Ajuste al stack | 20 | PG 18 con RLS y PITR, worker persistente, Keycloak propio y las mismas imágenes por digest | 2,33 | 2,00 | 2,00 |
| Seguridad | 25 | Datos financieros personales: +5 sobre la rúbrica por datos sensibles | 4,00 | 3,00 | 2,00 |
| Operación | 15 | Un solo operador | 2,67 | 2,00 | 2,00 |
| Reversibilidad | 15 | Rollback por digest, PITR fuera del proveedor y salida en horas | 3,00 | 2,67 | 2,67 |
| Esfuerzo | 5 | −5 sobre la rúbrica: la IaC ya existe y el esfuerzo pesa poco frente a la seguridad | 4,00 | 2,00 | 2,00 |
| **Puntaje sobre 5** | | | **3,18** | 2,68 | 1,90 |
| **Votos (Borda)** | | | **6** | 3 | 0 |
| **Primeros puestos** | | | **3** | 0 | 0 |
| **Veto** | | | no | no | **sí, 3 de 3** (costo) |

Consenso: 3 de 3 jueces pusieron primero a `lightsail-n1` y los tres ordenaron igual (Lightsail, Oracle, Fly). No hubo árbitro (`requiereArbitro: false`).

Los puntajes por criterio son el promedio de los tres jueces. Fly quedó vetado por mayoría: los tres jueces lo vetaron por costo.

## El proyecto, en lo que importa para desplegarlo

- Multiservicio en contenedores: Caddy, `finance-web` (Next con BFF), `finance-api`, `finance-worker` (pg-boss con LISTEN/NOTIFY y crons en America/La_Paz), PostgreSQL 18 con pgBackRest, Keycloak 26, SeaweedFS y el servicio opcional `finance-ml` (ADR-0033).
- Datos financieros sensibles de una sola persona, con RLS forzada, documentos cifrados por la aplicación y requisitos de RPO ≤ 15 min y RTO ≤ 4 h ([docs/30](../30-backup-and-disaster-recovery.md)).
- Uso personal desde Bolivia: un usuario y unos cientos de peticiones por día (supuesto del perfil). La latencia y el costo pesan más que la disponibilidad.
- Memoria estable medida **en local**: ≈ 1,4–1,7 GiB sin ML. Los techos de `compose.prod.yaml` suman 2400m sin ML y 2720m con ML, sobre un host de 2 GB con 2 GiB de swap.
- Repo público y trunk (`main` protegida, deploy manual por digest con aprobación).
- Perfil completo: [perfil-despliegue.json](perfil-despliegue.json).

## Restricciones

| Restricción | Qué vetó |
|---|---|
| Costo ≤ USD 20 por mes, con respaldos y DNS | **Fly.io** (≈ USD 37–42 en `gru`, más con la HA por omisión). También deja fuera N2, N3 y N4 de ADR-0027 sin una ampliación del owner |
| PostgreSQL 18 con RLS, roles propios y PITR | Fly Managed Postgres (solo PG 16/17) y Supabase (PG 17). Ya lo había registrado ADR-0027 |
| Worker persistente | Plataformas con scale-to-zero o sin procesos de fondo |
| Mismas imágenes por digest que CI | Cualquier destino que reconstruya. A Oracle A1 lo obliga a sumar multi-arch |
| Secretos solo en el host o en la consola | Penalizó a Fly: su token de deploy en GitHub da acceso a todos los secretos de la app |
| Owner acepta cargar la tarjeta | No vetó a nadie. Los tres candidatos la piden |

## Por qué ganó

- **Ya está construido.** `infra/modules/lightsail-host`, `infra/modules/b2-backups`, `infra/environments/prod`, `deploy/compose/compose.prod.yaml`, `deploy/host/` (deploy, backups y timers) y `.github/workflows/deploy.yml` existen. Antes del `apply` faltan cambios acotados al cloud-init y a los buckets (quinto digest, `ufw`, retención de los mensuales y hora del snapshot). Fuente: crítica de `lightsail-n1` y `cloud-init.yaml.tftpl:48-50`.
- **Mejor modelo de acceso del panel**, según el juez de seguridad: sin SSH público, deploy por Tailscale con federación OIDC hacia un comando forzado que solo acepta digests, secretos solo en `/etc/pfos` y Caddy como único proceso con puertos públicos. Fuente: `cloud-init.yaml.tftpl`, `lightsail-host/main.tf` (firewall 80/443 y 22 solo para `lightsail-connect`).
- **Precio fijo verificado:** USD 12 por la instancia de 2 GB con IPv4, 60 GB de SSD y 1,5 TB de transferencia en São Paulo. Fuente: aws.amazon.com/lightsail/pricing, verificado el 2026-11-14 por el proponente.
- **PITR independiente del proveedor:** pgBackRest cifra del lado cliente hacia Backblaze B2 con Object Lock, así que salir de AWS no pierde los respaldos.
- **Ruta de crecimiento sin rediseño:** N2 es solo `lightsail_bundle_id = "medium_3_0"`. Requiere ampliar el presupuesto.

## Por qué no los otros

- **Oracle A1 (2,68, segundo):** cuesta ≈ USD 1,5, tiene 6 veces la RAM y la mejor latencia (63 ms). Pero exige imágenes multi-arch en `main.yml` (hoy `platforms: linux/amd64`, línea 64), un módulo `oci-host` nuevo y un cloud-init adaptado a las iptables de Oracle. La variante arm64 no pasaría por verify-by-digest ni por el smoke. Corre además el riesgo de reclamo de instancias ociosas: la memoria residente ronda el umbral del 20 %. Queda como **plan B**.
- **Fly.io (1,90, vetado):** cumple lo técnico con una Machine propia para PG 18, pero cuesta USD 37–42 por mes en `gru`. Además, la crítica encontró una afirmación de seguridad falsa (el token de deploy sí expone los secretos), omisión de la réplica de documentos, red `.internal` solo IPv6 con binds en 0.0.0.0 y respaldos que dependen de crons de Actions que GitHub desactiva tras 60 días.

## Hallazgos que condicionan el diseño

La crítica de `lightsail-n1` dio el veredicto «viable con cambios» y refutó cuatro supuestos de la propuesta y de ADR-0027:

1. **«Drill de restore mensual automatizado que falla si no restaura»: no existe.** `deploy/host/systemd/` solo tiene `backup-check`, `backup-diff`, `backup-full`, `backup-monthly` y `docs-replica`. El drill de `deploy-and-restore.md` §6 es manual. Pasa a ser un cambio de código y un requisito antes de los datos reales.
2. **«RTO ≈ 1 h desde snapshot» no es una vuelta atrás limpia.** El snapshot pierde hasta 24 h de datos y, si PostgreSQL vuelve a archivar WAL en la misma stanza, rompe la continuidad del PITR. Además sale a las 06:00 UTC, el mismo minuto que el full o el diff. Pasa a ser una advertencia del runbook y un cambio de horario.
3. **«1,4–1,7 GiB» no incluye el host.** Faltan dockerd, containerd, tailscaled y journald, unos 150–300 MiB. Pasa a ser la regla de corte del PoC, medida sobre el host completo.
4. **«No cambia nada» es falso.** Faltan la limpieza de imágenes, un Keycloak optimizado o con techo mayor, el quinto digest en el comando forzado y una revisión de pgBackRest dentro del techo de 384m de PostgreSQL.

Las demás objeciones (Object Lock de 21 días contra la clave con `deleteFiles`, pgBackRest con Object Lock sin probar y el pago desde Bolivia) quedaron como brechas o reglas de corte. La lista completa, ordenada por riesgo, está en el [runbook](RUNBOOK-DESPLIEGUE.md#brechas-a-cerrar-antes-del-primer-apply) y las tareas, en [cambios-de-codigo.md](cambios-de-codigo.md).

## Costos aceptados

| Se resigna | Mitigación |
|---|---|
| Sin alta disponibilidad: un solo host y un solo blast radius | RTO ≤ 4 h desde B2 y drill programado. Uso personal |
| El owner opera los parches del SO, Docker, PITR y la custodia de claves | `unattended-upgrades` con reinicio a las 04:30 La Paz, timers de respaldo con heartbeat, tareas de mantenimiento con frecuencia |
| Memoria justa: 2 GB con techos que suman más que la RAM | PoC de 48 h con regla de corte. ML apagado por omisión y primero en apagarse |
| CPU con ráfagas: base de 0,4 vCPU sostenida | Uso casi nulo. Vigilar `BurstCapacityPercentage`. Pronósticos de madrugada |
| Margen de costo de USD 4–5 sin verificar (impuestos y recargo de la tarjeta boliviana). AWS Budgets solo avisa, no corta | Regla de corte con la primera factura real |
| Si 2 GB no alcanza, no hay escalón vertical dentro del tope: N2 cuesta ≈ USD 27–30 | El owner decide de antemano entre ampliar el presupuesto o preparar el plan B |
| Repositorio público | Sin secretos ni datos en el repo, gitleaks en CI y secretos solo en `/etc/pfos` |

## Disenso

Los tres jueces votaron igual. No hubo disenso sobre el ganador, pero cada uno dejó una preocupación, y quedan como riesgos documentados:

- **Juez de costo:** el costo y la memoria están atados. Si el PoC falla, el escalón de 4 GB rompe el tope y la salida barata (Oracle A1) todavía no existe. Pide el PoC midiendo el host completo, confirmar la primera factura real y dejar presupuestado el plan B (multi-arch o un tope mayor aprobado).
- **Juez de seguridad:** el acceso está bien resuelto, pero la red de seguridad de los datos no está probada. El Object Lock de 21 días con `deleteFiles` deja los 12 mensuales borrables desde un host comprometido. pgBackRest con Object Lock nunca se probó y el drill es manual. Antes de los datos reales pide un restore PITR real desde B2, un drill programado que falle de forma visible, la custodia de las claves maestras fuera del host y el cierre del 22.
- **Juez de operación:** hay tres trampas silenciosas: imágenes viejas que llenan el disco, el drill que no existe y la memoria medida solo en local. Agrega Keycloak sin `--optimized` (techo de 704m y base de 0,4 vCPU), que puede fallar al arrancar y disparar rollbacks en cadena. Antes del primer apply exige un timer de limpieza, un drill con timer que avise y Keycloak optimizado o con un techo mayor.

## Cambios de código que el despliegue necesita

La lista completa, con archivo, motivo y cuándo, está en [cambios-de-codigo.md](cambios-de-codigo.md). Resumen:

- [ ] Comando forzado del cloud-init con el quinto digest (`finance-ml`), **antes del primer apply**, y la salida `ml` del job `resolve` de `deploy.yml`, que hoy falta y deja el digest sin enviar.
- [ ] Retención de los respaldos mensuales protegida contra un host comprometido (bucket o lock aparte), antes del primer respaldo.
- [ ] Hora del snapshot de Lightsail fuera de la ventana de respaldos.
- [ ] Timer de drill de restore que avise si falla.
- [ ] Timer de limpieza de imágenes y alerta de disco.
- [ ] Keycloak con build optimizado o techo mayor.
- [ ] Volumen 0400 de la clave privada de conexiones en `compose.prod.yaml`.
- [ ] `ufw` del puerto 22 con límite de tasa.
- [ ] Documentación desactualizada (runbook §2.1, §5.2 y §6, docs/30 §8, ADR-0033).
- [ ] Content-Security-Policy de la web (hoy no se declara).

## Qué reabriría esta decisión

- El PoC mide más de 85 % de memoria del host sostenida, swap-in continuo u `OOMKilled`, y el owner no amplía el presupuesto. Se pasa a N1-F (plan B), según ADR-0027.
- Dos drills de restore fallidos seguidos, o que pgBackRest no funcione con Object Lock en B2. Se pasa a N3 (Neon), fuera del tope actual.
- La primera factura real supera los USD 20.
- AWS cambia el precio de Lightsail en São Paulo, o Backblaze cambia Object Lock.
- Varios usuarios reales, HA o un RTO menor a 1 h. Se pasa a N4, según ADR-0027.
- Encender ML con memoria del host > 85 % (disparador de ADR-0033).
