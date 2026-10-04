/**
 * Lógica pura del reporte "Recorrido" (openspec add-lifecycle-timeline, decisión 11): modelo del diagrama (estados
 * visitados, aristas recorridas numeradas por orden de ocurrencia, estado actual), layout fijo y determinista por máquina
 * (horizontal y vertical) y filas de la línea de tiempo. Sin librería de gráficos: geometría propia del SVG.
 */
import type {
  Lifecycle,
  LifecycleActor,
  LifecycleItem,
  LifecycleJournalEntries,
  LifecycleMachine,
} from './types';

// ── Modelo ────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Identificador de una arista: transición + par origen → destino (`∅` = creación). */
export const edgeId = (transition: string, from: string | null, to: string): string =>
  `${transition}:${from ?? '∅'}>${to}`;

export interface DiagramNode {
  readonly code: string;
  readonly terminal: boolean;
  readonly visited: boolean;
  readonly current: boolean;
}

export interface DiagramEdge {
  readonly id: string;
  readonly transition: string;
  /** `null` = creación desde ∅ (punto de entrada). */
  readonly from: string | null;
  readonly to: string;
  readonly traversed: boolean;
  /** Números de orden con que se recorrió (vacío si no se recorrió o si es la creación, que no se numera). */
  readonly order: readonly number[];
}

export interface DiagramModel {
  readonly nodes: readonly DiagramNode[];
  readonly edges: readonly DiagramEdge[];
  /** Número de orden de cada transición numerada, por `sequence` (la creación no lleva número). */
  readonly orderBySequence: ReadonlyMap<number, number>;
}

/** Aristas declaradas por la máquina: una por cada par origen → destino de cada transición, en orden de declaración. */
export function machineEdges(
  machine: LifecycleMachine,
): { id: string; transition: string; from: string | null; to: string }[] {
  return machine.transitions.flatMap((t) =>
    (t.from.length > 0 ? t.from : [null]).flatMap((from) =>
      t.to.map((to) => ({ id: edgeId(t.code, from, to), transition: t.code, from, to })),
    ),
  );
}

const bySequence = (items: readonly LifecycleItem[]) => [...items].sort((a, b) => a.sequence - b.sequence);

/**
 * Camino recorrido sobre la máquina: nodos visitados (camino + orígenes de las transiciones registradas, p. ej. el
 * estado inicial de una historia reconstruida), estado actual y aristas recorridas. La numeración cuenta solo las
 * transiciones: la creación (`fromState = null`, p. ej. RECORD/OPEN) es el punto de entrada y no lleva número.
 */
export function buildDiagramModel(lifecycle: Lifecycle): DiagramModel {
  const visited = new Set(lifecycle.path);
  const orders = new Map<string, number[]>();
  const traversed = new Set<string>();
  const orderBySequence = new Map<number, number>();
  let n = 0;
  for (const item of bySequence(lifecycle.items)) {
    if (item.kind !== 'TRANSITION') continue;
    if (item.fromState) visited.add(item.fromState);
    visited.add(item.toState);
    const id = edgeId(item.transition, item.fromState, item.toState);
    traversed.add(id);
    if (item.fromState === null) continue;
    n += 1;
    orderBySequence.set(item.sequence, n);
    orders.set(id, [...(orders.get(id) ?? []), n]);
  }
  return {
    nodes: lifecycle.machine.states.map((s) => ({
      code: s.code,
      terminal: s.terminal,
      visited: visited.has(s.code),
      current: s.code === lifecycle.currentState,
    })),
    edges: machineEdges(lifecycle.machine).map((e) => ({
      ...e,
      traversed: traversed.has(e.id),
      order: orders.get(e.id) ?? [],
    })),
    orderBySequence,
  };
}

// ── Línea de tiempo ───────────────────────────────────────────────────────────────────────────────────────────────

export type ActorView =
  | { readonly kind: 'you'; readonly value: '' }
  | { readonly kind: 'named' | 'user' | 'process'; readonly value: string };

export interface TimelineRow {
  readonly sequence: number;
  readonly kind: LifecycleItem['kind'];
  /** Número de orden en el diagrama (`null` para la creación y las anotaciones). */
  readonly order: number | null;
  readonly transition: string | null;
  readonly from: string | null;
  readonly to: string | null;
  readonly occurredAt: string;
  readonly actor: ActorView;
  readonly reason: string | null;
  readonly derived: boolean;
  readonly revisionFrom: number | null;
  readonly revisionTo: number | null;
  readonly journalEntries: LifecycleJournalEntries | null;
  readonly changedFields: readonly string[];
  readonly events: readonly string[];
}

export function actorView(actor: LifecycleActor, currentUserId: string | undefined): ActorView {
  if (actor.type === 'USER' && actor.id !== null && actor.id === currentUserId)
    return { kind: 'you', value: '' };
  if (actor.displayName) return { kind: 'named', value: actor.displayName };
  if (actor.type === 'USER') return { kind: 'user', value: (actor.id ?? '').slice(-8) };
  return { kind: 'process', value: actor.id ?? actor.type };
}

/** Una fila por transición o anotación, en orden de `sequence`, con el número de orden del diagrama. */
export function timelineRows(lifecycle: Lifecycle, currentUserId?: string): TimelineRow[] {
  const { orderBySequence } = buildDiagramModel(lifecycle);
  return bySequence(lifecycle.items).map((item) => {
    const base = {
      sequence: item.sequence,
      kind: item.kind,
      occurredAt: item.occurredAt,
      actor: actorView(item.actor, currentUserId),
      derived: item.derived,
      revisionFrom: item.revisionFrom,
      revisionTo: item.revisionTo,
      events: item.events,
    };
    return item.kind === 'TRANSITION'
      ? {
          ...base,
          order: orderBySequence.get(item.sequence) ?? null,
          transition: item.transition,
          from: item.fromState,
          to: item.toState,
          reason: item.reason,
          journalEntries: item.journalEntries,
          changedFields: [],
        }
      : {
          ...base,
          order: null,
          transition: null,
          from: null,
          to: null,
          reason: null,
          journalEntries: null,
          changedFields: item.changedFields,
        };
  });
}

// ── Layout ────────────────────────────────────────────────────────────────────────────────────────────────────────

export type Orientation = 'horizontal' | 'vertical';
type Side = 'top' | 'right' | 'bottom' | 'left';

interface Point {
  readonly x: number;
  readonly y: number;
}

interface LayoutSpec {
  readonly start: Point;
  readonly nodes: Readonly<Record<string, Point>>;
  /** Curvatura por arista (desplazamiento del punto de control sobre la normal de la cuerda; ver `quadratic`). */
  readonly bends?: Readonly<Record<string, number>>;
  /** Lado del nodo en el que se dibuja cada bucle (transición X → X). */
  readonly loops?: Readonly<Record<string, Side>>;
  /** Posición (0–1) del número y del rótulo sobre la curva cuando el punto medio choca con otro rótulo. */
  readonly labelT?: Readonly<Record<string, number>>;
}

export const NODE_W = 112;
export const NODE_H = 44;
export const START_R = 7;
const PAIR_BEND = -24;
const LABEL_GAP = 22;
const FONT_W = 6.6;

/**
 * Layouts fijos por máquina. `Transaction`: flujo principal en columnas (pendiente → contabilizada → confirmada →
 * reconciliada) con anulada a la derecha; las creaciones salen del punto de entrada por arriba (izquierda en vertical)
 * y las anulaciones llegan por abajo (derecha en vertical), anidadas para no cruzarse. `Account`: activa, cerrada,
 * archivada. Normal de la cuerda A→B = (−dy, dx): en una arista →, curvatura positiva = hacia abajo; en una ↓, hacia
 * la izquierda.
 */
const LAYOUTS: Readonly<Record<string, Readonly<Record<Orientation, LayoutSpec>>>> = {
  Transaction: {
    horizontal: {
      start: { x: 20, y: 150 },
      nodes: {
        PENDING: { x: 130, y: 150 },
        POSTED: { x: 330, y: 150 },
        CLEARED: { x: 530, y: 150 },
        RECONCILED: { x: 730, y: 150 },
        VOIDED: { x: 930, y: 150 },
      },
      bends: {
        [edgeId('RECORD', null, 'POSTED')]: -80,
        [edgeId('RECORD', null, 'CLEARED')]: -190,
        [edgeId('REVISE', 'CLEARED', 'POSTED')]: 64,
        [edgeId('VOID', 'CLEARED', 'VOIDED')]: 96,
        [edgeId('VOID', 'POSTED', 'VOIDED')]: 150,
        [edgeId('VOID', 'PENDING', 'VOIDED')]: 204,
      },
      loops: { [edgeId('REVISE', 'POSTED', 'POSTED')]: 'top' },
    },
    vertical: {
      start: { x: 170, y: 20 },
      nodes: {
        PENDING: { x: 170, y: 100 },
        POSTED: { x: 170, y: 220 },
        CLEARED: { x: 170, y: 340 },
        RECONCILED: { x: 170, y: 460 },
        VOIDED: { x: 170, y: 580 },
      },
      bends: {
        [edgeId('RECORD', null, 'POSTED')]: 180,
        [edgeId('RECORD', null, 'CLEARED')]: 280,
        [edgeId('REVISE', 'CLEARED', 'POSTED')]: -112,
        [edgeId('VOID', 'CLEARED', 'VOIDED')]: -160,
        [edgeId('VOID', 'POSTED', 'VOIDED')]: -215,
        [edgeId('VOID', 'PENDING', 'VOIDED')]: -270,
      },
      loops: { [edgeId('REVISE', 'POSTED', 'POSTED')]: 'left' },
      labelT: { [edgeId('REVISE', 'CLEARED', 'POSTED')]: 0.22 },
    },
  },
  Account: {
    horizontal: {
      start: { x: 20, y: 150 },
      nodes: {
        ACTIVE: { x: 130, y: 150 },
        CLOSED: { x: 330, y: 150 },
        ARCHIVED: { x: 530, y: 150 },
      },
      bends: {
        [edgeId('ARCHIVE', 'ACTIVE', 'ARCHIVED')]: -120,
        [edgeId('REACTIVATE', 'ARCHIVED', 'ACTIVE')]: -120,
      },
    },
    vertical: {
      start: { x: 170, y: 20 },
      nodes: {
        ACTIVE: { x: 170, y: 100 },
        CLOSED: { x: 170, y: 220 },
        ARCHIVED: { x: 170, y: 340 },
      },
      bends: {
        [edgeId('ARCHIVE', 'ACTIVE', 'ARCHIVED')]: 160,
        [edgeId('REACTIVATE', 'ARCHIVED', 'ACTIVE')]: 160,
      },
    },
  },
};

/** Layout genérico (máquinas sin layout propio, p. ej. `ExchangeRate`): estados en orden de declaración. */
function genericSpec(machine: LifecycleMachine, orientation: Orientation): LayoutSpec {
  const index = new Map(machine.states.map((s, i) => [s.code, i]));
  const nodes = Object.fromEntries(
    machine.states.map((s, i) => [
      s.code,
      orientation === 'horizontal' ? { x: 130 + 200 * i, y: 150 } : { x: 170, y: 100 + 120 * i },
    ]),
  );
  const bends: Record<string, number> = {};
  for (const e of machineEdges(machine)) {
    const span = Math.abs((index.get(e.to) ?? 0) - (e.from === null ? -1 : (index.get(e.from) ?? 0)));
    if (span > 1) bends[e.id] = (orientation === 'horizontal' ? -1 : 1) * 90 * (span - 1);
  }
  return {
    start: orientation === 'horizontal' ? { x: 20, y: 150 } : { x: 170, y: 20 },
    nodes,
    bends,
  };
}

export interface LaidOutNode {
  readonly code: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface LaidOutEdge {
  readonly id: string;
  readonly transition: string;
  readonly from: string | null;
  readonly to: string;
  /** Trazo SVG (`d`). */
  readonly d: string;
  readonly loop: boolean;
  /** Punto medio del trazo (insignia con el número de orden). */
  readonly mid: Point;
  /** Rótulo de la transición, desplazado hacia afuera de la curva. */
  readonly label: Point & { readonly anchor: 'start' | 'middle' | 'end' };
}

export interface DiagramLayout {
  readonly orientation: Orientation;
  /** `[minX, minY, width, height]` ajustado al contenido. */
  readonly viewBox: readonly [number, number, number, number];
  readonly start: Point & { readonly r: number };
  readonly nodes: readonly LaidOutNode[];
  readonly edges: readonly LaidOutEdge[];
}

const r1 = (v: number) => Math.round(v * 10) / 10;
const fmt = (p: Point) => `${r1(p.x)} ${r1(p.y)}`;

/** Punto del borde del rectángulo del nodo en la dirección `toward`. */
function rectAnchor(c: Point, toward: Point): Point {
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  const t = Math.min(
    dx === 0 ? Infinity : NODE_W / 2 / Math.abs(dx),
    dy === 0 ? Infinity : NODE_H / 2 / Math.abs(dy),
  );
  return { x: c.x + dx * t, y: c.y + dy * t };
}

function circleAnchor(c: Point, toward: Point, r: number): Point {
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: c.x + (dx / len) * r, y: c.y + (dy / len) * r };
}

/** Rótulo a `LABEL_GAP` del punto medio en la dirección `dir` (unitaria). */
function labelAt(mid: Point, dir: Point): LaidOutEdge['label'] {
  const p = { x: mid.x + dir.x * LABEL_GAP, y: mid.y + dir.y * LABEL_GAP };
  if (Math.abs(dir.x) > Math.abs(dir.y)) return { x: p.x, y: p.y + 4, anchor: dir.x > 0 ? 'start' : 'end' };
  return { x: p.x, y: dir.y > 0 ? p.y + 6 : p.y + 2, anchor: 'middle' };
}

function loopEdge(
  c: Point,
  side: Side,
): { d: string; mid: Point; label: LaidOutEdge['label']; samples: Point[] } {
  const hw = NODE_W / 2;
  const hh = NODE_H / 2;
  const spread = 14;
  const reach = 50;
  const width = 34;
  const geometry: Record<Side, { p0: Point; c1: Point; c2: Point; p3: Point; out: Point }> = {
    top: {
      p0: { x: c.x - spread, y: c.y - hh },
      c1: { x: c.x - width, y: c.y - hh - reach },
      c2: { x: c.x + width, y: c.y - hh - reach },
      p3: { x: c.x + spread, y: c.y - hh },
      out: { x: 0, y: -1 },
    },
    bottom: {
      p0: { x: c.x + spread, y: c.y + hh },
      c1: { x: c.x + width, y: c.y + hh + reach },
      c2: { x: c.x - width, y: c.y + hh + reach },
      p3: { x: c.x - spread, y: c.y + hh },
      out: { x: 0, y: 1 },
    },
    left: {
      p0: { x: c.x - hw, y: c.y + spread / 2 },
      c1: { x: c.x - hw - reach, y: c.y + width },
      c2: { x: c.x - hw - reach, y: c.y - width },
      p3: { x: c.x - hw, y: c.y - spread / 2 },
      out: { x: -1, y: 0 },
    },
    right: {
      p0: { x: c.x + hw, y: c.y - spread / 2 },
      c1: { x: c.x + hw + reach, y: c.y - width },
      c2: { x: c.x + hw + reach, y: c.y + width },
      p3: { x: c.x + hw, y: c.y + spread / 2 },
      out: { x: 1, y: 0 },
    },
  };
  const { p0, c1, c2, p3, out } = geometry[side];
  const at = (t: number): Point => {
    const u = 1 - t;
    return {
      x: u ** 3 * p0.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t ** 3 * p3.x,
      y: u ** 3 * p0.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t ** 3 * p3.y,
    };
  };
  const mid = at(0.5);
  return {
    d: `M ${fmt(p0)} C ${fmt(c1)} ${fmt(c2)} ${fmt(p3)}`,
    mid,
    label: labelAt(mid, out),
    samples: Array.from({ length: 11 }, (_, i) => at(i / 10)),
  };
}

/**
 * Layout determinista del diagrama de una máquina: posiciones fijas por máquina y orientación, aristas como curvas
 * cuadráticas (o bucles cúbicos) ancladas en el borde de los nodos, y `viewBox` ajustado al contenido. `labelOf` da el
 * texto de cada transición para estimar el ancho de los rótulos (por defecto, su código).
 */
export function layoutFor(
  machine: LifecycleMachine,
  orientation: Orientation,
  labelOf: (transition: string) => string = (t) => t,
): DiagramLayout {
  const spec = LAYOUTS[machine.aggregateType]?.[orientation] ?? genericSpec(machine, orientation);
  const fallback = genericSpec(machine, orientation);
  const pos = (code: string): Point => spec.nodes[code] ?? fallback.nodes[code]!;
  const declared = machineEdges(machine);
  const ids = new Set(declared.map((e) => `${e.from ?? '∅'}>${e.to}`));
  const bounds: Point[] = [];
  const box = (p: Point, hw: number, hh: number) => {
    bounds.push({ x: p.x - hw, y: p.y - hh }, { x: p.x + hw, y: p.y + hh });
  };

  const nodes = machine.states.map((s) => {
    const p = pos(s.code);
    box(p, NODE_W / 2, NODE_H / 2);
    return { code: s.code, x: p.x, y: p.y, w: NODE_W, h: NODE_H };
  });
  box(spec.start, START_R, START_R);

  const edges = declared.map((e): LaidOutEdge => {
    const text = labelOf(e.transition);
    const addLabel = (label: LaidOutEdge['label'], mid: Point) => {
      const w = text.length * FONT_W;
      const x0 = label.anchor === 'start' ? label.x : label.anchor === 'end' ? label.x - w : label.x - w / 2;
      bounds.push({ x: x0, y: label.y - 12 }, { x: x0 + w, y: label.y + 4 });
      box(mid, 22, 10);
    };
    if (e.from !== null && e.from === e.to) {
      const side = spec.loops?.[e.id] ?? (orientation === 'horizontal' ? 'top' : 'left');
      const loop = loopEdge(pos(e.to), side);
      bounds.push(...loop.samples);
      addLabel(loop.label, loop.mid);
      return { ...e, d: loop.d, loop: true, mid: loop.mid, label: loop.label };
    }
    const a = e.from === null ? spec.start : pos(e.from);
    const b = pos(e.to);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const normal = { x: -dy / len, y: dx / len };
    const paired = e.from !== null && ids.has(`${e.to}>${e.from}`);
    const bend = spec.bends?.[e.id] ?? (paired ? PAIR_BEND : 0);
    const control = { x: (a.x + b.x) / 2 + normal.x * bend, y: (a.y + b.y) / 2 + normal.y * bend };
    const p0 = e.from === null ? circleAnchor(a, control, START_R) : rectAnchor(a, control);
    const p2 = rectAnchor(b, control);
    const at = (t: number): Point => {
      const u = 1 - t;
      return {
        x: u * u * p0.x + 2 * u * t * control.x + t * t * p2.x,
        y: u * u * p0.y + 2 * u * t * control.y + t * t * p2.y,
      };
    };
    const mid = at(spec.labelT?.[e.id] ?? 0.5);
    bounds.push(...Array.from({ length: 11 }, (_, i) => at(i / 10)));
    const outward =
      bend !== 0
        ? { x: normal.x * Math.sign(bend), y: normal.y * Math.sign(bend) }
        : Math.abs(dx) >= Math.abs(dy)
          ? { x: 0, y: -1 }
          : { x: 1, y: 0 };
    const label = labelAt(mid, outward);
    addLabel(label, mid);
    return { ...e, d: `M ${fmt(p0)} Q ${fmt(control)} ${fmt(p2)}`, loop: false, mid, label };
  });

  const pad = 8;
  const minX = Math.floor(Math.min(...bounds.map((p) => p.x)) - pad);
  const minY = Math.floor(Math.min(...bounds.map((p) => p.y)) - pad);
  const maxX = Math.ceil(Math.max(...bounds.map((p) => p.x)) + pad);
  const maxY = Math.ceil(Math.max(...bounds.map((p) => p.y)) + pad);
  return {
    orientation,
    viewBox: [minX, minY, maxX - minX, maxY - minY],
    start: { ...spec.start, r: START_R },
    nodes,
    edges,
  };
}
