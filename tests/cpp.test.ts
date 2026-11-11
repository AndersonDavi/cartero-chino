import { describe, expect, it } from 'vitest';
import { solveCPP } from '../src/core/cpp';
import { fleury, hierholzer } from '../src/core/euler';
import { adjacency, degrees, stats } from '../src/core/graph';
import { bitmaskMatching, blossomMatching } from '../src/core/matching';
import { contract } from '../src/core/osm';
import type { Graph, Step } from '../src/core/types';
import { EJEMPLOS } from '../src/data/ejemplos';

const ejemplo = (name: string) => EJEMPLOS.find((e) => e.name.startsWith(name))!.graph;

/** El circuito es cerrado, consecutivo y usa cada arista 1 + (veces duplicada) veces. */
function checkCircuit(g: Graph, steps: Step[], start: number, duplicated: number[] = []) {
  expect(steps[0].from).toBe(start);
  expect(steps.at(-1)!.to).toBe(start);
  for (let i = 1; i < steps.length; i++) expect(steps[i].from).toBe(steps[i - 1].to);
  for (const s of steps) {
    const { u, v } = g.edges[s.edge];
    expect([u, v].sort()).toEqual([s.from, s.to].sort());
  }
  const count = new Array(g.edges.length).fill(1);
  duplicated.forEach((e) => count[e]++);
  const used = new Array(g.edges.length).fill(0);
  steps.forEach((s) => used[s.edge]++);
  expect(used).toEqual(count);
}

function randomGraph(n: number, extra: number, seed: number): Graph {
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const vertices = Array.from({ length: n }, (_, i) => ({ id: `v${i + 1}`, lat: rnd(), lon: rnd() }));
  const edges: Graph['edges'] = [];
  const add = (u: number, v: number) =>
    edges.push({ id: `e${edges.length + 1}`, u, v, length: 1 + Math.floor(rnd() * 100), geometry: [] });
  for (let i = 1; i < n; i++) add(i, Math.floor(rnd() * i)); // árbol: asegura que sea conexo
  for (let i = 0; i < extra; i++) add(Math.floor(rnd() * n), Math.floor(rnd() * n)); // puede haber bucles y paralelas
  return { vertices, edges };
}

describe('teoría de clase', () => {
  it('apretón de manos: la suma de grados es 2|E| y los impares vienen en parejas', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const g = randomGraph(12, 15, seed);
      const st = stats(g);
      expect(st.degreeSum).toBe(2 * st.edges);
      expect(st.odd % 2).toBe(0);
    }
  });

  it('el bucle cuenta 2 en el grado', () => {
    const g: Graph = {
      vertices: [{ id: 'v1', lat: 0, lon: 0 }],
      edges: [{ id: 'e1', u: 0, v: 0, length: 5, geometry: [] }],
    };
    expect(degrees(g)).toEqual([2]);
    expect(solveCPP(g).totalLength).toBe(5);
  });

  it('corbatín: ya es euleriano, no repite nada', () => {
    const g = ejemplo('Corbatín');
    const sol = solveCPP(g);
    expect(sol.oddVertices).toEqual([]);
    expect(sol.totalLength).toBe(sol.baseLength);
    expect(sol.circuit.some((s) => s.repeat)).toBe(false);
  });

  it('tablero 29 oct: duplica e4 y e3 (no e1) y da 22', () => {
    const g = ejemplo('Tablero');
    const sol = solveCPP(g, 1); // empezando en v2
    expect(sol.oddVertices.map((i) => g.vertices[i].id).sort()).toEqual(['v2', 'v3']);
    expect(sol.duplicated.map((e) => g.edges[e].id).sort()).toEqual(['e3', 'e4']);
    expect(sol.baseLength).toBe(17);
    expect(sol.totalLength).toBe(22);
    checkCircuit(g, sol.circuit, 1, sol.duplicated);
  });

  it('Königsberg: 4 impares, se emparejan de la forma más barata', () => {
    const g = ejemplo('Puentes');
    const sol = solveCPP(g);
    expect(sol.oddVertices.length).toBe(4);
    // A-B (100) + C-D (150) = 250 es lo más barato entre las 3 formas de emparejar
    expect(sol.extraLength).toBe(250);
    checkCircuit(g, sol.circuit, 0, sol.duplicated);
  });
});

describe('algoritmos', () => {
  it('Blossom da el mismo costo que las máscaras de bits', () => {
    let s = 7;
    const rnd = () => ((s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    for (let t = 0; t < 200; t++) {
      const k = 2 * (1 + Math.floor(rnd() * 7));
      const d = Array.from({ length: k }, () => new Array(k).fill(0));
      for (let i = 0; i < k; i++) for (let j = i + 1; j < k; j++) d[i][j] = d[j][i] = Math.round(rnd() * 1000) / 10;
      const exact = bitmaskMatching(k, (i, j) => d[i][j]).cost;
      const edges: [number, number, number][] = [];
      for (let i = 0; i < k; i++) for (let j = i + 1; j < k; j++) edges.push([i, j, d[i][j]]);
      const { pairs, unmatched } = blossomMatching(k, edges);
      expect(unmatched).toEqual([]);
      expect(pairs.reduce((c, [i, j]) => c + d[i][j], 0)).toBeCloseTo(exact, 6);
    }
  });

  it('el circuito es válido en grafos al azar (con bucles y paralelas)', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const g = randomGraph(10 + (seed % 15), 12 + seed, seed);
      const sol = solveCPP(g);
      checkCircuit(g, sol.circuit, 0, sol.duplicated);
      const len = sol.circuit.reduce((c, st) => c + g.edges[st.edge].length, 0);
      expect(len).toBeCloseTo(sol.totalLength, 6);
    }
  });

  it('Fleury y Hierholzer recorren lo mismo', () => {
    const g = ejemplo('Corbatín');
    checkCircuit(g, hierholzer(g, 0), 0);
    checkCircuit(g, fleury(g, 0), 0);
    const t = ejemplo('Tablero');
    const dup = solveCPP(t).duplicated;
    checkCircuit(t, fleury(t, 0, dup), 0, dup);
  });

  it('un grafo no conexo se rechaza', () => {
    const g: Graph = {
      vertices: [0, 1, 2, 3].map((i) => ({ id: `v${i + 1}`, lat: 0, lon: 0 })),
      edges: [
        { id: 'e1', u: 0, v: 1, length: 1, geometry: [] },
        { id: 'e2', u: 2, v: 3, length: 1, geometry: [] },
      ],
    };
    expect(() => solveCPP(g)).toThrow(/no es conexo/);
  });

  it('contraer: un vértice de grado 2 que no es cruce desaparece', () => {
    const g: Graph = {
      vertices: [0, 1, 2].map((i) => ({ id: `v${i + 1}`, lat: 0, lon: i })),
      edges: [
        { id: 'e1', u: 0, v: 1, length: 3, geometry: [[0, 0], [0, 1]], name: 'Calle 72' },
        { id: 'e2', u: 2, v: 1, length: 4, geometry: [[0, 2], [0, 1]], name: 'Calle 72' },
      ],
    };
    const c = contract(g);
    expect(c.vertices.length).toBe(2);
    expect(c.edges).toHaveLength(1);
    expect(c.edges[0].length).toBe(7);
    expect(c.edges[0].geometry).toEqual([[0, 0], [0, 1], [0, 2]]);
  });
});

describe('ruta de A a B', () => {
  it('tablero 29 oct: de v4 a v1 va por v3 (2 + 3 = 5) y no por v2 (4 + 2 = 6)', async () => {
    const { routeAB } = await import('../src/core/ab');
    const { adjacency } = await import('../src/core/graph');
    const g = ejemplo('Tablero');
    const at = (id: string): [number, number] => {
      const v = g.vertices.find((x) => x.id === id)!;
      return [v.lat, v.lon];
    };
    const { graph, solution } = routeAB(g, adjacency(g), at('v4'), at('v1'));
    expect(solution.totalLength).toBe(5);
    expect(graph.edges.map((e) => e.name ?? e.length)).toEqual([2, 3]);
    expect(graph.vertices.map((v) => v.lat)).toEqual([at('v4')[0], at('v3')[0], at('v1')[0]]);
    expect(solution.circuit.map((s) => [s.from, s.to])).toEqual([[0, 1], [1, 2]]);
  });

  it('ida y vuelta repite la misma trayectoria al revés', async () => {
    const { routeAB } = await import('../src/core/ab');
    const { adjacency } = await import('../src/core/graph');
    const g = ejemplo('Tablero');
    const p = (id: string): [number, number] => [g.vertices.find((x) => x.id === id)!.lat, g.vertices.find((x) => x.id === id)!.lon];
    const { solution } = routeAB(g, adjacency(g), p('v4'), p('v1'), { roundTrip: true });
    expect(solution.totalLength).toBe(10);
    expect(solution.circuit.map((s) => s.repeat)).toEqual([false, false, true, true]);
    expect(solution.circuit.at(-1)!.to).toBe(0);
  });

  it('en carro no toma una calle de sentido único al revés', async () => {
    const { routeAB } = await import('../src/core/ab');
    const { directedAdjacency } = await import('../src/core/graph');
    const g = ejemplo('Tablero');
    // e3 (v3–v1) solo se puede tomar de v1 a v3: de v4 a v1 ya no sirve ir por v3
    const e3 = g.edges.find((e) => e.id === 'e3')!;
    const conSentido = { ...g, edges: g.edges.map((e) => (e === e3 ? { ...e, u: e3.v, v: e3.u, oneway: true } : e)) };
    const p = (id: string): [number, number] => [g.vertices.find((x) => x.id === id)!.lat, g.vertices.find((x) => x.id === id)!.lon];
    const { solution } = routeAB(conSentido, directedAdjacency(conSentido), p('v4'), p('v1'), { vehicle: true });
    expect(solution.totalLength).toBe(6); // por v2: 4 + 2
  });
});

describe('giros prohibidos', () => {
  it('si en v3 no se puede girar de e2 a e3, de v4 a v1 va por v2', async () => {
    const { routeAB } = await import('../src/core/ab');
    const { directedAdjacency } = await import('../src/core/graph');
    const { indexTurns } = await import('../src/core/turns');
    const g = ejemplo('Tablero');
    const idx = (id: string) => g.edges.findIndex((e) => e.id === id);
    const v = (id: string) => g.vertices.findIndex((x) => x.id === id);
    const p = (id: string): [number, number] => [g.vertices[v(id)].lat, g.vertices[v(id)].lon];
    const turns = indexTurns([{ via: v('v3'), from: idx('e2'), to: idx('e3'), only: false }]);
    const sin = routeAB(g, directedAdjacency(g), p('v4'), p('v1'), { vehicle: true });
    const con = routeAB(g, directedAdjacency(g), p('v4'), p('v1'), { vehicle: true, turns });
    expect(sin.solution.totalLength).toBe(5); // e2 + e3
    expect(con.solution.totalLength).toBe(6); // e5 + e4
  });

  it('un giro "solo" obliga a salir por esa calle', async () => {
    const { routeAB } = await import('../src/core/ab');
    const { directedAdjacency } = await import('../src/core/graph');
    const { indexTurns } = await import('../src/core/turns');
    const g = ejemplo('Tablero');
    const idx = (id: string) => g.edges.findIndex((e) => e.id === id);
    const v = (id: string) => g.vertices.findIndex((x) => x.id === id);
    const p = (id: string): [number, number] => [g.vertices[v(id)].lat, g.vertices[v(id)].lon];
    // llegando a v3 por e2 solo se puede seguir por e1 (hacia v2)
    const turns = indexTurns([{ via: v('v3'), from: idx('e2'), to: idx('e1'), only: true }]);
    const con = routeAB(g, directedAdjacency(g), p('v4'), p('v1'), { vehicle: true, turns });
    expect(con.solution.totalLength).toBe(6); // e5 + e4 sigue siendo lo mejor permitido
    expect(con.graph.edges.map((e) => e.length)).toEqual([4, 2]);
  });
});

describe('editor del grafo', () => {
  const base = (): Graph => ({
    vertices: [
      { id: 'v1', lat: 0, lon: 0 },
      { id: 'v2', lat: 0, lon: 0.001 },
      { id: 'v3', lat: 0.001, lon: 0 },
    ],
    edges: [
      { id: 'e1', u: 0, v: 1, length: 111, geometry: [[0, 0], [0, 0.001]] },
      { id: 'e2', u: 0, v: 2, length: 111, geometry: [[0, 0], [0.001, 0]] },
    ],
  });

  it('partir una calle crea un cruce de grado 2 y conserva la longitud', async () => {
    const { applyEdit } = await import('../src/core/editar');
    const g = applyEdit(base(), { type: 'add', p: [0.0002, 0.0005], edge: 0 });
    expect(g.vertices).toHaveLength(4);
    expect(g.edges).toHaveLength(3);
    expect(degrees(g)[3]).toBe(2);
    const total = g.edges.filter((e) => e.u === 3 || e.v === 3).reduce((s, e) => s + e.length, 0);
    expect(total).toBeCloseTo(111.2, 0);
  });

  it('unir, borrar y mover mantienen el apretón de manos', async () => {
    const { applyEdit } = await import('../src/core/editar');
    let g = applyEdit(base(), { type: 'connect', a: 1, b: 2 });
    expect(stats(g).degreeSum).toBe(2 * g.edges.length);
    expect(solveCPP(g).oddVertices).toEqual([]); // triángulo: ya es euleriano
    g = applyEdit(g, { type: 'move', v: 2, p: [0.002, 0] });
    expect(g.edges.find((e) => e.id === 'e2')!.length).toBeCloseTo(222, -1);
    g = applyEdit(g, { type: 'removeVertex', v: 0 });
    expect(g.vertices.map((v) => v.id)).toEqual(['v2', 'v3']);
    expect(g.edges).toHaveLength(1);
    expect([g.edges[0].u, g.edges[0].v]).toEqual([0, 1]);
  });

  it('borrar un área quita los vértices de adentro y sus calles', async () => {
    const { applyEdit } = await import('../src/core/editar');
    // recuadro alrededor de v2 (lat 0, lon 0.001); v1 y v3 quedan afuera
    const ring = [[0.0008, -0.0002], [0.0012, -0.0002], [0.0012, 0.0002], [0.0008, 0.0002], [0.0008, -0.0002]];
    const g = applyEdit(base(), { type: 'removeArea', ring });
    expect(g.vertices.map((v) => v.id)).toEqual(['v1', 'v3']);
    expect(g.edges.map((e) => e.id)).toEqual(['e2']);
    expect([g.edges[0].u, g.edges[0].v]).toEqual([0, 1]);
  });
});

describe('varias paradas', () => {
  it('ordena las paradas intermedias para el recorrido más corto (TSP)', async () => {
    const { bestOrder } = await import('../src/core/ab');
    // puntos en una recta: 0, 3, 1, 2, 4 → lo mejor es visitarlos en orden de posición
    const x = [0, 30, 10, 20, 40];
    const d = (i: number, j: number) => Math.abs(x[i] - x[j]);
    expect(bestOrder(5, d, false)).toEqual([0, 2, 3, 1, 4]);
    // con 10 intermedias usa vecino más cercano + 2-opt y también lo encuentra
    const y = [0, 50, 10, 90, 30, 70, 20, 60, 40, 80, 100, 110];
    const dy = (i: number, j: number) => Math.abs(y[i] - y[j]);
    const o = bestOrder(12, dy, false);
    expect(o.map((i) => y[i])).toEqual([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110]);
  });

  it('una ruta con parada intermedia suma los tramos', async () => {
    const { routeStops } = await import('../src/core/ab');
    const { adjacency } = await import('../src/core/graph');
    const g = ejemplo('Tablero');
    const p = (id: string): [number, number] => [g.vertices.find((x) => x.id === id)!.lat, g.vertices.find((x) => x.id === id)!.lon];
    // v4 → v2 → v1: 4 (e5) + 2 (e4)
    const { solution } = routeStops(g, adjacency(g), [p('v4'), p('v2'), p('v1')]);
    expect(solution.ab!.legs).toEqual([4, 2]);
    expect(solution.totalLength).toBe(6);
  });
});

describe('moverse por fuera del área (cartero rural)', () => {
  it('para volver usa una calle de fuera si es más corta', async () => {
    const { solveCPPFree } = await import('../src/core/cpp');
    const net = ejemplo('Tablero');
    const vi = (id: string) => net.vertices.findIndex((x) => x.id === id);
    const ed = (id: string) => net.edges.find((e) => e.id === id)!;
    // calles requeridas: v3 –e1– v2 –e4– v1 (una "L"); v1 y v3 quedan con grado 1
    const g: Graph = {
      vertices: [net.vertices[vi('v3')], net.vertices[vi('v2')], net.vertices[vi('v1')]],
      edges: [
        { ...ed('e1'), u: 1, v: 0 },
        { ...ed('e4'), u: 1, v: 2 },
      ],
    };
    const toNet = [vi('v3'), vi('v2'), vi('v1')];
    const sol = solveCPPFree(g, 0, net, adjacency(net), toNet);
    // solo con el área: 8 de ida + 8 de vuelta = 16; por fuera vuelve por e3 (3): 8 + 3 = 11
    expect(solveCPP(g).totalLength).toBe(16);
    expect(sol.totalLength).toBe(11);
    const extra = sol.routeGraph!.edges.filter((e) => e.extra);
    expect(extra.map((e) => e.length)).toEqual([3]);
    checkCircuit(sol.routeGraph!, sol.circuit, 0, sol.duplicated);
  });

  it('une pedazos sueltos por el camino más corto', async () => {
    const { solveCPPFree } = await import('../src/core/cpp');
    const net = ejemplo('Tablero');
    const vi = (id: string) => net.vertices.findIndex((x) => x.id === id);
    const ed = (id: string) => net.edges.find((e) => e.id === id)!;
    // dos calles sueltas: e4 (v2–v1) y e2 (v3–v4)
    const g: Graph = {
      vertices: [net.vertices[vi('v1')], net.vertices[vi('v2')], net.vertices[vi('v3')], net.vertices[vi('v4')]],
      edges: [
        { ...ed('e4'), u: 1, v: 0 },
        { ...ed('e2'), u: 2, v: 3 },
      ],
    };
    const sol = solveCPPFree(g, 0, net, adjacency(net), [vi('v1'), vi('v2'), vi('v3'), vi('v4')]);
    checkCircuit(sol.routeGraph!, sol.circuit, 0, sol.duplicated);
    expect(sol.free!.pieces).toBe(2);
    // recorre e4 y e2 y vuelve: lo mínimo es v1-v2(2) v2-v4(4) v4-v3(2) v3-v1(3) = 11
    expect(sol.totalLength).toBe(11);
  });
});

describe('orden de paradas con final libre', () => {
  it('si el destino no es fijo, termina donde conviene', async () => {
    const { bestOrder } = await import('../src/core/ab');
    // A en 0; paradas en 50, 10 y 20 (la "última" que dio el usuario está en 20)
    const x = [0, 50, 10, 20];
    const d = (i: number, j: number) => Math.abs(x[i] - x[j]);
    expect(bestOrder(4, d, false, true)).toEqual([0, 2, 1, 3]); // terminar en 20: 0→10→50→20 = 80
    expect(bestOrder(4, d, false, false)).toEqual([0, 2, 3, 1]); // libre: 0→10→20→50 = 50
  });
});

describe('nombres de calles unidas', () => {
  it('no encadena nombres sin fin', async () => {
    const { joinNames } = await import('../src/core/osm');
    expect(joinNames('Calle 72', 'Calle 72')).toBe('Calle 72');
    expect(joinNames('Carrera 9L', 'Calle 94')).toBe('Carrera 9L → Calle 94');
    let n = 'Carrera 9L';
    for (const x of ['Carrera 9J', 'Diagonal 64B', 'Calle 64B', 'Calle 94']) n = joinNames(n, x)!;
    expect(n).toBe('Carrera 9L → … → Calle 94');
  });
});
