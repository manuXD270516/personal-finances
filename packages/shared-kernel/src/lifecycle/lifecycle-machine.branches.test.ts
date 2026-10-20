import { describe, expect, it } from 'vitest';
import { type DomainError } from '../errors/domain-error.js';
import { LifecycleMachine } from './lifecycle-machine.js';

const machine = LifecycleMachine.define({
  aggregateType: 'Loan',
  machineVersion: 3,
  states: [
    { code: 'ACTIVE', terminal: false },
    { code: 'PAUSED', terminal: false },
    { code: 'PAID', terminal: true },
  ],
  transitions: [
    { code: 'OPEN', from: [], to: ['ACTIVE'], guard: '—', events: ['debt.Opened.v1'] },
    { code: 'PAUSE', from: ['ACTIVE'], to: ['PAUSED'], guard: '—', events: [] },
    { code: 'RESUME', from: ['PAUSED'], to: ['ACTIVE'], guard: '—', events: [] },
    { code: 'SETTLE', from: ['ACTIVE', 'PAUSED'], to: ['PAID'], guard: 'saldo cero', events: [] },
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

const failure = (definition: Parameters<typeof LifecycleMachine.define>[0]) => {
  try {
    LifecycleMachine.define(definition);
  } catch (err) {
    return err;
  }
  return undefined;
};

describe('LifecycleMachine: ramas de la declaración y de las consultas', () => {
  const states = [
    { code: 'A', terminal: false },
    { code: 'Z', terminal: true },
  ];
  const create = { code: 'NEW', from: [], to: ['A'], guard: '', events: [] };

  it('machineVersion debe ser un entero positivo', () => {
    for (const machineVersion of [0, -1, 1.5, Number.NaN]) {
      expect(failure({ aggregateType: 'V', machineVersion, states, transitions: [create] })).toBeInstanceOf(
        TypeError,
      );
    }
  });

  it('rechaza estados duplicados, transiciones duplicadas y transiciones sin destino', () => {
    const base = { aggregateType: 'D', machineVersion: 1 };
    expect(String(failure({ ...base, states: [...states, states[0]!], transitions: [create] }))).toMatch(
      /duplicated state A/,
    );
    expect(String(failure({ ...base, states, transitions: [create, { ...create, to: ['A'] }] }))).toMatch(
      /duplicated transition NEW/,
    );
    expect(
      String(
        failure({
          ...base,
          states,
          transitions: [create, { code: 'X', from: ['A'], to: [], guard: '', events: [] }],
        }),
      ),
    ).toMatch(/has no destination/);
  });

  it('expone versión, tipo de agregado, estados conocidos y definiciones de transición', () => {
    expect(machine.version).toBe(3);
    expect(machine.aggregateType).toBe('Loan');
    expect(machine.isState('PAID')).toBe(true);
    expect(machine.isState('NOPE')).toBe(false);
    expect(machine.transitionDefinition('SETTLE')?.guard).toBe('saldo cero');
    expect(machine.transitionDefinition('NOPE' as 'OPEN')).toBeUndefined();
  });

  it('isTerminal: solo el estado declarado terminal; allows distingue creación de transición', () => {
    expect(machine.isTerminal('PAID')).toBe(true);
    expect(machine.isTerminal('ACTIVE')).toBe(false);
    expect(machine.allows('OPEN', null, 'ACTIVE')).toBe(true);
    expect(machine.allows('OPEN', 'ACTIVE', 'ACTIVE')).toBe(false);
    expect(machine.allows('PAUSE', null, 'PAUSED')).toBe(false);
    expect(machine.allows('PAUSE', 'ACTIVE', 'ACTIVE')).toBe(false);
    expect(machine.allows('NOPE' as 'OPEN', null, 'ACTIVE')).toBe(false);
  });

  it('canMove ignora las creaciones y admite excluir transiciones', () => {
    expect(machine.canMove('ACTIVE', 'PAUSED')).toBe(true);
    expect(machine.canMove('ACTIVE', 'PAID')).toBe(true);
    expect(machine.canMove('ACTIVE', 'PAID', { except: ['SETTLE'] })).toBe(false);
    expect(machine.canMove('PAID', 'ACTIVE')).toBe(false);
    expect(machine.canMove('PAUSED', 'PAUSED')).toBe(false);
  });

  it('transition: destino implícito si hay uno solo; desde un terminal ninguna transición es válida', () => {
    expect(machine.transition('PAUSE', 'ACTIVE')).toEqual({
      transition: 'PAUSE',
      from: 'ACTIVE',
      to: 'PAUSED',
    });
    expect(machine.transition('SETTLE', 'PAUSED', 'PAID').to).toBe('PAID');
    for (const code of ['OPEN', 'PAUSE', 'RESUME', 'SETTLE'] as const) {
      expect(codeOf(() => machine.transition(code, 'PAID'))).toBe('INVALID_STATUS_TRANSITION');
    }
    expect(codeOf(() => machine.transition('PAUSE', null))).toBe('INVALID_STATUS_TRANSITION');
    expect(codeOf(() => machine.transition('OPEN', 'ACTIVE'))).toBe('INVALID_STATUS_TRANSITION');
  });

  it('replay: recorrido vacío ⇒ null; un paso con destino no declarado se rechaza', () => {
    expect(machine.replay([])).toBeNull();
    expect(codeOf(() => machine.replay([{ transition: 'OPEN', from: null, to: 'PAUSED' }]))).toBe(
      'INVALID_STATUS_TRANSITION',
    );
  });

  it('outgoing por estado y reachableStates con una máquina que tiene un estado huérfano', () => {
    expect(machine.outgoing('ACTIVE').map((t) => t.code)).toEqual(['PAUSE', 'SETTLE']);
    expect(machine.outgoing('PAID')).toEqual([]);
    const orphan = LifecycleMachine.define({
      aggregateType: 'Orphan',
      machineVersion: 1,
      states: [...states, { code: 'LOST', terminal: false }],
      transitions: [create, { code: 'END', from: ['A'], to: ['Z'], guard: '', events: [] }],
    });
    expect([...orphan.reachableStates()].sort()).toEqual(['A', 'Z']);
  });

  it('la definición queda congelada', () => {
    expect(Object.isFrozen(machine.definition)).toBe(true);
    expect(Object.isFrozen(machine.definition.states[0])).toBe(true);
    expect(Object.isFrozen(machine.definition.transitions[0]?.events)).toBe(true);
  });
});
