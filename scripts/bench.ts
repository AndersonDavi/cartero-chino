// Mide construcción y solución del cartero chino con datos reales de OSM.
// Uso: npx vite-node scripts/bench.ts <carpeta-cache>
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { solveCPP } from '../src/core/cpp';
import { largestComponent, stats } from '../src/core/graph';
import { buildGraph, defaultBuildOptions, overpassQuery } from '../src/core/osm';
import { fetchOverpass } from '../src/core/overpass';
import zonas from '../src/data/zonas.json';

const cache = process.argv[2] ?? '.cache';
mkdirSync(cache, { recursive: true });

for (const [name, ring] of Object.entries(zonas as Record<string, number[][]>)) {
  const file = join(cache, `${name.split(' ')[0]}.json`);
  if (!existsSync(file)) {
    console.log(`Descargando ${name}…`);
    writeFileSync(file, await fetchOverpass(overpassQuery(ring, defaultBuildOptions), (h) => console.log(`  probando ${h}`)));
  }
  const raw = readFileSync(file, 'utf8');
  let t = performance.now();
  const osm = JSON.parse(raw);
  const built = buildGraph(osm, ring);
  const { graph, dropped } = largestComponent(built);
  const msBuild = performance.now() - t;
  const st = stats(graph);
  console.log(`\n== ${name} (${(raw.length / 1e6).toFixed(1)} MB, ${osm.elements.length} ways)`);
  console.log(`construir: ${msBuild.toFixed(0)} ms | V=${st.vertices} E=${st.edges} impares=${st.odd} bucles=${st.loops} paralelas=${st.parallel} fuera=${dropped.length}`);
  t = performance.now();
  for (const neighbors of [8, 12, 20]) {
    t = performance.now();
    const sol = solveCPP(graph, 0, undefined, { neighbors });
    console.log(
      `K=${neighbors}: ${(performance.now() - t).toFixed(0)} ms (emparejamiento ${sol.ms.matching.toFixed(0)} ms) | ` +
        `Σw=${(sol.baseLength / 1000).toFixed(1)} km, extra=${(sol.extraLength / 1000).toFixed(2)} km ` +
        `(${((100 * sol.extraLength) / sol.baseLength).toFixed(1)} %), pasos=${sol.circuit.length}`,
    );
  }
}
