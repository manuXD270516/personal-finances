import { describe, expect, it } from 'vitest';
import { WorkspaceCoalescer } from './workspace-coalescer.js';

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 5));

describe('WorkspaceCoalescer', () => {
  it('una ráfaga concurrente de hechos de un workspace se evalúa dos veces como máximo', async () => {
    const coalescer = new WorkspaceCoalescer();
    const starts: number[] = [];
    let clock = 0;
    const evaluate = async () => {
      starts.push((clock += 1));
      await tick();
    };
    await Promise.all(Array.from({ length: 50 }, () => coalescer.run('ws-1', evaluate)));
    expect(coalescer.executions).toBe(2);
    expect(starts).toHaveLength(2);
  });

  it('cada hecho espera una evaluación que empezó después de que llegó (no se pierde ningún cruce)', async () => {
    const coalescer = new WorkspaceCoalescer();
    const log: string[] = [];
    let evaluation = 0;
    const evaluate = async () => {
      evaluation += 1;
      const mine = evaluation;
      log.push(`start ${mine}`);
      await tick();
      log.push(`end ${mine}`);
    };
    const first = coalescer.run('ws-1', evaluate).then(() => log.push('first done'));
    await tick();
    // Llega mientras la evaluación 1 corre: debe esperar a la evaluación 2 (que empieza después de que llegó).
    const late = coalescer.run('ws-1', evaluate).then(() => log.push('late done'));
    await Promise.all([first, late]);
    expect(log.indexOf('late done')).toBeGreaterThan(log.indexOf('end 2'));
    expect(log.indexOf('start 2')).toBeGreaterThan(log.indexOf('start 1'));
    expect(coalescer.executions).toBe(2);
  });

  it('workspaces distintos no se coalescen entre sí y una secuencia sin solape evalúa cada vez', async () => {
    const coalescer = new WorkspaceCoalescer();
    await Promise.all([coalescer.run('a', tick), coalescer.run('b', tick)]);
    expect(coalescer.executions).toBe(2);
    await coalescer.run('a', tick);
    await coalescer.run('a', tick);
    expect(coalescer.executions).toBe(4);
  });

  it('un fallo de la evaluación lo ven los que esperaban y el workspace queda libre para reintentar', async () => {
    const coalescer = new WorkspaceCoalescer();
    const failing = async () => {
      await tick();
      throw new Error('boom');
    };
    const results = await Promise.allSettled([
      coalescer.run('ws-1', failing),
      coalescer.run('ws-1', failing),
      coalescer.run('ws-1', failing),
    ]);
    expect(results.map((r) => r.status)).toEqual(['rejected', 'rejected', 'rejected']);
    await expect(coalescer.run('ws-1', tick)).resolves.toBeUndefined();
  });
});
