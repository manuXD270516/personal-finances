// Ejecuta un binario de node_modules/.bin con las variables de .env cargadas (Node 22 process.loadEnvFile).
import { spawn } from 'node:child_process';
process.loadEnvFile('.env');
const [cmd, ...args] = process.argv.slice(2);
const child = spawn(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32', env: process.env });
child.on('exit', (code) => process.exit(code ?? 1));
