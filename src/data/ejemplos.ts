import type { Graph, LatLon } from '../core/types';

// Coordenadas de mentira (cerca de El Prado) solo para poder dibujarlos en el mapa.
const LAT = 10.995;
const LON = -74.805;
const S = 0.0012;

function make(name: string, pts: Record<string, [number, number]>, edges: [string, string, string, number][]): { name: string; graph: Graph } {
  const ids = Object.keys(pts);
  const vertices = ids.map((id) => ({ id, lat: LAT + pts[id][1] * S, lon: LON + pts[id][0] * S }));
  const at = (id: string): LatLon => [vertices[ids.indexOf(id)].lat, vertices[ids.indexOf(id)].lon];
  const seen = new Map<string, number>();
  // las aristas paralelas se dibujan curvas para que no queden una encima de otra
  const line = (a: string, b: string): LatLon[] => {
    const key = [a, b].sort().join();
    const n = seen.get(key) ?? 0;
    seen.set(key, n + 1);
    const p = at(a);
    const q = at(b);
    if (n === 0) return [p, q];
    const off = 0.25 * (n % 2 ? 1 : -1) * Math.ceil(n / 2);
    const mid: LatLon = [(p[0] + q[0]) / 2 - (q[1] - p[1]) * off, (p[1] + q[1]) / 2 + (q[0] - p[0]) * off];
    return [p, mid, q];
  };
  return {
    name,
    graph: {
      vertices,
      edges: edges.map(([id, a, b, w]) => ({
        id,
        u: ids.indexOf(a),
        v: ids.indexOf(b),
        length: w,
        geometry: a === b ? loop(at(a)) : line(a, b),
      })),
    },
  };
}

function loop(p: LatLon): LatLon[] {
  const r = S * 0.3;
  return Array.from({ length: 13 }, (_, i) => {
    const t = (i / 12) * 2 * Math.PI;
    return [p[0] + r * (1 - Math.cos(t)), p[1] + r * Math.sin(t)] as LatLon;
  });
}

export const EJEMPLOS = [
  // Grafo del tablero del 29 oct (circuito de Euler), con pesos inventados.
  make(
    'Tablero 29 oct (con pesos)',
    { v1: [0, 1], v2: [1, 1], v3: [0, 0], v4: [1, 0] },
    [
      ['e1', 'v2', 'v3', 6],
      ['e2', 'v3', 'v4', 2],
      ['e3', 'v3', 'v1', 3],
      ['e4', 'v2', 'v1', 2],
      ['e5', 'v2', 'v4', 4],
    ],
  ),
  // Corbatín: dos triángulos que comparten un vértice. Todos los grados son pares.
  make(
    'Corbatín (ya es euleriano)',
    { v1: [0, 1], v2: [0, 0], v3: [1, 0.5], v4: [2, 1], v5: [2, 0] },
    [
      ['e1', 'v1', 'v2', 100],
      ['e2', 'v2', 'v3', 100],
      ['e3', 'v3', 'v1', 100],
      ['e4', 'v3', 'v4', 100],
      ['e5', 'v4', 'v5', 100],
      ['e6', 'v5', 'v3', 100],
    ],
  ),
  // Puentes de Königsberg: 4 zonas, 7 puentes, los 4 vértices de grado impar.
  make(
    'Puentes de Königsberg',
    { A: [1, 2], B: [0, 1], C: [1, 0], D: [2, 1] },
    [
      ['e1', 'A', 'B', 100],
      ['e2', 'A', 'B', 120],
      ['e3', 'B', 'C', 100],
      ['e4', 'B', 'C', 120],
      ['e5', 'A', 'D', 150],
      ['e6', 'B', 'D', 140],
      ['e7', 'C', 'D', 150],
    ],
  ),
];
