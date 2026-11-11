// Tipos del grafo. Los vértices y aristas se guardan en arreglos y se
// referencian por índice (u, v), que es lo que usan los algoritmos.

export type LatLon = [number, number];

export interface Vertex {
  id: string;        // "v1", "v2", ... (como en el tablero)
  lat: number;
  lon: number;
  osmId?: number;
  name?: string;     // "Calle 72 × Carrera 46"
}

export interface Edge {
  id: string;        // "e1", "e2", ...
  u: number;
  v: number;         // u === v si es bucle
  length: number;    // peso w(e) en metros
  geometry: LatLon[]; // de u a v
  name?: string;
  highway?: string;
  osmWayId?: number;
  oneway?: boolean;  // true: solo se puede ir de u a v (en carro o moto)
  ways?: [number, number]; // vía de OSM del tramo que toca u y del que toca v (para giros prohibidos)
  extra?: boolean;  // calle usada solo para moverse (no estaba entre las que hay que recorrer)
}

export interface Graph {
  vertices: Vertex[];
  edges: Edge[];
}

/** Lista de adyacencia de incidencias: soporta bucles y aristas paralelas. */
export type Adjacency = { edge: number; to: number }[][];

export interface Step {
  edge: number;      // índice en graph.edges
  from: number;
  to: number;
  repeat: boolean;   // true si esa calle ya se había recorrido antes en el circuito
}

export type Matcher = 'ninguno' | 'bitmask' | 'blossom' | 'blossom-vecinos';

export interface Solution {
  kind?: 'cpp' | 'ab';   // cartero chino (por defecto) o camino más corto de A a B
  ab?: {
    from: LatLon;        // puntos que eligió el usuario
    to: LatLon;
    straight: number;    // distancia en línea recta, para comparar
    explored: number;    // vértices que Dijkstra alcanzó antes de llegar a B
    snap: [number, number]; // metros de A y de B a la intersección más cercana
    legs: number[];      // longitud de la ida (y de la vuelta)
    vehicle: boolean;    // true si respetó los sentidos únicos
    turns?: { rules: number; onRoute: LatLon[] }; // giros prohibidos: reglas usadas y cruces con regla en la ruta
    order?: number[];    // orden en que se visitaron las paradas (índices de las que dio el usuario)
    roundTrip?: boolean;
  };
  start: number;
  oddVertices: number[];
  pairs: { a: number; b: number; dist: number; path: number[] }[]; // path = aristas
  duplicated: number[];   // aristas agregadas (con repetición)
  circuit: Step[];
  baseLength: number;     // Σ w(E)
  extraLength: number;    // costo del emparejamiento
  totalLength: number;
  matcher: Matcher;
  exact: boolean;         // false si se usó el emparejamiento sobre vecinos cercanos
  ms: { dijkstra: number; matching: number; euler: number };
  routeGraph?: Graph;     // grafo de la ruta con las calles extra para moverse (si se usaron)
  free?: { pieces: number }; // cartero "rural": cuántos pedazos tenía el área
}

export interface GraphStats {
  vertices: number;
  edges: number;
  degreeSum: number;
  odd: number;
  components: number;
  loops: number;
  parallel: number;
  baseLength: number;
}
