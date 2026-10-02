// Used by WATCH_MODE=node-watch: `node --watch /app/src/app.mjs` restarts on change of this file or its imports.
import http from 'node:http';
import { token } from './token.mjs';
const at = Date.now();
console.log(`DETECT token=${token} at=${at} lat_raw=${at - token} (process restarted)`);
http.createServer((req, res) => {
  res.setHeader('content-type', 'application/json');
  if (req.url === '/time') return res.end(JSON.stringify({ now: Date.now() }));
  res.end(JSON.stringify({ token, at }));
}).listen(8080);
