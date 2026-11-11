import { useEffect, useMemo, useRef, useState } from 'react';
import { degrees } from '../core/graph';
import { positionAt, prime, type RouteStep } from '../core/route';
import type { Graph, GraphStats, Solution } from '../core/types';
import { Formulas } from './Formulas';
import { EXPLICAR, type Estimate } from './Teoria';
import type { Layers } from '../map/MapView';

const CLARO = 80;        // hasta aquí se lee bien sin acercar
const DETALLE = 4000;    // con más líneas no se colorea lo ya recorrido (sería muy pesado)

interface Props {
  graph: Graph | null;
  solution: Solution | null;
  steps: RouteStep[];
  progress: number;
  start: number;
  layers: Layers;
  onPickStart(v: number): void;
  stats: GraphStats | null;
  explain: number;
  onExplain(step: number): void;
  estimate: Estimate;
}

type Pt = { x: number; y: number };
type Box = { x: number; y: number; w: number; h: number };
const PAD = 70;

/** Vista "como en el tablero": vértices v1..vn, aristas e1..em, sin el mapa. */
export function TableroView({ graph, solution, steps, progress, start, layers, onPickStart, stats, explain, onExplain, estimate }: Props) {
  const tokensRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [svgW, setSvgW] = useState(900);
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSvgW(e.contentRect.width || 900));
    ro.observe(el);
    return () => ro.disconnect();
  });

  const layout = useMemo(() => {
    if (!graph || graph.vertices.length === 0) return null;
    // el lienzo crece con el número de vértices para que haya espacio; luego se acerca con zoom
    const W = Math.max(1000, Math.sqrt(graph.vertices.length) * 130);
    const H = W * 0.7;
    const lat0 = graph.vertices.reduce((s, v) => s + v.lat, 0) / graph.vertices.length;
    const k = Math.cos((lat0 * Math.PI) / 180);
    const raw = graph.vertices.map((v) => ({ x: v.lon * k, y: -v.lat }));
    let [x0, x1, y0, y1] = [Infinity, -Infinity, Infinity, -Infinity];
    for (const p of raw) {
      x0 = Math.min(x0, p.x);
      x1 = Math.max(x1, p.x);
      y0 = Math.min(y0, p.y);
      y1 = Math.max(y1, p.y);
    }
    const scale = Math.min((W - 2 * PAD) / (x1 - x0 || 1), (H - 2 * PAD) / (y1 - y0 || 1));
    const ox = (W - (x1 - x0) * scale) / 2;
    const oy = (H - (y1 - y0) * scale) / 2;
    const pts: Pt[] = raw.map((p) => ({ x: ox + (p.x - x0) * scale, y: oy + (p.y - y0) * scale }));
    if (pts.length <= 300) spread(pts, W, H);

    // cada línea dibujada es una arista original o una copia (e', e''...)
    const copies = new Array(graph.edges.length).fill(0);
    solution?.duplicated.forEach((e) => copies[e]++);
    const groups = new Map<string, { edge: number; copy: number }[]>();
    graph.edges.forEach((e, i) => {
      const key = e.u < e.v ? `${e.u},${e.v}` : `${e.v},${e.u}`;
      if (!groups.has(key)) groups.set(key, []);
      for (let c = 0; c <= copies[i]; c++) groups.get(key)!.push({ edge: i, copy: c });
    });
    const lines: { edge: number; copy: number; d: string; label: Pt; curve: (t: number) => Pt }[] = [];
    for (const list of groups.values()) {
      list.forEach(({ edge, copy }, j) => {
        const e = graph.edges[edge];
        const P = pts[e.u];
        const Q = pts[e.v];
        if (e.u === e.v) {
          const s = 45 + 22 * j;
          const c1 = { x: P.x - s, y: P.y - s * 1.6 };
          const c2 = { x: P.x + s, y: P.y - s * 1.6 };
          const curve = (t: number) => cubic(P, c1, c2, P, t);
          lines.push({ edge, copy, d: `M${P.x},${P.y} C${c1.x},${c1.y} ${c2.x},${c2.y} ${P.x},${P.y}`, label: curve(0.5), curve });
          return;
        }
        const off = (j - (list.length - 1) / 2) * 34;
        // normal fija según el par ordenado, para que las curvas no se crucen
        const [A, B] = e.u < e.v ? [P, Q] : [Q, P];
        const len = Math.hypot(B.x - A.x, B.y - A.y) || 1;
        const n = { x: -(B.y - A.y) / len, y: (B.x - A.x) / len };
        const ctrl = { x: (P.x + Q.x) / 2 + n.x * off * 2, y: (P.y + Q.y) / 2 + n.y * off * 2 };
        const curve = (t: number) => quad(P, ctrl, Q, t);
        lines.push({ edge, copy, d: `M${P.x},${P.y} Q${ctrl.x},${ctrl.y} ${Q.x},${Q.y}`, label: curve(0.5), curve });
      });
    }
    return { pts, lines, W, H };
  }, [graph, solution]);

  // --- zoom con la rueda o pellizcando, y arrastrar para moverse ---
  const [box, setBox] = useState<Box | null>(null);
  const full: Box | null = layout ? { x: 0, y: 0, w: layout.W, h: layout.H } : null;
  const vb = box ?? full;
  useEffect(() => setBox(null), [layout]);

  const toSvg = (cx: number, cy: number): Pt => {
    const svg = svgRef.current!;
    const m = svg.getScreenCTM()!.inverse();
    const p = new DOMPoint(cx, cy).matrixTransform(m);
    return { x: p.x, y: p.y };
  };
  const zoomAt = (f: number, at: Pt) =>
    setBox((b) => {
      const cur = b ?? full!;
      const w = Math.min(full!.w * 2, Math.max(full!.w / 200, cur.w * f));
      const r = w / cur.w;
      return { x: at.x - (at.x - cur.x) * r, y: at.y - (at.y - cur.y) * r, w, h: cur.h * r };
    });

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomAt(Math.exp(e.deltaY * 0.0015), toSvg(e.clientX, e.clientY));
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  });

  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const moved = useRef(0);
  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moved.current = 0;
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const ps = pointers.current;
    const prev = ps.get(e.pointerId);
    if (!prev || !vb) return;
    if (ps.size === 1) {
      const a = toSvg(prev.x, prev.y);
      const b = toSvg(e.clientX, e.clientY);
      moved.current += Math.hypot(e.clientX - prev.x, e.clientY - prev.y);
      setBox({ ...vb, x: vb.x - (b.x - a.x), y: vb.y - (b.y - a.y) });
    } else if (ps.size === 2) {
      // pellizco: la distancia entre los dos dedos cambia el zoom
      const other = [...ps.entries()].find(([id]) => id !== e.pointerId)![1];
      const d0 = Math.hypot(prev.x - other.x, prev.y - other.y);
      const d1 = Math.hypot(e.clientX - other.x, e.clientY - other.y);
      if (d0 > 0 && d1 > 0) zoomAt(d0 / d1, toSvg((e.clientX + other.x) / 2, (e.clientY + other.y) / 2));
      moved.current += 10;
    }
    ps.set(e.pointerId, { x: e.clientX, y: e.clientY });
  };
  const onPointerUp = (e: React.PointerEvent) => pointers.current.delete(e.pointerId);

  const deg = useMemo(() => (graph ? degrees(graph) : []), [graph]);
  // todas las aristas en un solo trazo, para el minimapa
  const overview = useMemo(() => (layout ? layout.lines.filter((l) => l.copy === 0).map((l) => l.d).join(' ') : ''), [layout]);
  const labels = useMemo(() => (layout && graph && graph.vertices.length <= CLARO ? placeLabels(layout, graph, sizeK(graph.vertices.length)) : null), [layout, graph]);
  const doneIndex = useMemo(() => {
    const m = new Map<string, number>();
    steps.forEach((s, i) => m.set(`${s.edge}:${s.copy}`, i));
    return m;
  }, [steps]);

  const pos = steps.length ? positionAt(steps, progress) : null;
  const cur = pos ? steps[pos.i] : null;

  useEffect(() => {
    tokensRef.current?.querySelector('.tok.now')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [pos?.i]);

  if (!graph || !layout || !vb) return <div className="tablero vacio">Genera un grafo o carga un ejemplo para verlo como en el tablero.</div>;

  const nV = graph.vertices.length;
  // nombres solo cuando hay pocos a la vista: al acercar aparecen (nivel de detalle)
  const inView = (q: Pt) => q.x >= vb.x && q.x <= vb.x + vb.w && q.y >= vb.y && q.y <= vb.y + vb.h;
  let visibles = 0;
  for (const q of layout.pts) if (inView(q)) visibles++;
  const vLabels = visibles <= 160;
  const eLabels = visibles <= 120;
  const zoomed = vb.w < layout.W * 0.95;
  // tamaño de letra y puntos: en grafos pequeños fijo; en grandes, que se vean igual en pantalla al acercar
  const unitsPerPx = vb.w / svgW;
  const k = nV <= CLARO ? sizeK(nV) : Math.min(1.2, Math.max(0.15, (15 * unitsPerPx) / 28));
  const kr = nV <= CLARO ? 1 : Math.min(1, Math.max(0.2, (7 * unitsPerPx) / 11));
  const detail = layout.lines.length <= DETALLE;
  const isOdd = (i: number) => deg[i] % 2 === 1;
  const weight = (w: number) => (Number.isInteger(w) && w < 1000 ? `${w}` : `${Math.round(w)} m`);

  // marcador sobre la curva del paso actual
  let dot: Pt | null = null;
  if (pos && cur && layers.ruta) {
    const l = layout.lines.find((x) => x.edge === cur.edge && x.copy === cur.copy);
    const e = graph.edges[cur.edge];
    const f = cur.length ? pos.offset / cur.length : 0;
    if (l) dot = l.curve(cur.from === e.u ? f : 1 - f);
  }

  // en recorridos muy largos la notación muestra solo una ventana alrededor del paso actual
  const WIN = 150;
  const i0 = steps.length > 2 * WIN && pos ? Math.max(0, pos.i - WIN) : 0;
  const i1 = steps.length > 2 * WIN && pos ? Math.min(steps.length, pos.i + WIN) : steps.length;
  const closed = steps.length > 0 && steps[0].from === steps[steps.length - 1].to;

  return (
    <div className="tablero">
      {nV > CLARO && (
        <div className="tablero-aviso">
          Grafo grande ({nV.toLocaleString('es-CO')} vértices): será difícil de leer. Acerca con la rueda del mouse o pellizcando, y arrastra para moverte.
          {!vLabels && ' Los nombres aparecen al acercar.'} El recuadro de la esquina muestra en qué zona estás.
        </div>
      )}
      <div className="tablero-zoom">
        <button onClick={() => zoomAt(0.6, { x: vb.x + vb.w / 2, y: vb.y + vb.h / 2 })} title="Acercar">
          +
        </button>
        <button onClick={() => zoomAt(1 / 0.6, { x: vb.x + vb.w / 2, y: vb.y + vb.h / 2 })} title="Alejar">
          −
        </button>
        <button onClick={() => setBox(null)} title="Ver todo">
          ⤢
        </button>
      </div>
      <div className="tablero-cuerpo">
      <svg
        ref={svgRef}
        viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
        className="tablero-svg"
        style={{ '--k': k } as React.CSSProperties}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {layout.lines.map((l) => {
          const e = graph.edges[l.edge];
          const idx = detail ? doneIndex.get(`${l.edge}:${l.copy}`) : undefined;
          const done = layers.ruta && idx !== undefined && pos !== null && idx < pos.i;
          const now = layers.ruta && cur !== null && cur.edge === l.edge && cur.copy === l.copy;
          const dup = l.copy > 0;
          if (dup && !layers.duplicadas && !layers.ruta) return null;
          const cls = ['arista', dup ? 'dup' : '', e.extra ? 'extra' : '', done ? (dup ? 'hecha-dup' : 'hecha') : '', now ? 'ahora' : ''].join(' ');
          return (
            <g key={`${l.edge}:${l.copy}`} className={cls}>
              <path d={l.d} />
              {labels
                ? (() => {
                    // grafo chico: una sola etiqueta "e1 · 1023 m" al costado de la línea, sin chocar
                    const at = labels.edges.get(`${l.edge}:${l.copy}`);
                    if (!at) return null;
                    return (
                      <text x={at.x} y={at.y} className="e-label centrada">
                        {e.id}
                        {prime(l.copy)}
                        {layers.grafo && !dup && nV <= 20 && <tspan className="w-label"> · {weight(e.length)}</tspan>}
                      </text>
                    );
                  })()
                : eLabels &&
                  inView(l.label) && (
                    <text x={l.label.x} y={l.label.y - 8} className="e-label">
                      {e.id}
                      {prime(l.copy)}
                    </text>
                  )}
            </g>
          );
        })}
        {layers.parejas &&
          solution?.pairs.map((p, i) => (
            <line key={i} x1={layout.pts[p.a].x} y1={layout.pts[p.a].y} x2={layout.pts[p.b].x} y2={layout.pts[p.b].y} className="pareja" />
          ))}
        {graph.vertices.map((v, i) => {
          const p = layout.pts[i];
          const odd = layers.impares && isOdd(i);
          return (
            <g key={v.id} className={`vertice ${odd ? 'impar' : ''} ${i === start ? 'inicio' : ''}`} onClick={() => moved.current < 5 && onPickStart(i)}>
              {labels ? (
                <>
                  {/* grafo chico: el grado va dentro del círculo y el nombre en el lado libre */}
                  <circle cx={p.x} cy={p.y} r={(i === start ? 20 : 17) * k} />
                  {layers.impares && (
                    <text x={p.x} y={p.y} className="deg-in" style={{ fontSize: 17 * k }}>
                      {deg[i]}
                    </text>
                  )}
                  <text x={labels.vertices[i].x} y={labels.vertices[i].y} className="v-label centrada">
                    {v.id}
                  </text>
                </>
              ) : (
                <>
                  <circle cx={p.x} cy={p.y} r={(i === start ? 15 : 11) * kr} />
                  {vLabels && inView(p) && (
                    <text x={p.x + 16} y={p.y - 16} className="v-label">
                      {v.id}
                    </text>
                  )}
                  {vLabels && inView(p) && layers.impares && isOdd(i) && (
                    <text x={p.x + 16} y={p.y + 30} className="deg-label">
                      deg {deg[i]}
                    </text>
                  )}
                </>
              )}
            </g>
          );
        })}
        {dot && <circle cx={dot.x} cy={dot.y} r={10 * kr} className="cartero-dot" />}
      </svg>
      {zoomed && (
        <svg
          className="minimapa"
          viewBox={`0 0 ${layout.W} ${layout.H}`}
          onClick={(e) => {
            // tocar el minimapa centra la vista en ese punto
            const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
            const x = ((e.clientX - r.left) / r.width) * layout.W;
            const y = ((e.clientY - r.top) / r.height) * layout.H;
            setBox({ ...vb, x: x - vb.w / 2, y: y - vb.h / 2 });
          }}
        >
          <path d={overview} />
          <rect x={vb.x} y={vb.y} width={vb.w} height={vb.h} />
        </svg>
      )}
      <aside className="pasos">
        {!solution || !stats ? (
          <p className="ayuda">Calcula la ruta para ver aquí, paso a paso, cómo se obtiene con las fórmulas.</p>
        ) : solution.kind === 'ab' ? (
          <Formulas graph={graph} stats={stats} solution={solution} step={1} estimate={estimate} />
        ) : explain === 0 ? (
          <button className="primario" onClick={() => onExplain(1)}>
            Ver cómo se calculó, paso a paso
          </button>
        ) : (
          <>
            <Formulas graph={graph} stats={stats} solution={solution} step={explain} estimate={estimate} />
            <div className="fila pasos-nav">
              <button onClick={() => onExplain(Math.max(1, explain - 1))} disabled={explain <= 1}>
                ◀ Anterior
              </button>
              <button onClick={() => onExplain(explain < EXPLICAR.length ? explain + 1 : 1)}>{explain < EXPLICAR.length ? 'Siguiente ▶' : 'Volver a empezar'}</button>
              <button onClick={() => onExplain(0)}>Salir</button>
            </div>
          </>
        )}
      </aside>
      </div>

      {solution && steps.length > 0 && (
        <div className="notacion" ref={tokensRef}>
          <span className="tok-titulo">{closed ? 'Camino cerrado:' : 'Recorrido:'}</span>
          {i0 > 0 && <span className="tok-titulo"> … ({i0.toLocaleString('es-CO')} pasos antes)</span>}
          <span className="tok v">{graph.vertices[steps[i0].from].id}</span>
          {steps.slice(i0, i1).map((s, k) => {
            const i = i0 + k;
            return (
              <span key={i} className="tok-par">
                <span className={`tok e ${s.repeat ? 'rep' : ''} ${pos && i === pos.i ? 'now' : ''} ${pos && i < pos.i ? 'pas' : ''}`}>
                  {graph.edges[s.edge].id}
                  {prime(s.copy)}
                </span>{' '}
                <span className="tok v">{graph.vertices[s.to].id}</span>
              </span>
            );
          })}
          {i1 < steps.length && <span className="tok-titulo"> … ({(steps.length - i1).toLocaleString('es-CO')} pasos más)</span>}
        </div>
      )}
    </div>
  );
}

const sizeK = (nV: number) => (nV <= 12 ? 1 : nV <= 30 ? 0.8 : 0.6);

type LBox = { x: number; y: number; w: number; h: number };
const hits = (a: LBox, b: LBox) => Math.abs(a.x - b.x) * 2 < a.w + b.w && Math.abs(a.y - b.y) * 2 < a.h + b.h;

/**
 * Dónde poner cada nombre para que no se monte sobre líneas, círculos ni otros nombres.
 * Para cada etiqueta se prueban varias posiciones y se queda la que menos choca
 * (los vértices prefieren el lado por donde no sale ninguna calle).
 */
function placeLabels(layout: { pts: Pt[]; lines: { edge: number; copy: number; curve: (t: number) => Pt }[] }, g: Graph, k: number) {
  const taken: LBox[] = [];
  const R = 18 * k;
  layout.pts.forEach((p) => taken.push({ x: p.x, y: p.y, w: 2 * R + 4, h: 2 * R + 4 }));
  // las líneas se marcan como ocupadas con cuadritos a lo largo
  for (const l of layout.lines) {
    for (let t = 0.04; t < 0.97; t += 0.04) {
      const q = l.curve(t);
      taken.push({ x: q.x, y: q.y, w: 8, h: 8 });
    }
  }
  const cost = (b: LBox) => {
    let c = 0;
    for (const t of taken) if (hits(b, t)) c += t.w > 10 ? 3 : 1;
    return c;
  };

  // nombres de vértices
  const vfs = 28 * k;
  const vertices: Pt[] = layout.pts.map((p, i) => {
    const text = g.vertices[i].id;
    const w = text.length * vfs * 0.6;
    const h = vfs;
    const dirs = g.edges
      .filter((e) => e.u === i || e.v === i)
      .map((e) => {
        const q = layout.pts[e.u === i ? e.v : e.u];
        return Math.atan2(q.y - p.y, q.x - p.x);
      });
    let best: { b: LBox; score: number } | null = null;
    for (let a = 0; a < 16; a++) {
      const ang = (a / 16) * 2 * Math.PI - Math.PI / 4;
      const dist = R + 8 + Math.abs(Math.cos(ang)) * (w / 2) + Math.abs(Math.sin(ang)) * (h / 2);
      const b = { x: p.x + Math.cos(ang) * dist, y: p.y + Math.sin(ang) * dist, w, h };
      // qué tan lejos queda de las calles que salen del vértice (más lejos, mejor)
      const gap = dirs.length ? Math.min(...dirs.map((d) => Math.abs(((ang - d + 3 * Math.PI) % (2 * Math.PI)) - Math.PI))) : Math.PI;
      const score = cost(b) * 10 - gap;
      if (!best || score < best.score) best = { b, score };
    }
    taken.push(best!.b);
    return { x: best!.b.x, y: best!.b.y };
  });

  // etiquetas de aristas
  const efs = 24 * k;
  const showW = g.vertices.length <= 20;
  const edges = new Map<string, Pt>();
  for (const l of layout.lines) {
    const e = g.edges[l.edge];
    const text = `${e.id}${"'".repeat(l.copy)}${showW && l.copy === 0 ? ` · ${Math.round(e.length)} m` : ''}`;
    const w = text.length * efs * 0.52;
    const h = efs;
    let best: { b: LBox; score: number } | null = null;
    for (const t of [0.5, 0.38, 0.62, 0.28, 0.72]) {
      const q = l.curve(t);
      const a = l.curve(Math.max(0, t - 0.02));
      const c = l.curve(Math.min(1, t + 0.02));
      const len = Math.hypot(c.x - a.x, c.y - a.y) || 1;
      const n = { x: -(c.y - a.y) / len, y: (c.x - a.x) / len };
      for (const side of [1, -1]) {
        const off = 6 + Math.abs(n.x) * (w / 2) + Math.abs(n.y) * (h / 2);
        const b = { x: q.x + n.x * off * side, y: q.y + n.y * off * side, w, h };
        const score = cost(b) * 10 + Math.abs(t - 0.5) * 4;
        if (!best || score < best.score) best = { b, score };
      }
    }
    taken.push(best!.b);
    edges.set(`${l.edge}:${l.copy}`, { x: best!.b.x, y: best!.b.y });
  }
  return { vertices, edges };
}

/**
 * Separa los vértices que quedan casi encima (pasa en avenidas de doble calzada):
 * se empujan los pares más cercanos que MIN y cada uno vuelve un poco a su sitio.
 */
function spread(pts: Pt[], W: number, H: number) {
  const MIN = pts.length <= 30 ? 110 : 70;
  const home = pts.map((p) => ({ ...p }));
  for (let it = 0; it < 300; it++) {
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        let dx = pts[j].x - pts[i].x;
        let dy = pts[j].y - pts[i].y;
        let d = Math.hypot(dx, dy);
        if (d >= MIN) continue;
        if (d < 1e-6) [dx, dy, d] = [1, 0, 1];
        const push = ((MIN - d) / d) * 0.25;
        pts[i].x -= dx * push;
        pts[i].y -= dy * push;
        pts[j].x += dx * push;
        pts[j].y += dy * push;
      }
    }
    for (let i = 0; i < pts.length; i++) {
      pts[i].x += (home[i].x - pts[i].x) * 0.02;
      pts[i].y += (home[i].y - pts[i].y) * 0.02;
      pts[i].x = Math.min(W - PAD / 2, Math.max(PAD / 2, pts[i].x));
      pts[i].y = Math.min(H - PAD / 2, Math.max(PAD / 2, pts[i].y));
    }
  }
}

function quad(a: Pt, c: Pt, b: Pt, t: number): Pt {
  const u = 1 - t;
  return { x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, y: u * u * a.y + 2 * u * t * c.y + t * t * b.y };
}

function cubic(a: Pt, c1: Pt, c2: Pt, b: Pt, t: number): Pt {
  const u = 1 - t;
  return {
    x: u ** 3 * a.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t ** 3 * b.x,
    y: u ** 3 * a.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t ** 3 * b.y,
  };
}
