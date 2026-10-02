import { connect } from 'node:net';
import type { DependencyCheck } from '../readiness.js';

const encode = (args: readonly string[]): string =>
  `*${args.length}\r\n` + args.map((a) => `$${Buffer.byteLength(a)}\r\n${a}\r\n`).join('');

/**
 * Valkey/Redis: `AUTH` (si la URL trae credenciales) + `PING` por RESP sobre TCP. Sin cliente pesado: la
 * readiness solo necesita saber si responde. Solo se registra si `JOB_QUEUE_DRIVER=bullmq` o `SESSION_STORE=valkey`.
 */
export function valkeyCheck(url: string): DependencyCheck {
  const parsed = new URL(url);
  const host = parsed.hostname;
  const port = Number(parsed.port || 6379);
  const user = decodeURIComponent(parsed.username);
  const password = decodeURIComponent(parsed.password);
  const commands: string[][] = [];
  if (password) commands.push(user ? ['AUTH', user, password] : ['AUTH', password]);
  commands.push(['PING']);

  return {
    name: 'valkey',
    check(signal) {
      return new Promise<void>((resolve, reject) => {
        let buffer = '';
        let replies = 0;
        const socket = connect({ host, port }, () => {
          socket.write(commands.map(encode).join(''));
        });
        const fail = (err: Error) => {
          socket.destroy();
          reject(err);
        };
        signal.addEventListener('abort', () => fail(new Error('aborted')), { once: true });
        socket.setEncoding('utf8');
        socket.on('error', fail);
        socket.on('close', () => {
          if (replies < commands.length) fail(new Error('connection closed'));
        });
        socket.on('data', (chunk: string) => {
          buffer += chunk;
          let idx = buffer.indexOf('\r\n');
          while (idx >= 0) {
            const line = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            if (line.startsWith('-')) return fail(new Error('valkey replied with an error'));
            replies += 1;
            if (replies === commands.length) {
              socket.end();
              return line === '+PONG' ? resolve() : fail(new Error('unexpected PING reply'));
            }
            idx = buffer.indexOf('\r\n');
          }
        });
      });
    },
  };
}
