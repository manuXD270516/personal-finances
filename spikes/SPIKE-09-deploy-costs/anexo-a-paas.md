# SPIKE-09 — Anexo A: PaaS (Vercel, Railway, Fly.io, Render, …)

> Addendum a [SPIKE-09](README.md) pedido por el owner (decisión **D42**, [docs/31](../../docs/31-phase-1-consolidation-decisions.md)): evaluar las PaaS que usa en otros proyectos (**Fly.io** en `gru` con máquinas auto-stop, imagen en GHCR y volúmenes; **Railway** con builds Railpack/Dockerfile, migraciones `preDeploy` y healthchecks) además de **Vercel**, **Render** y similares. Investigación **documental**, sin cuenta en ninguna plataforma. Precios consultados el **2026-10-04** (fuentes en §8); todo lo marcado **(est.)** es una estimación propia; lo marcado **(verificar)** no se pudo confirmar en una fuente oficial. Cifras en USD/mes, sin impuestos (Bolivia: +~15 % est., ver README §12).

## 1. Restricciones duras (las mismas del README §3)

| Restricción | Por qué pesa en una PaaS |
|---|---|
| `finance-api` (`api`) + **`worker`** pg-boss | El worker hace polling continuo a PostgreSQL: **ni el worker ni la BD escalan a cero**. Auto-stop solo aplica a `web`/`api` |
| `finance-web` (Next.js 16, BFF) | Sesiones de servidor en PostgreSQL (`iam.bff_session`, rol `pf_bff`), cookies `Secure`/`SameSite`, refresh con lock; hoy imagen `output: 'standalone'` en GHCR |
| PostgreSQL **18** con RLS **forzada** y roles propios (`pf_app`, `pf_worker`, `pf_migrator`, `pf_ledger_maintenance`, `pf_workspace_directory`, `pf_bff`) + **PITR** | El rol de migración DEBE poder crear roles sin `BYPASSRLS` (ADR-0005, ADR-0023). Una BD gestionada sin `CREATEROLE` o sin PG 18 no sirve |
| Keycloak 26 | ≈ 550 MiB medidos, arranque en frío 30–80 s: debe quedar **siempre encendido** (un login no puede esperar un cold start) |
| Almacenamiento S3 con versioning y presigned POST | SeaweedFS validado (SPIKE-07); R2/B2 sin presigned POST (README §5.7) |
| Salida HTTPS a paralelo.bo / bo.dolarapi.com, cron (`LEDGER_INTEGRITY_CRON`, polling FX), OTLP | Egress libre y cron en proceso (pg-boss), no cron de plataforma |
| Deploy por **digest de GHCR** + **contrato único de configuración** | `main.yml` construye una vez; la plataforma debe aceptar imágenes, no reconstruir |

## 2. Fly.io

- **Cómputo (Machines):** `shared-cpu-1x` en las regiones más baratas: 512 MB **USD 3.69**, 1 GB **6.70**, RAM extra USD 6/GB. **`gru` (São Paulo) aplica ×1.615** (la región más cara): 512 MB ≈ 5.96, 1 GB ≈ 10.82, 2 GB ≈ 20.5 (est., calculado). Máquina detenida: sin cargo de CPU/RAM, rootfs a USD 0.15/GB-mes.
- **Auto-stop/auto-start:** `auto_stop_machines = stop|suspend`, `auto_start_machines = true`, `min_machines_running` (solo región primaria). Útil para `web` y `api`; **no** para `worker` (pg-boss) ni Keycloak (cold start de 30–80 s en el login).
- **Volúmenes:** USD 0.15/GB-mes; snapshots USD 0.08/GB-mes (10 GB gratis). IPv4 dedicada USD 2/mes. Egress Sudamérica **USD 0.04/GB** (despreciable a esta escala).
- **Managed Postgres (MPG):** Basic (shared-2x, 1 GB) **USD 38**, Starter (2 GB) 72, + USD 0.28/GB-mes; HA, backups y pooling incluidos; PITR por `fly mpg restore` desde 2026-08 (retención en días: **verificar**). **Bloqueantes para PFOS:** (1) `fly mpg create --pg-major-version` admite **solo 16 y 17** (sin PG 18, ADR-0005); (2) los usuarios solo pueden tener los roles `schema_admin`/`writer`/`reader`, sin superusuario ni **`CREATEROLE`** → `migrate` no puede crear `pf_app`, `pf_worker`, etc. (ADR-0023). Disponibilidad en `gru`: la tabla de regiones dice que no, el anuncio de MPGv2 GA (2026-07-20) dice que sí (**verificar** con `fly platform regions`).
- **Fly Postgres "unmanaged" (legacy):** sin mantenimiento ni soporte de Fly. La vía realista es **PostgreSQL 18 propio** en una Machine + volumen con pgBackRest → B2 (igual que N1/N2, sin snapshots de VM).
- **Deploy:** `fly deploy --image <ref>` despliega una imagen ya construida → encaja con build-once. Pull desde GHCR **privado** con credenciales: **verificar**; alternativa que conserva el digest: copiar el manifiesto a `registry.fly.io` (`crane copy`/`skopeo`) en el job de deploy. Migraciones con `[deploy] release_command`.
- **IaC:** el provider Terraform `fly-apps/fly` está **sin mantenimiento**; Fly recomienda `flyctl` + `fly.toml` + Machines API (IaC declarativa parcial).
- **Red privada:** 6PN (`*.internal` / Flycast) entre apps de la organización (documentado; no re-verificado el 2026-10-04).

**Estimación PFOS en `gru` (est.):** `web` 512 MB 5.96 + `api` 512 MB 5.96 + `worker` 512 MB 5.96 + Keycloak 1 GB 10.82 + PG 18 propio 1 GB 10.82 + SeaweedFS 256 MB 3.54 + volúmenes 20 GB 3.00 + IPv4 2 ≈ **USD 48**; con auto-stop en `web`/`api` (uso personal, encendidas ~10 % del tiempo) ≈ **USD 38–42**. Con MPG Basic en lugar de PG propio: ≈ **USD 75–80** y además **no cumple** (PG 17, sin `CREATEROLE`).

## 3. Railway

- **Planes:** Free (USD 1 de uso), **Hobby USD 5** (incluye 5 de uso), **Pro USD 20/workspace** (incluye 20 de uso). Uso: RAM **USD 10/GB-mes**, CPU **USD 20/vCPU-mes**, volúmenes USD 0.15/GB-mes, egress USD 0.05/GB.
- **Regiones:** `us-west2`, `us-east4` (Virginia), `europe-west4`, `asia-southeast1` — **sin Sudamérica**. RTT esperado desde Bolivia ≈ el de AWS `us-east-1` (138–143 ms, README §4) (est.).
- **PostgreSQL:** la plantilla oficial usa `postgres-ssl:18` (**PG 18**, fuente secundaria) y Railway la llama "unmanaged": es un contenedor con superusuario → **roles propios y RLS sin restricción**. Convertible a clúster HA (Patroni).
- **Backups:** de volumen, incrementales, diarios (6 días), semanales (27), mensuales (89) y manuales, cobrados como volumen. **Sin PITR nativo** → pgBackRest/WAL-G → B2 propio (mismo trabajo que en el VPS).
- **Config as code (`railway.json`/`railway.toml`):** builder `RAILPACK` (default) o `DOCKERFILE`, `preDeployCommand` (migraciones con `pf_migrator`), `healthcheckPath`/`healthcheckTimeout`, `cronSchedule`, `restartPolicyType`. Servicios desde imagen de registry (GHCR por digest; credenciales de registry privado: **verificar** el plan requerido). Red privada `*.railway.internal` (documentada; no re-verificada).
- **IaC:** solo provider Terraform **comunitario** (`terraform-community-providers/railway`) + Railway CLI.

**Estimación PFOS (est.):** RAM media ≈ 1.9–2.3 GB (web 0.25, api 0.3, worker 0.3, Keycloak 0.6, PG 0.3–0.5, SeaweedFS 0.1) × 10 = 19–23 + CPU media ≈ 0.15 vCPU × 20 = 3 + volúmenes 20 GB = 3 ≈ **USD 25–30** (la cuota Hobby/Pro se descuenta como crédito; con Pro el piso es 20). Es la PaaS **más barata** que cumple PG 18 + roles + RLS, pero sin región SA ni PITR gestionado.

## 4. Vercel (solo `finance-web`)

- **Hobby:** "restringido a uso personal no comercial"; incluye 1 M invocaciones, 4 h de Active CPU, 360 GB-h de memoria y 100 GB de transferencia. PFOS personal cabe, pero cualquier uso comercial (incluido pagar a un desarrollador) exige **Pro: USD 20/mes por asiento** con USD 20 de uso incluido.
- **Región `gru1`** (São Paulo, `sa-east-1`) disponible; las funciones van a `iad1` por defecto (hay que fijarla). Tarifas `gru1`: Active CPU USD 0.221/h, memoria USD 0.0183/GB-h (≈ 1.7× las de `iad1`). A nuestra escala el uso es ≈ 0 (cabe en lo incluido).
- **Fluid compute:** duración máxima 300 s (Pro hasta 800 s), 2–4 GB; WebSockets en beta pública (2026-06) limitados a esa duración. Next.js 16 soportado (16.3).
- **Encaje con nuestro BFF:**
  - Funciones efímeras con concurrencia por instancia: el `pg.Pool` del BFF debe adaptarse (pool pequeño + cierre de inactivas; Vercel recomienda adjuntar el pool al ciclo de vida de la función). Cada instancia abre conexiones propias → conviene pooling del lado de la BD (est.).
  - **Sin red privada** hacia `api`/PostgreSQL (Secure Compute solo Enterprise; IPs estáticas **USD 100/mes por proyecto**): `api` y la BD de sesiones quedarían **expuestas a Internet** con TLS + credenciales, sin allowlist. Hoy `web → api` es HTTP interno y la BD no se publica (README §11).
  - El lock de refresh del BFF ya es de BD (`pg_advisory_xact_lock` por sesión en `apps/web/src/bff/session-store.ts`, con deduplicación en memoria solo como optimización), así que funciona con varias instancias; pero cada refresh es una transacción más contra una BD remota.
  - Cookies de sesión: sin problema con dominio propio (`app.` en Vercel, `auth.` y `api.` en otro host).
  - **Rompe build-once:** Vercel construye desde el código fuente (o con su CLI `vercel build`/`--prebuilt`), no despliega la imagen de GHCR → dos artefactos para `web` y el `verify-by-digest` deja de cubrir lo que corre en producción.
- **Costo:** USD 0 (Hobby) o 20 (Pro), y **no ahorra nada** en el resto: `api`, `worker`, Keycloak y PG siguen necesitando host. En el VPS, `web` ocupa ≈ 150–300 MiB de un costo fijo.

## 5. Render

- **Workspace:** Hobby USD 0, **Pro USD 25/mes**, Scale 499. Web services y **background workers** al mismo precio: Starter **USD 7** (512 MB, < 1 CPU), Standard **USD 25** (2 GB, 1 CPU). Cron jobs por minuto (desde USD 0.00016/min). Discos USD 0.25/GB-mes.
- **Postgres:** 256 MB USD 6, **1 GB USD 19**, 2 GB 40, 4 GB 75 (+ USD 0.30/GB tras 1 GB). **PG 13–18** (18 la última). **PITR 3 días en Hobby, 7 en Pro**. Roles propios con `CREATEROLE` sobre el usuario por defecto: **verificar** (bloqueante si no).
- **Regiones:** Oregon, Ohio, Virginia, Frankfurt, Singapur — **sin Sudamérica**. Ancho de banda incluido 5 GB (Hobby) / 25 GB (Pro), excedente USD 0.15/GB.
- **IaC:** provider Terraform **oficial** (`render-oss/render`, GA) + Blueprints (`render.yaml`). Deploy desde imagen de registry soportado.

**Estimación PFOS (est.):** `web`+`api`+`worker` 3 × 7 = 21 + Keycloak Standard 25 (no hay plan de 1 GB) + PG 1 GB 19 + SeaweedFS como servicio privado 7 + disco 10 GB 2.5 ≈ **USD 75** en Hobby (PITR 3 días) o **≈ USD 100** en Pro (PITR 7 días).

## 6. Otras y combinaciones

| Opción | Datos clave (2026-10-04) | Estimación PFOS (est.) | Veredicto |
|---|---|---|---|
| **Northflank** | Región gestionada `southamerica-east`; PAYG USD 0.01667/vCPU-h, 0.00833/GB-h; planes `nf-compute-50` (0.5 vCPU, 1 GB) USD 12, `nf-compute-100-2` (1 vCPU, 2 GB) 24; BYOC en AWS `sa-east-1` | ≈ 35–55 (PG addon y versión 18 **sin verificar**) | Única PaaS "clásica" con región SA además de Fly; merece una mirada solo si Fly no convence |
| Koyeb | Pro USD 29/mes (10 de cómputo incluido); eco 512 MB 2.68; sin región SA; Postgres serverless desde ≈ 60 | ≥ 60 | Descartada |
| DigitalOcean App Platform | 512 MB 5, 1 GB 10, 2 GB 25; Managed PG 18 (USD 15.15); sin región SA | ≈ 45–60 | Igual que DO en README §5.6, sin ventaja |
| **H1 — Vercel (`web`, `gru1`) + Fly `gru` (`api`, `worker`, Keycloak, SeaweedFS) + Neon `aws-sa-east-1`** | Neon Launch PG 18, PITR 7 días; Fly sin PG | Fly ≈ 30 + Neon ≈ 21–25 + Vercel 0–20 ≈ **USD 50–75** | Tres proveedores, `api` y BD públicos, roles Neon con `neon_superuser` (README §5.6). No mejora a N3 |
| H2 — Fly `gru` completo + Neon | Fly ≈ 30 + Neon ≈ 21–25 | ≈ **USD 52–58** | Equivale a N3 con PITR gestionado y sin SO que parchear; mismo costo que N3 |
| H3 — Railway + Neon | Railway en `us-east4` + Neon SA: ~120 ms por consulta app↔BD | — | **Descartada** (latencia app↔BD) |

## 7. Comparación con ADR-0027 y recomendación

| Opción | USD/mes (est.) | Ops (1 persona) | PG 18 / RLS / roles propios / PITR | Keycloak | RTT desde Bolivia | Lock-in | IaC | GHCR digest + contrato único |
|---|---|---|---|---|---|---|---|---|
| **N1** Hetzner CX33 + Compose | **13–15** | Media | Sí / sí / sí / propio (pgBackRest → B2) | Sí (RAM fija) | 235–263 ms | Bajo | `hcloud` oficial | **Máximo** |
| **N2** Lightsail SP 4 GB + Compose | **27–30** | Media | Sí / sí / sí / propio | Sí | **112 ms** | Bajo | `aws` oficial | **Máximo** |
| Railway (`us-east4`) | **25–30** | **Baja** (sin SO); PG y PITR propios | Sí / sí / sí / propio (backups de volumen sin PITR) | Sí (always-on, ~6 USD) | ≈ 140 ms (est., no medido) | Medio (`railway.json`, red privada propia) | Comunitario + CLI | Alto (imagen por digest; `preDeployCommand`) |
| Fly.io `gru` (PG propio) | **38–48** | Baja-media (PG en Machine sin soporte de Fly) | Sí / sí / sí / propio | Sí (no auto-stop) | ≈ 110 ms (est., misma metrópoli que `sa-east-1`; no medido) | Medio (`fly.toml`, Machines) | Provider sin mantenimiento; `flyctl` | Alto (`--image`, `release_command`) |
| Fly.io `gru` + MPG | 75–80 | Baja | **No** (PG 16/17, sin `CREATEROLE`) | Sí | ≈ 110 ms (est.) | Medio-alto | `flyctl` | Alto |
| Render (Hobby / Pro) | 75 / 100 | Muy baja | Sí (PG 18) / sí / **verificar** / 3 o 7 días gestionado | Caro (plan 2 GB) | ≈ 140 ms (Virginia, est.) | Medio | **Oficial** + Blueprints | Alto |
| Vercel (solo `web`) | +0 / +20 | Baja para `web`; sube la del resto | N/A (no aloja BD) | N/A | `gru1` | Medio | Oficial | **Rompe** build-once para `web` |
| H1 Vercel + Fly + Neon | 50–75 | Media (3 proveedores) | Sí / sí / con cuidado (`neon_superuser`) / gestionado 7 días | Sí (Fly) | ≈ 110 ms | Alto | Mixta | Parcial |
| H2 Fly + Neon | 52–58 | Baja | Sí / sí / con cuidado / gestionado 7 días | Sí | ≈ 110 ms | Medio | Mixta | Alto |

**¿Alguna PaaS supera a N2 o N1?** **No en el conjunto de restricciones.**

1. **Costo:** solo **Railway** iguala a N2 (≈ 25–30), y ninguna se acerca a N1 (≈ 13–15). Fly `gru` cuesta ≈ 1.3–1.6× N2 por el multiplicador ×1.615 de São Paulo; Render y las combinaciones con Vercel/Neon cuestan 2–3×.
2. **PostgreSQL:** las BD gestionadas de las PaaS no cumplen o no suman: Fly MPG no tiene PG 18 ni `CREATEROLE`; Railway y Fly-propio dejan el PITR **a cargo del owner** igual que el VPS (el ahorro de operación se limita a no parchear el SO). Render cumple PG 18 y PITR, pero cuesta ≈ 3× N2 y está fuera de Sudamérica.
3. **Latencia:** solo Fly (`gru`), Northflank y Vercel (`gru1`) están en São Paulo; Railway y Render quedan en EE. UU. (≈ +30 ms frente a N2, est.).
4. **Keycloak y worker** siempre encendidos anulan el atractivo del auto-stop: solo `web`/`api` pueden dormir y valen ≈ USD 6–12/mes en `gru`.
5. **Vercel no aporta:** no reduce el costo del resto, expone `api` y la BD de sesiones a Internet (sin red privada salvo Enterprise o IPs estáticas a USD 100/mes) y rompe el deploy por digest para `web`.

**Recomendación:** mantener **N2 como default** y N1 como opción < USD 20 (ADR-0027 sin cambio de decisión, sigue **Propuesto** hasta la decisión de presupuesto). Registrar dos variantes PaaS por si el owner prioriza no administrar un host:

- **P1 — Railway** (≈ USD 25–30): mismo costo que N2, sin SO que parchear, flujo que el owner ya conoce (`preDeployCommand` = `migrate`, healthchecks a `/health/ready`), PG 18 en contenedor con roles propios; **a cambio** de región EE. UU. (+~30 ms), PITR propio igualmente (pgBackRest → B2) e IaC comunitaria.
- **P2 — Fly.io `gru`** (≈ USD 38–48): latencia de São Paulo y auto-stop de `web`/`api`; PG 18 propio en Machine + volumen (no MPG); deploy `fly deploy --image` con el digest de GHCR. Pasa a ser la opción PaaS preferida si Fly agrega PG 18 y `CREATEROLE` a MPG (entonces sería un N3 sin VPS).

Disparador para reconsiderar: si el PoC de 48 h del N2 (README §14) muestra que el owner no quiere operar un host, probar P1 o P2 con el mismo contrato de configuración y el mismo drill de restore antes de decidir.

## 8. Fuentes (consultadas el 2026-10-04)

- Fly.io: [pricing](https://fly.io/pricing.md), [docs de precios](https://docs.fly.io/about/pricing), [auto-stop/auto-start](https://docs.fly.io/launch/autostop-autostart/), [Managed Postgres](https://docs.fly.io/mpg), [`fly mpg create` (versiones 16/17)](https://docs.fly.io/flyctl/cmd/fly_mpg_create.md), [`fly mpg users set-role`](https://docs.fly.io/flyctl/cmd/fly_mpg_users_set-role.md), [regiones](https://docs.fly.io/reference/regions), [MPGv2 nuevas regiones y GA (foro oficial, 2026-07-20)](https://community.fly.io/t/mpgv2-new-regions-and-ga/28321), [PITR con `fly mpg restore` (foro oficial, 2026-08)](https://community.fly.io/t/fly-mpg-restore-now-supports-naming-and-point-in-time-restore/28464), [ventana de recuperación (foro oficial)](https://community.fly.io/t/managed-postgres-pitr-time-refused-while-backup-id-restore-works-how-do-i-read-the-recovery-window/28638), [roles sin `CREATEROLE` (foro oficial)](https://community.fly.io/t/can-the-admin-user-have-createrole-and-bypassrls-no-superuser/28697), [Postgres unmanaged sin soporte](https://docs.fly.io/unmanaged-postgres/index.md), [`fly deploy --image`](https://docs.fly.io/flyctl/cmd/fly_deploy.md), [provider Terraform sin mantenimiento](https://github.com/fly-apps/terraform-provider-fly/issues/255)
- Railway: [pricing](https://railway.com/pricing), [regiones](https://docs.railway.com/reference/regions), [PostgreSQL](https://docs.railway.com/guides/postgresql), [backups](https://docs.railway.com/reference/backups), [config as code](https://docs.railway.com/reference/config-as-code), [provider Terraform comunitario](https://github.com/terraform-community-providers/terraform-provider-railway)
- Vercel: [fair use (Hobby no comercial)](https://vercel.com/docs/limits/fair-use-guidelines), [plan Pro](https://vercel.com/docs/plans/pro-plan), [pricing](https://vercel.com/pricing), [regiones](https://vercel.com/docs/regions), [precios `gru1`](https://vercel.com/docs/pricing/regional-pricing/gru1), [límites de funciones](https://vercel.com/docs/functions/limitations), [cron jobs](https://vercel.com/docs/cron-jobs/usage-and-pricing), [WebSockets beta (2026-06-22)](https://vercel.com/changelog/websocket-support-is-now-in-public-beta), [Next.js 16.3 en Vercel (secundaria)](https://www.createwith.com/tool/vercel/updates/vercel-nextjs-163-support-cuts-prefetching-and-speeds-routing)
- Render: [pricing](https://render.com/pricing.md), [versiones de PostgreSQL](https://render.com/docs/postgresql-upgrading), [regiones](https://render.com/docs/regions), [provider Terraform](https://render.com/docs/terraform-provider)
- Otras: [Koyeb pricing](https://www.koyeb.com/pricing), [Koyeb instancias](https://www.koyeb.com/docs/reference/instances), [Northflank pricing](https://northflank.com/pricing), [Northflank `southamerica-east`](https://northflank.com/cloud/northflank/regions/southamerica-east), [DO App Platform pricing](https://www.digitalocean.com/pricing/app-platform), [DO disponibilidad regional](https://docs.digitalocean.com/platform/regional-availability/), [DO PG 18 (secundaria)](https://www.digitalocean.com/community/questions/postgres-18-availability)
- Neon: [pricing](https://neon.com/pricing), [regiones](https://neon.com/docs/introduction/regions), [política de versiones (PG 18)](https://neon.com/docs/postgresql/postgres-version-policy)
