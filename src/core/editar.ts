import { haversine, pointInRing, polylineLength } from './geo';
import type { Edge, Graph, LatLon } from './types';

// Operaciones del editor. Cada una devuelve un grafo nuevo (no modifica el anterior),
// así "deshacer" es solo volver al grafo de antes.

export type EditOp =
  | { type: 'move'; v: number; p: LatLon }
  | { type: 'add'; p: LatLon; edge?: number } // con edge: parte esa calle en el punto
  | { type: 'connect'; a: number; b: number; geometry?: LatLon[]; length?: number } // sin geometría: línea recta
  | { type: 'removeVertex'; v: number }
  | { type: 'removeEdge'; e: number }
  | { type: 'removeArea'; ring: number[][] }; // borra los vértices dentro del área, con sus calles

export function applyEdit(g: Graph, op: EditOp): Graph {
  switch (op.type) {
    case 'move':
      return moveVertex(g, op.v, op.p);
    case 'add':
      return op.edge === undefined ? addVertex(g, op.p).graph : splitEdge(g, op.edge, op.p).graph;
    case 'connect':
      return connect(g, op.a, op.b, op.geometry, op.length);
    case 'removeVertex':
      return removeVertex(g, op.v);
    case 'removeEdge':
      return { ...g, edges: g.edges.filter((_, i) => i !== op.e) };
    case 'removeArea':
      return removeVertices(g, g.vertices.map((v) => pointInRing(v.lat, v.lon, op.ring)));
  }
}

const nextId = (ids: string[], prefix: string) => `${prefix}${Math.max(0, ...ids.map((id) => +id.slice(1) || 0)) + 1}`;

/** Mueve un vértice; las calles que llegan a él estiran su primer o último punto. */
export function moveVertex(g: Graph, v: number, p: LatLon): Graph {
  const vertices = g.vertices.map((x, i) => (i === v ? { ...x, lat: p[0], lon: p[1] } : x));
  const edges = g.edges.map((e) => {
    if (e.u !== v && e.v !== v) return e;
    const geometry = [...e.geometry];
    if (e.u === v) geometry[0] = p;
    if (e.v === v) geometry[geometry.length - 1] = p;
    return { ...e, geometry, length: polylineLength(geometry) };
  });
  return { vertices, edges };
}

export function addVertex(g: Graph, p: LatLon): { graph: Graph; v: number } {
  const vertex = { id: nextId(g.vertices.map((x) => x.id), 'v'), lat: p[0], lon: p[1], name: 'Cruce agregado' };
  return { graph: { vertices: [...g.vertices, vertex], edges: g.edges }, v: g.vertices.length };
}

/** Parte una calle en el punto más cercano a p: queda un cruce nuevo con dos aristas. */
export function splitEdge(g: Graph, e: number, p: LatLon): { graph: Graph; v: number } {
  const ed = g.edges[e];
  const { point, index } = nearestOnLine(ed.geometry, p);
  const { graph, v } = addVertex(g, point);
  const g1: LatLon[] = [...ed.geometry.slice(0, index + 1), point];
  const g2: LatLon[] = [point, ...ed.geometry.slice(index + 1)];
  const a: Edge = { ...ed, v, geometry: g1, length: polylineLength(g1) };
  const b: Edge = { ...ed, id: nextId(g.edges.map((x) => x.id), 'e'), u: v, geometry: g2, length: polylineLength(g2), ways: undefined };
  const edges = [...graph.edges];
  edges[e] = a;
  edges.push(b);
  return { graph: { vertices: graph.vertices, edges }, v };
}

/** Une dos vértices con una calle nueva: por la geometría dada (las calles reales) o recta. */
export function connect(g: Graph, a: number, b: number, geometry?: LatLon[], length?: number): Graph {
  const pa: LatLon = [g.vertices[a].lat, g.vertices[a].lon];
  const pb: LatLon = [g.vertices[b].lat, g.vertices[b].lon];
  const geo = geometry ?? [pa, pb];
  const edge: Edge = { id: nextId(g.edges.map((x) => x.id), 'e'), u: a, v: b, length: length ?? (geometry ? polylineLength(geo) : haversine(pa, pb)), geometry: geo, name: 'Calle agregada' };
  return { vertices: g.vertices, edges: [...g.edges, edge] };
}

/** Borra un vértice y las calles que llegan a él. */
export function removeVertex(g: Graph, v: number): Graph {
  const map = (i: number) => (i > v ? i - 1 : i);
  return {
    vertices: g.vertices.filter((_, i) => i !== v),
    edges: g.edges.filter((e) => e.u !== v && e.v !== v).map((e) => ({ ...e, u: map(e.u), v: map(e.v) })),
  };
}

/** Borra todos los vértices marcados y las calles que llegan a ellos. */
export function removeVertices(g: Graph, kill: boolean[]): Graph {
  const map: number[] = [];
  let k = 0;
  kill.forEach((x, i) => (map[i] = x ? -1 : k++));
  return {
    vertices: g.vertices.filter((_, i) => !kill[i]),
    edges: g.edges.filter((e) => !kill[e.u] && !kill[e.v]).map((e) => ({ ...e, u: map[e.u], v: map[e.v] })),
  };
}

/** Punto de la polilínea más cercano a p y el índice del segmento donde cae. */
export function nearestOnLine(pts: LatLon[], p: LatLon): { point: LatLon; index: number; dist: number } {
  const k = Math.cos((p[0] * Math.PI) / 180);
  let best = { point: pts[0], index: 0, dist: Infinity };
  for (let i = 1; i < pts.length; i++) {
    const [ay, ax] = [pts[i - 1][0], pts[i - 1][1] * k];
    const [by, bx] = [pts[i][0], pts[i][1] * k];
    const [py, px] = [p[0], p[1] * k];
    const len2 = (bx - ax) ** 2 + (by - ay) ** 2;
    const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / len2)) : 0;
    const q: LatLon = [ay + t * (by - ay), (ax + t * (bx - ax)) / k];
    const d = haversine(q, p);
    if (d < best.dist) best = { point: q, index: i - 1, dist: d };
  }
  return best;
}
