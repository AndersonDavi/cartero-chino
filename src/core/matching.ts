import blossomLib from './blossom.js';

export type Pair = [number, number];

/**
 * Emparejamiento perfecto de costo mínimo por programación dinámica sobre
 * subconjuntos (máscaras de bits). Exacto, O(2^k · k). Sirve hasta k ≈ 20.
 *
 * dp[mask] = costo mínimo de emparejar los vértices cuyos bits están en mask.
 * Siempre se empareja el primer vértice libre i con algún j libre.
 */
export function bitmaskMatching(k: number, cost: (i: number, j: number) => number): { pairs: Pair[]; cost: number } {
  if (k === 0) return { pairs: [], cost: 0 };
  if (k % 2 === 1) throw new Error('No hay emparejamiento perfecto con un número impar de vértices');
  if (k > 24) throw new Error('Demasiados vértices para máscaras de bits');
  const full = (1 << k) - 1;
  const dp = new Float64Array(1 << k).fill(Infinity);
  const choice = new Int32Array(1 << k).fill(-1);
  dp[0] = 0;
  for (let mask = 0; mask < full; mask++) {
    if (dp[mask] === Infinity) continue;
    let i = 0;
    while (mask & (1 << i)) i++;
    for (let j = i + 1; j < k; j++) {
      if (mask & (1 << j)) continue;
      const next = mask | (1 << i) | (1 << j);
      const c = dp[mask] + cost(i, j);
      if (c < dp[next]) {
        dp[next] = c;
        choice[next] = (i << 8) | j;
      }
    }
  }
  const pairs: Pair[] = [];
  for (let mask = full; mask; ) {
    const i = choice[mask] >> 8;
    const j = choice[mask] & 255;
    pairs.push([i, j]);
    mask &= ~((1 << i) | (1 << j));
  }
  return { pairs, cost: dp[full] };
}

/**
 * Emparejamiento de costo mínimo con el algoritmo Blossom de Edmonds (1965).
 * La librería maximiza peso, así que se usa peso = M − costo y cardinalidad
 * máxima: entre los emparejamientos más grandes, el de mayor peso es el de
 * menor costo. Los costos se pasan a enteros (decímetros) para que las
 * comparaciones internas sean exactas.
 *
 * `edges` puede ser el grafo completo (exacto) o solo vecinos cercanos.
 * Devuelve las parejas y los vértices que quedaron sin pareja.
 */
export function blossomMatching(k: number, edges: [number, number, number][]): { pairs: Pair[]; unmatched: number[] } {
  if (k === 0) return { pairs: [], unmatched: [] };
  const toInt = (c: number) => Math.round(c * 10);
  const M = edges.reduce((m, e) => Math.max(m, toInt(e[2])), 0) + 1;
  const input = edges.map(([i, j, c]) => [i, j, M - toInt(c)]);
  const mate: number[] = input.length ? blossomLib(input, true) : [];
  const pairs: Pair[] = [];
  const unmatched: number[] = [];
  for (let i = 0; i < k; i++) {
    const j = mate[i] ?? -1;
    if (j === -1 || j === undefined) unmatched.push(i);
    else if (i < j) pairs.push([i, j]);
  }
  return { pairs, unmatched };
}

/** Voraz: empareja siempre los dos más cercanos. No es óptimo; sirve de comparación. */
export function greedyMatching(k: number, edges: [number, number, number][]): { pairs: Pair[]; unmatched: number[] } {
  const used = new Uint8Array(k);
  const pairs: Pair[] = [];
  for (const [i, j] of [...edges].sort((a, b) => a[2] - b[2])) {
    if (used[i] || used[j]) continue;
    used[i] = used[j] = 1;
    pairs.push([i, j]);
  }
  const unmatched: number[] = [];
  for (let i = 0; i < k; i++) if (!used[i]) unmatched.push(i);
  return { pairs, unmatched };
}
