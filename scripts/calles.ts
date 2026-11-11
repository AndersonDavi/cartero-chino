// Junta respuestas de Overpass ya descargadas en un solo grafo de ciudad, para
// recortar áreas sin depender de Overpass. Con --reglas agrega los giros prohibidos.
// Uso: npx vite-node scripts/calles.ts <salida.json> <overpass1.json> [overpass2.json ...] [--reglas restricciones.json]
import { readFileSync, writeFileSync } from 'node:fs';
import { stats } from '../src/core/graph';
import { buildGraph } from '../src/core/osm';
import type { Graph } from '../src/core/types';

const args = process.argv.slice(2);
const r = args.indexOf('--reglas');
const reglas = r >= 0 ? args.splice(r, 2)[1] : null;
const [output, ...inputs] = args;
const ways = new Map<number, unknown>();
for (const f of inputs) for (const el of JSON.parse(readFileSync(f, 'utf8')).elements) ways.set(el.id, el);
const graph = buildGraph({ elements: [...ways.values()] as never });
const r6 = (x: number) => Math.round(x * 1e6) / 1e6;

const restrictions = reglas ? resolve(graph, JSON.parse(readFileSync(reglas, 'utf8')).elements) : [];

const out = {
  fuente: 'OpenStreetMap vía Overpass (ODbL)',
  fecha: new Date().toISOString().slice(0, 10),
  vertices: graph.vertices.map((v) => [r6(v.lat), r6(v.lon), v.name ?? '']),
  // [u, v, longitud, nombre, tipo, geometría plana lat,lon,lat,lon..., sentido único]
  edges: graph.edges.map((e) => [e.u, e.v, Math.round(e.length * 10) / 10, e.name ?? '', e.highway ?? '', e.geometry.flatMap(([a, b]) => [r6(a), r6(b)]), e.oneway ? 1 : 0]),
  restrictions,
};
writeFileSync(output, JSON.stringify(out));
console.log(stats(graph), 'sentido único:', graph.edges.filter((e) => e.oneway).length);

interface Relation {
  type: 'relation';
  id: number;
  tags?: Record<string, string>;
  members: { type: 'way' | 'node'; ref: number; role: string }[];
}

/**
 * Pasa cada relación de OSM (from = vía, via = nodo, to = vía) a índices del grafo:
 * las aristas que tocan el vértice del nodo "via" y vienen de la vía "from" o "to".
 */
function resolve(g: Graph, rels: Relation[]): [number, number, number, number][] {
  const vertexOf = new Map<number, number>();
  g.vertices.forEach((v, i) => v.osmId !== undefined && vertexOf.set(v.osmId, i));
  const incident = new Map<number, number[]>();
  g.edges.forEach((e, i) => {
    for (const x of [e.u, e.v]) {
      if (!incident.has(x)) incident.set(x, []);
      incident.get(x)!.push(i);
    }
  });
  const wayAt = (e: number, x: number) => {
    const ed = g.edges[e];
    return ed.ways ? (ed.u === x ? ed.ways[0] : ed.ways[1]) : ed.osmWayId;
  };
  const out: [number, number, number, number][] = [];
  const skipped: Record<string, number> = {};
  const skip = (why: string) => (skipped[why] = (skipped[why] ?? 0) + 1);
  for (const rel of rels) {
    const kind = rel.tags?.restriction ?? rel.tags?.['restriction:motorcar'];
    if (!kind || !/^(no|only)_/.test(kind)) {
      skip('sin tipo de giro');
      continue;
    }
    const from = rel.members.find((m) => m.role === 'from' && m.type === 'way');
    const to = rel.members.find((m) => m.role === 'to' && m.type === 'way');
    const via = rel.members.filter((m) => m.role === 'via');
    if (!from || !to || via.length !== 1 || via[0].type !== 'node') {
      skip('via es una calle (no soportado)');
      continue;
    }
    const x = vertexOf.get(via[0].ref);
    if (x === undefined) {
      skip('cruce fuera de las calles guardadas');
      continue;
    }
    const inc = incident.get(x) ?? [];
    const froms = inc.filter((e) => wayAt(e, x) === from.ref);
    const tos = inc.filter((e) => wayAt(e, x) === to.ref);
    if (!froms.length || !tos.length) {
      skip('calles no encontradas en el cruce');
      continue;
    }
    for (const f of froms) for (const t of tos) out.push([x, f, t, kind.startsWith('only_') ? 1 : 0]);
  }
  console.log(`giros: ${out.length} reglas en el grafo de ${rels.length} relaciones; omitidas:`, skipped);
  return out;
}
