# ADR-0027: Destino de despliegue inicial — VPS único con Docker Compose (AWS Lightsail São Paulo), escalable por niveles

- Estado: Propuesto (pendiente de que el owner confirme el presupuesto mensual, DESIGN-GATE Q3)
- Fecha: 2026-10-03
- Decisores: Owner (Product/Tech Lead)
- Relacionado: Reemplazaría a ADR-0013 al aceptarse; [SPIKE-09](../../spikes/SPIKE-09-deploy-costs/README.md); docs/ARCHITECTURE.md §5, §15; docs/19-local-development.md; docs/21-cloud-deployment-options.md; docs/22-infrastructure.md; docs/30-backup-and-disaster-recovery.md; ADR-0005, ADR-0009, ADR-0010, ADR-0011, ADR-0014, ADR-0015, ADR-0020, ADR-0023; OpenSpec capability `platform/delivery-pipeline`

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

Desplegar por **niveles**, con un default y disparadores explícitos de cambio:

| Nivel | Costo (prod, 2026-10) | Destino |
|---|---|---|
| N1 | ≈ USD 10–15/mes | Hetzner CX33 (DE/FI) + Compose; PITR propio |
| **N2 (default)** | **≈ USD 27–30/mes** | **AWS Lightsail 4 GB en `sa-east-1` (São Paulo) + Compose**; PITR propio |
| N3 | ≈ USD 50–60/mes | N2 con PostgreSQL en Neon Launch `aws-sa-east-1` (PG 18, PITR 7 días) |
| N4 | ≥ USD 110/mes | ECS Fargate + RDS (contenido de ADR-0013) |

Para N1/N2 se decide además:

- **Runtime:** `docker compose` con un override de producción (`compose.prod.yaml`) sobre las mismas imágenes por digest; Caddy como único proceso con puertos públicos (80/443, TLS ACME); `migrate` como `compose run --rm` antes de `up -d`.
- **PostgreSQL 18 en contenedor** con **pgBackRest** (WAL continuo + base diaria, cifrado del lado cliente) hacia **Backblaze B2** con versioning y Object Lock, clave del host sin permiso de borrado; restore drill mensual en VM efímera (docs/30).
- **Object storage:** SeaweedFS en el host (validado en SPIKE-07) con réplica nocturna a B2. **Cloudflare R2 no se usa** para documentos ni backups (sin versioning ni Object Lock).
- **Identidad:** Keycloak 26 propio (`start --optimized`); IdP gestionado solo se reevalúa al pasar a N4.
- **Observabilidad:** Grafana Cloud Free vía OTLP (Grafana Alloy en el host), sampling de trazas 10 %, check sintético de `/health/ready`.
- **IaC:** OpenTofu/Terraform (ADR-0014) con provider `aws` (`aws_lightsail_*`) o `hcloud`, más `b2`, `cloudflare`/DNS y `grafana`; cloud-init para el host; state en S3 cifrado.
- **Deploy:** job de GitHub Actions posterior a `verify-by-digest`, por SSH a través de Tailscale (sin SSH público); los secretos viven en el host, CI solo envía digests.
- **Staging:** efímero (VM creada y destruida con OpenTofu para validar releases o drills), no permanente.

**Disparadores:** presupuesto < USD 20 → N1; un drill de restore fallido dos veces o deseo de no operar PITR → N3; varios usuarios reales, HA/RTO < 1 h u objetivo de aprendizaje AWS → N4 (nuevo ADR o reactivación de ADR-0013).

## Análisis de opciones

### 1. VPS único + Compose (elegida, N1/N2)
- **Pros:** el más barato con requisitos completos; paridad máxima (es el modo B de docs/19); lock-in mínimo; RAM medida cabe en 4 GB (≈ 1.8–2.8 GiB).
- **Contras:** sin HA; PITR y parches del SO a cargo del owner; un solo blast radius.
- **Costo:** N1 ≈ USD 10–15; N2 ≈ USD 27–30. **Complejidad operativa:** media.

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
- Costo de producción ≈ USD 30/mes con PG 18 + RLS + PITR, OIDC y observabilidad.
- Cero cambios en la aplicación: mismas imágenes, mismo contrato de configuración, mismos adapters.
- Ruta de crecimiento en la misma cuenta y región AWS (N2 → N4).

**Negativas**
- El owner opera backups/PITR, parches del SO y Docker.
- Sin alta disponibilidad: RTO ≈ 1 h ante pérdida del host.
- Menor learning value de ECS/VPC hasta el N4.

**Riesgos**
- PITR propio mal configurado. *Mitigación:* drill mensual automatizado que falla si no restaura; alerta por `archive` atrasado; escalar a N3.
- Memoria insuficiente en 4 GB. *Mitigación:* límites por contenedor, swap, subir a Lightsail 8 GB (USD 44).
- Cambios de precio del proveedor. *Mitigación:* contratos estándar y IaC → mover de proveedor en horas; AWS Budgets.
- Telemetría en un tercero. *Mitigación:* redacción y detectores restringidos (SPIKE-10).

## Validación

- **Owner:** confirmar presupuesto (Q3); con eso el ADR pasa a Aceptado y ADR-0013 a "Reemplazado por ADR-0027".
- **PoC de 48 h** al abrir el change de despliegue: N2 creado con OpenTofu, stack completo con carga E2E (RAM ≤ 3 GiB), un restore PITR completo con RTO < 1 h y costo facturado ≤ USD 35/mes en Cost Explorer.
- Métricas continuas: AWS Budgets (alerta a USD 35), resultado del drill mensual, uso de memoria por contenedor.

## Notas

- Verificado 2026-10-03 (fuentes en SPIKE-09 §15): Lightsail disponible en São Paulo desde 2026-06-12 con el mismo precio (4 GB = USD 24); Hetzner CX33 €8.49 tras la subida del 2026-06-15; Oracle Always Free A1 reducido a 2 OCPU/12 GB; Neon PG 18 GA (2026-05-01); Supabase sigue en PG 17; R2 sin versioning/Object Lock/presigned POST; B2 con versioning y Object Lock pero sin presigned POST; Grafana Cloud Free con 50 GB de logs y 14 días de retención.
- Latencia medida desde Bolivia (RTT TCP): AWS `sa-east-1` 112 ms, `us-east-1` 138 ms, Hetzner DE/FI 235–263 ms, OCI Santiago 63 ms.
- Variante USD 0 (Oracle Always Free en Santiago) documentada en SPIKE-09 como experimental: requiere imágenes multi-arch y cuenta Pay-As-You-Go para evitar el reclamo de instancias ociosas.
