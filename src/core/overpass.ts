import { OVERPASS_ENDPOINTS } from './osm';

// Con `npm run dev` se pasa por el proxy de Vite (ver vite.config.ts).
const viaProxy = typeof location !== 'undefined' && import.meta.env?.DEV;
const endpoints = OVERPASS_ENDPOINTS.map((url, i) => ({ url: viaProxy ? `${location.origin}/overpass/${i}` : url, host: new URL(url).host }));

export interface DownloadProgress {
  host: string;
  attempt: number;   // 1, 2, 3...
  of: number;
  phase: 'esperando' | 'recibiendo';
  bytes: number;
  failed: string[];  // servidores que ya fallaron, con el motivo
}

/**
 * Envía la consulta a Overpass y va avisando el progreso. Si un servidor no manda
 * nada en `idleMs` (está en cola o colgado) o responde con error, pasa al siguiente.
 */
export async function fetchOverpass(query: string, onProgress: (p: DownloadProgress) => void = () => {}, idleMs = 45_000): Promise<string> {
  const failed: string[] = [];
  for (const [i, { url, host }] of endpoints.entries()) {
    const base = { host, attempt: i + 1, of: endpoints.length, failed: [...failed] };
    onProgress({ ...base, phase: 'esperando', bytes: 0 });
    const ctrl = new AbortController();
    let timer = setTimeout(() => ctrl.abort(), idleMs);
    const alive = () => {
      clearTimeout(timer);
      timer = setTimeout(() => ctrl.abort(), idleMs);
    };
    try {
      const res = await fetch(url, { method: 'POST', body: new URLSearchParams({ data: query }), signal: ctrl.signal });
      if (!res.ok) throw new Error(res.status === 429 ? 'demasiadas consultas (429)' : res.status === 504 ? 'ocupado (504)' : `error ${res.status}`);
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let text = '';
      let bytes = 0;
      let last = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        alive();
        bytes += value.length;
        text += decoder.decode(value, { stream: true });
        if (performance.now() - last > 200) {
          onProgress({ ...base, phase: 'recibiendo', bytes });
          last = performance.now();
        }
      }
      text += decoder.decode();
      // Overpass a veces responde 200 con el error dentro ("remark": "runtime error...")
      const remark = /"remark":\s*"([^"]*)"/.exec(text.slice(0, 2000) + text.slice(-2000))?.[1];
      if (remark && /error|timed out/i.test(remark)) throw new Error(remark.slice(0, 80));
      return text;
    } catch (e) {
      failed.push(`${host}: ${ctrl.signal.aborted ? `sin respuesta en ${Math.round(idleMs / 1000)} s` : (e as Error).message}`);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`Ningún servidor de Overpass respondió (${failed.join('; ')}). Intenta de nuevo en un rato o usa las calles guardadas.`);
}
