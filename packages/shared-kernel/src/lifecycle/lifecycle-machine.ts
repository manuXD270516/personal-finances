import { DomainError } from '../errors/domain-error.js';

/**
 * Máquina de estados declarada de un agregado (openspec add-lifecycle-timeline, decisión 1; docs/31 D37). Es DATO
 * puro (serializable tal cual en `GET W/lifecycle-machines/{aggregateType}`) y la ÚNICA fuente de las reglas de
 * transición: el agregado valida cada cambio de estado contra ella y el recorrido la muestra.
 *
 * - `from: []` declara una transición de creación (∅ → estado).
 * - `to` admite varios destinos (p. ej. `RECORD` de una transacción nace `PENDING`, `POSTED` o `CLEARED`).
 * - Un estado `terminal` no tiene transiciones salientes.
 */
export interface LifecycleStateDefinition<S extends string = string> {
  readonly code: S;
  readonly terminal: boolean;
}

export interface LifecycleTransitionDefinition<S extends string = string, T extends string = string> {
  readonly code: T;
  readonly from: readonly S[];
  readonly to: readonly S[];
  /** Guarda en lenguaje del dominio (documentación; la evalúa el agregado). */
  readonly guard: string;
  /** Eventos que publica la transición (`<context>.<EventName>.v<N>`). */
  readonly events: readonly string[];
}

export interface LifecycleMachineDefinition<S extends string = string, T extends string = string> {
  readonly aggregateType: string;
  readonly machineVersion: number;
  readonly states: readonly LifecycleStateDefinition<S>[];
  readonly transitions: readonly LifecycleTransitionDefinition<S, T>[];
}

/** Paso del flujo de un agregado: qué transición lo llevó de `from` (∅ = `null`) a `to`. */
export interface StateTransition<S extends string = string, T extends string = string> {
  readonly transition: T;
  readonly from: S | null;
  readonly to: S;
}

const invalidTransition = (aggregateType: string, detail: string) =>
  new DomainError('INVALID_STATUS_TRANSITION', `${aggregateType}: ${detail}`);

/** Máquina validada + operaciones de consulta (permitido, reproducción de un camino). */
export class LifecycleMachine<S extends string = string, T extends string = string> {
  private readonly byCode: ReadonlyMap<T, LifecycleTransitionDefinition<S, T>>;
  private readonly stateCodes: ReadonlySet<S>;

  private constructor(readonly definition: LifecycleMachineDefinition<S, T>) {
    this.stateCodes = new Set(definition.states.map((s) => s.code));
    this.byCode = new Map(definition.transitions.map((t) => [t.code, t]));
  }

  /** Valida la declaración (estados y transiciones únicos y conocidos; terminales sin salidas) y la congela. */
  static define<const S extends string, const T extends string>(
    definition: LifecycleMachineDefinition<S, T>,
  ): LifecycleMachine<S, T> {
    const fail = (msg: string) => {
      throw new TypeError(`LifecycleMachine ${definition.aggregateType}: ${msg}`);
    };
    if (!Number.isSafeInteger(definition.machineVersion) || definition.machineVersion < 1) {
      fail('machineVersion must be a positive integer');
    }
    const states = new Set<string>();
    for (const s of definition.states) {
      if (states.has(s.code)) fail(`duplicated state ${s.code}`);
      states.add(s.code);
    }
    const codes = new Set<string>();
    let creations = 0;
    for (const t of definition.transitions) {
      if (codes.has(t.code)) fail(`duplicated transition ${t.code}`);
      codes.add(t.code);
      if (t.to.length === 0) fail(`transition ${t.code} has no destination`);
      if (t.from.length === 0) creations += 1;
      for (const s of [...t.from, ...t.to]) if (!states.has(s)) fail(`unknown state ${s} in ${t.code}`);
      for (const s of t.from) {
        if (definition.states.find((d) => d.code === s)?.terminal) {
          fail(`terminal state ${s} has outgoing transition ${t.code}`);
        }
      }
    }
    if (creations === 0) fail('no creation transition (from: [])');
    const frozen: LifecycleMachineDefinition<S, T> = Object.freeze({
      aggregateType: definition.aggregateType,
      machineVersion: definition.machineVersion,
      states: Object.freeze(definition.states.map((s) => Object.freeze({ ...s }))),
      transitions: Object.freeze(
        definition.transitions.map((t) =>
          Object.freeze({
            ...t,
            from: Object.freeze([...t.from]),
            to: Object.freeze([...t.to]),
            events: Object.freeze([...t.events]),
          }),
        ),
      ),
    });
    return new LifecycleMachine(frozen);
  }

  get aggregateType(): string {
    return this.definition.aggregateType;
  }

  get version(): number {
    return this.definition.machineVersion;
  }

  isState(code: string): code is S {
    return this.stateCodes.has(code as S);
  }

  isTerminal(state: S): boolean {
    return this.definition.states.some((s) => s.code === state && s.terminal);
  }

  transitionDefinition(code: T): LifecycleTransitionDefinition<S, T> | undefined {
    return this.byCode.get(code);
  }

  /** ¿Está declarada `code` de `from` (∅ = `null`) a `to`? */
  allows(code: T, from: S | null, to: S): boolean {
    const t = this.byCode.get(code);
    if (!t || !t.to.includes(to)) return false;
    return from === null ? t.from.length === 0 : t.from.includes(from);
  }

  /** ¿Existe ALGUNA transición declarada (que no sea de creación) de `from` a `to`? */
  canMove(from: S, to: S, options: { readonly except?: readonly T[] } = {}): boolean {
    return this.definition.transitions.some(
      (t) => !options.except?.includes(t.code) && t.from.includes(from) && t.to.includes(to),
    );
  }

  /**
   * Valida un paso y lo devuelve como `StateTransition`. Si la transición tiene un único destino, `to` puede
   * omitirse. Un paso no declarado ⇒ `INVALID_STATUS_TRANSITION` (409).
   */
  transition(code: T, from: S | null, to?: S): StateTransition<S, T> {
    const t = this.byCode.get(code);
    if (!t) throw invalidTransition(this.aggregateType, `unknown transition ${code}`);
    const target = to ?? (t.to.length === 1 ? t.to[0] : undefined);
    if (target === undefined) {
      throw invalidTransition(this.aggregateType, `transition ${code} needs an explicit destination`);
    }
    if (!this.allows(code, from, target)) {
      throw invalidTransition(this.aggregateType, `cannot ${code} from ${from ?? '∅'} to ${target}`);
    }
    return { transition: code, from, to: target };
  }

  /**
   * Reproduce un recorrido completo desde ∅: devuelve el estado final o lanza `INVALID_STATUS_TRANSITION` si algún
   * paso no está declarado o no encadena con el anterior.
   */
  replay(steps: readonly StateTransition<S, T>[]): S | null {
    let current: S | null = null;
    for (const step of steps) {
      if (step.from !== current) {
        throw invalidTransition(
          this.aggregateType,
          `step ${step.transition} starts at ${step.from ?? '∅'} but the path is at ${current ?? '∅'}`,
        );
      }
      current = this.transition(step.transition, step.from, step.to).to;
    }
    return current;
  }

  /** Estados alcanzables desde ∅ siguiendo transiciones declaradas. */
  reachableStates(): ReadonlySet<S> {
    const seen = new Set<S>();
    const queue: S[] = this.definition.transitions.filter((t) => t.from.length === 0).flatMap((t) => t.to);
    while (queue.length > 0) {
      const s = queue.shift() as S;
      if (seen.has(s)) continue;
      seen.add(s);
      for (const t of this.definition.transitions) if (t.from.includes(s)) queue.push(...t.to);
    }
    return seen;
  }

  /** Transiciones aplicables desde un estado (∅ = creación). */
  outgoing(from: S | null): readonly LifecycleTransitionDefinition<S, T>[] {
    return this.definition.transitions.filter((t) =>
      from === null ? t.from.length === 0 : t.from.includes(from),
    );
  }
}
