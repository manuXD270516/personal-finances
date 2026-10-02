# ADR-0014: Infrastructure as Code — Terraform (compatible con OpenTofu), módulos por capa, state remoto

- Estado: Propuesto
- Fecha: 2026-10-01
- Decisores: Owner (Product/Tech Lead)
- Relacionado: docs/ARCHITECTURE.md §5, §6, §11; docs/21-cloud-deployment-options.md; docs/22-infrastructure.md; ADR-0013, ADR-0015, ADR-0020

## Contexto y problema

La infraestructura cloud (red, cómputo, BD, cache, storage, IAM, secretos, DNS/TLS, observabilidad, budgets) para staging y producción debe ser reproducible, revisable en PR y destruible/recreable (p. ej. staging efímero para ahorrar). Crearla por consola genera drift y conocimiento no documentado. Hay que elegir herramienta, lenguaje, estructura y gestión de state.

## Drivers de decisión

- Madurez y cobertura del provider AWS (y GCP para plan B).
- Licencia y sostenibilidad.
- Learning value / estándar de industria.
- Revisión en PR (plan legible) y seguridad (state con secretos).
- Simplicidad para 1 persona.
- Portabilidad entre clouds (al menos en el modelo mental y herramienta).

## Opciones consideradas

1. **Terraform** (HashiCorp/IBM, BSL 1.1).
2. **OpenTofu** (fork MPL 2.0, Linux Foundation/CNCF).
3. **Pulumi** (TypeScript).
4. **AWS CDK** (TypeScript → CloudFormation).
5. CloudFormation/SAM directamente.

## Decisión

- **HCL Terraform, escrito para ser compatible con OpenTofu**: sin features exclusivas de Terraform Cloud/HCP ni de OpenTofu (p. ej. state encryption nativa de OpenTofu solo se activa si se elige OpenTofu como binario). El binario usado en CI se fija en `.terraform-version`/`.opentofu-version` y se puede cambiar sin reescribir código.
- **Estructura:** `infra/terraform/modules/<capa>` (network, database, cache, storage, compute-ecs, identity, observability, budgets) y `infra/terraform/environments/{dev,staging,prod}` que componen módulos con variables por entorno.
- **State remoto** por entorno: S3 con versioning + cifrado SSE-KMS y **locking nativo de S3** (lockfile; DynamoDB solo si la versión del binario lo requiere). Bucket de state creado por un bootstrap mínimo documentado.
- **Pipeline:** `fmt -check`, `validate`, `tflint`, `trivy config` (o checkov) en PR; `plan` publicado como comentario en PR; `apply` solo desde `main` con aprobación manual para prod (ADR-0015). Autenticación CI → AWS por **OIDC federado** (sin access keys estáticas).
- Providers y módulos con versiones pinneadas (`.terraform.lock.hcl` versionado).
- Secretos: nunca en `.tfvars` versionados; se crean en Secrets Manager/SSM con valores inyectados fuera de banda o generados (`random_password`) aceptando que el state los contiene (state cifrado y con acceso restringido).

## Análisis de opciones

### 1. Terraform
- **Pros:** estándar de facto; provider AWS más completo; documentación y módulos abundantes; alto learning value.
- **Contras:** BSL 1.1 desde 1.6 (no OSI) — irrelevante para uso interno, pero riesgo de futuras restricciones bajo IBM; algunas features nuevas ligadas a HCP Terraform.
- **Costo:** 0 (CLI). **Complejidad operativa:** media.

### 2. OpenTofu
- **Pros:** MPL 2.0, gobernanza Linux Foundation/CNCF; compatible con providers y HCL de Terraform; features propias útiles (state encryption client-side, `-exclude`, early variable evaluation, `for_each` en providers, OCI registry).
- **Contras:** divergencia creciente con Terraform en features nuevas; comunidad algo menor; algunas herramientas de terceros soportan primero Terraform.
- **Costo:** 0. **Complejidad operativa:** media.

### 3. Pulumi (TS)
- **Pros:** mismo lenguaje que el proyecto; abstracciones reales (funciones, tests unitarios); providers basados en los de Terraform.
- **Contras:** state en Pulumi Cloud por defecto (self-managed backend posible); el uso de un lenguaje general invita a sobre-abstraer; menor learning value de mercado que Terraform; preview menos legible que `plan` para revisión.
- **Costo:** 0 individual (backend propio). **Complejidad:** media.

### 4. AWS CDK
- **Pros:** TypeScript; constructs de alto nivel (ECS patterns) productivos.
- **Contras:** lock-in AWS (plan B Cloud Run imposible con la misma herramienta); CloudFormation subyacente (rollbacks lentos, límites de stack, drift detection pobre); diffs menos transparentes.
- **Costo:** 0. **Complejidad:** media.

### 5. CloudFormation/SAM
- **Pros:** nativo, sin state que gestionar.
- **Contras:** verboso, solo AWS, peor DX.
- Descartado.

## Consecuencias

**Positivas**
- Infra revisable y reproducible; staging puede destruirse y recrearse para ahorrar costo.
- Portabilidad de herramienta: se puede cambiar Terraform ↔ OpenTofu por un flag de CI.
- Plan B (Cloud Run) expresable con la misma herramienta (provider google).

**Negativas**
- HCL es un lenguaje más que aprender/mantener.
- Restricción autoimpuesta: no usar features exclusivas de uno u otro binario.

**Riesgos**
- State con secretos expuesto. *Mitigación:* bucket privado, KMS, acceso solo para el rol de CI y el owner; versioning para recuperación.
- Drift por cambios manuales en consola. *Mitigación:* `plan` programado semanal en CI que alerta si hay diff.

## Validación

- CI: `fmt`, `validate`, `tflint`, escaneo de misconfig sin hallazgos HIGH no justificados.
- `plan` sin cambios después de un `apply` (idempotencia).
- Test de compatibilidad: el mismo código ejecuta `init/validate/plan` con Terraform y OpenTofu en un job de CI (ambas versiones pinneadas).
- SPIKE-09 reutiliza estos módulos mínimos.

## Notas

- Verificado 2026-10-01: Terraform ≥ 1.6 bajo BSL 1.1; IBM completó la compra de HashiCorp (anunciada 2024); OpenTofu MPL 2.0, bajo Linux Foundation y aceptado en CNCF (abril 2025), con línea estable 1.12.x a mediados de 2026 y features exclusivas (state encryption desde 1.7, OCI registry desde 1.10).
- La elección del binario por defecto (Terraform vs OpenTofu) puede tomarse en Phase 1 sin nuevo ADR, añadiendo una Nota fechada aquí; **disenso menor del autor:** preferiría **OpenTofu** como binario por defecto (licencia MPL y state encryption client-side), manteniendo el código compatible con ambos tal como decide ARCHITECTURE §5.
