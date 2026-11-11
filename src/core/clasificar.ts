import type { Graph, Solution } from './types';

export interface Clasificacion {
  tipo: 'camino' | 'sendero' | 'trayectoria' | 'camino cerrado' | 'circuito' | 'circuito simple';
  porque: string;
  euler: string | null;
}

/**
 * Clasifica el recorrido con las definiciones de clase:
 * abierto: camino → sendero (no repite aristas) → trayectoria (tampoco vértices);
 * cerrado: camino cerrado → circuito (no repite aristas) → circuito simple.
 */
export function clasificar(g: Graph, sol: Solution): Clasificacion | null {
  const c = sol.circuit;
  if (c.length === 0) return null;
  const closed = c[0].from === c[c.length - 1].to;
  const uses = new Array(g.edges.length).fill(0);
  c.forEach((s) => uses[s.edge]++);
  const repEdge = uses.findIndex((n) => n > 1);
  // secuencia de vértices; en un recorrido cerrado el último es el mismo primero
  const seq = [c[0].from, ...c.map((s) => s.to)];
  if (closed) seq.pop();
  const seen = new Set<number>();
  let repVertex = -1;
  for (const v of seq) {
    if (seen.has(v)) {
      repVertex = v;
      break;
    }
    seen.add(v);
  }
  const allOnce = uses.every((n) => n === 1);
  const allCovered = uses.every((n) => n >= 1);
  const E = (e: number) => g.edges[e].id;
  const V = (v: number) => g.vertices[v].id;

  let tipo: Clasificacion['tipo'];
  let porque: string;
  if (repEdge >= 0) {
    tipo = closed ? 'camino cerrado' : 'camino';
    porque = `repite aristas (por ejemplo ${E(repEdge)}, que se recorre ${uses[repEdge]} veces)`;
  } else if (repVertex >= 0) {
    tipo = closed ? 'circuito' : 'sendero';
    porque = `no repite aristas, pero pasa más de una vez por ${V(repVertex)}`;
  } else {
    tipo = closed ? 'circuito simple' : 'trayectoria';
    porque = closed ? 'no repite aristas ni vértices (salvo el inicio, que es el final)' : 'no repite aristas ni vértices';
  }
  if (closed) porque += '; empieza y termina en el mismo vértice';

  let euler: string | null = null;
  if (allOnce) euler = closed ? 'Es un circuito de Euler: usa cada arista del grafo exactamente una vez y vuelve al inicio.' : 'Es un sendero de Euler: usa cada arista exactamente una vez, de un extremo al otro.';
  else if (allCovered && closed)
    euler = 'No es circuito de Euler de G (repite calles), pero sí lo es del multigrafo con las aristas duplicadas: ahí cada copia se usa una sola vez.';
  return { tipo, porque, euler };
}
