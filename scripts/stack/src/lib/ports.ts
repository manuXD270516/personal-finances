import { execFile } from 'node:child_process';
import { createServer } from 'node:net';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** true si se puede escuchar en `host:port` en este momento. */
export function isPortFree(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.unref();
    server.once('error', () => resolve(false));
    server.listen({ port, host, exclusive: true }, () => server.close(() => resolve(true)));
  });
}

export interface PortRange {
  readonly start: number;
  readonly end: number;
}

/** Rangos TCP reservados por Hyper-V/WinNAT (solo Windows): escuchar ahí falla aunque nadie use el puerto. */
export async function windowsExcludedPortRanges(): Promise<PortRange[]> {
  if (process.platform !== 'win32') return [];
  try {
    const { stdout } = await execFileAsync('netsh', [
      'interface',
      'ipv4',
      'show',
      'excludedportrange',
      'protocol=tcp',
    ]);
    return parseExcludedRanges(stdout);
  } catch {
    return [];
  }
}

export function parseExcludedRanges(text: string): PortRange[] {
  const ranges: PortRange[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(\d+)\s+(\d+)\b/.exec(line);
    if (m) ranges.push({ start: Number(m[1]), end: Number(m[2]) });
  }
  return ranges;
}

export const inRanges = (port: number, ranges: readonly PortRange[]): boolean =>
  ranges.some((r) => port >= r.start && port <= r.end);

/** Siguiente puerto libre por encima de `from` (fuera de rangos excluidos y de `taken`). */
export async function suggestPort(
  from: number,
  host: string,
  excluded: readonly PortRange[],
  taken: ReadonlySet<number>,
): Promise<number | undefined> {
  for (let port = from + 1; port < Math.min(from + 200, 49151); port++) {
    if (taken.has(port) || inRanges(port, excluded)) continue;
    if (await isPortFree(port, host)) return port;
  }
  return undefined;
}
