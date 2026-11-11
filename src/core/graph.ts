import type { Adjacency, Graph, GraphStats } from './types';

export function adjacency(g: Graph, extra: number[] = []): Adjacency {
  const adj: Adjacency = g.vertices.map(() => []);
  const add = (e: number) => {
    const { u, v } = g.edges[e];
    adj[u].push({ edge: e, to: v });
    adj[v].push({ edge: e, to: u }); // un bucle queda dos veces en adj[u]: aporta 2 al grado
  };
  g.edges.forEach((_, e) => add(e));
  extra.forEach(add);
  return adj;
}

/**
 * Adyacencia para carro o moto: una calle de sentido único solo se puede tomar
 * de u a v (arco del grafo dirigido); las de doble vía, en los dos sentidos.
 */
export function directedAdjacency(g: Graph): Adjacency {
  const adj: Adjacency = g.vertices.map(() => []);
  g.edges.forEach(({ u, v, oneway }, e) => {
    adj[u].push({ edge: e, to: v });
    if (!oneway && u !== v) adj[v].push({ edge: e, to: u });
  });
  return adj;
}

export function degrees(g: Graph): number[] {
  const deg = new Array(g.vertices.length).fill(0);
  for (const { u, v } of g.edges) {
    deg[u]++;
    deg[v]++;
  }
  return deg;
}

/** Componentes conexas con BFS. Devuelve el número de componente de cada vértice. */
export function components(g: Graph): { comp: number[]; count: number } {
  const adj = adjacency(g);
  const comp = new Array(g.vertices.length).fill(-1);
  let count = 0;
  for (let s = 0; s < comp.length; s++) {
    if (comp[s] !== -1) continue;
    comp[s] = count;
    const queue = [s];
    for (let i = 0; i < queue.length; i++) {
      for (const { to } of adj[queue[i]]) {
        if (comp[to] === -1) {
          comp[to] = count;
          queue.push(to);
        }
      }
    }
    count++;
  }
  return { comp, count };
}

export function stats(g: Graph): GraphStats {
  const deg = degrees(g);
  const pairs = new Set<string>();
  let parallel = 0;
  let loops = 0;
  for (const { u, v } of g.edges) {
    if (u === v) loops++;
    const key = u < v ? `${u},${v}` : `${v},${u}`;
    if (pairs.has(key)) parallel++;
    pairs.add(key);
  }
  return {
    vertices: g.vertices.length,
    edges: g.edges.length,
    degreeSum: deg.reduce((a, b) => a + b, 0),
    odd: deg.filter((d) => d % 2 === 1).length,
    components: components(g).count,
    loops,
    parallel,
    baseLength: g.edges.reduce((s, e) => s + e.length, 0),
  };
}

/**
 * Se queda con la componente conexa más grande (por longitud de calles).
 * Devuelve el grafo nuevo y las aristas que quedaron por fuera, para pintarlas en gris.
 */
export function largestComponent(g: Graph): { graph: Graph; dropped: Graph['edges'] } {
  const { comp, count } = components(g);
  if (count <= 1) return { graph: g, dropped: [] };
  const size = new Array(count).fill(0);
  for (const e of g.edges) size[comp[e.u]] += e.length;
  const best = size.indexOf(Math.max(...size));
  const keep = g.vertices.map((_, i) => comp[i] === best);
  const dropped = g.edges.filter((e) => !keep[e.u]);
  return { graph: subgraph(g, keep), dropped };
}

/** Subgrafo inducido por los vértices marcados, renumerado como v1, v2, ... */
export function subgraph(g: Graph, keep: boolean[]): Graph {
  const map = new Array(g.vertices.length).fill(-1);
  const vertices = g.vertices.filter((_, i) => keep[i]);
  let k = 0;
  g.vertices.forEach((_, i) => {
    if (keep[i]) map[i] = k++;
  });
  const edges = g.edges.filter((e) => keep[e.u] && keep[e.v]).map((e) => ({ ...e, u: map[e.u], v: map[e.v] }));
  return relabel({ vertices, edges });
}

/**
 * Numera vértices y aristas en orden de lectura (de arriba a abajo, de izquierda
 * a derecha), para que v1 quede arriba a la izquierda como en el tablero.
 */
export function relabel(g: Graph): Graph {
  const order = g.vertices.map((_, i) => i).sort((a, b) => {
    const va = g.vertices[a];
    const vb = g.vertices[b];
    const row = Math.round((vb.lat - va.lat) * 2000); // filas de ~55 m
    return row !== 0 ? row : va.lon - vb.lon;
  });
  const map = new Array(order.length);
  order.forEach((old, i) => (map[old] = i));
  const vertices = order.map((old, i) => ({ ...g.vertices[old], id: `v${i + 1}` }));
  const edges = g.edges
    .map((e) => ({ ...e, u: map[e.u], v: map[e.v] }))
    .sort((a, b) => Math.min(a.u, a.v) - Math.min(b.u, b.v) || Math.max(a.u, a.v) - Math.max(b.u, b.v))
    .map((e, i) => ({ ...e, id: `e${i + 1}` }));
  return { vertices, edges };
}
