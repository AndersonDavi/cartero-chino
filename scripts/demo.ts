// Recorta un área de un JSON de Overpass ya descargado y la guarda como demo sin internet.
// Uso: npx vite-node scripts/demo.ts <overpass.json> <salida.json> "<nombre>" lonO latS lonE latN
import { readFileSync, writeFileSync } from 'node:fs';
import { largestComponent, stats } from '../src/core/graph';
import { buildGraph } from '../src/core/osm';

const [input, output, name, ...nums] = process.argv.slice(2);
const [w, s, e, n] = nums.map(Number);
const ring = [[w, s], [e, s], [e, n], [w, n], [w, s]];
const { graph } = largestComponent(buildGraph(JSON.parse(readFileSync(input, 'utf8')), ring));
const round = (x: number) => Math.round(x * 1e6) / 1e6;
graph.vertices.forEach((v) => ((v.lat = round(v.lat)), (v.lon = round(v.lon))));
graph.edges.forEach((ed) => ((ed.length = Math.round(ed.length * 10) / 10), (ed.geometry = ed.geometry.map(([a, b]) => [round(a), round(b)]))));
writeFileSync(output, JSON.stringify({ name, area: ring, graph }));
console.log(name, stats(graph));
