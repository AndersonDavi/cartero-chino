import { MinHeap } from './dijkstra';
import type { Adjacency, Graph } from './types';

/**
 * Giro prohibido (o obligatorio) en un cruce, tomado de las relaciones
 * `type=restriction` de OpenStreetMap:
 * - "no": llegando por `from` al vértice `via`, no se puede salir por `to`;
 * - "solo": llegando por `from`, la única salida permitida es `to`.
 */
export interface TurnRule {
  via: number;
  from: number;
  to: number;
  only: boolean;
}

export type TurnIndex = Map<string, { no: Set<number>; only: Set<number> | null }>;

export function indexTurns(rules: TurnRule[]): TurnIndex {
  const idx: TurnIndex = new Map();
  for (const r of rules) {
    const key = `${r.via},${r.from}`;
    if (!idx.has(key)) idx.set(key, { no: new Set(), only: null });
    const entry = idx.get(key)!;
    if (r.only) (entry.only ??= new Set()).add(r.to);
    else entry.no.add(r.to);
  }
  return idx;
}

export function allowedTurn(idx: TurnIndex, via: number, from: number, to: number): boolean {
  const r = idx.get(`${via},${from}`);
  if (!r) return true;
  if (r.only) return r.only.has(to);
  return !r.no.has(to);
}

/**
 * Dijkstra "por aristas": el estado no es solo el vértice donde estoy, sino
 * también por qué calle llegué (así se sabe si un giro está permitido). Es como
 * correr Dijkstra sobre el grafo de aristas, donde cada vértice es una calle
 * recorrida en un sentido y cada arista es un giro permitido.
 */
export function dijkstraTurns(g: Graph, adj: Adjacency, s: number, t: number, idx: TurnIndex): { path: number[]; dist: number; explored: number } | null {
  const m = g.edges.length;
  const dist = new Float64Array(2 * m).fill(Infinity);
  const pred = new Int32Array(2 * m).fill(-1);
  const done = new Uint8Array(2 * m);
  // estado = arista * 2 + (0 si se llegó a su vértice v, 1 si a su vértice u)
  const state = (e: number, at: number) => e * 2 + (at === g.edges[e].v ? 0 : 1);
  const endOf = (st: number) => (st % 2 === 0 ? g.edges[st >> 1].v : g.edges[st >> 1].u);
  const heap = new MinHeap();
  for (const { edge, to } of adj[s]) {
    const st = state(edge, to);
    const w = g.edges[edge].length;
    if (w < dist[st]) {
      dist[st] = w;
      heap.push(w, st);
    }
  }
  let explored = 0;
  while (heap.size) {
    const [d, st] = heap.pop();
    if (done[st]) continue;
    done[st] = 1;
    explored++;
    const x = endOf(st);
    const from = st >> 1;
    if (x === t) {
      const path: number[] = [];
      for (let c = st; c >= 0; c = pred[c]) path.push(c >> 1);
      return { path: path.reverse(), dist: d, explored };
    }
    for (const { edge, to } of adj[x]) {
      if (!allowedTurn(idx, x, from, edge)) continue;
      const ns = state(edge, to);
      const nd = d + g.edges[edge].length;
      if (nd < dist[ns]) {
        dist[ns] = nd;
        pred[ns] = st;
        heap.push(nd, ns);
      }
    }
  }
  return null;
}
