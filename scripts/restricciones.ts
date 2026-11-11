// Descarga las reglas de giro (relaciones type=restriction) de OSM para un recuadro.
// Uso: npx vite-node scripts/restricciones.ts <salida.json> sur oeste norte este
import { writeFileSync } from 'node:fs';
import { OVERPASS_ENDPOINTS } from '../src/core/osm';

const [output, s, w, n, e] = process.argv.slice(2);
const query = `[out:json][timeout:120];rel["type"="restriction"](${s},${w},${n},${e});out body;`;
for (const url of OVERPASS_ENDPOINTS) {
  try {
    console.log('probando', new URL(url).host);
    const res = await fetch(url, {
      method: 'POST',
      body: new URLSearchParams({ data: query }),
      headers: { 'User-Agent': 'cartero-chino-proyecto-universidad/0.1' },
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) throw new Error(String(res.status));
    const text = await res.text();
    writeFileSync(output, text);
    console.log('reglas:', JSON.parse(text).elements.length);
    process.exit(0);
  } catch (err) {
    console.log('  falló:', (err as Error).message);
  }
}
process.exit(1);
