import { useEffect, type ReactNode } from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';

/** Fórmula en LaTeX con KaTeX. */
function TeX({ children, inline }: { children: string; inline?: boolean }) {
  const html = katex.renderToString(children, { throwOnError: false, displayMode: !inline });
  return <span className={inline ? 'tex' : 'tex bloque'} dangerouslySetInnerHTML={{ __html: html }} />;
}

/** Una fórmula con su número, cómo se lee en voz alta y qué quiere decir. */
function Formula({ n, tex, lee, children }: { n?: number; tex: string; lee: string; children: ReactNode }) {
  return (
    <div className="g-formula">
      <div className="g-tex">
        <TeX>{tex}</TeX>
        {n && <span className="g-num">({n})</span>}
      </div>
      <p className="g-lee">
        <b>Se lee:</b> «{lee}»
      </p>
      <div className="g-que">{children}</div>
    </div>
  );
}

const SECCIONES: [string, string][] = [
  ['g-problema', 'El problema'],
  ['g-euler', 'Teorema de Euler'],
  ['g-formulas', 'Las fórmulas'],
  ['g-tablero', 'Ejemplo del tablero'],
  ['g-konigsberg', 'Königsberg'],
  ['g-viajante', 'Domicilios (viajante)'],
  ['g-resultados', 'Resultados reales'],
  ['g-preguntas', 'Preguntas'],
];

export function Guia({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  const ir = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <div className="guia" role="dialog" aria-label="Teoría y fórmulas del cartero chino">
      <div className="guia-in">
        <header className="g-head">
          <div>
            <h1>Teoría y fórmulas</h1>
            <p>Cómo calcula la app la ruta más corta del cartero, fórmula por fórmula.</p>
          </div>
          <button className="g-cerrar" onClick={onClose} aria-label="Cerrar la guía">
            ✕
          </button>
        </header>

        <nav className="g-indice">
          {SECCIONES.map(([id, t]) => (
            <button key={id} onClick={() => ir(id)}>
              {t}
            </button>
          ))}
        </nav>

        <section id="g-problema">
          <h2>1. El problema del cartero chino</h2>
          <p>
            Un cartero debe pasar por <b>todas las calles</b> de un barrio al menos una vez y volver al punto de partida, caminando lo menos posible. ¿Cuánto camina
            como mínimo y en qué orden?
          </p>
          <div className="g-tarjetas">
            <div>
              <b>Vértice</b>
              <span>cada cruce o esquina</span>
            </div>
            <div>
              <b>Arista</b>
              <span>cada tramo de calle entre dos cruces</span>
            </div>
            <div>
              <b>Peso w(e)</b>
              <span>lo que mide la calle (m o km)</span>
            </div>
            <div>
              <b>Grado deg(v)</b>
              <span>cuántas calles llegan a ese cruce</span>
            </div>
          </div>
          <p>La app sigue cinco pasos, los mismos del botón «Explicar»:</p>
          <ol className="g-pasos">
            <li>
              <b>Grafo:</b> las calles de OpenStreetMap se vuelven vértices y aristas.
            </li>
            <li>
              <b>Vértices impares:</b> se buscan los cruces con grado impar.
            </li>
            <li>
              <b>Emparejamiento:</b> Dijkstra mide las distancias y Blossom empareja los impares con la menor suma.
            </li>
            <li>
              <b>Aristas duplicadas:</b> se repiten los caminos de cada pareja; todos los grados quedan pares.
            </li>
            <li>
              <b>Circuito de Euler:</b> Hierholzer arma el orden del recorrido.
            </li>
          </ol>
        </section>

        <section id="g-euler">
          <h2>2. Teorema de Euler: la idea central</h2>
          <Formula
            tex={String.raw`\exists\ \text{circuito de Euler} \iff G \text{ conexo y } \deg(v) \text{ par } \ \forall v \in V`}
            lee="Existe un circuito de Euler si y solo si G es conexo y el grado de v es par para todo v que pertenece a V."
          >
            <p>
              Cada vez que el cartero <b>entra</b> a una esquina tiene que <b>salir</b> por otra calle: las calles de cada esquina se gastan <b>de a pares</b>. Con 4
              calles entra, sale, entra y sale. Con 3 calles entra, sale y vuelve a entrar… y ya no queda calle libre para salir: <b>le toca repetir una</b>.
            </p>
          </Formula>
          <Esquinas />
          <p className="g-clave">
            Conclusión: el problema son los <b>vértices de grado impar</b>. Hay que repetir calles para emparejarlos de dos en dos, y repetir lo menos posible.
          </p>
        </section>

        <section id="g-formulas">
          <h2>3. Las fórmulas, una por una</h2>

          <h3>Lema del apretón de manos</h3>
          <Formula
            n={1}
            tex={String.raw`\sum_{v \in V} \deg(v) = 2|E|`}
            lee="La suma de los grados de todos los vértices v que pertenecen a V es igual a dos veces el número de aristas."
          >
            <p>
              Cada calle tiene dos puntas, así que suma 2 al total de grados. La suma siempre es par, y por eso <b>los vértices impares siempre vienen en número par</b>{' '}
              (2, 4, 44…): siempre se pueden emparejar de a dos.
            </p>
          </Formula>

          <h3>Peso total del grafo</h3>
          <Formula
            n={2}
            tex={String.raw`W(G) = \sum_{e \in E} w(e)`}
            lee="W de G es igual a la suma de los pesos w de e, para toda arista e que pertenece a E."
          >
            <p>
              Es lo que miden todas las calles juntas. El cartero lo camina <b>sí o sí</b>: es la cota mínima.
            </p>
          </Formula>

          <h3>Fórmula del cartero chino</h3>
          <Formula
            n={3}
            tex={String.raw`L^* = W(G) + \min_{M \in \mathcal{M}(O)} \sum_{(u,v) \in M} d_G(u,v)`}
            lee="L estrella es igual a W de G más el mínimo, entre todos los emparejamientos M de los vértices impares O, de la suma de las distancias d sub G de u a v, para cada pareja u, v de M."
          >
            <p>
              <b>Lo mínimo que camina = todas las calles + lo mínimo que hay que repetir.</b> Lo repetido sale de emparejar los impares de dos en dos de forma que la
              suma de las distancias entre parejas sea la más pequeña.
            </p>
          </Formula>

          <h3>Dijkstra (camino más corto)</h3>
          <Formula
            n={4}
            tex={String.raw`d(v) \leftarrow \min\{\, d(v),\ d(u) + w(u,v) \,\}`}
            lee="d de v se actualiza con el mínimo entre d de v y d de u más w de u v."
          >
            <p>
              Sirve para saber la distancia real entre dos impares, que no siempre es la calle directa. «Si llegar a v pasando por u sale más corto que lo que ya
              tenía, me quedo con el nuevo valor». Se empieza con d = 0 en el origen e ∞ en los demás y se repite hasta que nada mejora.
            </p>
          </Formula>

          <h3>Cuántos emparejamientos hay</h3>
          <Formula
            n={5}
            tex={String.raw`|\mathcal{M}(O)| = (k-1)!! = (k-1)(k-3)\cdots 3 \cdot 1`}
            lee="El número de emparejamientos de O es k menos uno doble factorial: k menos uno, por k menos tres, y así hasta tres por uno."
          >
            <p>
              Con k impares, el primero tiene k − 1 opciones de pareja, el siguiente libre k − 3, etc. Con k = 2 hay 1; con k = 4 hay 3; con k = 44 (El Prado) hay{' '}
              <b>más de 10²⁶</b>. Por eso no se prueban todas: el algoritmo <b>Blossom de Edmonds</b> encuentra el mejor emparejamiento en tiempo polinomial (≈ k³).
            </p>
          </Formula>

          <h3>Haversine (distancia en la Tierra)</h3>
          <Formula
            n={6}
            tex={String.raw`d = 2R \arcsin \sqrt{\sin^2\tfrac{\Delta\varphi}{2} + \cos\varphi_1 \cos\varphi_2 \sin^2\tfrac{\Delta\lambda}{2}}`}
            lee="d es igual a dos R por el arcoseno de la raíz de: seno cuadrado de delta fi sobre dos, más coseno de fi uno por coseno de fi dos por seno cuadrado de delta lambda sobre dos."
          >
            <p>
              Calcula los metros entre dos puntos del mapa a partir de su latitud (φ) y longitud (λ), teniendo en cuenta que la Tierra es redonda. R = 6371 km es el
              radio de la Tierra.
            </p>
          </Formula>

          <h3>Largo de una calle curva</h3>
          <Formula
            n={7}
            tex={String.raw`w(e) = \sum_{i=1}^{m-1} d(p_i, p_{i+1})`}
            lee="w de e es la suma, desde i igual a uno hasta m menos uno, de la distancia entre p sub i y p sub i más uno."
          >
            <p>Una calle de OpenStreetMap llega como una lista de m puntos. Se mide con Haversine de punto a punto y se suman los tramos: ese es el peso de la arista.</p>
          </Formula>
        </section>

        <section id="g-tablero">
          <h2>4. Ejemplo del tablero, paso a paso</h2>
          <p>
            Es el ejemplo «Tablero 29 oct (con pesos)» de la app: 4 vértices y 5 aristas con pesos e1 = 6, e2 = 2, e3 = 3, e4 = 2, e5 = 4.
          </p>
          <Tablero />
          <ol className="g-pasos">
            <li>
              <b>Peso total:</b> <TeX inline>{String.raw`W = 6 + 2 + 3 + 2 + 4 = 17`}</TeX>
            </li>
            <li>
              <b>Grados:</b> <TeX inline>{String.raw`\deg(v_1)=2,\ \deg(v_2)=3,\ \deg(v_3)=3,\ \deg(v_4)=2`}</TeX>. Los impares son v₂ y v₃. Comprobación con (1):{' '}
              <TeX inline>{String.raw`2+3+3+2 = 10 = 2 \cdot 5\ \checkmark`}</TeX>
            </li>
            <li>
              <b>Dijkstra de v₂ a v₃:</b> directo por e1 = 6; por v₁ = 2 + 3 = <b>5</b>; por v₄ = 4 + 2 = 6. El más corto es <b>5</b> (e4 + e3).
            </li>
            <li>
              <b>Emparejamiento:</b> con k = 2 solo hay (2 − 1)!! = 1 pareja: (v₂, v₃). Se duplican e4 y e3; v₂ y v₃ quedan con grado 4.
            </li>
            <li>
              <b>Resultado:</b> <TeX inline>{String.raw`L^* = 17 + 5 = 22`}</TeX>. Ya todos los grados son pares y Hierholzer arma el circuito.
            </li>
          </ol>
        </section>

        <section id="g-konigsberg">
          <h2>5. Puentes de Königsberg: los 3 emparejamientos</h2>
          <p>
            Los 4 vértices (A, B, C, D) son impares, así que hay <TeX inline>{String.raw`(4-1)!! = 3`}</TeX> formas de emparejarlos. W(G) = 880.
          </p>
          <table className="g-tabla">
            <thead>
              <tr>
                <th>Emparejamiento</th>
                <th>Distancias</th>
                <th>Se repite</th>
              </tr>
            </thead>
            <tbody>
              <tr className="g-mejor">
                <td>{'{A,B} + {C,D}'}</td>
                <td>100 + 150</td>
                <td>250</td>
              </tr>
              <tr>
                <td>{'{A,C} + {B,D}'}</td>
                <td>200 + 140</td>
                <td>340</td>
              </tr>
              <tr className="g-mejor">
                <td>{'{A,D} + {B,C}'}</td>
                <td>150 + 100</td>
                <td>250</td>
              </tr>
            </tbody>
          </table>
          <p>
            El mínimo repite 250, así que <TeX inline>{String.raw`L^* = 880 + 250 = 1130`}</TeX>.
          </p>
        </section>

        <section id="g-viajante">
          <h2>6. Domicilios: el problema del viajante</h2>
          <div className="g-tarjetas g-dos">
            <div>
              <b>Cartero chino</b>
              <span>recorrer todas las calles de una zona: correo puerta a puerta, recolección de basura, barrido, inspección de vías. Modo principal de la app.</span>
            </div>
            <div>
              <b>Viajante (TSP)</b>
              <span>visitar unos puntos en el mejor orden: entregar domicilios o pedidos en varias direcciones. Modo «Ruta con paradas» de la app.</span>
            </div>
          </div>
          <p>
            Con paradas, Dijkstra (4) calcula la distancia por calles entre cada par de paradas y luego se busca el orden de visita que da la menor suma:
          </p>
          <Formula
            n={8}
            tex={String.raw`\min_{\pi} \sum_{i=1}^{n-1} d\big(p_{\pi(i)},\, p_{\pi(i+1)}\big)`}
            lee="El mínimo, entre todos los órdenes pi de las paradas, de la suma de las distancias entre cada parada y la siguiente."
          >
            <p>
              Una ruta cerrada con n paradas tiene <TeX inline>{String.raw`\tfrac{(n-1)!}{2}`}</TeX> órdenes posibles y no se conoce un algoritmo polinomial que
              garantice el mejor (es NP-difícil). Por eso la app prueba <b>todos los órdenes</b> cuando hay hasta 8 paradas intermedias (8! = 40 320) y, con más,
              usa <b>vecino más cercano</b> y lo mejora con <b>2-opt</b> (invierte tramos de la ruta mientras se acorte): da una ruta muy buena, pero no garantizada
              óptima.
            </p>
          </Formula>
          <p className="g-clave">
            Diferencia clave: el cartero recorre <b>aristas</b> (calles) y se resuelve exacto en tiempo polinomial; el viajante visita <b>vértices</b> (puntos) y
            en general solo se puede aproximar.
          </p>
        </section>

        <section id="g-resultados">
          <h2>7. Resultados en zonas reales</h2>
          <div className="g-scroll">
            <table className="g-tabla">
              <thead>
                <tr>
                  <th>Zona</th>
                  <th>|V|</th>
                  <th>|E|</th>
                  <th>Impares</th>
                  <th>W(G)</th>
                  <th>Repetido</th>
                  <th>L*</th>
                  <th>Tiempo</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Tablero</td>
                  <td>4</td>
                  <td>5</td>
                  <td>2</td>
                  <td>17</td>
                  <td>5 (29,4 %)</td>
                  <td>22</td>
                  <td>1,5 ms</td>
                </tr>
                <tr>
                  <td>Königsberg</td>
                  <td>4</td>
                  <td>7</td>
                  <td>4</td>
                  <td>880</td>
                  <td>250 (28,4 %)</td>
                  <td>1 130</td>
                  <td>0,2 ms</td>
                </tr>
                <tr>
                  <td>El Prado</td>
                  <td>86</td>
                  <td>144</td>
                  <td>44</td>
                  <td>14,86 km</td>
                  <td>2,27 km (15,3 %)</td>
                  <td>17,13 km</td>
                  <td>15 ms</td>
                </tr>
                <tr>
                  <td>Centro</td>
                  <td>134</td>
                  <td>223</td>
                  <td>58</td>
                  <td>20,80 km</td>
                  <td>3,22 km (15,5 %)</td>
                  <td>24,02 km</td>
                  <td>25 ms</td>
                </tr>
                <tr>
                  <td>Soledad</td>
                  <td>5 918</td>
                  <td>9 022</td>
                  <td>4 078</td>
                  <td>595,63 km</td>
                  <td>157,37 km (26,4 %)</td>
                  <td>753,00 km</td>
                  <td>4,5 s</td>
                </tr>
                <tr>
                  <td>Barranquilla</td>
                  <td>11 288</td>
                  <td>18 080</td>
                  <td>6 892</td>
                  <td>1 579,89 km</td>
                  <td>328,16 km (20,8 %)</td>
                  <td>1 908,05 km</td>
                  <td>16,8 s</td>
                </tr>
              </tbody>
            </table>
          </div>
          <ul>
            <li>En todas las zonas el número de impares es par, como dice (1).</li>
            <li>En la red real hay muchos impares (43 % a 69 %) por las esquinas en T (grado 3) y las calles ciegas (grado 1): ninguna zona es euleriana.</li>
            <li>En los barrios el emparejamiento es exacto. En las ciudades completas es aproximado (Blossom con los 8 vecinos más cercanos) para que tarde segundos.</li>
          </ul>
        </section>

        <section id="g-preguntas">
          <h2>8. Preguntas frecuentes</h2>
          <dl className="g-faq">
            <dt>¿Por qué no prueban todas las combinaciones?</dt>
            <dd>Con 44 impares son más de 10²⁶ emparejamientos (fórmula 5). Blossom encuentra el mínimo en tiempo polinomial, más o menos k³.</dd>
            <dt>¿Por qué los impares siempre son un número par?</dt>
            <dd>Por el apretón de manos (1): la suma de grados es 2|E|, que es par, y una suma de números con una cantidad impar de impares sería impar.</dd>
            <dt>¿Cómo saben que es la ruta más corta?</dt>
            <dd>
              Toda ruta pasa por cada calle (al menos W(G)) y lo que se repite une impares de dos en dos (al menos el emparejamiento mínimo). La app logra exactamente
              esa suma, así que nada puede ser más corto.
            </dd>
            <dt>¿Y las calles de un solo sentido?</dt>
            <dd>El modelo es no dirigido. La versión dirigida se resuelve con flujo de costo mínimo y queda como trabajo futuro.</dd>
            <dt>¿De dónde salen las calles?</dt>
            <dd>De OpenStreetMap. Las distancias se calculan con Haversine (6) y la suma de tramos (7).</dd>
            <dt>¿En qué se diferencia del problema del viajante?</dt>
            <dd>
              El viajante visita puntos (domicilios); el cartero recorre calles (toda una zona). El cartero se resuelve exacto en tiempo polinomial y el viajante no
              (es NP-difícil). La app hace los dos: el cartero en el modo principal y el viajante en «Ruta con paradas» con la opción de ordenar las paradas.
            </dd>
          </dl>
        </section>
      </div>
    </div>
  );
}

/** Esquina de grado 4 (entra y sale sin repetir) frente a una de grado 3 (repite una calle). */
function Esquinas() {
  const ok = 'var(--start)';
  const mal = 'var(--odd)';
  const flecha = (id: string, c: string) => (
    <marker id={id} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M2 1L8 5L2 9" fill="none" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </marker>
  );
  return (
    <svg className="g-svg" viewBox="0 0 680 290" role="img" aria-label="Esquina de grado par contra esquina de grado impar">
      <defs>
        {flecha('g-ok', ok)}
        {flecha('g-mal', mal)}
      </defs>
      <g stroke={ok} strokeWidth="2.5">
        <line x1="95" y1="140" x2="158" y2="140" markerEnd="url(#g-ok)" />
        <line x1="170" y1="128" x2="170" y2="65" markerEnd="url(#g-ok)" />
        <line x1="245" y1="140" x2="182" y2="140" markerEnd="url(#g-ok)" />
        <line x1="170" y1="152" x2="170" y2="215" markerEnd="url(#g-ok)" />
      </g>
      <circle cx="170" cy="140" r="8" fill={ok} />
      <g className="g-txt">
        <text x="112" y="126" textAnchor="middle">1. entra</text>
        <text x="180" y="92">2. sale</text>
        <text x="226" y="126" textAnchor="middle">3. entra</text>
        <text x="180" y="196">4. sale</text>
        <text x="170" y="250" textAnchor="middle" className="g-fuerte">Grado 4 (par)</text>
        <text x="170" y="272" textAnchor="middle">Entra, sale, entra, sale: no se atasca</text>
      </g>
      <line x1="340" y1="50" x2="340" y2="280" stroke="var(--line)" strokeDasharray="4 4" />
      <g strokeWidth="2.5">
        <line x1="435" y1="140" x2="498" y2="140" stroke={ok} markerEnd="url(#g-ok)" />
        <line x1="510" y1="128" x2="510" y2="65" stroke={ok} markerEnd="url(#g-ok)" />
        <line x1="585" y1="134" x2="522" y2="134" stroke={mal} markerEnd="url(#g-mal)" />
        <line x1="522" y1="148" x2="585" y2="148" stroke={mal} strokeDasharray="5 4" markerEnd="url(#g-mal)" />
      </g>
      <circle cx="510" cy="140" r="8" fill={mal} />
      <g className="g-txt">
        <text x="452" y="126" textAnchor="middle">1. entra</text>
        <text x="520" y="92">2. sale</text>
        <text x="566" y="122" textAnchor="middle">3. entra</text>
        <text x="556" y="170" textAnchor="middle">repite la 3</text>
        <text x="510" y="250" textAnchor="middle" className="g-fuerte">Grado 3 (impar)</text>
        <text x="510" y="272" textAnchor="middle">No queda calle libre: toca repetir</text>
      </g>
    </svg>
  );
}

/** El grafo del tablero antes (impares en rojo) y después de duplicar e4 y e3. */
function Tablero() {
  // v1 arriba izq., v2 arriba der., v3 abajo izq., v4 abajo der.
  const P = { v1: [70, 60], v2: [250, 60], v3: [70, 220], v4: [250, 220] } as const;
  type V = keyof typeof P;
  const A: [string, V, V, number][] = [
    ['e1', 'v2', 'v3', 6],
    ['e2', 'v3', 'v4', 2],
    ['e3', 'v3', 'v1', 3],
    ['e4', 'v2', 'v1', 2],
    ['e5', 'v2', 'v4', 4],
  ];
  const grafo = (dx: number, despues: boolean) => {
    const gr: Record<V, number> = { v1: 2, v2: despues ? 4 : 3, v3: despues ? 4 : 3, v4: 2 };
    return (
      <g transform={`translate(${dx},0)`}>
        {A.map(([id, a, b, w]) => {
          const [x1, y1] = P[a];
          const [x2, y2] = P[b];
          const mx = (x1 + x2) / 2;
          const my = (y1 + y2) / 2;
          const diag = id === 'e1';
          return (
            <g key={id}>
              <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--fg)" strokeWidth="2" opacity="0.7" />
              <text x={diag ? mx + 14 : x1 === x2 ? mx + (x1 < 150 ? -14 : 14) : mx} y={diag ? my - 6 : y1 === y2 ? my + (y1 < 150 ? -10 : 22) : my + 5} textAnchor={x1 === x2 ? (x1 < 150 ? 'end' : 'start') : 'middle'} className="g-txt">
                {id} = {w}
              </text>
            </g>
          );
        })}
        {despues && (
          <g fill="none" stroke="var(--dup)" strokeWidth="2.5" strokeDasharray="7 5">
            <path d="M250 60 Q160 100 70 60" />
            <path d="M70 60 Q110 140 70 220" />
          </g>
        )}
        {(Object.keys(P) as V[]).map((v) => {
          const impar = gr[v] % 2 === 1;
          const [x, y] = P[v];
          return (
            <g key={v}>
              <circle cx={x} cy={y} r="15" fill={impar ? 'var(--odd)' : 'var(--start)'} />
              <text x={x} y={y + 5} textAnchor="middle" className="g-vtx">
                {v}
              </text>
              <text x={x} y={y < 150 ? y - 24 : y + 36} textAnchor="middle" className="g-txt">
                grado {gr[v]}
              </text>
            </g>
          );
        })}
        <text x="160" y="290" textAnchor="middle" className="g-txt g-fuerte">
          {despues ? 'Después: se duplican e4 y e3 (+5)' : 'Antes: v2 y v3 son impares'}
        </text>
      </g>
    );
  };
  return (
    <svg className="g-svg" viewBox="0 0 680 310" role="img" aria-label="Grafo del tablero antes y después de duplicar aristas">
      {grafo(10, false)}
      {grafo(350, true)}
    </svg>
  );
}
