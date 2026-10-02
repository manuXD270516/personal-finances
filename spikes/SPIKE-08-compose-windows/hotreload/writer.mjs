// Linux-side writer (simulates an editor running inside WSL2/ext4). POST /write -> writes token = Date.now().
import http from 'node:http';
import { writeFileSync, mkdirSync } from 'node:fs';
const dir = '/app/src';
mkdirSync(`${dir}/filler`, { recursive: true });
for (let i = 0; i < Number(process.env.FILLER ?? 2000); i++) writeFileSync(`${dir}/filler/f${i}.mjs`, `export const v${i} = ${i};\n`);
writeFileSync(`${dir}/app.mjs`, process.env.APP_SRC);
writeFileSync(`${dir}/token.mjs`, 'export const token = 0;\n');
http.createServer((req, res) => {
  const token = Date.now();
  writeFileSync(`${dir}/token.mjs`, `export const token = ${token};\n`);
  res.end(JSON.stringify({ token }));
}).listen(8081, () => console.log('writer ready'));
