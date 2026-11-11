import { clasificar } from '../core/clasificar';
import type { Graph, GraphStats, Solution } from '../core/types';
import { fmt, fmtSpeed, type Unit } from './format';

export const EXPLICAR = ['Grafo', 'Vértices impares', 'Emparejamiento', 'Aristas duplicadas', 'Circuito de Euler'];

const METODO: Record<Solution['matcher'], string> = {
  ninguno: 'no hizo falta (no hay impares)',
  bitmask: 'programación dinámica con máscaras de bits (exacto)',
  blossom: 'Blossom de Edmonds sobre todos los pares (exacto)',
  'blossom-vecinos': 'Blossom de Edmonds con los impares más cercanos (casi óptimo)',
};

interface Props {
  graph: Graph;
  stats: GraphStats;
  solution: Solution | null;
  explain: number;
  unit: Unit;
  estimate: Estimate;
}

/** Datos para estimar el tiempo: rodando a una velocidad, más esperas en cruces y giros. */
export interface Estimate {
  speed: number;     // m/s en movimiento
  waitCross: number; // s por cruce
  waitTurn: number;  // s por giro
  crossings: number;
  turns: number;
}

export function Teoria({ graph, stats, solution, explain, unit, estimate: est }: Props) {
  const n = (x: number) => x.toLocaleString('es-CO');
  const ms = (x: number) => (x < 1000 ? `${Math.round(x)} ms` : `${(x / 1000).toLocaleString('es-CO', { maximumFractionDigits: 1 })} s`);
  const k = stats.odd;
  const showOnly = (step: number) => explain === 0 || explain === step;
  const clase = solution ? clasificar(graph, solution) : null;
  const rodando = solution ? solution.totalLength / est.speed : 0;
  const cruces = est.crossings * est.waitCross;
  const giros = est.turns * est.waitTurn;
  const tiempo = solution && (
    <>
      <dt>Tiempo estimado</dt>
      <dd>
        <b>{horas((rodando + cruces + giros) / 3600)}</b> = {horas(rodando / 3600)} rodando a {fmtSpeed(est.speed, unit)}
        {cruces > 0 && (
          <>
            {' '}
            + {horas(cruces / 3600)} en {n(est.crossings)} cruces ({est.waitCross} s c/u)
          </>
        )}
        {giros > 0 && (
          <>
            {' '}
            + {horas(giros / 3600)} en {n(est.turns)} giros ({est.waitTurn} s c/u)
          </>
        )}
      </dd>
    </>
  );
  const totalTime = horas((rodando + cruces + giros) / 3600);
  const tipo = clase && (
    <>
      <dt>¿Qué es?</dt>
      <dd>
        <b>{cap(clase.tipo)}</b>: {clase.porque}.
      </dd>
      {clase.euler && (
        <dd className="full">
          {clase.euler}
          {solution?.kind === 'ab' ? ' (Ojo: aquí el grafo son solo las calles de la ruta, no toda la ciudad.)' : ''}
        </dd>
      )}
    </>
  );

  if (solution?.kind === 'ab' && solution.ab) {
    const ab = solution.ab;
    return (
      <div className="teoria">
        <Resumen
          items={[
            ['Recorrido', fmt(solution.totalLength), `${tramos(ab).map(([d]) => d).join(' → ')} → ${tramos(ab).at(-1)![1]} · ${ab.vehicle ? 'carro o moto' : 'a pie'}`],
            ['Línea recta', fmt(ab.straight), `${(solution.totalLength / ab.straight).toLocaleString('es-CO', { maximumFractionDigits: 2 })} veces más por calles`],
            ['Tiempo estimado', totalTime, `a ${fmtSpeed(est.speed, unit)} + esperas`],
            ['Tipo', clase ? cap(clase.tipo) : '—', 'según las definiciones de clase'],
          ]}
        />
        <details className="detalle">
          <summary>Detalle</summary>
        <dl>
          <dt>Recorrido</dt>
          <dd>
            <b>{fmt(solution.totalLength)}</b>
{' '}
            {ab.vehicle ? '(carro o moto, respetando sentidos)' : '(a pie)'}
          </dd>
          {ab.legs.length > 1 && (
            <>
              <dt>Tramos</dt>
              <dd>
                {tramos(ab).map(([de, a, d], i) => (
                  <span key={i} className="tramo">
                    {de} → {a}: {fmt(d)}
                  </span>
                ))}
              </dd>
            </>
          )}
          <dt>Línea recta</dt>
          <dd>
            {fmt(ab.straight)}{ab.legs.length > 1 ? ' (sumando cada tramo)' : ''} · por calles es {(solution.totalLength / ab.straight).toLocaleString('es-CO', { maximumFractionDigits: 2 })} veces más
          </dd>
          {tipo}
          <dt>Grafo de la ruta</dt>
          <dd>
            {n(stats.vertices)} vértices y {n(stats.edges)} aristas (v1 = A)
          </dd>
          {tiempo}
          {ab.turns && (
            <>
              <dt>Giros prohibidos</dt>
              <dd>
                Respeta {n(ab.turns.rules)} reglas de giro de OSM; la ruta pasa por {n(ab.turns.onRoute.length)} cruce(s) con reglas (en amarillo en el mapa)
              </dd>
            </>
          )}
          <dt>Dijkstra exploró</dt>
          <dd>
            {n(ab.explored)} {ab.turns ? 'estados (calle, sentido)' : 'intersecciones'}
          </dd>
          <dt>Ajuste</dt>
          <dd>
            A queda a {fmt(ab.snap[0])} y B a {fmt(ab.snap[1])} de la intersección más cercana
          </dd>
          <dt>Tiempo de cálculo</dt>
          <dd>{ms(solution.ms.dijkstra)}</dd>
        </dl>
        </details>
        <details className="porque">
          <summary>¿Cómo se calculó y por qué es el más corto?</summary>
          <ol>
            <li>Se busca la intersección más cercana a A y a B (distancia de haversine).</li>
            <li>
              <b>Dijkstra</b> parte de A con distancia 0 y las demás en ∞. En cada paso fija el vértice no fijado más cercano y actualiza a sus vecinos:{' '}
              <code>d(v) = min(d(v), d(u) + w(u,v))</code>.
            </li>
            <li>
              ¿Por qué es el mínimo? Todas las calles miden más de 0. Cuando se fija un vértice, cualquier otro camino hacia él tendría que pasar por un vértice
              aún no fijado, que ya está igual o más lejos, así que no puede salir más corto. Al fijar B, d(B) es la distancia mínima.
            </li>
            {ab.vehicle && <li>En carro o moto, una calle de sentido único es un arco: solo se puede tomar en su dirección (grafo mixto).</li>}
            {ab.turns && (
              <li>
                <b>Giros prohibidos.</b> Saber dónde estoy no basta: importa por qué calle llegué. Por eso Dijkstra trabaja sobre el <b>grafo de aristas</b>: cada
                estado es "voy por la calle e en este sentido" y se pasa a otra calle solo si el giro está permitido. Si la regla dice "no girar a la
                izquierda", esa transición simplemente no existe.
              </li>
            )}
            {ab.legs.length > 1 && <li>Con ida y vuelta se hacen dos Dijkstra (A→B y B→A); cada uno es mínimo, así que la suma también.</li>}
          </ol>
        </details>
      </div>
    );
  }

  return (
    <div className="teoria">
      {solution && explain === 0 && (
        <Resumen
          items={[
            ['Recorrido total', fmt(solution.totalLength), `${n(solution.circuit.length)} pasos`],
            [
              solution.free ? 'Para moverse' : 'Se repite',
              fmt(solution.extraLength),
              `${((100 * solution.extraLength) / solution.baseLength).toLocaleString('es-CO', { maximumFractionDigits: 1 })} % más que Σ w(E)`,
            ],
            ['Tiempo estimado', totalTime, `a ${fmtSpeed(est.speed, unit)} + esperas`],
            ['Tipo', clase ? cap(clase.tipo) : '—', clase?.euler ? 'circuito de Euler del multigrafo' : undefined],
          ]}
        />
      )}
      {explain > 0 && (
        <p className="paso">
          Paso {explain} de {EXPLICAR.length}: <b>{EXPLICAR[explain - 1]}</b>
        </p>
      )}

      {showOnly(1) && (
        <dl>
          <dt>G = (V, E)</dt>
          <dd>
            |V| = {n(stats.vertices)} intersecciones, |E| = {n(stats.edges)} tramos
          </dd>
          <dt>Apretón de manos</dt>
          <dd>
            Σ deg(v) = {n(stats.degreeSum)} = 2·{n(stats.edges)} {stats.degreeSum === 2 * stats.edges ? '✓' : '✗'}
          </dd>
          <dt>¿Conexo?</dt>
          <dd>{stats.components === 1 ? 'Sí, una sola componente' : `No: ${stats.components} componentes`}</dd>
          {(stats.loops > 0 || stats.parallel > 0) && (
            <>
              <dt>¿Simple?</dt>
              <dd>
                No: {stats.loops} bucle(s), {stats.parallel} arista(s) paralela(s)
              </dd>
            </>
          )}
          <dt>Σ w(E)</dt>
          <dd>{fmt(stats.baseLength)} (si cada calle se recorriera una sola vez)</dd>
        </dl>
      )}

      {showOnly(2) && (
        <dl>
          <dt>Impares |O|</dt>
          <dd>
            {n(k)} {k % 2 === 0 ? '(par, como dice el apretón de manos ✓)' : ''}
          </dd>
          <dt>¿Circuito de Euler?</dt>
          <dd>{k === 0 ? 'Sí: todos los grados son pares' : 'No: hay vértices de grado impar, hay que repetir calles'}</dd>
          {explain === 2 && k > 0 && k <= 12 && solution && (
            <dd className="lista">{solution.oddVertices.map((i) => graph.vertices[i].id).join(', ')}</dd>
          )}
        </dl>
      )}

      {solution && showOnly(3) && k > 0 && (
        <dl>
          <dt>Emparejamiento</dt>
          <dd>
            {n(solution.pairs.length)} parejas por {METODO[solution.matcher]}
          </dd>
          <dt>Distancias</dt>
          <dd>Dijkstra desde cada vértice impar</dd>
          {solution.pairs.length <= 10 &&
            solution.pairs.map((p, i) => (
              <dd key={i} className="lista">
                {graph.vertices[p.a].id} – {graph.vertices[p.b].id}: {p.path.map((e) => graph.edges[e].id).join(' ')} ({fmt(p.dist)})
              </dd>
            ))}
        </dl>
      )}

      {solution && showOnly(4) && (
        <dl>
          {solution.free ? (
            <>
              <dt>Para moverse</dt>
              <dd>
                {fmt(solution.extraLength)} de calles que se recorren de más, incluidas calles de fuera del área (punteadas en amarillo)
                {solution.free.pieces > 1 ? `; los ${solution.free.pieces} pedazos se unieron por el camino más corto` : ''}
              </dd>
            </>
          ) : (
            <>
              <dt>Aristas duplicadas</dt>
              <dd>
                {n(solution.duplicated.length)} aristas paralelas nuevas: {fmt(solution.extraLength)}
              </dd>
            </>
          )}
          <dd className="full">Ahora todos los grados son pares, así que el multigrafo tiene circuito de Euler.</dd>
        </dl>
      )}

      {solution && showOnly(5) && (
        <dl>
          <dt>Recorrido total</dt>
          <dd>
            <b>{fmt(solution.totalLength)}</b> = {fmt(solution.baseLength)} + {fmt(solution.extraLength)} (
            {((100 * solution.extraLength) / solution.baseLength).toLocaleString('es-CO', { maximumFractionDigits: 1 })} % extra)
          </dd>
          {tipo}
          <dt>Pasos</dt>
          <dd>{n(solution.circuit.length)} aristas recorridas (Hierholzer)</dd>
          {tiempo}
          <dt>Tiempo de cálculo</dt>
          <dd>
            Dijkstra {ms(solution.ms.dijkstra)} · emparejamiento {ms(solution.ms.matching)} · Hierholzer {ms(solution.ms.euler)}
          </dd>
        </dl>
      )}

      {solution && explain === 0 && (
        <details className="porque">
          <summary>¿Cómo se calculó y por qué es la ruta más corta?</summary>
          <ol>
            <li>
              <b>Cota inferior.</b> Cualquier recorrido pasa al menos una vez por cada calle, así que mide como mínimo Σ w(E) = {fmt(solution.baseLength)}.
            </li>
            <li>
              <b>Hay que repetir.</b> En un camino cerrado, a cada vértice se entra y se sale la misma cantidad de veces, así que contando las repeticiones todos los
              grados quedan pares. Los {n(k)} vértices impares obligan a repetir calles.
            </li>
            <li>
              <b>Lo repetido forma caminos entre impares.</b> Las aristas repetidas tienen grado impar justo en los vértices impares de G, así que se parten en
              caminos que unen esos vértices de dos en dos. Cada camino mide al menos la distancia más corta entre sus extremos (Dijkstra).
            </li>
            <li>
              <b>Emparejamiento mínimo.</b> Lo mínimo que se puede repetir es el emparejamiento perfecto de costo mínimo de los impares: {fmt(solution.extraLength)}
              {solution.matcher === 'blossom-vecinos' ? ' (aquí casi mínimo: solo se probaron los impares más cercanos)' : ''}.
            </li>
            {solution.free && (
              <li>
                <b>Moverse por fuera (cartero rural).</b> Las calles del área son obligatorias, pero para ir de un impar a otro vale cualquier calle de la
                ciudad, así que las distancias de Dijkstra se miden en toda la ciudad.
                {solution.free.pieces > 1
                  ? ` Como el área tenía ${solution.free.pieces} pedazos, primero se unieron por el camino más corto (heurística de Frederickson): en ese caso el problema es NP-difícil y el resultado es muy bueno pero no garantizado óptimo.`
                  : ' Como el área es de una sola pieza, sigue siendo óptimo.'}
              </li>
            )}
            <li>
              <b>Se alcanza la cota.</b> La app repite justo esos caminos y Hierholzer arma un circuito de Euler en el multigrafo, así que el total es {fmt(solution.baseLength)} +{' '}
              {fmt(solution.extraLength)} = {fmt(solution.totalLength)}. Nada puede ser más corto, porque eso ya es lo mínimo de los pasos 1 a 4.
            </li>
          </ol>
        </details>
      )}
    </div>
  );
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

const LETRAS = 'ABCDEFGHIJKLMNOP';
/** Tramos de una ruta con paradas, con las letras que se ven en el mapa: [desde, hasta, metros]. */
function tramos(ab: NonNullable<Solution['ab']>): [string, string, number][] {
  const order = ab.order ?? ab.legs.map((_, i) => i).concat(ab.legs.length);
  const seq = ab.roundTrip ? [...order, order[0]] : order;
  return ab.legs.map((d, i) => [LETRAS[seq[i]], LETRAS[seq[i + 1]], d]);
}

/** Tarjetas con los números clave, legibles desde lejos (proyector). */
function Resumen({ items }: { items: [string, string, string?][] }) {
  return (
    <div className="resumen">
      {items.map(([label, value, sub]) => (
        <div key={label} className="tarjeta">
          <span>{label}</span>
          <b>{value}</b>
          {sub && <small>{sub}</small>}
        </div>
      ))}
    </div>
  );
}

function horas(h: number) {
  if (h < 1 / 60) return `${Math.max(1, Math.round(h * 3600))} s`;
  if (h < 1) return `${Math.round(h * 60)} min`;
  if (h < 48) return `${Math.floor(h)} h ${Math.round((h % 1) * 60)} min`;
  return `${Math.round(h)} h (unos ${Math.round(h / 8)} días de 8 h)`;
}
