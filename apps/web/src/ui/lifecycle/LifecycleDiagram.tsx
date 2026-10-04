import type { DiagramModel, DiagramLayout } from './logic';
import { NODE_H } from './logic';

const ON = '#0969da';
const ON_DARK = '#0a3069';
const OFF = '#8c959f';
const OFF_TEXT = '#57606a';

/**
 * Diagrama SVG de la máquina de estados (estático y determinista, sin librería de gráficos): estados visitados y
 * transiciones recorridas destacados (trazo continuo, numeradas por orden), estado actual con énfasis (relleno y
 * "(actual)") y lo no recorrido atenuado (trazo discontinuo). El color nunca es la única señal. `role="img"` con nombre
 * y `aria-describedby` a la línea de tiempo, que es la alternativa accesible.
 */
export function LifecycleDiagram({
  model,
  layout,
  idPrefix,
  label,
  describedBy,
  stateLabel,
  transitionLabel,
  currentLabel,
  className,
}: {
  model: DiagramModel;
  layout: DiagramLayout;
  idPrefix: string;
  label: string;
  describedBy: string;
  stateLabel: (code: string) => string;
  transitionLabel: (code: string) => string;
  currentLabel: string;
  className: string;
}) {
  const [minX, minY, width, height] = layout.viewBox;
  const marker = (on: boolean) => `${idPrefix}-${layout.orientation}-arrow-${on ? 'on' : 'off'}`;
  const nodeOf = new Map(model.nodes.map((n) => [n.code, n]));
  const edgeOf = new Map(model.edges.map((e) => [e.id, e]));
  const edges = layout.edges.map((e) => ({ geo: e, state: edgeOf.get(e.id)! }));
  // Lo recorrido se dibuja encima de lo atenuado.
  const ordered = [...edges.filter((e) => !e.state.traversed), ...edges.filter((e) => e.state.traversed)];

  return (
    <svg
      role="img"
      aria-label={label}
      aria-describedby={describedBy}
      viewBox={`${minX} ${minY} ${width} ${height}`}
      data-testid="lifecycle-diagram"
      data-orientation={layout.orientation}
      className={className}
      width="100%"
      style={{ maxWidth: `${width}px`, height: 'auto', fontFamily: 'inherit' }}
    >
      <defs>
        {[true, false].map((on) => (
          <marker
            key={String(on)}
            id={marker(on)}
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill={on ? ON : OFF} />
          </marker>
        ))}
      </defs>
      <circle cx={layout.start.x} cy={layout.start.y} r={layout.start.r} fill="#24292f" />
      {ordered.map(({ geo, state }) => (
        <g
          key={geo.id}
          data-testid="lifecycle-edge"
          data-code={state.transition}
          data-from={state.from ?? ''}
          data-to={state.to}
          data-traversed={String(state.traversed)}
          data-order={state.order.join(',')}
        >
          <path
            d={geo.d}
            fill="none"
            stroke={state.traversed ? ON : OFF}
            strokeWidth={state.traversed ? 2.25 : 1.25}
            strokeDasharray={state.traversed ? undefined : '5 4'}
            opacity={state.traversed ? 1 : 0.7}
            markerEnd={`url(#${marker(state.traversed)})`}
          />
          <text
            x={geo.label.x}
            y={geo.label.y}
            textAnchor={geo.label.anchor}
            fontSize="12"
            fontWeight={state.traversed ? 600 : 400}
            fill={state.traversed ? ON_DARK : OFF_TEXT}
          >
            {transitionLabel(state.transition)}
          </text>
          {state.order.length > 0 ? (
            <g data-testid="lifecycle-edge-order">
              <rect
                x={geo.mid.x - (8 + 3.5 * state.order.join(', ').length)}
                y={geo.mid.y - 9}
                width={16 + 7 * state.order.join(', ').length}
                height={18}
                rx={9}
                fill={ON}
                stroke="#ffffff"
                strokeWidth={1.5}
              />
              <text
                x={geo.mid.x}
                y={geo.mid.y + 4}
                textAnchor="middle"
                fontSize="11"
                fontWeight={700}
                fill="#ffffff"
              >
                {state.order.join(', ')}
              </text>
            </g>
          ) : null}
        </g>
      ))}
      {layout.nodes.map((n) => {
        const state = nodeOf.get(n.code)!;
        const x = n.x - n.w / 2;
        const y = n.y - n.h / 2;
        const fill = state.current ? ON : state.visited ? '#ddf4ff' : '#f6f8fa';
        const text = state.current ? '#ffffff' : state.visited ? ON_DARK : OFF_TEXT;
        return (
          <g
            key={n.code}
            data-testid="lifecycle-node"
            data-code={n.code}
            data-visited={String(state.visited)}
            data-current={String(state.current)}
            data-terminal={String(state.terminal)}
          >
            <rect
              x={x}
              y={y}
              width={n.w}
              height={n.h}
              rx={10}
              fill={fill}
              stroke={state.current ? ON_DARK : state.visited ? ON : OFF}
              strokeWidth={state.current ? 3 : state.visited ? 1.75 : 1.25}
              strokeDasharray={state.visited ? undefined : '5 4'}
            />
            {state.terminal ? (
              <rect
                x={x + 4}
                y={y + 4}
                width={n.w - 8}
                height={n.h - 8}
                rx={7}
                fill="none"
                stroke={state.current ? '#ffffff' : state.visited ? ON : OFF}
                strokeWidth={1}
              />
            ) : null}
            <text
              x={n.x}
              y={state.current ? n.y - 1 : n.y + 4.5}
              textAnchor="middle"
              fontSize="13"
              fontWeight={state.visited ? 600 : 400}
              fill={text}
            >
              {stateLabel(n.code)}
            </text>
            {state.current ? (
              <text x={n.x} y={n.y + NODE_H / 2 - 7} textAnchor="middle" fontSize="10" fill="#ffffff">
                {currentLabel}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}
