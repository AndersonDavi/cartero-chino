import katex from 'katex';
import 'katex/dist/katex.min.css';
import { clasificar } from '../core/clasificar';
import type { Graph, GraphStats, Solution } from '../core/types';
import type { Estimate } from './Teoria';
import { EXPLICAR } from './Teoria';

/** Una fórmula en LaTeX, dibujada con KaTeX. */
function TeX({ children, inline }: { children: string; inline?: boolean }) {
  const html = katex.renderToString(children, { throwOnError: false, displayMode: !inline });
  return <span className={inline ? 'tex' : 'tex bloque'} dangerouslySetInnerHTML={{ __html: html }} />;
}

// números en LaTeX con coma decimal, como se escriben en Colombia
// (primero la coma decimal, para no confundirla con la del espacio de miles "\,")
const num = (x: number, d = 0) =>
  x
    .toLocaleString('es-CO', { maximumFractionDigits: d })
    .replace(',', 'DEC')
    .replace(/\./g, '\\,')
    .replace('DEC', '{,}');
const metros = (m: number) => (m < 1000 ? `${num(m)}\\text{ m}` : `${num(m / 1000, 2)}\\text{ km}`);
// en los ejemplos de clase los pesos son números sin unidad
const peso = (g: Graph, w: number) => (g.edges.every((e) => Number.isInteger(e.length) && e.length < 1000) ? num(w) : metros(w));
const lista = (xs: string[], max = 10) => (xs.length > max ? `${xs.slice(0, max).join(', ')}, \\dots` : xs.join(', '));
const id = (s: string) => s.replace(/^([a-z]+)(\d+)$/i, '$1_{$2}');

interface Props {
  graph: Graph;
  stats: GraphStats;
  solution: Solution;
  step: number; // 1..5 en el cartero chino
  estimate: Estimate;
}

/** Explicación de cada paso del cálculo con las fórmulas y los números de este grafo. */
export function Formulas({ graph, stats, solution, step, estimate }: Props) {
  const clase = clasificar(graph, solution);
  const w = (x: number) => peso(graph, x);

  if (solution.kind === 'ab' && solution.ab) {
    const ab = solution.ab;
    const terms = solution.circuit.map((s) => graph.edges[s.edge].length);
    const suma = terms.length > 8 ? `${terms.slice(0, 8).map(w).join(' + ')} + \\dots` : terms.map(w).join(' + ');
    const rod = solution.totalLength / estimate.speed;
    return (
      <div className="formulas">
        <h3>Cómo se calculó el camino</h3>
        <p>1. A y B se pegan a la intersección más cercana (fórmula de haversine):</p>
        <TeX>{`d = 2R\\arcsin\\sqrt{\\sin^2\\tfrac{\\Delta\\varphi}{2} + \\cos\\varphi_1\\cos\\varphi_2\\sin^2\\tfrac{\\Delta\\lambda}{2}}`}</TeX>
        <p>
          A queda a <TeX inline>{metros(ab.snap[0])}</TeX> de <TeX inline>{'v_1'}</TeX> y B a <TeX inline>{metros(ab.snap[1])}</TeX>.
        </p>
        <p>2. Dijkstra fija siempre el vértice más cercano y actualiza a sus vecinos:</p>
        <TeX>{`d(v) \\leftarrow \\min\\big(d(v),\\ d(u) + w(u,v)\\big)`}</TeX>
        <p>
          Exploró <TeX inline>{num(ab.explored)}</TeX> {ab.turns ? 'estados (calle, sentido), por los giros prohibidos' : 'intersecciones'}.
        </p>
        <p>3. La distancia es la suma de las calles del camino:</p>
        <TeX>{`d(A,B) = ${suma} = ${metros(solution.totalLength)}`}</TeX>
        <p>4. Tiempo estimado:</p>
        <TeX>{`t = \\frac{d}{v} + n_c\\,t_c + n_g\\,t_g = ${num(rod / 60, 1)} + ${num(estimate.crossings)}\\cdot ${num(estimate.waitCross)}\\text{ s} + ${num(estimate.turns)}\\cdot ${num(estimate.waitTurn)}\\text{ s}`}</TeX>
        {clase && (
          <p>
            Es un(a) <b>{clase.tipo}</b>: {clase.porque}.
          </p>
        )}
      </div>
    );
  }

  const odd = solution.oddVertices.map((i) => id(graph.vertices[i].id));
  const k = odd.length;
  return (
    <div className="formulas">
      <h3>
        Paso {step} de {EXPLICAR.length}: {EXPLICAR[step - 1]}
      </h3>

      {step === 1 && (
        <>
          <p>El mapa se volvió un grafo: cada cruce es un vértice y cada tramo de calle una arista con su longitud como peso.</p>
          <TeX>{`G = (V, E),\\quad |V| = ${num(stats.vertices)},\\quad |E| = ${num(stats.edges)}`}</TeX>
          <p>Teorema del apretón de manos:</p>
          <TeX>{`\\sum_{v \\in V} \\deg(v) = ${num(stats.degreeSum)} = 2 \\cdot ${num(stats.edges)} = 2|E| \\ \\checkmark`}</TeX>
          <p>Si cada calle se recorriera una sola vez, la ruta mediría:</p>
          <TeX>{`\\sum_{e \\in E} w(e) = ${w(solution.baseLength)}`}</TeX>
        </>
      )}

      {step === 2 && (
        <>
          <p>Vértices de grado impar (en rojo):</p>
          <TeX>{`O = \\{${lista(odd)}\\},\\qquad |O| = ${num(k)}`}</TeX>
          <p>Teorema de Euler:</p>
          <TeX>{`\\exists\\ \\text{circuito de Euler} \\iff G \\text{ conexo y } \\deg(v) \\text{ par } \\forall v`}</TeX>
          <p>
            {k === 0
              ? 'Todos los grados son pares: ya existe un circuito de Euler, no hay que repetir nada.'
              : `Hay ${k} vértices impares, así que no hay circuito de Euler: hay que repetir calles. |O| es par, como asegura el apretón de manos.`}
          </p>
        </>
      )}

      {step === 3 && (
        <>
          <p>Dijkstra da la distancia más corta entre impares:</p>
          <TeX>{`d(v) \\leftarrow \\min\\big(d(v),\\ d(u) + w(u,v)\\big)`}</TeX>
          <p>Se emparejan de dos en dos con la menor suma posible:</p>
          <TeX>{`\\min_{M} \\sum_{\\{u,v\\} \\in M} d(u,v)`}</TeX>
          {solution.pairs.slice(0, 8).map((p, i) => (
            <TeX key={i}>{`d(${id(graph.vertices[p.a].id)}, ${id(graph.vertices[p.b].id)}) = ${w(p.dist)}`}</TeX>
          ))}
          {solution.pairs.length > 8 && <p>… y {solution.pairs.length - 8} parejas más.</p>}
          <p>
            Método: {solution.matcher === 'bitmask' ? 'máscaras de bits' : solution.matcher === 'blossom' ? 'Blossom de Edmonds' : solution.matcher === 'blossom-vecinos' ? 'Blossom con vecinos cercanos (casi óptimo)' : 'no hizo falta'}.
          </p>
          {solution.matcher === 'bitmask' && <TeX>{`dp[S \\cup \\{i,j\\}] = \\min_j \\big(dp[S] + d(i,j)\\big)`}</TeX>}
        </>
      )}

      {step === 4 && (
        <>
          <p>Las calles de cada pareja se duplican (aristas paralelas, en naranja). Lo repetido mide:</p>
          <TeX>{`\\sum_{\\{u,v\\} \\in M} d(u,v) = ${solution.pairs.length && solution.pairs.length <= 6 ? solution.pairs.map((p) => w(p.dist)).join(' + ') + ' = ' : ''}${w(solution.extraLength)}`}</TeX>
          <p>Ahora todos los grados son pares:</p>
          <TeX>{`\\deg'(v) \\equiv 0 \\pmod 2 \\quad \\forall v \\in V`}</TeX>
          <p>Así que el multigrafo sí tiene circuito de Euler.</p>
        </>
      )}

      {step === 5 && (
        <>
          <p>Hierholzer arma el circuito en O(|E|). El total es la cota mínima más lo repetido:</p>
          <TeX>{`L = \\sum w(e) + \\min_M \\sum d(u,v) = ${w(solution.baseLength)} + ${w(solution.extraLength)} = ${w(solution.totalLength)}`}</TeX>
          <p>No puede haber algo más corto: toda ruta pasa por cada calle (≥ Σw) y lo repetido une impares de dos en dos (≥ emparejamiento mínimo).</p>
          {clase && (
            <p>
              Es un <b>{clase.tipo}</b>: {clase.porque}. {clase.euler}
            </p>
          )}
          <TeX>{`t = \\frac{L}{v} + n_c\\,t_c + n_g\\,t_g`}</TeX>
        </>
      )}
    </div>
  );
}
