# ADR-0027: Destino de despliegue inicial — VPS único con Docker Compose (AWS Lightsail São Paulo), escalable por niveles

- Estado: **Aceptado (2026-10-05)** — presupuesto del owner USD 10–20/mes; default **AWS Lightsail 2 GB en São Paulo** (≈ USD 14/mes), fallback Oracle Cloud A1 (ver [Decisión del owner 2026-10-05](#decisión-del-owner-2026-10-05-presupuesto-usd-1020))
- Fecha: 2026-10-03 (propuesta) · 2026-10-05 (aceptación)
- Decisores: Owner (Product/Tech Lead)
- Relacionado: Reemplaza a ADR-0013; [runbook de despliegue y restauración](../runbooks/deploy-and-restore.md); `infra/`, `deploy/compose/compose.prod.yaml`, `.github/workflows/deploy.yml`; [SPIKE-09](../../spikes/SPIKE-09-deploy-costs/README.md); docs/ARCHITECTURE.md §5, §15; docs/19-local-development.md; docs/21-cloud-deployment-options.md; docs/22-infrastructure.md; docs/30-backup-and-disaster-recovery.md; ADR-0005, ADR-0009, ADR-0010, ADR-0011, ADR-0014, ADR-0015, ADR-0020, ADR-0023; OpenSpec capability `platform/delivery-pipeline`

## Contexto y problema

ADR-0013 recomendó AWS ECS/Fargate + RDS con un perfil de costo mínimo, condicionado a que SPIKE-09 confirmara el costo frente al presupuesto del owner. SPIKE-09 (2026-10-03) muestra que ese perfil cuesta **≈ USD 110–130/mes solo producción** (165–195 con staging), mientras que el sistema real es para **1 a pocos usuarios** con carga casi nula. Los requisitos no negociables son: PostgreSQL 18 con RLS y PITR, OIDC, API S3, worker siempre encendido (pg-boss + cron), observabilidad OTel, IaC, seguridad por diseño, y latencia razonable desde Bolivia. Las imágenes ya se construyen una vez y se publican en GHCR por digest (`main.yml`), y el stack completo ya corre en Docker Compose con un contrato único de configuración (modo B de docs/19).

## Drivers de decisión

- Costo mensual proporcional a 1–pocos usuarios.
- Cumplir PG 18 + RLS + PITR (RPO ≤ 15 min, RTO ≤ 4 h, docs/30).
- Paridad local ↔ cloud (mismas imágenes, mismo contrato de configuración).
- Latencia desde Bolivia.
- Operación por 1 persona.
- IaC (ADR-0014) y ruta de crecimiento sin reescribir la app.
- Seguridad: superficie mínima, backups inmutables, sin credenciales de larga vida en CI.

## Opciones consideradas

1. **VPS único + Docker Compose** (Hetzner, AWS Lightsail, Vultr, DigitalOcean, Oracle Always Free).
2. VPS + **PostgreSQL gestionado** (Neon, DigitalOcean Managed PG).
3. **PaaS** (Fly.io, Railway, Render).
4. **Google Cloud Run** + Cloud SQL.
5. **AWS ECS Fargate + RDS** (ADR-0013).

## Decisión

Desplegar por **niveles**, con un default y disparadores explícitos de cambio (tabla re-verificada el 2026-10-05 con el presupuesto del owner, SPIKE-09 §17):

| Nivel | Costo (prod, 2026-10) | Destino |
|---|---|---|
| **N1 (default)** | **≈ USD 14/mes** (≈ 16 con impuestos) | **AWS Lightsail 2 GB en `sa-east-1` (São Paulo) + Compose**; PITR propio con pgBackRest → B2 |
| N1-F (fallback) | ≈ USD 1/mes | Oracle Cloud A1 (Santiago, cuenta Pay-As-You-Go) + Compose; requiere imágenes multi-arch |
| N2 | ≈ USD 27–30/mes | Lightsail 4 GB São Paulo (mismo stack; solo cambia `lightsail_bundle_id`) |
| N3 | ≈ USD 50–60/mes | N2 con PostgreSQL en Neon Launch `aws-sa-east-1` (PG 18, PITR 7 días) |
| N4 | ≥ USD 110/mes | ECS Fargate + RDS (contenido de ADR-0013) |

Hetzner CX33 (el N1 de la propuesta del 2026-10-03) queda **descartado**: los planes CX/CAX figuran como no disponibles para contratar desde agosto de 2026 (SPIKE-09 §17.1).

Para N1/N2 se decide además:

- **Runtime:** `docker compose` con el override `deploy/compose/compose.prod.yaml` sobre `compose.yaml` y las mismas imágenes por digest; Caddy como único proceso con puertos públicos (80/443, TLS ACME); `migrate` corre como dependencia de `up --wait` (si falla, api/worker siguen en N-1). Límites de memoria por contenedor dimensionados para 2 GB + 2 GiB de swap.
- **PostgreSQL 18 en contenedor** con **pgBackRest** (imagen `pfos-postgres` construida por `main.yml`: WAL continuo asíncrono, full semanal + diferencial diario con retención de 14 días, full mensual × 12, cifrado del lado cliente) hacia **Backblaze B2** con versioning y **Object Lock governance**; la clave del host no tiene `bypassGovernance` ni permisos sobre retenciones (puede ocultar archivos para que pgBackRest expire, pero no destruir versiones bloqueadas). Backup incremental previo a cada migración. Restore drill mensual en VM efímera con clave de solo lectura (docs/30).
- **Object storage:** SeaweedFS en el host (validado en SPIKE-07) con réplica nocturna a B2. **Cloudflare R2 no se usa** para documentos ni backups (sin versioning ni Object Lock).
- **Identidad:** Keycloak 26 propio en modo `start` (no `start-dev`), caché local y heap acotado; realm de producción sin usuarios demo; consola de administración solo por túnel. IdP gestionado solo se reevalúa al pasar a N4.
- **Observabilidad:** Grafana Cloud Free vía OTLP **directo desde la app** (sin Grafana Alloy en 2 GB), sampling de trazas 10 %, checks sintéticos de `/api/health/ready` y del discovery OIDC.
- **IaC:** OpenTofu (ADR-0014) en `infra/`: providers `aws` (`aws_lightsail_*`, Budgets) y `b2`; cloud-init para el host; state en S3 con **cifrado del lado cliente** de OpenTofu. Sin `apply` desde CI.
- **Deploy:** `.github/workflows/deploy.yml` (solo `workflow_dispatch`, environment `production` con aprobación del owner) toma los digests de una corrida exitosa de `main.yml` y los envía por SSH a través de Tailscale (federación OIDC, sin auth key guardada; sin SSH público) a un **comando forzado** que valida los argumentos; los secretos viven solo en el host. Rollback por digest al release anterior.
- **Staging:** efímero (VM de drill creada y destruida con OpenTofu, `drill_enabled`), no permanente.

**Disparadores:** 2 GB insuficiente en el PoC (OOM, swap sostenido, memoria > 85 %) → N2 si el owner amplía el presupuesto, si no N1-F; un drill de restore fallido dos veces o deseo de no operar PITR → N3; varios usuarios reales, HA/RTO < 1 h u objetivo de aprendizaje AWS → N4 (nuevo ADR o reactivación de ADR-0013).

## Análisis de opciones

### 1. VPS único + Compose (elegida: N1 Lightsail 2 GB; N1-F Oracle A1; N2 Lightsail 4 GB)
- **Pros:** el más barato con requisitos completos; paridad máxima (es el modo B de docs/19); lock-in mínimo; RAM medida cabe holgada en 4 GB (≈ 1.8–2.8 GiB con Alloy) y ajustada en 2 GB (≈ 1.3–1.6 GiB sin Alloy, heaps acotados, swap; SPIKE-09 §17.2).
- **Contras:** sin HA; PITR y parches del SO a cargo del owner; un solo blast radius.
- **Costo:** N1 ≈ USD 14; N1-F ≈ USD 1; N2 ≈ USD 27–30. **Complejidad operativa:** media.

### 2. VPS + PostgreSQL gestionado (N3)
- **Pros:** PITR gestionado; Neon tiene PG 18 y región São Paulo; mismo VPS para el resto.
- **Contras:** el polling de pg-boss impide el scale-to-zero (≈ USD 21–25/mes en Neon); en Neon los roles creados por consola heredan `BYPASSRLS` (los roles de app deben crearse por SQL); sin IP allowlist en el plan Launch.
- **Costo:** ≈ USD 50–60. **Complejidad:** baja-media.

### 3. PaaS (Fly.io, Railway, Render, Vercel)
- **Pros:** operación mínima, deploy simple.
- **Contras:** Keycloak (≥ 1 GiB) encarece cada plataforma; PITR débil o caro (Render 3 días en Hobby, Railway sin PITR gestionado); sin región sudamericana en Render/Railway; IaC limitada; lock-in medio.
- **Costo:** ≈ USD 25–80 según plataforma. **Complejidad:** muy baja.
- **Re-evaluación 2026-10-04 ([SPIKE-09 Anexo A](../../spikes/SPIKE-09-deploy-costs/anexo-a-paas.md), docs/31 D42):** ninguna PaaS supera a N2/N1 con todas las restricciones. Fly.io Managed Postgres no sirve (solo PG 16/17, sin `CREATEROLE` para los roles de ADR-0023); Vercel para `web` no ahorra costo, expone `api` y la BD de sesiones a Internet y rompe el deploy por digest. Variantes registradas si el owner prefiere no administrar un host: **P1 Railway** (≈ USD 25–30, `us-east4`, PG 18 en contenedor, PITR propio) y **P2 Fly.io `gru`** (≈ USD 38–48, PG 18 propio en Machine + volumen, auto-stop solo en `web`/`api`).

### 4. Cloud Run + Cloud SQL
- **Pros:** gestionado, buen PITR, IaC madura, región São Paulo.
- **Contras:** worker y Keycloak siempre encendidos anulan el ahorro del scale-to-zero.
- **Costo:** ≈ USD 60–110. **Complejidad:** baja.

### 5. ECS Fargate + RDS (ADR-0013)
- **Pros:** seguridad, backups y DR excelentes; alto learning value; escalable.
- **Contras:** 4–6× el costo del default para 1 usuario; más piezas (VPC, ALB, IAM).
- **Costo:** ≈ USD 110–130 prod (165–195 con staging). **Complejidad:** media.

## Consecuencias

**Positivas**
- Costo de producción ≈ USD 14/mes (≈ 16 con impuestos) con PG 18 + RLS + PITR, OIDC y observabilidad, dentro del presupuesto del owner (USD 10–20).
- Cero cambios en la aplicación: mismas imágenes, mismo contrato de configuración, mismos adapters.
- Ruta de crecimiento en la misma cuenta y región AWS (N1 → N2 cambiando el plan; → N4).

**Negativas**
- El owner opera backups/PITR, parches del SO y Docker.
- Sin alta disponibilidad: RTO ≈ 1 h ante pérdida del host.
- Menor learning value de ECS/VPC hasta el N4.

**Riesgos**
- PITR propio mal configurado. *Mitigación:* drill mensual automatizado que falla si no restaura; alerta por `archive` atrasado; escalar a N3.
- Memoria insuficiente en 2 GB (Keycloak llegó a 908 MiB sin límite tras E2E). *Mitigación:* techos por contenedor, heaps acotados, swap de 2 GiB, señales de salida en el runbook §1; N2 (4 GB, USD 24) con OK del owner o fallback N1-F.
- Fallback Oracle A1: capacidad escasa, reclamo de instancias ociosas, ARM. *Mitigación:* solo con cuenta PAYG y tras habilitar imágenes multi-arch (½–1 día, SPIKE-09 §17.4).
- Cambios de precio del proveedor. *Mitigación:* contratos estándar y IaC → mover de proveedor en horas; AWS Budgets.
- Telemetría en un tercero. *Mitigación:* redacción y detectores restringidos (SPIKE-10).

## Validación

- **Owner (hecho 2026-10-05):** presupuesto USD 10–20/mes → ADR Aceptado; ADR-0013 pasa a "Reemplazado por ADR-0027".
- **PoC de 48 h** al abrir el change de despliegue: N1 creado con OpenTofu (`infra/environments/prod`), stack completo con carga E2E (memoria de contenedores ≤ 1.7 GiB, sin `OOMKilled`, swap-in no sostenido), un restore PITR completo con RTO < 1 h (runbook §6) y costo facturado ≤ USD 20/mes en Cost Explorer.
- Métricas continuas: AWS Budgets (límite USD 20: alertas al 80 % real y 100 % pronosticado), resultado del drill mensual, uso de memoria por contenedor, heartbeat de backups.

## Decisión del owner 2026-10-05 (presupuesto USD 10–20)

- **Default N1: AWS Lightsail Linux 2 GB, São Paulo.** Desglose mensual (SPIKE-09 §17.3): instancia USD 12.00 (IPv4 y 1.5 TB de transferencia incluidos) + snapshots automáticos ≈ 0.5–1 + Backblaze B2 ≈ 0 (dentro de los 10 GB gratis) + Grafana Cloud Free 0 + Tailscale/Cloudflare DNS 0 + dominio ≈ 1 → **≈ USD 14** (≈ 16 con IVA/IT est.).
- **Fallback N1-F: Oracle Cloud A1 (Santiago, PAYG) ≈ USD 1**, solo si 2 GB no alcanza y el presupuesto no sube; exige imágenes multi-arch en `main.yml`.
- Descartados por presupuesto o disponibilidad: Lightsail 4 GB (≈ USD 27), Hetzner CX33 (no contratable desde 2026-08), Hetzner CPX US y Vultr/DigitalOcean 2 GB (sin ventaja frente a Lightsail SP; ver SPIKE-09 §17.3). Lightsail IPv6-only descartado: `ghcr.io` y `paralelo.bo` no tienen AAAA.
- Diferencia con la propuesta del 2026-10-03: la clave B2 del host **sí** tiene `deleteFiles` (pgBackRest necesita expirar); la inmutabilidad la da Object Lock governance sin `bypassGovernance`. Comportamiento de expiración con lock a verificar en el PoC (SPIKE-09 §14.3).
- Implementación (sin `apply`): `infra/`, `deploy/compose/compose.prod.yaml`, `docker/postgres.Dockerfile`, `deploy/pgbackrest/`, `deploy/host/`, `.github/workflows/deploy.yml`, [runbook](../runbooks/deploy-and-restore.md).

## Notas

- Verificado 2026-10-03 (fuentes en SPIKE-09 §15): Lightsail disponible en São Paulo desde 2026-06-12 con el mismo precio (4 GB = USD 24); Hetzner CX33 €8.49 tras la subida del 2026-06-15; Oracle Always Free A1 reducido a 2 OCPU/12 GB; Neon PG 18 GA (2026-05-01); Supabase sigue en PG 17; R2 sin versioning/Object Lock/presigned POST; B2 con versioning y Object Lock pero sin presigned POST; Grafana Cloud Free con 50 GB de logs y 14 días de retención.
- Latencia medida desde Bolivia (RTT TCP): AWS `sa-east-1` 112 ms, `us-east-1` 138 ms, Hetzner DE/FI 235–263 ms, OCI Santiago 63 ms.
- Variante USD 0 (Oracle Always Free en Santiago) documentada en SPIKE-09 como experimental: requiere imágenes multi-arch y cuenta Pay-As-You-Go para evitar el reclamo de instancias ociosas.
