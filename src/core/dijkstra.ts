import type { Adjacency, Graph } from './types';

/** Montículo binario de mínimos con pares (prioridad, vértice). */
export class MinHeap {
  private keys: number[] = [];
  private vals: number[] = [];
  get size() {
    return this.keys.length;
  }
  push(k: number, v: number) {
    const { keys, vals } = this;
    let i = keys.length;
    keys.push(k);
    vals.push(v);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= k) break;
      keys[i] = keys[p];
      vals[i] = vals[p];
      i = p;
    }
    keys[i] = k;
    vals[i] = v;
  }
  pop(): [number, number] {
    const { keys, vals } = this;
    const top: [number, number] = [keys[0], vals[0]];
    const k = keys.pop()!;
    const v = vals.pop()!;
    const n = keys.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && keys[c + 1] < keys[c]) c++;
        if (keys[c] >= k) break;
        keys[i] = keys[c];
        vals[i] = vals[c];
        i = c;
      }
      keys[i] = k;
      vals[i] = v;
    }
    return top;
  }
}

export interface DijkstraResult {
  dist: Float64Array;
  predEdge: Int32Array; // arista por la que se llegó (-1 si no se alcanzó)
  found: number[];      // objetivos alcanzados, en orden de cercanía
}

/**
 * Dijkstra desde `source`. Si se dan `targets` y `stopAfter`, se detiene en cuanto
 * encuentra esa cantidad de objetivos (búsqueda acotada, para grafos grandes).
 */
export function dijkstra(
  g: Graph,
  adj: Adjacency,
  source: number,
  targets?: Uint8Array,
  stopAfter = Infinity,
): DijkstraResult {
  const n = g.vertices.length;
  const dist = new Float64Array(n).fill(Infinity);
  const predEdge = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  const found: number[] = [];
  const heap = new MinHeap();
  dist[source] = 0;
  heap.push(0, source);
  while (heap.size) {
    const [d, x] = heap.pop();
    if (done[x]) continue;
    done[x] = 1;
    if (targets && targets[x] && x !== source) {
      found.push(x);
      if (found.length >= stopAfter) break;
    }
    for (const { edge, to } of adj[x]) {
      const nd = d + g.edges[edge].length;
      if (nd < dist[to]) {
        dist[to] = nd;
        predEdge[to] = edge;
        heap.push(nd, to);
      }
    }
  }
  return { dist, predEdge, found };
}

/**
 * Dijkstra desde varios orígenes a la vez; se detiene en el primer vértice que
 * cumpla `isTarget`. Devuelve ese vértice, de qué origen salió y la distancia.
 */
export function nearestFromSet(
  g: Graph,
  adj: Adjacency,
  sources: number[],
  isTarget: (v: number) => boolean,
): { target: number; origin: number; dist: number } | null {
  const n = g.vertices.length;
  const dist = new Float64Array(n).fill(Infinity);
  const origin = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  const heap = new MinHeap();
  for (const s of sources) {
    dist[s] = 0;
    origin[s] = s;
    heap.push(0, s);
  }
  while (heap.size) {
    const [d, x] = heap.pop();
    if (done[x]) continue;
    done[x] = 1;
    if (isTarget(x)) return { target: x, origin: origin[x], dist: d };
    for (const { edge, to } of adj[x]) {
      const nd = d + g.edges[edge].length;
      if (nd < dist[to]) {
        dist[to] = nd;
        origin[to] = origin[x];
        heap.push(nd, to);
      }
    }
  }
  return null;
}

/** Reconstruye la trayectoria (lista de aristas) de source a target. */
export function pathTo(g: Graph, r: DijkstraResult, source: number, target: number): number[] {
  const path: number[] = [];
  let x = target;
  while (x !== source) {
    const e = r.predEdge[x];
    if (e < 0) throw new Error(`No hay camino a ${g.vertices[target].id}`);
    path.push(e);
    const { u, v } = g.edges[e];
    x = u === x ? v : u;
  }
  return path.reverse();
}
