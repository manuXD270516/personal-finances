# ADR-0013: Estrategia de despliegue cloud — AWS ECS/Fargate (perfil de costo mínimo), Cloud Run como plan B, EKS rechazado

- Estado: Propuesto (decisión final del owner sobre presupuesto tras SPIKE-09)
- Fecha: 2026-10-01
- Decisores: Owner (Product/Tech Lead)
- Relacionado: docs/ARCHITECTURE.md §5, §11; docs/21-cloud-deployment-options.md (análisis detallado); docs/22-infrastructure.md; ADR-0005, ADR-0008, ADR-0009, ADR-0010, ADR-0011, ADR-0014, ADR-0015, ADR-0020; OpenSpec capability `platform/delivery-pipeline`; SPIKE-09

## Contexto y problema

PFOS debe desplegarse en staging y producción con: 2–3 servicios de contenedor (`finance-web`, `finance-api` api + worker; `finance-ml` desde Phase 8), PostgreSQL gestionado, Redis/Valkey, object storage S3, IdP OIDC, secretos, TLS, logs/métricas y backups. Los requisitos en tensión:

- **Costo mínimo** (proyecto personal, presupuesto del owner por confirmar).
- **Paridad** con local (contenedores, S3 API, OIDC).
- **Learning value**: el owner quiere experiencia transferible en una plataforma cloud "enterprise".
- **Operación por 1 persona** (sin gestionar clusters).
- Worker siempre encendido (outbox relay, jobs programados) → plataformas scale-to-zero estricto requieren ajustes.

El análisis detallado de proveedores, precios y topologías vive en `docs/21-cloud-deployment-options.md`; este ADR registra la decisión y su resumen.

## Drivers de decisión

- Costo mensual staging + prod.
- Complejidad operativa.
- Paridad local ↔ cloud y portabilidad (contenedores OCI estándar).
- Madurez de IaC (ADR-0014).
- Learning value / empleabilidad.
- Servicios gestionados disponibles (PG 18, Valkey/Redis, S3, secretos, OIDC).
- Soporte para procesos long-running (worker).

## Opciones consideradas

1. **AWS ECS on Fargate** (+ RDS PostgreSQL, ElastiCache/Valkey o contenedor, S3, Secrets Manager/SSM, ALB, CloudWatch).
2. **AWS EKS** (Kubernetes gestionado).
3. **Google Cloud Run** (+ Cloud SQL, Memorystore, GCS).
4. **Fly.io**.
5. **Render**.
6. **Railway**.
7. **Azure Container Apps** (+ Azure Database for PostgreSQL Flexible Server).
8. **DigitalOcean App Platform** (+ Managed PostgreSQL/Valkey, Spaces).

## Decisión

- **Recomendación: AWS ECS/Fargate** con un **perfil de costo mínimo** (detallado en docs/21): una VPC sin NAT Gateway gestionado (subnets públicas con security groups estrictos o NAT instance/VPC endpoints según SPIKE-09), RDS PostgreSQL single-AZ instancia pequeña Graviton, Valkey en ElastiCache Serverless/instancia mínima **o** como contenedor sidecar sin HA en staging, S3, Secrets Manager/SSM Parameter Store, un ALB compartido (o alternativa más barata evaluada en SPIKE-09), Fargate Spot para staging y worker cuando sea aceptable.
- **Plan B documentado: Google Cloud Run** (+ Cloud SQL + GCS), activable si SPIKE-09 muestra que el costo de ECS supera el presupuesto del owner de forma significativa. El worker en Cloud Run requiere instancia mínima ≥ 1 con CPU always-allocated (o Cloud Run Jobs + Scheduler para trabajos programados).
- **Kubernetes/EKS rechazado** por ahora (costo del control plane + complejidad operativa).
- PaaS (Fly.io, Render, Railway, DO App Platform) quedan como **alternativas de bajo costo** documentadas para demos/entornos efímeros, no como objetivo principal.
- Las imágenes son OCI estándar y la configuración es 12-factor, de modo que el cambio de plataforma afecta solo a `infra/` (ADR-0014) y al pipeline (ADR-0015).

## Análisis de opciones

Resumen (costos orientativos staging+prod mínimos, a verificar en SPIKE-09; detalle en docs/21):

| Opción | Pros | Contras | Costo orientativo | Complejidad operativa |
|---|---|---|---|---|
| **ECS/Fargate** | Sin gestionar nodos; integración IAM task roles, Secrets, CloudWatch, ALB; Terraform muy maduro; alto learning value; RDS PG y S3 nativos | Costos "ocultos" (ALB ~USD 16+/mes, NAT Gateway ~USD 32+/mes por AZ, IPv4 públicas facturables); más piezas que un PaaS | Medio (USD ~60–150/mes con perfil mínimo para 2 entornos) | Media |
| EKS | Estándar K8s, portabilidad máxima, ecosistema | Control plane ~USD 73/mes por cluster; operar K8s (upgrades, add-ons, ingress) para 1 persona | Alto | Alta |
| **Cloud Run** | Scale-to-zero real, pago por uso, HTTPS incluido, muy simple; Cloud SQL gestionado | Worker long-running requiere min instances (costo continuo); Cloud SQL mínimo no gratuito; menor learning value AWS; paridad S3 vía GCS interoperable | Bajo-medio | Baja |
| Fly.io | Barato, simple, máquinas cerca del usuario, PG gestionado (Managed Postgres) | Menor madurez enterprise; IaC limitado; soporte | Bajo | Baja |
| Render | Muy simple, background workers nativos, PG gestionado | Precio por servicio sube rápido; menos control de red; IaC vía blueprint propio | Bajo-medio | Muy baja |
| Railway | DX excelente, uso medido | Menos control, IaC limitado, menos adecuado para datos sensibles con requisitos de red | Bajo | Muy baja |
| Azure Container Apps | Scale-to-zero, Dapr/KEDA, jobs; PG Flexible Server | Ecosistema/IaC más complejo (azurerm), menor alineación con el learning goal | Bajo-medio | Media |
| DO App Platform | Precios predecibles, PG/Valkey gestionados, Spaces S3-compatible | Menos servicios avanzados (IAM fino, KMS); IaC Terraform disponible pero limitado | Bajo | Baja |

## Consecuencias

**Positivas**
- Plataforma con IaC muy madura, IAM fino (task roles: sin credenciales estáticas para S3), y aprendizaje transferible.
- Sin clusters que operar.
- Portabilidad mantenida (contenedores + S3 API + OIDC + PG estándar).

**Negativas**
- Costo base mayor que un PaaS o Cloud Run para tráfico casi nulo.
- Más recursos IaC (VPC, SG, ALB, IAM) que mantener.

**Riesgos**
- Sobrecosto por componentes de red (NAT Gateway, ALB, IPv4). *Mitigación:* perfil de costo mínimo, budgets y alertas de AWS Budgets desde el día 1, revisión mensual.
- El presupuesto del owner no alcanza. *Mitigación:* plan B Cloud Run documentado; o staging efímero (levantado bajo demanda).
- IdP cloud no decidido (Cognito vs Keycloak, ADR-0010). *Mitigación:* decidir junto a SPIKE-09.

## Validación

- **SPIKE-09 (1 d):** PoC con Terraform mínimo (o calculadoras oficiales + despliegue de prueba de 48 h) midiendo costo real diario de ECS/Fargate vs Cloud Run para staging+prod, incluyendo red, BD, cache, storage y logs. Criterio: el owner fija un presupuesto mensual máximo; si ECS ≤ presupuesto → aceptar; si no → evaluar Cloud Run y abrir ADR que reemplace.
- Métricas continuas: costo mensual por entorno (AWS Cost Explorer tags `env`, `service`), alertas al 80% del presupuesto.

## Notas

- Las cifras de costo de esta ADR son **orientativas** y no se verificaron por web en esta redacción: **a verificar en SPIKE-09** y en docs/21.
- AWS factura las IPv4 públicas desde 2024; considerarlo al decidir subnets públicas vs NAT.
- La decisión final depende del presupuesto que el owner declare (Open Question en DESIGN-GATE).
