// Copia .env.example -> .env si no existe (cross-platform).
import { copyFileSync, existsSync } from 'node:fs';
if (existsSync('.env')) console.log('.env ya existe');
else { copyFileSync('.env.example', '.env'); console.log('.env creado desde .env.example'); }
