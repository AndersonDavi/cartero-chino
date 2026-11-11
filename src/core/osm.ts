import { insideArea, polylineLength } from './geo';
import { relabel } from './graph';
import type { TurnRule } from './turns';
import type { Edge, Graph, LatLon, Vertex } from './types';

export interface BuildOptions {
  troncales: boolean;   // Vía 40, Circunvalar, Calle 30...
  peatonales: boolean;  // calles peatonales y senderos
  servicio: boolean;    // vías de servicio (parqueaderos, entradas)
}

export const defaultBuildOptions: BuildOptions = { troncales: false, peatonales: false, servicio: false };

export const OVERPASS_ENDPOINTS = [
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

export function highwayTypes(o: BuildOptions): string[] {
  const t = ['primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'primary_link', 'secondary_link', 'tertiary_link'];
  if (o.troncales) t.push('trunk', 'trunk_link');
  if (o.peatonales) t.push('pedestrian', 'footway');
  if (o.servicio) t.push('service');
  return t;
}

/** Consulta Overpass QL para las calles dentro del anillo [[lon, lat], ...]. */
export function overpassQuery(ring: number[][], o: BuildOptions): string {
  const pts = ring.slice(0, ring[0][0] === ring.at(-1)![0] && ring[0][1] === ring.at(-1)![1] ? -1 : undefined);
  const poly = pts.map(([lon, lat]) => `${lat.toFixed(6)} ${lon.toFixed(6)}`).join(' ');
  return `[out:json][timeout:180];
way["highway"~"^(${highwayTypes(o).join('|')})$"]["area"!="yes"]["access"!~"^(private|no)$"](poly:"${poly}");
out body geom;`;
}

/** Sentido de una vía según sus etiquetas: 1 = en el sentido del dibujo, -1 = al revés, 0 = doble. */
export function onewayOf(t?: Record<string, string>): 0 | 1 | -1 {
  if (!t) return 0;
  const o = t.oneway;
  if (o === '-1' || o === 'reverse') return -1;
  if (o === 'yes' || o === '1' || o === 'true') return 1;
  if (o === 'no') return 0;
  if (t.junction === 'roundabout' || t.junction === 'circular' || t.highway === 'motorway') return 1;
  return 0;
}

interface OsmWay {
  type: 'way';
  id: number;
  nodes: number[];
  geometry: { lat: number; lon: number }[];
  tags?: Record<string, string>;
}

/**
 * Convierte la respuesta de Overpass en un grafo:
 * - vértice = nodo OSM compartido por 2 o más calles, o extremo de una calle;
 * - arista = tramo de calle entre dos vértices, con su longitud como peso.
 * Si se da un anillo, solo quedan los tramos con los dos extremos dentro del área.
 */
export function buildGraph(osm: { elements: OsmWay[] }, ring?: number[][]): Graph {
  const ways = osm.elements.filter((e) => e.type === 'way' && e.geometry && e.nodes.length >= 2);

  const uses = new Map<number, number>();
  for (const w of ways) {
    w.nodes.forEach((n, i) => {
      const end = i === 0 || i === w.nodes.length - 1;
      uses.set(n, (uses.get(n) ?? 0) + (end ? 2 : 1));
    });
  }
  const isVertex = (n: number) => (uses.get(n) ?? 0) >= 2;

  const index = new Map<number, number>();
  const vertices: Vertex[] = [];
  const names: Set<string>[] = [];
  const vertexOf = (n: number, p: { lat: number; lon: number }, name?: string) => {
    let i = index.get(n);
    if (i === undefined) {
      i = vertices.length;
      index.set(n, i);
      vertices.push({ id: '', lat: p.lat, lon: p.lon, osmId: n });
      names.push(new Set());
    }
    if (name) names[i].add(name);
    return i;
  };
  const inside = (p: { lat: number; lon: number }) => !ring || insideArea(p.lat, p.lon, ring);

  const edges: Edge[] = [];
  for (const w of ways) {
    const name = w.tags?.name ?? w.tags?.ref;
    const dir = onewayOf(w.tags);
    let start = 0;
    for (let i = 1; i < w.nodes.length; i++) {
      if (!isVertex(w.nodes[i])) continue;
      const a = w.geometry[start];
      const b = w.geometry[i];
      if (inside(a) && inside(b)) {
        const geometry: LatLon[] = w.geometry.slice(start, i + 1).map((p) => [p.lat, p.lon]);
        const u = vertexOf(w.nodes[start], a, name);
        const v = vertexOf(w.nodes[i], b, name);
        // los de sentido contrario (oneway=-1) se guardan al revés: así oneway siempre es u → v
        edges.push({
          id: '',
          u: dir === -1 ? v : u,
          v: dir === -1 ? u : v,
          length: polylineLength(geometry),
          geometry: dir === -1 ? geometry.reverse() : geometry,
          name,
          highway: w.tags?.highway,
          osmWayId: w.id,
          oneway: dir !== 0,
          ways: [w.id, w.id],
        });
      }
      start = i;
    }
  }
  vertices.forEach((v, i) => {
    const n = [...names[i]];
    if (n.length) v.name = n.slice(0, 2).join(' × ');
  });
  return relabel(contract({ vertices, edges }));
}

/** Formato compacto de public/data/calles-atlantico.json (ver scripts/calles.ts). */
export interface CompactStreets {
  fuente: string;
  fecha: string;
  vertices: [number, number, string][];
  edges: [number, number, number, string, string, number[], number?][]; // ..., geometría, sentido único (1)
  restrictions?: [number, number, number, number][]; // [vértice, arista de llegada, arista de salida, 1 = "solo"]
}

export function fromCompact(c: CompactStreets): Graph {
  return {
    vertices: c.vertices.map(([lat, lon, name], i) => ({ id: `v${i + 1}`, lat, lon, name: name || undefined })),
    edges: c.edges.map(([u, v, length, name, highway, flat, oneway], i) => {
      const geometry: LatLon[] = [];
      for (let k = 0; k < flat.length; k += 2) geometry.push([flat[k], flat[k + 1]]);
      return { id: `e${i + 1}`, u, v, length, name: name || undefined, highway: highway || undefined, geometry, oneway: oneway === 1 };
    }),
  };
}

export function turnsFromCompact(c: CompactStreets): TurnRule[] {
  return (c.restrictions ?? []).map(([via, from, to, only]) => ({ via, from, to, only: only === 1 }));
}

/** Recorta un grafo ya armado: quedan los tramos con los dos extremos dentro del anillo. */
export function clipGraph(g: Graph, ring: number[][]): Graph {
  const inside = g.vertices.map((v) => insideArea(v.lat, v.lon, ring));
  const used = new Array(g.vertices.length).fill(-1);
  const vertices: Vertex[] = [];
  const edges: Edge[] = [];
  const keep = (i: number) => {
    if (used[i] < 0) {
      used[i] = vertices.length;
      vertices.push(g.vertices[i]);
    }
    return used[i];
  };
  for (const e of g.edges) {
    if (inside[e.u] && inside[e.v]) edges.push({ ...e, u: keep(e.u), v: keep(e.v) });
  }
  return relabel(contract({ vertices, edges }));
}

/**
 * Nombre de dos tramos unidos: si son la misma calle, uno solo; si no, "inicio → fin".
 * Al unir muchos tramos solo se guardan la primera y la última calle, para que no
 * se forme una cadena larguísima ("Carrera 9L → … → Calle 94").
 */
export function joinNames(a?: string, b?: string): string | undefined {
  if (!a) return b;
  if (!b) return a;
  const parts = [...a.split(' → '), ...b.split(' → ')].filter((x) => x !== '…');
  const uniq = parts.filter((x, i) => i === 0 || x !== parts[i - 1]);
  if (uniq.length === 1) return uniq[0];
  if (uniq.length === 2) return `${uniq[0]} → ${uniq[1]}`;
  return uniq[0] === uniq[uniq.length - 1] ? uniq[0] : `${uniq[0]} → … → ${uniq[uniq.length - 1]}`;
}

/**
 * Quita los vértices de grado 2 que no son cruces (donde una calle cambia de way
 * en OSM sin cruzarse con otra): sus dos aristas se unen en una sola.
 */
export function contract(g: Graph): Graph {
  const edges: (Edge | null)[] = g.edges.map((e) => ({ ...e }));
  const inc: Set<number>[] = g.vertices.map(() => new Set());
  edges.forEach((e, i) => {
    inc[e!.u].add(i);
    inc[e!.v].add(i);
  });
  const deg = (x: number) => {
    let d = 0;
    for (const i of inc[x]) d += edges[i]!.u === edges[i]!.v ? 2 : 1;
    return d;
  };
  const alive = g.vertices.map(() => true);

  for (let x = 0; x < g.vertices.length; x++) {
    if (inc[x].size !== 2 || deg(x) !== 2) continue;
    const [ia, ib] = [...inc[x]];
    const a = edges[ia]!;
    const b = edges[ib]!;
    const p = a.u === x ? a.v : a.u;
    const q = b.u === x ? b.v : b.u;
    if (p === x || q === x) continue;
    // solo se unen si los sentidos encajan: las dos de doble vía, o las dos en la misma dirección
    const intoX = a.v === x; // a va de p a x
    const outOfX = b.u === x; // b va de x a q
    if (!!a.oneway !== !!b.oneway) continue;
    if (a.oneway && intoX !== outOfX) continue;
    const ga = a.v === x ? a.geometry : [...a.geometry].reverse();
    const gb = b.u === x ? b.geometry : [...b.geometry].reverse();
    const pq = [...ga, ...gb.slice(1)];
    const reversed = a.oneway && !intoX; // las dos van de q hacia p
    const wayP = a.ways ? (a.u === p ? a.ways[0] : a.ways[1]) : a.osmWayId;
    const wayQ = b.ways ? (b.u === q ? b.ways[0] : b.ways[1]) : b.osmWayId;
    const merged: Edge = {
      ...a,
      ways: wayP !== undefined && wayQ !== undefined ? (reversed ? [wayQ, wayP] : [wayP, wayQ]) : undefined,
      u: reversed ? q : p,
      v: reversed ? p : q,
      length: a.length + b.length,
      geometry: reversed ? pq.reverse() : pq,
      name: joinNames(intoX || !a.oneway ? a.name : b.name, intoX || !a.oneway ? b.name : a.name),
    };
    edges[ia] = merged;
    edges[ib] = null;
    inc[x].clear();
    inc[q].delete(ib);
    inc[q].add(ia);
    alive[x] = false;
  }

  const vertices = g.vertices.filter((_, i) => alive[i]);
  const map: number[] = [];
  let k = 0;
  for (let i = 0; i < alive.length; i++) map[i] = alive[i] ? k++ : -1;
  return {
    vertices,
    edges: edges.filter((e): e is Edge => e !== null).map((e) => ({ ...e, u: map[e.u], v: map[e.v] })),
  };
}
