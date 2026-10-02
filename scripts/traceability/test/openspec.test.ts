import { describe, expect, it } from 'vitest';
import { loadRequirements, parseSpecMarkdown, parseTrace } from '../src/openspec.js';
import { makeRepo } from './helpers.js';

const summarize = (reqs: Awaited<ReturnType<typeof loadRequirements>>) =>
  reqs
    .map((r) => ({
      spec: r.spec,
      name: r.name,
      priority: r.priority,
      trace: r.trace,
      scenarios: r.scenarios,
      sources: r.sources,
    }))
    .sort((a, b) => `${a.spec}#${a.name}`.localeCompare(`${b.spec}#${b.name}`));

describe('parseo de requirements de OpenSpec', () => {
  it('lee la línea Trace/Priority', () => {
    expect(
      parseTrace('El sistema DEBE (MUST) algo.\nTrace: FR-DEMO-001, NFR-MAINT-005 · Priority: Must'),
    ).toEqual({
      trace: ['FR-DEMO-001', 'NFR-MAINT-005'],
      priority: 'Must',
    });
    expect(parseTrace('Sin línea de traza')).toEqual({ trace: [], priority: null });
  });

  it('parsea deltas ADDED/MODIFIED y omite los REMOVED', () => {
    const md = [
      '## ADDED Requirements',
      '',
      '### Requirement: Uno',
      'Texto DEBE (MUST).',
      'Trace: FR-A-001 · Priority: Must',
      '',
      '#### Scenario: Esc A',
      '- **CUANDO** x',
      '',
      '## MODIFIED Requirements',
      '',
      '### Requirement: Dos',
      'Texto.',
      'Trace: NFR-SEC-001 · Priority: Should',
      '',
      '#### Scenario: Esc B',
      '#### Scenario: Esc C',
      '',
      '## REMOVED Requirements',
      '',
      '### Requirement: Tres',
      '**Motivo**: ya no aplica',
    ].join('\n');
    const reqs = parseSpecMarkdown(md);
    expect(reqs).toEqual([
      { name: 'Uno', operation: 'ADDED', priority: 'Must', trace: ['FR-A-001'], scenarios: ['Esc A'] },
      {
        name: 'Dos',
        operation: 'MODIFIED',
        priority: 'Should',
        trace: ['NFR-SEC-001'],
        scenarios: ['Esc B', 'Esc C'],
      },
      { name: 'Tres', operation: 'REMOVED', priority: null, trace: [], scenarios: [] },
    ]);
  });

  it('incluye changes activos y specs principales, y excluye changes archivados (Markdown)', async () => {
    const reqs = summarize(await loadRequirements({ root: makeRepo(), openspec: 'markdown' }));
    expect(reqs).toEqual([
      {
        spec: 'demo/capability',
        name: 'Requirement cubierto',
        priority: 'Must',
        trace: ['FR-DEMO-001', 'NFR-MAINT-005'],
        scenarios: ['Escenario uno', 'Escenario dos'],
        sources: ['openspec/changes/add-demo/specs/demo/capability/spec.md'],
      },
      {
        spec: 'demo/capability',
        name: 'Requirement opcional',
        priority: 'Should',
        trace: ['FR-DEMO-002'],
        scenarios: ['Escenario opcional'],
        sources: ['openspec/changes/add-demo/specs/demo/capability/spec.md'],
      },
      {
        spec: 'demo/main',
        name: 'Requirement principal',
        priority: 'Must',
        trace: ['FR-DEMO-003'],
        scenarios: ['Escenario principal'],
        sources: ['openspec/specs/demo/main/spec.md'],
      },
    ]);
  });

  it('el CLI de OpenSpec (--json) produce los mismos requirements que el parseo Markdown', async () => {
    const root = makeRepo();
    const viaCli = summarize(await loadRequirements({ root, openspec: 'cli' }));
    const viaMarkdown = summarize(await loadRequirements({ root, openspec: 'markdown' }));
    expect(viaCli).toEqual(viaMarkdown);
  });
});
