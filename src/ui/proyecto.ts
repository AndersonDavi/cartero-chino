import type { BuildOptions } from '../core/osm';
import type { Graph, Solution } from '../core/types';

// Formato del archivo JSON del recorrido (el mismo que se guarda en Drive).
export interface Proyecto {
  schema: 'cartero-chino/proyecto@1';
  name: string;
  createdAt: string;
  area: number[][] | null;
  options: BuildOptions;
  start: number;
  graph: Graph;
  solution: Solution | null;
}

export const fileName = (name: string) => `${name.replace(/[^\p{L}\p{N} _-]/gu, '').trim() || 'recorrido'}.json`;

export function makeProject(p: Omit<Proyecto, 'schema' | 'createdAt'>): Proyecto {
  return { schema: 'cartero-chino/proyecto@1', createdAt: new Date().toISOString(), ...p };
}

export function exportProject(p: Omit<Proyecto, 'schema' | 'createdAt'>) {
  const blob = new Blob([JSON.stringify(makeProject(p))], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fileName(p.name);
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function parseProject(text: string): Proyecto {
  const p = JSON.parse(text) as Proyecto;
  if (p.schema !== 'cartero-chino/proyecto@1' || !p.graph?.vertices || !p.graph?.edges) {
    throw new Error('Ese archivo no es un recorrido del cartero chino');
  }
  return p;
}

export async function importProject(file: File): Promise<Proyecto> {
  return parseProject(await file.text());
}
