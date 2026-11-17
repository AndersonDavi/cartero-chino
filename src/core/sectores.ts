import { adjacency } from './graph';
import { MinHeap } from './dijkstra';
import type { Graph } from './types';

/**
 * k carteros: parte las calles en k sectores conexos de longitud parecida.
 *
 * Repartir las calles para que la vuelta más larga sea lo más corta posible es
 * NP-difícil, así que se usa una heurística:
 * 1. Centros: k-medias sobre los puntos medios de las calles (ponderado por su longitud),
 *    arrancando con los puntos más separados entre sí.
 * 2. Crecimiento por el grafo: cada sector parte de la calle más cercana a su centro y,
 *    en cada paso, el sector con menos metros toma la calle vecina libre más cercana a
 *    su centro. Así los sectores quedan pegados (conexos) y parejos.
 *
 * Devuelve el sector de cada arista (0..k-1).
 */
export function sectorizar(g: Graph, k: number): number[] {
  const m = g.edges.length;
  k = Math.max(1, Math.min(k, m));
  if (k === 1) return new Array(m).fill(0);

  // puntos medios en metros (proyección local)
  const lat0 = (g.vertices.reduce((s, v) => s + v.lat, 0) / g.vertices.length) * (Math.PI / 180);
  const kx = 111320 * Math.cos(lat0);
  const ky = 110540;
  const mid = g.edges.map((e) => {
    const p = e.geometry[Math.floor(e.geometry.length / 2)] ?? [g.vertices[e.u].lat, g.vertices[e.u].lon];
    return [p[1] * kx, p[0] * ky] as [number, number];
  });
  const w = g.edges.map((e) => Math.max(e.length, 1));
  const d2 = (a: [number, number], b: [number, number]) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;

  // 1. centros iniciales: el punto más lejano de los ya elegidos (determinista)
  const cx = mid.reduce((s, p, i) => [s[0] + p[0] * w[i], s[1] + p[1] * w[i]], [0, 0]);
  const W = w.reduce((s, x) => s + x, 0);
  const centro: [number, number] = [cx[0] / W, cx[1] / W];
  let first = 0;
  mid.forEach((p, i) => d2(p, centro) > d2(mid[first], centro) && (first = i));
  const centers: [number, number][] = [mid[first]];
  const near = mid.map((p) => d2(p, mid[first]));
  while (centers.length < k) {
    let far = 0;
    near.forEach((d, i) => d > near[far] && (far = i));
    centers.push(mid[far]);
    mid.forEach((p, i) => (near[i] = Math.min(near[i], d2(p, mid[far]))));
  }
  // k-medias (pocas vueltas bastan para ubicar los centros)
  for (let it = 0; it < 12; it++) {
    const sum = centers.map(() => [0, 0, 0]);
    mid.forEach((p, i) => {
      let best = 0;
      for (let c = 1; c < k; c++) if (d2(p, centers[c]) < d2(p, centers[best])) best = c;
      sum[best][0] += p[0] * w[i];
      sum[best][1] += p[1] * w[i];
      sum[best][2] += w[i];
    });
    sum.forEach((s, c) => s[2] > 0 && (centers[c] = [s[0] / s[2], s[1] / s[2]]));
  }

  // 2. crecimiento parejo por el grafo
  const adj = adjacency(g);
  const sector = new Array<number>(m).fill(-1);
  const load = new Array<number>(k).fill(0);
  const frontier = centers.map(() => new MinHeap());
  const take = (e: number, c: number) => {
    sector[e] = c;
    load[c] += g.edges[e].length;
    for (const v of [g.edges[e].u, g.edges[e].v])
      for (const { edge } of adj[v]) if (sector[edge] < 0) frontier[c].push(d2(mid[edge], centers[c]), edge);
  };
  // semilla: la calle libre más cercana a cada centro
  centers.forEach((ctr, c) => {
    let best = -1;
    mid.forEach((p, i) => sector[i] < 0 && (best < 0 || d2(p, ctr) < d2(mid[best], ctr)) && (best = i));
    if (best >= 0) take(best, c);
  });
  let left = sector.filter((s) => s < 0).length;
  const stuck = new Array<boolean>(k).fill(false);
  while (left > 0) {
    // el sector con menos metros que todavía pueda crecer
    let c = -1;
    for (let i = 0; i < k; i++) if (!stuck[i] && (c < 0 || load[i] < load[c])) c = i;
    if (c < 0) break;
    let e = -1;
    while (frontier[c].size > 0) {
      const [, top] = frontier[c].pop();
      if (sector[top] < 0) {
        e = top;
        break;
      }
    }
    if (e < 0) {
      stuck[c] = true;
      continue;
    }
    take(e, c);
    left--;
  }
  // calles sueltas (pedazos sin conexión): al centro más cercano
  sector.forEach((s, i) => {
    if (s >= 0) return;
    let best = 0;
    for (let c = 1; c < k; c++) if (d2(mid[i], centers[c]) < d2(mid[i], centers[best])) best = c;
    sector[i] = best;
  });
  return sector;
}

/** Subgrafo con las aristas dadas; `toParent[v]` es el índice del vértice v en el grafo original. */
export function subgrafoAristas(g: Graph, edges: number[]): { graph: Graph; toParent: number[] } {
  const map = new Map<number, number>();
  const toParent: number[] = [];
  const idx = (v: number) => {
    let x = map.get(v);
    if (x === undefined) {
      x = toParent.length;
      map.set(v, x);
      toParent.push(v);
    }
    return x;
  };
  const sub = edges.map((e, i) => {
    const ed = g.edges[e];
    return { ...ed, id: `e${i + 1}`, u: idx(ed.u), v: idx(ed.v) };
  });
  const vertices = toParent.map((v, i) => ({ ...g.vertices[v], id: `v${i + 1}` }));
  return { graph: { vertices, edges: sub }, toParent };
}
