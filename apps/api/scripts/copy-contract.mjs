// Copia el contrato OpenAPI (fuente de verdad, contracts/openapi) junto al build de finance-api: la imagen
// (`pnpm deploy`) solo incluye `dist`, `db` y `contract`, y la API valida cada petición contra él al arrancar.
import { copyFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const source = fileURLToPath(new URL('../../../contracts/openapi/finance-api.v1.yaml', import.meta.url));
const targetDir = fileURLToPath(new URL('../contract/', import.meta.url));
mkdirSync(targetDir, { recursive: true });
copyFileSync(source, `${targetDir}finance-api.v1.yaml`);
