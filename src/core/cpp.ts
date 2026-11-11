import { dijkstra, nearestFromSet, pathTo } from './dijkstra';
import { hierholzer } from './euler';
import { adjacency, components, degrees } from './graph';
import { bitmaskMatching, blossomMatching, type Pair } from './matching';
import type { Adjacency, Graph, Matcher, Solution } from './types';

export const BITMASK_MAX = 20;   // hasta aquí, máscaras de bits (exacto y fácil de explicar)
export const DENSE_MAX = 400;    // hasta aquí, Blossom sobre el grafo completo de impares (exacto)
export const NEIGHBORS = 8;      // más allá, Blossom solo con los 8 impares más cercanos de cada uno

export type Progress = (msg: string) => void;

/**
 * Emparejamiento perfecto de costo mínimo de los vértices `odd` de S, con las
 * distancias más cortas medidas en S (Dijkstra). Devuelve parejas de índices de `odd`.
 */
function matchOdd(S: Graph, adj: Adjacency, odd: number[], progress: Progress, neighbors: number) {
  const k = odd.length;
  const isOdd = new Uint8Array(S.vertices.length);
  odd.forEach((v) => (isOdd[v] = 1));
  let t = performance.now();
  let pairs: Pair[] = [];
  let matcher: Matcher = 'ninguno';
  let exact = true;
  let msDijkstra = 0;

  if (k > 0 && k <= DENSE_MAX) {
    progress(`Dijkstra desde ${k} vértices impares…`);
    const dist = odd.map((s) => {
      const r = dijkstra(S, adj, s, isOdd, k - 1);
      return odd.map((v) => r.dist[v]);
    });
    msDijkstra = performance.now() - t;
    t = performance.now();
    if (k <= BITMASK_MAX) {
      progress(`Emparejamiento exacto con máscaras de bits (2^${k} subconjuntos)…`);
      pairs = bitmaskMatching(k, (i, j) => dist[i][j]).pairs;
      matcher = 'bitmask';
    } else {
      progress(`Blossom sobre el grafo completo de ${k} impares…`);
      const edges: [number, number, number][] = [];
      for (let i = 0; i < k; i++) for (let j = i + 1; j < k; j++) edges.push([i, j, dist[i][j]]);
      pairs = blossomMatching(k, edges).pairs;
      matcher = 'blossom';
    }
  } else if (k > 0) {
    progress(`Dijkstra acotado: ${neighbors} impares más cercanos de cada uno de los ${k}…`);
    const local = new Map<number, number>();
    odd.forEach((v, i) => local.set(v, i));
    const edges = new Map<string, [number, number, number]>();
    const near: { j: number; d: number }[][] = odd.map(() => []);
    odd.forEach((s, i) => {
      const r = dijkstra(S, adj, s, isOdd, neighbors);
      for (const v of r.found) {
        const j = local.get(v)!;
        near[i].push({ j, d: r.dist[v] });
        const key = i < j ? `${i},${j}` : `${j},${i}`;
        if (!edges.has(key)) edges.set(key, [Math.min(i, j), Math.max(i, j), r.dist[v]]);
      }
    });
    bridgeOddGroups(S, adj, odd, edges, near);
    msDijkstra = performance.now() - t;
    t = performance.now();
    progress(`Blossom sobre ${edges.size} candidatos…`);
    const res = blossomMatching(k, [...edges.values()]);
    pairs = res.pairs;
    if (res.unmatched.length) pairs = repairLeftovers(S, adj, odd, near, pairs, res.unmatched);
    matcher = 'blossom-vecinos';
    exact = false;
  }
  return { pairs, matcher, exact, msDijkstra, msMatching: performance.now() - t };
}

/** Trayectoria más corta en S entre cada pareja. */
function pairPaths(S: Graph, adj: Adjacency, odd: number[], pairs: Pair[]) {
  return pairs.map(([i, j]) => {
    const a = odd[i];
    const b = odd[j];
    const target = new Uint8Array(S.vertices.length);
    target[b] = 1;
    const r = dijkstra(S, adj, a, target, 1);
    return { a, b, dist: r.dist[b], path: pathTo(S, r, a, b) };
  });
}

/**
 * Problema del cartero chino en un grafo no dirigido y conexo.
 * 1. O = vértices de grado impar (|O| es par por el apretón de manos).
 * 2. Distancias más cortas entre impares (Dijkstra).
 * 3. Emparejamiento perfecto de costo mínimo de O.
 * 4. Duplicar las aristas de la trayectoria de cada pareja.
 * 5. Circuito de Euler en el multigrafo (Hierholzer).
 */
export function solveCPP(g: Graph, start = 0, progress: Progress = () => {}, { neighbors = NEIGHBORS } = {}): Solution {
  if (g.edges.length === 0) throw new Error('El grafo no tiene aristas');
  if (components(g).count > 1) throw new Error('El grafo no es conexo: no existe un recorrido que pase por todas las calles');

  const odd = degrees(g).flatMap((d, i) => (d % 2 === 1 ? [i] : []));
  const adj = adjacency(g);
  const m = matchOdd(g, adj, odd, progress, neighbors);

  progress('Duplicando las aristas de cada pareja…');
  const solvedPairs = pairPaths(g, adj, odd, m.pairs);
  const duplicated = solvedPairs.flatMap((p) => p.path);

  progress('Circuito de Euler con Hierholzer…');
  const t = performance.now();
  const circuit = hierholzer(g, start, duplicated);
  const msEuler = performance.now() - t;

  const baseLength = g.edges.reduce((s, e) => s + e.length, 0);
  const extraLength = duplicated.reduce((s, e) => s + g.edges[e].length, 0);
  return {
    start,
    oddVertices: odd,
    pairs: solvedPairs,
    duplicated,
    circuit,
    baseLength,
    extraLength,
    totalLength: baseLength + extraLength,
    matcher: m.matcher,
    exact: m.exact,
    ms: { dijkstra: m.msDijkstra, matching: m.msMatching, euler: msEuler },
  };
}

/**
 * Cartero chino "rural": hay que pasar por todas las calles de g (las requeridas),
 * pero para moverse se puede usar cualquier calle de la ciudad (net), como haría
 * Google Maps. `toNet[v]` es el vértice de net donde está el vértice v de g.
 *
 * - Si g es conexo, el resultado es óptimo: es el mismo emparejamiento de impares,
 *   pero con distancias medidas en toda la ciudad.
 * - Si g tiene pedazos sueltos el problema es NP-difícil; se unen los pedazos con
 *   el camino más corto hacia el más cercano (heurística de Frederickson) y luego
 *   se empareja.
 *
 * Las calles usadas solo para moverse se agregan al grafo de la ruta marcadas como
 * `extra` (se dibujan aparte); ese grafo va en `solution.routeGraph`.
 */
export function solveCPPFree(g: Graph, start: number, net: Graph, netAdj: Adjacency, toNet: number[], progress: Progress = () => {}, { neighbors = NEIGHBORS } = {}): Solution {
  if (g.edges.length === 0) throw new Error('El grafo no tiene aristas');
  const fromNet = new Map<number, number>();
  toNet.forEach((x, v) => fromNet.set(x, v));
  const moves: number[][] = []; // caminos en net (aristas) usados solo para moverse

  // 1. unir pedazos sueltos por la ciudad
  const { comp, count } = components(g);
  if (count > 1) {
    progress(`Uniendo ${count} pedazos por las calles más cercanas…`);
    const joined = new Set([comp[start]]);
    while (joined.size < count) {
      const sources = toNet.filter((_, v) => joined.has(comp[v]));
      const hit = nearestFromSet(net, netAdj, sources, (x) => fromNet.has(x) && !joined.has(comp[fromNet.get(x)!]));
      if (!hit) throw new Error('Hay pedazos que no se pueden unir por calles');
      const target = new Uint8Array(net.vertices.length);
      target[hit.target] = 1;
      const r = dijkstra(net, netAdj, hit.origin, target, 1);
      moves.push(pathTo(net, r, hit.origin, hit.target));
      joined.add(comp[fromNet.get(hit.target)!]);
    }
  }

  // 2. grados en la ciudad: calles requeridas + caminos de unión
  const deg = new Map<number, number>();
  const bump = (x: number) => deg.set(x, (deg.get(x) ?? 0) + 1);
  for (const e of g.edges) {
    bump(toNet[e.u]);
    bump(toNet[e.v]);
  }
  for (const path of moves) for (const e of path) (bump(net.edges[e].u), bump(net.edges[e].v));
  const odd = [...deg.entries()].filter(([, d]) => d % 2 === 1).map(([x]) => x);

  // 3. emparejar con distancias en toda la ciudad
  const m = matchOdd(net, netAdj, odd, progress, neighbors);
  progress('Agregando los caminos de cada pareja…');
  const netPairs = pairPaths(net, netAdj, odd, m.pairs);
  moves.push(...netPairs.map((p) => p.path));

  // 4. grafo de la ruta: requeridas + calles para moverse (una arista por cada calle de net usada)
  const route: Graph = { vertices: [...g.vertices], edges: [...g.edges] };
  const vOf = (x: number) => {
    let v = fromNet.get(x);
    if (v === undefined) {
      v = route.vertices.length;
      route.vertices.push({ ...net.vertices[x], id: `v${v + 1}` });
      fromNet.set(x, v);
    }
    return v;
  };
  // Una calle de la ciudad puede ser parte de una calle del área (las del área están
  // contraídas: una arista puede cubrir varias de la ciudad). Si un camino recorre una
  // calle del área completa, es una repetición de esa calle; si no, es una calle "de moverse".
  const keyOf = (lat: number, lon: number) => `${lat.toFixed(6)},${lon.toFixed(6)}`;
  const netKey = new Map(net.vertices.map((v, i) => [keyOf(v.lat, v.lon), i]));
  const netToG = new Map<number, { e: number; n: number }>();
  g.edges.forEach((e, gi) => {
    const seq: number[] = [];
    for (const [lat, lon] of e.geometry) {
      const x = netKey.get(keyOf(lat, lon));
      if (x !== undefined && x !== seq[seq.length - 1]) seq.push(x);
    }
    const pieces: number[] = [];
    for (let k = 1; k < seq.length; k++) {
      const hit = netAdj[seq[k - 1]].find((a) => a.to === seq[k]);
      if (hit) pieces.push(hit.edge);
    }
    for (const ne of pieces) netToG.set(ne, { e: gi, n: pieces.length });
  });

  const eOf = new Map<number, number>();
  const extra: number[] = []; // pasadas de más (repeticiones), para Hierholzer
  let nextId = Math.max(0, ...g.edges.map((e) => +e.id.slice(1) || 0)) + 1;
  const outside = (ne: number) => {
    const known = eOf.get(ne);
    if (known !== undefined) {
      extra.push(known);
      return known;
    }
    const ed = net.edges[ne];
    const idx = route.edges.length;
    route.edges.push({ ...ed, id: `e${nextId++}`, u: vOf(ed.u), v: vOf(ed.v), extra: true, oneway: undefined, ways: undefined });
    eOf.set(ne, idx);
    return idx;
  };
  const pathInRoute = (path: number[]) => {
    const out: number[] = [];
    for (let i = 0; i < path.length; ) {
      const m = netToG.get(path[i]);
      let j = i + 1;
      while (m && j < path.length && netToG.get(path[j])?.e === m.e) j++;
      if (m && j - i === m.n) {
        extra.push(m.e); // recorre esa calle del área completa: se repite
        out.push(m.e);
      } else {
        for (let k = i; k < j; k++) out.push(outside(path[k]));
      }
      i = j;
    }
    return out;
  };
  for (let i = 0; i < moves.length - netPairs.length; i++) pathInRoute(moves[i]);
  const solvedPairs = netPairs.map((p) => ({ a: vOf(p.a), b: vOf(p.b), dist: p.dist, path: pathInRoute(p.path) }));

  // 5. circuito de Euler
  progress('Circuito de Euler con Hierholzer…');
  const t = performance.now();
  const circuit = hierholzer(route, start, extra);
  const msEuler = performance.now() - t;

  const baseLength = g.edges.reduce((s, e) => s + e.length, 0);
  const moveLength = route.edges.filter((e) => e.extra).reduce((s, e) => s + e.length, 0) + extra.reduce((s, e) => s + route.edges[e].length, 0);
  return {
    start,
    oddVertices: odd.map(vOf),
    pairs: solvedPairs,
    duplicated: extra,
    circuit,
    baseLength,
    extraLength: moveLength,
    totalLength: baseLength + moveLength,
    matcher: m.matcher,
    exact: m.exact && count === 1,
    ms: { dijkstra: m.msDijkstra, matching: m.msMatching, euler: msEuler },
    routeGraph: route,
    free: { pieces: count },
  };
}

/**
 * Si un grupo de impares solo tiene candidatos entre ellos y son una cantidad
 * impar, es imposible emparejarlos a todos: uno debe salir del grupo (pasa con
 * barrios unidos al resto por una sola vía larga). Para cada grupo impar se
 * agrega como candidata la conexión más corta hacia un impar de fuera.
 */
function bridgeOddGroups(
  g: Graph,
  adj: ReturnType<typeof adjacency>,
  odd: number[],
  edges: Map<string, [number, number, number]>,
  near: { j: number; d: number }[][],
) {
  const k = odd.length;
  const local = new Map<number, number>();
  odd.forEach((v, i) => local.set(v, i));
  for (let round = 0; round < 100; round++) {
    const parent = Int32Array.from({ length: k }, (_, i) => i);
    const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));
    for (const [i, j] of edges.values()) parent[find(i)] = find(j);
    const groups = new Map<number, number[]>();
    for (let i = 0; i < k; i++) {
      const r = find(i);
      if (!groups.has(r)) groups.set(r, []);
      groups.get(r)!.push(i);
    }
    const oddGroups = [...groups.values()].filter((m) => m.length % 2 === 1);
    if (oddGroups.length === 0) return;
    for (const members of oddGroups) {
      const inGroup = new Set(members.map((i) => odd[i]));
      const hit = nearestFromSet(g, adj, [...inGroup], (v) => local.has(v) && !inGroup.has(v));
      if (!hit) continue;
      const i = local.get(hit.origin)!;
      const j = local.get(hit.target)!;
      edges.set(i < j ? `${i},${j}` : `${j},${i}`, [Math.min(i, j), Math.max(i, j), hit.dist]);
      near[i].push({ j, d: hit.dist });
      near[j].push({ j: i, d: hit.dist });
    }
  }
}

/**
 * Con solo vecinos cercanos, algunos impares pueden quedar sin pareja (por ejemplo
 * un grupo aislado con cantidad impar). Se emparejan entre ellos con distancias
 * completas y luego se mejora con intercambios: si (p, y) es una pareja larga y
 * a es vecino de p con pareja b, se cambia a (p, a) + (b, y) cuando sale más corto.
 * Cada intercambio "acerca" la pareja larga hasta que ya no se puede mejorar.
 */
function repairLeftovers(
  g: Graph,
  adj: ReturnType<typeof adjacency>,
  odd: number[],
  near: { j: number; d: number }[][],
  pairs: Pair[],
  unmatched: number[],
): Pair[] {
  const k = odd.length;
  const mate = new Int32Array(k).fill(-1);
  const cost = new Float64Array(k);
  for (const [i, j] of pairs) {
    mate[i] = j;
    mate[j] = i;
    const d = near[i].find((n) => n.j === j)?.d ?? near[j].find((n) => n.j === i)!.d;
    cost[i] = cost[j] = d;
  }
  const row = new Map<number, Float64Array>();
  const fullRow = (x: number) => {
    let r = row.get(x);
    if (!r) {
      const dist = dijkstra(g, adj, odd[x]).dist;
      r = Float64Array.from(odd, (v) => dist[v]);
      row.set(x, r);
    }
    return r;
  };

  const e: [number, number, number][] = [];
  for (let a = 0; a < unmatched.length; a++)
    for (let b = a + 1; b < unmatched.length; b++) e.push([a, b, fullRow(unmatched[a])[unmatched[b]]]);
  const chains: [number, number][] = [];
  for (const [a, b] of blossomMatching(unmatched.length, e).pairs) {
    const [x, y] = [unmatched[a], unmatched[b]];
    mate[x] = y;
    mate[y] = x;
    cost[x] = cost[y] = fullRow(x)[y];
    chains.push([x, y]);
  }

  // Mueve el extremo p dejando fijo y; devuelve el nuevo extremo y si hubo cambios.
  const slide = (p: number, y: number): { p: number; moved: boolean } => {
    const ry = fullRow(y);
    let moved = false;
    for (let guard = 0; guard < 10000; guard++) {
      let best = 1e-6;
      let pick = -1;
      let pickD = 0;
      for (const { j: a, d: dpa } of near[p]) {
        const b = mate[a];
        if (a === y || b === p || b < 0) continue;
        const gain = cost[p] + cost[a] - dpa - ry[b];
        if (gain > best) {
          best = gain;
          pick = a;
          pickD = dpa;
        }
      }
      if (pick < 0) break;
      const b = mate[pick];
      mate[p] = pick;
      mate[pick] = p;
      cost[p] = cost[pick] = pickD;
      mate[b] = y;
      mate[y] = b;
      cost[b] = cost[y] = ry[b];
      p = b;
      moved = true;
    }
    return { p, moved };
  };

  // se alterna: primero se mueve un extremo, luego el otro, hasta que ninguno mejore
  for (const [x0, y0] of chains) {
    let [p, y] = [x0, y0];
    for (let round = 0; round < 20; round++) {
      const r = slide(p, y);
      if (!r.moved && round > 0) break;
      [p, y] = [y, r.p];
    }
  }

  const out: Pair[] = [];
  for (let i = 0; i < k; i++) if (mate[i] > i) out.push([i, mate[i]]);
  return out;
}

/**
 * Un circuito de Euler se puede empezar en cualquiera de sus vértices: basta con
 * rotarlo. Así cambiar el inicio no obliga a recalcular todo.
 */
export function rotateSolution(sol: Solution, start: number): Solution {
  const j = sol.circuit.findIndex((s) => s.from === start);
  if (j < 0) return sol;
  const order = [...sol.circuit.slice(j), ...sol.circuit.slice(0, j)];
  const seen = new Set<number>();
  const circuit = order.map((s) => {
    const repeat = seen.has(s.edge);
    seen.add(s.edge);
    return { ...s, repeat };
  });
  return { ...sol, start, circuit };
}
