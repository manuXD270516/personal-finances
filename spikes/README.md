# Spikes tecnológicos (Implementation Gate)

> Código **descartable**. Nada de esta carpeta se importa desde `apps/`, `packages/` ni `services/`, y no forma parte del workspace pnpm del producto. Sirve como evidencia para aceptar o ajustar ADRs.

| Spike | Carpeta | ADR(s) | Estado |
|---|---|---|---|
| SPIKE-01 OpenSpec en CI | [SPIKE-01-openspec-ci](SPIKE-01-openspec-ci/README.md) | 0024 | Completado (CI real pendiente de remoto) |
| SPIKE-02 Acceso a datos | [SPIKE-02-data-access](SPIKE-02-data-access/README.md) | 0007, 0005, 0023 | Completado — Kysely + dbmate |
| SPIKE-03 Money y redondeo | [SPIKE-03-money](SPIKE-03-money/README.md) | 0006 | Completado — recomienda aceptar |
| SPIKE-04 Modular monolith NestJS | [SPIKE-04-modular-monolith](SPIKE-04-modular-monolith/README.md) | 0002, 0003, 0018 | Completado — recomienda aceptar (ADR-0018 requiere ajustes de tooling) |
| SPIKE-05 Outbox + cola | [SPIKE-05-outbox-queue](SPIKE-05-outbox-queue/README.md) | 0008 | Completado — recomienda pg-boss, Redis opcional (Q5) |
| SPIKE-06 Auth Keycloak + BFF | [SPIKE-06-auth-bff](SPIKE-06-auth-bff/README.md) | 0010, 0019 | Completado — recomienda aceptar (openid-client, sin Auth.js) |
| SPIKE-07 Object storage local | [SPIKE-07-object-storage](SPIKE-07-object-storage/README.md) | 0009 | Completado — SeaweedFS |
| SPIKE-08 Compose en Windows | [SPIKE-08-compose-windows](SPIKE-08-compose-windows/README.md) | 0011, 0012 | Completado (ADR-0012 Propuesto) |
| SPIKE-09 Costo cloud | [SPIKE-09-deploy-costs](SPIKE-09-deploy-costs/README.md) | 0013, 0027 | Completado (investigación + latencia medida). [Anexo A — PaaS](SPIKE-09-deploy-costs/anexo-a-paas.md) (2026-10-04, D42): ninguna PaaS supera a los VPS. **§17 (2026-10-05):** presupuesto del owner USD 10–20 → default AWS Lightsail 2 GB São Paulo (≈ USD 14/mes), fallback Oracle A1; Hetzner CX no contratable; **ADR-0027 Aceptado**, ADR-0013 reemplazado; scaffolding de deploy (`infra/`, `compose.prod.yaml`, `deploy.yml`) validado sin cloud. PoC de costo facturado pendiente |
| SPIKE-10 Observabilidad local | [SPIKE-10-observability](SPIKE-10-observability/README.md) | 0020 | Completado (ADR en Propuesto) |

## Reglas

- Cada spike vive en `spikes/SPIKE-NN-nombre/` con su propio `package.json` (o `pyproject`), `compose.yaml` si necesita contenedores y un `README.md` con el informe (en español): pregunta, setup, comandos ejecutados, resultados medidos, evidencia, recomendación, impacto en ADRs/docs.
- Contenedores con nombre de proyecto `pf-spike-NN` y puertos de host en el rango **61xxx** (la máquina del owner ya usa 5432, 55432, 56379, 9000/9001, 7700 para otros proyectos). Al terminar: `docker compose -p pf-spike-NN down -v`.
- Ningún spike detiene, modifica ni borra contenedores, volúmenes o redes que no haya creado.
- Los ADRs quedan en *Propuesto* con una sección **Resultado del spike**; el owner los acepta. **2026-10-02:** el owner aceptó los 17 ADRs respaldados por spikes (0008 con pg-boss, 0010 con sesiones en PostgreSQL, 0012 con estrategia de dockerización y parametrización).
