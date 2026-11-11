import { bearing } from './geo';
import type { Graph, Step } from './types';

/**
 * Algoritmo de Hierholzer, O(|E|). Recorre el multigrafo formado por las aristas
 * de g más las duplicadas (`extra`, índices de aristas de g que se repiten).
 * Exige que todos los grados sean pares y que sea conexo (teorema de Euler).
 *
 * Idea: caminar sin repetir aristas hasta quedarse atascado (eso solo pasa en el
 * vértice de partida); al retroceder por la pila, si un vértice aún tiene aristas
 * libres se abre desde él un sub-circuito que se empalma ahí.
 */
export function hierholzer(g: Graph, start: number, extra: number[] = []): Step[] {
  // arista aumentada a → arista original base[a]; las copias son aristas paralelas
  const base = [...g.edges.keys(), ...extra];
  const adj: { aug: number; to: number }[][] = g.vertices.map(() => []);
  base.forEach((e, aug) => {
    const { u, v } = g.edges[e];
    adj[u].push({ aug, to: v });
    adj[v].push({ aug, to: u });
  });

  const used = new Uint8Array(base.length);
  const ptr = new Int32Array(g.vertices.length);
  const stack: { v: number; via: number }[] = [{ v: start, via: -1 }];
  const out: { v: number; via: number }[] = [];

  // rumbo con que se sale de x por la arista e (o con que se llega a x, si `arrive`)
  const heading = (e: number, x: number, arrive: boolean): number | null => {
    const { u, v, geometry: geo } = g.edges[e];
    if (geo.length < 2 || u === v) return null;
    const fromX = (u === x) !== arrive; // la geometría va de u a v
    const pts = fromX ? geo : [...geo].reverse();
    return arrive ? bearing(pts[pts.length - 2], pts[pts.length - 1]) : bearing(pts[0], pts[1]);
  };

  while (stack.length) {
    const top = stack[stack.length - 1];
    const list = adj[top.v];
    let p = ptr[top.v];
    while (p < list.length && used[list[p].aug]) p++;
    ptr[top.v] = p;
    if (p === list.length) {
      out.push(stack.pop()!);
    } else {
      // entre las aristas libres se prefiere la que sigue más derecho: no cambia el
      // total (todo circuito de Euler mide lo mismo), pero la ruta zigzaguea menos
      let pick = p;
      const inH = top.via >= 0 ? heading(base[top.via], top.v, true) : null;
      if (inH !== null) {
        let best = Infinity;
        for (let q = p; q < list.length; q++) {
          if (used[list[q].aug]) continue;
          const h = heading(base[list[q].aug], top.v, false);
          const turn = h === null ? 90 : Math.abs(((h - inH + 540) % 360) - 180);
          if (turn < best) {
            best = turn;
            pick = q;
          }
        }
      }
      used[list[pick].aug] = 1;
      stack.push({ v: list[pick].to, via: list[pick].aug });
    }
  }
  out.reverse();

  if (out.length - 1 !== base.length) throw new Error('El grafo no es conexo: el circuito no cubre todas las aristas');
  const seen = new Uint8Array(g.edges.length);
  const steps: Step[] = [];
  for (let i = 1; i < out.length; i++) {
    const e = base[out[i].via];
    steps.push({ edge: e, from: out[i - 1].v, to: out[i].v, repeat: seen[e] === 1 });
    seen[e] = 1;
  }
  return steps;
}

/**
 * Algoritmo de Fleury (el visto en clase), O(|E|²): en cada paso evita "quemar
 * puentes", lo que obliga a revisar con un BFS si la arista desconecta lo que
 * queda. Se deja para comparar tiempos con Hierholzer.
 */
export function fleury(g: Graph, start: number, extra: number[] = []): Step[] {
  const base = [...g.edges.keys(), ...extra];
  const adj: { aug: number; to: number }[][] = g.vertices.map(() => []);
  base.forEach((e, aug) => {
    const { u, v } = g.edges[e];
    adj[u].push({ aug, to: v });
    adj[v].push({ aug, to: u });
  });
  const used = new Uint8Array(base.length);
  const reachable = (from: number) => {
    const seen = new Uint8Array(g.vertices.length);
    const q = [from];
    seen[from] = 1;
    let count = 1;
    for (let i = 0; i < q.length; i++) {
      for (const { aug, to } of adj[q[i]]) {
        if (!used[aug] && !seen[to]) {
          seen[to] = 1;
          count++;
          q.push(to);
        }
      }
    }
    return count;
  };

  const seenEdge = new Uint8Array(g.edges.length);
  const steps: Step[] = [];
  let x = start;
  for (let n = 0; n < base.length; n++) {
    const free = adj[x].filter((a) => !used[a.aug]);
    let pick = free[0];
    if (free.length > 1) {
      // ¿es puente? se prueba quitarla y ver si se sigue alcanzando lo mismo
      const before = reachable(x);
      for (const cand of free) {
        used[cand.aug] = 1;
        const after = reachable(cand.to);
        used[cand.aug] = 0;
        if (after === before) {
          pick = cand;
          break;
        }
      }
    }
    if (!pick) throw new Error('Fleury se quedó sin aristas: el grafo no es euleriano');
    used[pick.aug] = 1;
    const e = base[pick.aug];
    steps.push({ edge: e, from: x, to: pick.to, repeat: seenEdge[e] === 1 });
    seenEdge[e] = 1;
    x = pick.to;
  }
  return steps;
}
