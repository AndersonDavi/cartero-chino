// Todo lo pesado corre aquí para que el mapa no se congele.
import { nearestVertex, routeAB, routeStops, shortestLeg } from '../core/ab';
import { solveCPP, solveCPPFree } from '../core/cpp';
import { haversine, pointInRing, ringAreaKm2 } from '../core/geo';
import { adjacency, components, directedAdjacency, largestComponent, relabel, stats } from '../core/graph';
import { buildGraph, clipGraph, contract, defaultBuildOptions, fromCompact, overpassQuery, turnsFromCompact, type BuildOptions, type CompactStreets } from '../core/osm';
import { indexTurns, type TurnIndex } from '../core/turns';
import { fetchOverpass, type DownloadProgress } from '../core/overpass';
import type { Adjacency, Graph, LatLon } from '../core/types';
import zonas from '../data/zonas.json';

export type Source = 'auto' | 'overpass';

export type WorkerRequest =
  | { type: 'build'; ring: number[][]; options: BuildOptions; source: Source }
  | { type: 'load'; graph: Graph; edit?: boolean }
  | { type: 'solve'; start: number; freeMove?: boolean }
  | { type: 'route'; points: LatLon[]; vehicle: boolean; roundTrip: boolean; optimize?: boolean; fixEnd?: boolean }
  | { type: 'path'; id: number; from: LatLon; to: LatLon }
  | { type: 'trace'; id: number; from: LatLon | null; to: LatLon; preview: boolean }
  | { type: 'traceGraph'; edges: number[] };

export type WorkerResponse =
  | { type: 'progress'; msg: string; download?: DownloadProgress }
  | { type: 'error'; msg: string }
  | { type: 'graph'; graph: Graph; dropped: Graph['edges']; stats: ReturnType<typeof stats>; origin: string; edit?: boolean }
  | { type: 'solution'; solution: ReturnType<typeof solveCPP>; excluded?: string[]; notice?: string }
  | { type: 'path'; id: number; geometry: LatLon[] | null; length: number }
  | { type: 'trace'; id: number; preview: boolean; point: LatLon; edges: number[]; geometry: LatLon[] }
  | { type: 'route'; graph: Graph; solution: ReturnType<typeof solveCPP>; stats: ReturnType<typeof stats> };

let current: Graph | null = null;
let saved: Promise<{ graph: Graph; fecha: string; turns: TurnIndex }> | null = null;
const post = (m: WorkerResponse) => postMessage(m);
const progress = (msg: string) => post({ type: 'progress', msg });

/** ¿El área cae dentro de Barranquilla o Soledad (donde hay calles guardadas)? */
function covered(ring: number[][]): boolean {
  const cities = Object.values(zonas as Record<string, number[][]>);
  // un punto cuenta si está dentro o a menos de ~150 m del borde: así una ciudad
  // completa (cuyas esquinas están justo sobre su propio borde) cuenta como cubierta
  return ring.every(([lon, lat]) => cities.some((c) => pointInRing(lat, lon, c) || nearRing(lon, lat, c, 0.0014)));
}

function nearRing(x: number, y: number, ring: number[][], tol: number): boolean {
  for (let i = 1; i < ring.length; i++) {
    const [ax, ay] = ring[i - 1];
    const [bx, by] = ring[i];
    const len2 = (bx - ax) ** 2 + (by - ay) ** 2;
    const t = len2 ? Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / len2)) : 0;
    if (Math.hypot(x - (ax + t * (bx - ax)), y - (ay + t * (by - ay))) < tol) return true;
  }
  return false;
}

let city: { adj: Adjacency; directed: Adjacency; allowed: Uint8Array } | null = null;
let cityKeys: Map<string, number> | null = null;

/** Adyacencia de toda la ciudad y su componente principal (para no caer en calles sueltas). */
async function cityIndex(g: Graph) {
  if (!city) {
    const { comp, count } = components(g);
    const size = new Array(count).fill(0);
    comp.forEach((c) => size[c]++);
    const best = size.indexOf(Math.max(...size));
    city = { adj: adjacency(g), directed: directedAdjacency(g), allowed: Uint8Array.from(comp, (c) => (c === best ? 1 : 0)) };
  }
  return city;
}

function loadSaved() {
  saved ??= fetch(new URL(`${import.meta.env.BASE_URL}data/calles-atlantico.json`, location.origin))
    .then((r) => {
      if (!r.ok) throw new Error(`no se pudo abrir el archivo de calles (${r.status})`);
      return r.json() as Promise<CompactStreets>;
    })
    .then((c) => ({ graph: fromCompact(c), fecha: c.fecha, turns: indexTurns(turnsFromCompact(c)) }))
    .catch((e) => {
      saved = null;
      throw e;
    });
  return saved;
}

onmessage = async (ev: MessageEvent<WorkerRequest>) => {
  const req = ev.data;
  try {
    if (req.type === 'build') {
      const sameOptions = (Object.keys(defaultBuildOptions) as (keyof BuildOptions)[]).every((k) => req.options[k] === defaultBuildOptions[k]);
      let graph: Graph;
      let origin: string;
      if (req.source === 'auto' && sameOptions && covered(req.ring)) {
        progress('Abriendo las calles guardadas de Barranquilla y Soledad…');
        const s = await loadSaved();
        progress('Recortando el área…');
        graph = clipGraph(s.graph, req.ring);
        origin = `calles guardadas (OSM, ${s.fecha})`;
      } else {
        const idle = Math.min(180_000, 30_000 + 15_000 * ringAreaKm2(req.ring));
        const raw = await fetchOverpass(overpassQuery(req.ring, req.options), (download) => post({ type: 'progress', msg: 'Descargando calles de OpenStreetMap', download }), idle);
        progress('Armando el grafo…');
        graph = buildGraph(JSON.parse(raw), req.ring);
        origin = 'OpenStreetMap en vivo';
      }
      const { graph: g, dropped } = largestComponent(graph);
      if (g.edges.length === 0) throw new Error('No se encontraron calles en esa área');
      current = g;
      post({ type: 'graph', graph: g, dropped, stats: stats(g), origin });
    } else if (req.type === 'load') {
      current = req.graph;
      post({ type: 'graph', graph: req.graph, dropped: [], stats: stats(req.graph), origin: '', edit: req.edit });
    } else if (req.type === 'route') {
      const ring = (p: LatLon) => [[p[1], p[0]]];
      if (!req.points.every((p) => covered(ring(p)))) throw new Error('Por ahora la ruta de A a B funciona dentro de Barranquilla y Soledad');
      progress('Abriendo las calles guardadas…');
      const s = await loadSaved();
      progress('Buscando el camino más corto (Dijkstra)…');
      const { adj, directed, allowed } = await cityIndex(s.graph);
      if (req.optimize && req.points.length > 3) progress('Buscando el mejor orden de las paradas…');
      const { graph, solution } = routeStops(s.graph, req.vehicle ? directed : adj, req.points, {
        optimize: req.optimize,
        fixEnd: req.fixEnd,
        allowed,
        vehicle: req.vehicle,
        roundTrip: req.roundTrip,
        turns: req.vehicle ? s.turns : undefined,
      });
      current = graph;
      post({ type: 'route', graph, solution, stats: stats(graph) });
    } else if (req.type === 'solve') {
      if (!current) throw new Error('Primero genera el grafo');
      // moverse también por calles de fuera del área (cartero "rural"), si se puede ubicar cada vértice en la ciudad
      let notice: string | undefined;
      if (req.freeMove) {
        const s = await loadSaved();
        const { adj, allowed } = await cityIndex(s.graph);
        const key = (lat: number, lon: number) => `${lat.toFixed(6)},${lon.toFixed(6)}`;
        cityKeys ??= new Map(s.graph.vertices.map((v, i) => [key(v.lat, v.lon), i]));
        const toNet = current.vertices.map((v) => {
          const k = cityKeys!.get(key(v.lat, v.lon));
          if (k !== undefined) return k;
          const n = nearestVertex(s.graph, [v.lat, v.lon], allowed);
          return n.dist < 30 ? n.v : -1;
        });
        if (toNet.every((x) => x >= 0) && new Set(toNet).size === toNet.length) {
          const startV = req.start < current.vertices.length ? req.start : 0;
          post({ type: 'solution', solution: solveCPPFree(current, startV, s.graph, adj, toNet, progress) });
          return;
        }
        notice = 'Algunos puntos no están sobre las calles guardadas: la ruta usa solo las calles del área.';
      }
      const { comp, count } = components(current);
      if (count === 1) {
        post({ type: 'solution', solution: solveCPP(current, req.start, progress), notice });
      } else {
        // si hay pedazos sueltos (por ejemplo un cruce agregado sin unir), se recorre
        // el pedazo más grande y se avisa cuáles quedaron por fuera
        const g = current;
        const size = new Array(count).fill(0);
        g.edges.forEach((e) => (size[comp[e.u]] += e.length));
        const best = size.indexOf(Math.max(...size));
        const vNew = new Int32Array(g.vertices.length).fill(-1);
        const vOld: number[] = [];
        g.vertices.forEach((_, i) => {
          if (comp[i] === best) {
            vNew[i] = vOld.length;
            vOld.push(i);
          }
        });
        const eOld: number[] = [];
        const sub: Graph = { vertices: vOld.map((i) => g.vertices[i]), edges: [] };
        g.edges.forEach((e, i) => {
          if (comp[e.u] !== best) return;
          eOld.push(i);
          sub.edges.push({ ...e, u: vNew[e.u], v: vNew[e.v] });
        });
        const s = solveCPP(sub, vNew[req.start] >= 0 ? vNew[req.start] : 0, progress);
        const V = (i: number) => vOld[i];
        const E = (i: number) => eOld[i];
        post({
          type: 'solution',
          solution: {
            ...s,
            start: V(s.start),
            oddVertices: s.oddVertices.map(V),
            pairs: s.pairs.map((p) => ({ ...p, a: V(p.a), b: V(p.b), path: p.path.map(E) })),
            duplicated: s.duplicated.map(E),
            circuit: s.circuit.map((c) => ({ ...c, edge: E(c.edge), from: V(c.from), to: V(c.to) })),
          },
          excluded: g.vertices.filter((_, i) => comp[i] !== best).map((v) => v.id),
        });
      }
    } else if (req.type === 'trace') {
      // "Trazar calles": el punto se pega al cruce más cercano y se une al anterior por las calles
      const s = await loadSaved();
      const { adj, allowed } = await cityIndex(s.graph);
      const to = nearestVertex(s.graph, req.to, allowed);
      const tv = s.graph.vertices[to.v];
      const point: LatLon = [tv.lat, tv.lon];
      let edges: number[] = [];
      const geometry: LatLon[] = [];
      if (req.from) {
        const from = nearestVertex(s.graph, req.from, allowed);
        const r = from.v === to.v ? null : shortestLeg(s.graph, adj, from.v, to.v, {});
        if (r) {
          edges = r.leg.map((st) => st.edge);
          for (const st of r.leg) {
            const e = s.graph.edges[st.edge];
            const g = st.from === e.u ? e.geometry : [...e.geometry].reverse();
            geometry.push(...(geometry.length ? g.slice(1) : g));
          }
        }
      }
      post({ type: 'trace', id: req.id, preview: req.preview, point, edges, geometry });
    } else if (req.type === 'traceGraph') {
      const s = await loadSaved();
      const keep = [...new Set(req.edges)];
      if (keep.length === 0) throw new Error('Traza al menos un tramo de calle');
      const used = new Map<number, number>();
      const g: Graph = { vertices: [], edges: [] };
      const vid = (v: number) => {
        if (!used.has(v)) {
          used.set(v, g.vertices.length);
          g.vertices.push(s.graph.vertices[v]);
        }
        return used.get(v)!;
      };
      for (const e of keep) {
        const ed = s.graph.edges[e];
        g.edges.push({ ...ed, u: vid(ed.u), v: vid(ed.v) });
      }
      const { graph, dropped } = largestComponent(relabel(contract(g)));
      current = graph;
      post({ type: 'graph', graph, dropped, stats: stats(graph), origin: 'calles trazadas a mano' });
    } else if (req.type === 'path') {
      // camino por calles reales entre dos puntos (para "Unir" en el editor)
      const s = await loadSaved();
      const { adj, allowed } = await cityIndex(s.graph);
      try {
        const { graph } = routeAB(s.graph, adj, req.from, req.to, { allowed });
        const geometry: LatLon[] = [req.from];
        for (const e of graph.edges) geometry.push(...e.geometry);
        geometry.push(req.to);
        const length = graph.edges.reduce((t, e) => t + e.length, 0) + haversine(req.from, geometry[1]) + haversine(geometry[geometry.length - 2], req.to);
        post({ type: 'path', id: req.id, geometry, length });
      } catch {
        post({ type: 'path', id: req.id, geometry: null, length: 0 });
      }
    }
  } catch (e) {
    post({ type: 'error', msg: (e as Error).message });
  }
};
