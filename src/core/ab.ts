import { dijkstra, pathTo } from './dijkstra';
import { haversine } from './geo';
import { dijkstraTurns, type TurnIndex } from './turns';
import type { Adjacency, Graph, LatLon, Solution, Step } from './types';

/** Vértice más cercano a un punto (solo entre los permitidos, si se dan). */
export function nearestVertex(g: Graph, p: LatLon, allowed?: Uint8Array): { v: number; dist: number } {
  let best = -1;
  let bestD = Infinity;
  const k = Math.cos((p[0] * Math.PI) / 180);
  g.vertices.forEach((v, i) => {
    if (allowed && !allowed[i]) return;
    const d = (v.lat - p[0]) ** 2 + ((v.lon - p[1]) * k) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return { v: best, dist: best < 0 ? Infinity : haversine(p, [g.vertices[best].lat, g.vertices[best].lon]) };
}

export interface RouteOptions {
  roundTrip?: boolean;   // ida y vuelta: A → B → A
  vehicle?: boolean;     // carro o moto: respeta los sentidos únicos (adj debe ser dirigida)
  allowed?: Uint8Array;  // vértices donde se puede empezar o terminar
  turns?: TurnIndex;     // giros prohibidos (solo en carro o moto)
}

type Leg = { edge: number; from: number; to: number }[];

/** Camino más corto entre dos vértices (Dijkstra, o por aristas si hay giros prohibidos). */
export function shortestLeg(g: Graph, adj: Adjacency, s: number, e: number, opts: RouteOptions): { leg: Leg; dist: number; explored: number } | null {
  let path: number[];
  let explored = 0;
  let dist: number;
  if (opts.turns) {
    const r = dijkstraTurns(g, adj, s, e, opts.turns);
    if (!r) return null;
    ({ path, dist, explored } = r);
  } else {
    const target = new Uint8Array(g.vertices.length);
    target[e] = 1;
    const r = dijkstra(g, adj, s, target, 1);
    if (!Number.isFinite(r.dist[e])) return null;
    for (const d of r.dist) if (Number.isFinite(d)) explored++;
    path = pathTo(g, r, s, e);
    dist = r.dist[e];
  }
  let x = s;
  const leg = path.map((edge) => {
    const { u, v } = g.edges[edge];
    const step = { edge, from: x, to: x === u ? v : u };
    x = step.to;
    return step;
  });
  return { leg, dist, explored };
}

/**
 * Orden de visita de las paradas intermedias que hace más corto el recorrido
 * (problema del viajante, TSP). La primera parada queda fija; la última también si
 * `fixedEnd` (es el destino), salvo en ida y vuelta, donde se vuelve a la primera. Con pocas paradas se
 * prueban todos los órdenes; con muchas, vecino más cercano y mejora 2-opt.
 */
export function bestOrder(n: number, d: (i: number, j: number) => number, roundTrip: boolean, fixedEnd = !roundTrip): number[] {
  if (roundTrip) fixedEnd = false;
  const mids = Array.from({ length: n }, (_, i) => i).slice(1, fixedEnd ? n - 1 : n);
  const cost = (order: number[]) => {
    let c = 0;
    for (let i = 1; i < order.length; i++) c += d(order[i - 1], order[i]);
    return roundTrip ? c + d(order[order.length - 1], order[0]) : c;
  };
  const build = (m: number[]) => [0, ...m, ...(fixedEnd ? [n - 1] : [])];
  if (mids.length <= 8) {
    let best = build(mids);
    let bestC = cost(best);
    const permute = (arr: number[], k: number) => {
      if (k === arr.length) {
        const o = build(arr);
        const c = cost(o);
        if (c < bestC) [best, bestC] = [o, c];
        return;
      }
      for (let i = k; i < arr.length; i++) {
        [arr[k], arr[i]] = [arr[i], arr[k]];
        permute(arr, k + 1);
        [arr[k], arr[i]] = [arr[i], arr[k]];
      }
    };
    permute([...mids], 0);
    return best;
  }
  // vecino más cercano
  const left = new Set(mids);
  const m: number[] = [];
  let cur = 0;
  while (left.size) {
    let next = -1;
    for (const j of left) if (next < 0 || d(cur, j) < d(cur, next)) next = j;
    m.push(next);
    left.delete(next);
    cur = next;
  }
  // 2-opt: invertir tramos mientras mejore
  let order = build(m);
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 1; i < order.length - 2; i++) {
      for (let j = i + 1; j < order.length - (fixedEnd ? 1 : 0); j++) {
        const cand = [...order.slice(0, i), ...order.slice(i, j + 1).reverse(), ...order.slice(j + 1)];
        if (cost(cand) < cost(order) - 1e-9) {
          order = cand;
          improved = true;
        }
      }
    }
  }
  return order;
}

/**
 * Recorrido por varias paradas: camino más corto entre cada par seguido (y de
 * vuelta a la primera si es ida y vuelta). Con `optimize` primero se busca el
 * mejor orden de las paradas intermedias.
 */
export function routeStops(g: Graph, adj: Adjacency, points: LatLon[], opts: RouteOptions & { optimize?: boolean; fixEnd?: boolean } = {}): { graph: Graph; solution: Solution } {
  if (points.length < 2) throw new Error('Hacen falta al menos dos puntos');
  const snapped = points.map((p) => nearestVertex(g, p, opts.allowed));
  if (snapped.some((x) => x.v < 0)) throw new Error('No hay calles cerca de esos puntos');
  const noPath = opts.vehicle ? 'No hay camino respetando sentidos y giros prohibidos (prueba a pie o mueve el punto)' : 'No hay camino por calles entre esos puntos';

  const t = performance.now();
  let explored = 0;
  let order = points.map((_, i) => i);
  const cache = new Map<string, ReturnType<typeof shortestLeg>>();
  const leg = (i: number, j: number) => {
    const key = `${i},${j}`;
    if (!cache.has(key)) {
      const r = snapped[i].v === snapped[j].v ? { leg: [], dist: 0, explored: 0 } : shortestLeg(g, adj, snapped[i].v, snapped[j].v, opts);
      if (r) explored += r.explored;
      cache.set(key, r);
    }
    return cache.get(key)!;
  };
  const fixEnd = opts.fixEnd ?? true;
  if (opts.optimize && points.length >= (opts.roundTrip || !fixEnd ? 3 : 4)) {
    order = bestOrder(points.length, (i, j) => leg(i, j)?.dist ?? Infinity, !!opts.roundTrip, fixEnd);
  }
  const pairs: [number, number][] = [];
  for (let k = 1; k < order.length; k++) pairs.push([order[k - 1], order[k]]);
  if (opts.roundTrip) pairs.push([order[order.length - 1], order[0]]);
  const legs = pairs.map(([i, j]) => {
    const r = leg(i, j);
    if (!r) throw new Error(noPath);
    return r.leg;
  });
  if (legs.every((l) => l.length === 0)) throw new Error('Todos los puntos quedan en la misma esquina');
  const ms = performance.now() - t;

  // cruces de la ruta que tienen alguna regla de giro (para mostrarlos)
  const turnVias = new Set<number>();
  if (opts.turns) {
    const vias = new Set([...opts.turns.keys()].map((k) => +k.split(',')[0]));
    for (const l of legs) for (const st of l.slice(0, -1)) if (vias.has(st.to)) turnVias.add(st.to);
  }

  const { graph, circuit } = walkGraph(g, legs.flat());
  const legLengths = legs.map((l) => l.reduce((s, st) => s + g.edges[st.edge].length, 0));
  const total = legLengths.reduce((s, x) => s + x, 0);
  const base = graph.edges.reduce((s, e) => s + e.length, 0);
  const deg = new Array(graph.vertices.length).fill(0);
  graph.edges.forEach(({ u, v }) => (deg[u]++, deg[v]++));
  const from = points[order[0]];
  const to = points[order[order.length - 1]];
  return {
    graph,
    solution: {
      kind: 'ab',
      ab: {
        from,
        to,
        straight: pairs.reduce((t, [i, j]) => t + haversine(points[i], points[j]), 0),
        explored,
        snap: [snapped[order[0]].dist, snapped[order[order.length - 1]].dist],
        legs: legLengths,
        vehicle: !!opts.vehicle,
        turns: opts.turns ? { rules: opts.turns.size, onRoute: [...turnVias].map((v) => [g.vertices[v].lat, g.vertices[v].lon] as LatLon) } : undefined,
        order,
        roundTrip: !!opts.roundTrip,
      },
      start: 0,
      oddVertices: deg.flatMap((d, i) => (d % 2 ? [i] : [])),
      pairs: [],
      duplicated: circuit.filter((s) => s.repeat).map((s) => s.edge),
      circuit,
      baseLength: base,
      extraLength: total - base,
      totalLength: total,
      matcher: 'ninguno',
      exact: true,
      ms: { dijkstra: ms, matching: 0, euler: 0 },
    },
  };
}

/** Camino de A a B (y de vuelta si se pide): es un recorrido de dos paradas. */
export function routeAB(g: Graph, adj: Adjacency, from: LatLon, to: LatLon, opts: RouteOptions = {}): { graph: Graph; solution: Solution } {
  const a = nearestVertex(g, from, opts.allowed);
  const b = nearestVertex(g, to, opts.allowed);
  if (a.v >= 0 && a.v === b.v) throw new Error('A y B quedan en la misma esquina');
  return routeStops(g, adj, [from, to], opts);
}

/**
 * Convierte un recorrido sobre la ciudad en un grafo pequeño con solo las calles
 * usadas: vértices y aristas numerados en el orden en que aparecen.
 */
export function walkGraph(g: Graph, steps: { edge: number; from: number; to: number }[]): { graph: Graph; circuit: Step[] } {
  const vmap = new Map<number, number>();
  const emap = new Map<number, number>();
  const graph: Graph = { vertices: [], edges: [] };
  const vid = (old: number) => {
    if (!vmap.has(old)) {
      vmap.set(old, graph.vertices.length);
      graph.vertices.push({ ...g.vertices[old], id: `v${graph.vertices.length + 1}` });
    }
    return vmap.get(old)!;
  };
  const circuit = steps.map((s) => {
    const from = vid(s.from);
    const to = vid(s.to);
    let e = emap.get(s.edge);
    const repeat = e !== undefined;
    if (e === undefined) {
      e = graph.edges.length;
      emap.set(s.edge, e);
      const ed = g.edges[s.edge];
      const forward = ed.u === s.from;
      graph.edges.push({ ...ed, id: `e${e + 1}`, u: from, v: to, oneway: undefined, geometry: forward ? ed.geometry : [...ed.geometry].reverse() });
    }
    return { edge: e, from, to, repeat };
  });
  return { graph, circuit };
}
