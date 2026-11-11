import { bearing, pointAlong, polylineLength } from './geo';
import type { Graph, LatLon, Solution } from './types';

export interface RouteStep {
  edge: number;
  from: number;
  to: number;
  repeat: boolean;
  copy: number;          // 0 = primera pasada, 1 = e', 2 = e'', ...
  geometry: LatLon[];    // orientada en el sentido del recorrido
  length: number;
  start: number;         // distancia acumulada al empezar este paso
}

export function buildRoute(g: Graph, sol: Solution): { steps: RouteStep[]; total: number } {
  const times = new Array(g.edges.length).fill(0);
  let acc = 0;
  const steps = sol.circuit.map((s) => {
    const e = g.edges[s.edge];
    const forward = s.from === e.u;
    const geometry = forward ? e.geometry : [...e.geometry].reverse();
    const step: RouteStep = { ...s, copy: times[s.edge]++, geometry, length: e.length, start: acc };
    acc += e.length;
    return step;
  });
  return { steps, total: acc };
}

/** Índice del paso que contiene la distancia d (búsqueda binaria). */
export function stepAt(steps: RouteStep[], d: number): number {
  let lo = 0;
  let hi = steps.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (steps[mid].start <= d) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export function positionAt(steps: RouteStep[], d: number): { i: number; offset: number; p: LatLon; heading: number } {
  const i = stepAt(steps, d);
  const s = steps[i];
  const offset = Math.min(s.length, Math.max(0, d - s.start));
  // la geometría de los ejemplos no mide lo mismo que el peso: se escala
  const geoLen = geometryLength(s.geometry);
  const { p, heading } = pointAlong(s.geometry, s.length > 0 ? (offset / s.length) * geoLen : 0);
  return { i, offset, p, heading };
}

const lenCache = new WeakMap<LatLon[], number>();
export function geometryLength(pts: LatLon[]): number {
  let l = lenCache.get(pts);
  if (l === undefined) {
    l = polylineLength(pts);
    lenCache.set(pts, l);
  }
  return l;
}

export type Turn = 'recto' | 'derecha' | 'izquierda' | 'leve-derecha' | 'leve-izquierda' | 'vuelta' | 'fin';

/** Maniobra al terminar el paso i (como las instrucciones de Waze). */
export function turnAfter(steps: RouteStep[], i: number): Turn {
  const a = steps[i];
  const b = steps[i + 1];
  if (!b) return 'fin';
  const n = a.geometry.length;
  const h1 = bearing(a.geometry[n - 2], a.geometry[n - 1]);
  const h2 = bearing(b.geometry[0], b.geometry[1]);
  const delta = ((h2 - h1 + 540) % 360) - 180;
  if (Math.abs(delta) >= 150) return 'vuelta';
  if (Math.abs(delta) < 20) return 'recto';
  if (Math.abs(delta) < 50) return delta > 0 ? 'leve-derecha' : 'leve-izquierda';
  return delta > 0 ? 'derecha' : 'izquierda';
}

export const TURN_TEXT: Record<Turn, string> = {
  recto: 'Sigue derecho',
  derecha: 'Gira a la derecha',
  izquierda: 'Gira a la izquierda',
  'leve-derecha': 'Mantente a la derecha',
  'leve-izquierda': 'Mantente a la izquierda',
  vuelta: 'Da la vuelta en U',
  fin: 'Llegas al punto de partida',
};

export const prime = (n: number) => "'".repeat(n);

/**
 * Agrupa los pasos en indicaciones, como un navegador: tramos seguidos "derecho"
 * son una sola indicación, que termina donde hay que girar.
 */
export interface Guide {
  boundaries: number[];   // pasos donde termina una indicación
  starts: number[];       // distancia a la que empieza cada indicación
  firstVisits: number[];  // índice del paso en que cada calle se recorre por primera vez (ordenado)
}

export function buildGuide(steps: RouteStep[]): Guide {
  const boundaries: number[] = [];
  const firstVisits: number[] = [];
  steps.forEach((s, j) => {
    if (turnAfter(steps, j) !== 'recto') boundaries.push(j);
    if (!s.repeat) firstVisits.push(j);
  });
  const starts = [0, ...boundaries.filter((j) => j + 1 < steps.length).map((j) => steps[j + 1].start)];
  return { boundaries, starts, firstVisits };
}

export function instruction(steps: RouteStep[], guide: Guide, i: number): { turn: Turn; end: number; nextEdge?: number } {
  const b = guide.boundaries;
  let lo = 0;
  let hi = b.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (b[mid] < i) lo = mid + 1;
    else hi = mid;
  }
  const j = lo < b.length ? b[lo] : steps.length - 1;
  return { turn: turnAfter(steps, j), end: steps[j].start + steps[j].length, nextEdge: steps[j + 1]?.edge };
}

/** Cuántos elementos de un arreglo ordenado son menores que x. */
export function countBelow(sorted: number[], x: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
