import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { type DomainError } from '../errors/domain-error.js';
import { LifecycleMachine, type StateTransition } from './lifecycle-machine.js';

// Máquina mínima de ejemplo (openspec add-lifecycle-timeline, decisión 1): estados, terminal, creación y guardas.
const machine = LifecycleMachine.define({
  aggregateType: 'Sample',
  machineVersion: 1,
  states: [
    { code: 'OPEN', terminal: false },
    { code: 'DONE', terminal: false },
    { code: 'GONE', terminal: true },
  ],
  transitions: [
    { code: 'CREATE', from: [], to: ['OPEN', 'DONE'], guard: '—', events: ['s.Created.v1'] },
    { code: 'FINISH', from: ['OPEN'], to: ['DONE'], guard: '—', events: [] },
    { code: 'REOPEN', from: ['DONE'], to: ['OPEN'], guard: '—', events: [] },
    { code: 'DROP', from: ['OPEN', 'DONE'], to: ['GONE'], guard: 'motivo', events: [] },
  ],
});

const codeOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (err) {
    return (err as DomainError).code;
  }
  return undefined;
};

describe('LifecycleMachine (shared-kernel)', () => {
  it('[TC-AUDIT-LIFECYCLE-001] una transición no declarada se rechaza con INVALID_STATUS_TRANSITION', () => {
    expect(machine.transition('FINISH', 'OPEN')).toEqual({ transition: 'FINISH', from: 'OPEN', to: 'DONE' });
    expect(codeOf(() => machine.transition('FINISH', 'DONE'))).toBe('INVALID_STATUS_TRANSITION');
    expect(codeOf(() => machine.transition('CREATE', 'OPEN', 'DONE'))).toBe('INVALID_STATUS_TRANSITION');
    // Creación con varios destinos: exige destino explícito.
    expect(codeOf(() => machine.transition('CREATE', null))).toBe('INVALID_STATUS_TRANSITION');
    expect(machine.transition('CREATE', null, 'DONE').to).toBe('DONE');
    expect(codeOf(() => machine.transition('NOPE' as 'DROP', 'OPEN'))).toBe('INVALID_STATUS_TRANSITION');
  });

  it('[TC-AUDIT-LIFECYCLE-001] la declaración se valida: terminales sin salidas, estados conocidos, una creación', () => {
    const base = {
      aggregateType: 'Bad',
      machineVersion: 1,
      states: [
        { code: 'A', terminal: false },
        { code: 'Z', terminal: true },
      ],
    };
    expect(() =>
      LifecycleMachine.define({
        ...base,
        transitions: [
          { code: 'NEW', from: [], to: ['A'], guard: '', events: [] },
          { code: 'BACK', from: ['Z'], to: ['A'], guard: '', events: [] },
        ],
      }),
    ).toThrow(/terminal state Z/);
    expect(() =>
      LifecycleMachine.define({
        ...base,
        transitions: [{ code: 'GO', from: ['A'], to: ['Z'], guard: '', events: [] }],
      }),
    ).toThrow(/no creation transition/);
    expect(() =>
      LifecycleMachine.define({
        ...base,
        transitions: [{ code: 'NEW', from: [], to: ['Q' as 'A'], guard: '', events: [] }],
      }),
    ).toThrow(/unknown state Q/);
    expect(Object.isFrozen(machine.definition.transitions[0]?.to)).toBe(true);
  });

  it('[TC-AUDIT-LIFECYCLE-001] replay reproduce un camino y rechaza pasos que no encadenan', () => {
    const path: StateTransition<'OPEN' | 'DONE' | 'GONE', 'CREATE' | 'FINISH' | 'REOPEN' | 'DROP'>[] = [
      { transition: 'CREATE', from: null, to: 'OPEN' },
      { transition: 'FINISH', from: 'OPEN', to: 'DONE' },
      { transition: 'DROP', from: 'DONE', to: 'GONE' },
    ];
    expect(machine.replay(path)).toBe('GONE');
    expect(codeOf(() => machine.replay([path[0]!, path[2]!]))).toBe('INVALID_STATUS_TRANSITION');
    expect([...machine.reachableStates()].sort()).toEqual(['DONE', 'GONE', 'OPEN']);
    expect(machine.outgoing(null).map((t) => t.code)).toEqual(['CREATE']);
    expect(machine.isTerminal('GONE')).toBe(true);
  });

  it('[TC-AUDIT-LIFECYCLE-001] PBT: todo camino generado con transiciones permitidas es reproducible y termina en un estado alcanzable', () => {
    fc.assert(
      fc.property(fc.array(fc.nat(), { maxLength: 30 }), (choices) => {
        const steps: StateTransition<string, string>[] = [];
        let current: string | null = null;
        for (const pick of choices) {
          const options = machine.outgoing(current as never);
          if (options.length === 0) break;
          const t = options[pick % options.length]!;
          const to = t.to[pick % t.to.length]!;
          steps.push({ transition: t.code, from: current, to });
          current = to;
        }
        const end = machine.replay(steps as never);
        expect(end).toBe(current);
        if (end !== null) expect(machine.reachableStates().has(end)).toBe(true);
        // Después de un terminal no hay más pasos.
        if (end !== null && machine.isTerminal(end)) expect(machine.outgoing(end)).toHaveLength(0);
      }),
    );
  });
});
