import { useEffect, useMemo, useRef, useState } from 'react';
import { rotateSolution } from './core/cpp';
import { polylineLength, ringAreaKm2 } from './core/geo';
import { defaultBuildOptions, type BuildOptions } from './core/osm';
import { buildGuide, buildRoute, countBelow, instruction, positionAt, TURN_TEXT, type Turn } from './core/route';
import type { Edge, Graph, GraphStats, LatLon, Solution } from './core/types';
import { EJEMPLOS } from './data/ejemplos';
import zonas from './data/zonas.json';
import { applyEdit, type EditOp } from './core/editar';
import { C, MapView, type EditTool, type Fondo, type Layers, type MapApi, type View } from './map/MapView';
import { TableroView } from './ui/TableroView';
import { Teoria, EXPLICAR } from './ui/Teoria';
import { Guia } from './ui/Guia';
import { fmt, fromMs, toMs, type Unit } from './ui/format';
import { Lugar, type Punto } from './ui/Lugar';
import { exportProject, fileName, importProject, makeProject, parseProject, type Proyecto } from './ui/proyecto';
import { driveConfigured, listDrive, openFromDrive, saveToDrive, type DriveFile } from './services/drive';
import type { DownloadProgress } from './core/overpass';
import type { Source, WorkerRequest, WorkerResponse } from './worker/solver.worker';

interface Busy {
  msg: string;
  download?: DownloadProgress;
  since: number;
}

const VIEWS: { id: View; label: string }[] = [
  { id: 'plano', label: 'Plano' },
  { id: 'aerea', label: 'Aérea' },
  { id: '3d', label: '3D' },
  { id: 'navegar', label: 'Navegar' },
  { id: 'tablero', label: 'Tablero' },
];
// velocidades de la animación: las reales primero y luego más rápidas para rutas largas (se guardan en m/s)
// reproducción: ×1 es tiempo real a la velocidad del vehículo; menos de 1 es cámara lenta
const MULTS = [0.25, 0.5, 1, 2, 5, 10, 30, 60, 120, 300, 600, 1800, 3600, 10800];
const PROMEDIOS = [
  { label: 'A pie', kmh: 5 },
  { label: 'Bici', kmh: 15 },
  { label: 'Carro', kmh: 25 },
  { label: 'Moto', kmh: 30 },
];
const DEMOS = [{ name: 'El Prado (sin internet)', file: 'el-prado.json' }];
const LETRAS = 'ABCDEFGHIJKLMNOP';
const ALL: Layers ={ grafo: true, impares: true, parejas: true, duplicadas: true, ruta: true };

export default function App() {
  const [view, setView] = useState<View>('plano');
  const [guia, setGuia] = useState(() => location.hash === '#teoria');
  // la guía se puede abrir directo con #teoria en la dirección
  const abrirGuia = (on: boolean) => {
    setGuia(on);
    history.replaceState(null, '', on ? '#teoria' : location.pathname + location.search);
  };
  const [area, setArea] = useState<number[][] | null>(null);
  const [drawMode, setDrawMode] = useState<'rectangle' | 'polygon' | null>(null);
  const [options, setOptions] = useState<BuildOptions>(defaultBuildOptions);
  const [graph, setGraph] = useState<Graph | null>(null);
  const [dropped, setDropped] = useState<Edge[]>([]);
  const [stats, setStats] = useState<GraphStats | null>(null);
  const [solution, setSolution] = useState<Solution | null>(null);
  const [start, setStart] = useState(0);
  const [busy, setBusyState] = useState<Busy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<Source>('auto');
  const [origin, setOrigin] = useState('');
  const [, tick] = useState(0);
  const [layers, setLayers] = useState<Layers>(ALL);
  const [explain, setExplain] = useState(0); // 0 = apagado, 1..5 = paso
  const [playing, setPlaying] = useState(false);
  const [mult, setMult] = useState(10); // reproducción ×N
  const [progress, setProgress] = useState(0);
  const [follow, setFollow] = useState(false);
  const [open, setOpen] = useState(true);
  const [fondo, setFondo] = useState<Fondo>('completo');
  const [mode, setMode] = useState<'cartero' | 'ab'>('cartero');
  const [stops, setStops] = useState<(Punto | null)[]>([null, null]); // A, paradas intermedias y la última
  const [pickPoint, setPickPoint] = useState<number | null>(null); // índice de la parada que se elige en el mapa
  const [optimize, setOptimize] = useState(false);
  const [fixEnd, setFixEnd] = useState(true); // al ordenar: la última parada es el destino fijo
  const [freeMove, setFreeMove] = useState(true);
  // "Trazar calles": puntos (cruces) y tramos ya unidos por las calles
  const [trace, setTrace] = useState<{ points: LatLon[]; segs: { edges: number[]; geometry: LatLon[] }[] } | null>(null);
  const [tracePreview, setTracePreview] = useState<LatLon[] | null>(null);
  const traceIds = useRef({ next: 1, preview: 0 });
  const setStop = (i: number, p: Punto | null) => setStops((s) => s.map((x, j) => (j === i ? p : x)));
  const [name, setName] = useState('Mi recorrido');
  const [unit, setUnit] = useState<Unit>('kmh');
  const [vehicle, setVehicle] = useState(false);
  const [roundTrip, setRoundTrip] = useState(false);
  const [avg, setAvg] = useState(5 / 3.6); // velocidad promedio para estimar el tiempo, m/s
  const [waitCross, setWaitCross] = useState(3); // segundos de espera por cruce (semáforos, pare)
  const [waitTurn, setWaitTurn] = useState(0); // segundos extra por cada giro
  const [editTool, setEditTool] = useState<EditTool | null>(null);
  const [undo, setUndo] = useState<Graph[]>([]);
  const [fitKey, setFitKey] = useState(0);
  const [proyector, setProyector] = useState(false);
  const [ajustes, setAjustes] = useState(false);
  const [driveId, setDriveId] = useState<string | undefined>();
  const [driveList, setDriveList] = useState<DriveFile[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [manualRot, setManualRot] = useState(false);
  const [pathResult, setPathResult] = useState<{ id: number; geometry: LatLon[] | null; length: number } | null>(null);
  const pendingJoin = useRef<{ id: number; a: number; b: number } | null>(null);
  const pendingSolution = useRef<Solution | null>(null);
  const pendingStart = useRef<LatLon | null>(null); // al trazar: la ruta empieza en el primer punto marcado
  const exampleRef = useRef(false);
  const [isExample, setIsExample] = useState(false); // ejemplos de clase: coordenadas de mentira

  const mapApi = useRef<MapApi>(null);
  const d = useRef(0);
  const worker = useRef<Worker | null>(null);

  // con "moverse por fuera" la ruta trae su propio grafo (las calles requeridas + las de moverse)
  const viewGraph = solution?.routeGraph ?? graph;
  const route = useMemo(() => (viewGraph && solution ? buildRoute(viewGraph, solution) : { steps: [], total: 0 }), [viewGraph, solution]);

  // el tiempo transcurrido se cuenta desde que empezó la tarea (no se reinicia con cada aviso)
  const setBusy = (msg: string | null, download?: DownloadProgress) =>
    setBusyState((b) => (msg === null ? null : { msg, download, since: b?.since ?? Date.now() }));

  // --- worker ---
  const startWorker = () => {
    const w = new Worker(new URL('./worker/solver.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (ev: MessageEvent<WorkerResponse>) => {
      const m = ev.data;
      if (m.type === 'progress') setBusy(m.msg, m.download);
      else if (m.type === 'error') {
        setBusy(null);
        setError(m.msg);
      } else if (m.type === 'graph' && m.edit) {
        setStats(m.stats); // una edición: el grafo ya está en pantalla, solo cambian los números
      } else if (m.type === 'graph') {
        setBusy(null);
        setFitKey((k) => k + 1);
        setUndo([]);
        setGraph(m.graph);
        setDropped(m.dropped);
        setStats(m.stats);
        setOrigin(m.origin);
        // al abrir un archivo guardado, su ruta ya calculada llega junto con el grafo
        const sol = pendingSolution.current;
        pendingSolution.current = null;
        setSolution(sol);
        let st = sol?.start ?? 0;
        const first = pendingStart.current;
        pendingStart.current = null;
        if (first && !sol) {
          // el vértice más cercano al primer punto trazado
          let best = Infinity;
          m.graph.vertices.forEach((v, i) => {
            const d = (v.lat - first[0]) ** 2 + (v.lon - first[1]) ** 2;
            if (d < best) [best, st] = [d, i];
          });
        }
        setStart(st);
        setIsExample(exampleRef.current);
        exampleRef.current = false;
      } else if (m.type === 'trace') {
        if (m.preview) {
          if (m.id === traceIds.current.preview) setTracePreview(m.geometry);
        } else {
          setBusy(null);
          setTracePreview(null);
          setTrace((t) => (t ? { points: [...t.points, m.point], segs: t.points.length ? [...t.segs, { edges: m.edges, geometry: m.geometry }] : t.segs } : t));
        }
      } else if (m.type === 'path') {
        setBusy(null);
        setPathResult(m);
      } else if (m.type === 'solution') {
        setBusy(null);
        setSolution(m.solution);
        if (m.notice) flashRef.current(m.notice);
        if (m.excluded?.length) {
          const ids = m.excluded.length > 6 ? `${m.excluded.slice(0, 6).join(', ')} y ${m.excluded.length - 6} más` : m.excluded.join(', ');
          flashRef.current(`Sin conexión con el resto (quedaron fuera del recorrido): ${ids}.`);
        }
      } else if (m.type === 'route') {
        setBusy(null);
        setFitKey((k) => k + 1);
        setArea(null);
        setGraph(m.graph);
        setDropped([]);
        setStats(m.stats);
        setOrigin('calles guardadas');
        setStart(0);
        setSolution(m.solution);
      }
    };
    worker.current = w;
    return w;
  };
  useEffect(() => {
    const w = startWorker();
    return () => w.terminate();
  }, []);
  const send = (req: WorkerRequest, msg: string) => {
    setError(null);
    setBusyState({ msg, since: Date.now() });
    setPlaying(false);
    worker.current!.postMessage(req);
  };
  // cancelar = matar el worker y crear otro; el grafo que ya estaba se le vuelve a pasar
  const cancel = () => {
    worker.current?.terminate();
    const w = startWorker();
    if (graph) w.postMessage({ type: 'load', graph } satisfies WorkerRequest);
    setBusyState(null);
    setError('Cancelado');
  };
  useEffect(() => {
    if (!busy) return;
    const id = setInterval(() => tick((x) => x + 1), 1000);
    return () => clearInterval(id);
  }, [busy !== null]);

  // --- animación ---
  useEffect(() => {
    d.current = 0;
    setProgress(0);
    setPlaying(false);
    // que el recorrido completo dure como mucho minuto y medio de animación
    setMult(10);
  }, [route]);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    let lastUi = 0;
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      d.current = Math.min(route.total, d.current + avg * mult * dt);
      mapApi.current?.setProgress(d.current);
      if (now - lastUi > 90 || d.current >= route.total) {
        setProgress(d.current);
        lastUi = now;
      }
      if (d.current >= route.total) setPlaying(false);
      else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, mult, avg, route]);

  const glideRaf = useRef(0);
  const seek = (x: number) => {
    cancelAnimationFrame(glideRaf.current);
    glideTarget.current = null;
    d.current = x;
    setProgress(x);
    mapApi.current?.setProgress(x);
  };
  const restart = () => {
    setPlaying(false);
    glide(0);
  };
  // salto animado: el cartero recorre rápido el tramo en vez de aparecer de golpe
  // destino del salto en curso: si se vuelve a tocar ⏭ o ⏮ mientras se mueve, se cuenta desde ahí
  const glideTarget = useRef<number | null>(null);
  const glide = (x: number) => {
    cancelAnimationFrame(glideRaf.current);
    glideTarget.current = x;
    setPlaying(false);
    const from = d.current;
    const dur = Math.min(1800, 500 + Math.abs(x - from) / 3);
    const t0 = performance.now();
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / dur);
      const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
      d.current = from + (x - from) * e;
      mapApi.current?.setProgress(d.current);
      setProgress(d.current);
      if (k < 1) glideRaf.current = requestAnimationFrame(step);
      else glideTarget.current = null;
    };
    glideRaf.current = requestAnimationFrame(step);
  };

  // --- modo explicar: cada paso muestra una capa más ---
  useEffect(() => {
    if (!explain) return;
    setLayers({ grafo: true, impares: explain >= 2, parejas: explain === 3, duplicadas: explain >= 4 && explain < 5, ruta: explain >= 5 });
    if (explain === 5 && !playing) {
      seek(0);
      setPlaying(true);
    }
  }, [explain]);

  // --- trazar calles ---
  const traceTo = (p: LatLon, preview: boolean) => {
    if (!trace) return;
    const id = traceIds.current.next++;
    if (preview) {
      if (!trace.points.length) return;
      traceIds.current.preview = id;
    }
    worker.current!.postMessage({ type: 'trace', id, from: trace.points.at(-1) ?? null, to: p, preview } satisfies WorkerRequest);
  };
  const traceLength = trace ? trace.segs.reduce((s, x) => s + polylineLength(x.geometry), 0) : 0;
  const finishTrace = () => {
    if (!trace) return;
    pendingStart.current = trace.points[0] ?? null;
    send({ type: 'traceGraph', edges: trace.segs.flatMap((x) => x.edges) }, 'Armando el grafo con las calles trazadas…');
    setTrace(null);
    setTracePreview(null);
    setArea(null);
  };

  // --- archivos: JSON local y Google Drive ---
  const openProject = (p: Proyecto) => {
    setName(p.name);
    setOptions(p.options);
    setMode(p.solution?.kind === 'ab' ? 'ab' : 'cartero');
    pendingSolution.current = p.solution;
    loadGraph(p.graph, p.name, p.area);
  };
  const flashTimer = useRef(0);
  const flash = (msg: string) => {
    setNotice(msg);
    clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setNotice(null), 4000);
  };
  const flashRef = useRef(flash);
  flashRef.current = flash;
  const saveDrive = async () => {
    try {
      setBusyState({ msg: 'Guardando en Google Drive…', since: Date.now() });
      const id = await saveToDrive(fileName(name), makeProject({ name, area, options, graph: graph!, solution, start }), driveId);
      setDriveId(id);
      setBusyState(null);
      flash(`Guardado en Drive: CarteroChino/${fileName(name)}`);
    } catch (e) {
      setBusyState(null);
      setError((e as Error).message);
    }
  };
  const listDriveFiles = async () => {
    try {
      setBusyState({ msg: 'Buscando tus recorridos en Drive…', since: Date.now() });
      setDriveList(await listDrive());
      setBusyState(null);
    } catch (e) {
      setBusyState(null);
      setError((e as Error).message);
    }
  };
  const openDrive = async (f: DriveFile) => {
    try {
      setBusyState({ msg: `Abriendo ${f.name}…`, since: Date.now() });
      const p = parseProject(await openFromDrive(f.id));
      setDriveId(f.id);
      setDriveList(null);
      openProject(p);
    } catch (e) {
      setBusyState(null);
      setError((e as Error).message);
    }
  };

  // --- editor del grafo ---
  const edit = (op: EditOp) => {
    if (!graph) return;
    // "Unir" va por las calles reales: se le pide al worker el camino entre los dos vértices
    if (op.type === 'connect' && !op.geometry) {
      const a = graph.vertices[op.a];
      const b = graph.vertices[op.b];
      const id = Date.now();
      pendingJoin.current = { id, a: op.a, b: op.b };
      setBusyState({ msg: `Buscando las calles entre ${a.id} y ${b.id}…`, since: Date.now() });
      worker.current!.postMessage({ type: 'path', id, from: [a.lat, a.lon], to: [b.lat, b.lon] } satisfies WorkerRequest);
      return;
    }
    const next = applyEdit(graph, op);
    if (op.type === 'removeArea') {
      const nv = graph.vertices.length - next.vertices.length;
      const ne = graph.edges.length - next.edges.length;
      if (nv === 0) return flash('No había vértices dentro del rectángulo.');
      flash(`Borrados ${nv} vértice(s) y ${ne} calle(s). Puedes deshacerlo con ↶.`);
    }
    setUndo((u) => [...u.slice(-49), graph]);
    setGraph(next);
    setSolution(null);
    if (start >= next.vertices.length) setStart(0);
    worker.current!.postMessage({ type: 'load', graph: next, edit: true } satisfies WorkerRequest);
  };
  const undoEdit = () => {
    const prev = undo[undo.length - 1];
    if (!prev) return;
    setUndo((u) => u.slice(0, -1));
    setGraph(prev);
    setSolution(null);
    worker.current!.postMessage({ type: 'load', graph: prev, edit: true } satisfies WorkerRequest);
  };

  useEffect(() => {
    document.documentElement.classList.toggle('proyector', proyector);
  }, [proyector]);

  useEffect(() => {
    const j = pendingJoin.current;
    if (!pathResult || !j || pathResult.id !== j.id || !graph) return;
    pendingJoin.current = null;
    const { a, b } = j;
    const name = `${graph.vertices[a].id} y ${graph.vertices[b].id}`;
    if (pathResult.geometry) {
      edit({ type: 'connect', a, b, geometry: pathResult.geometry, length: pathResult.length });
      flash(`Unidos ${name} por ${fmt(pathResult.length)} de calles.`);
    } else {
      edit({ type: 'connect', a, b, geometry: [[graph.vertices[a].lat, graph.vertices[a].lon], [graph.vertices[b].lat, graph.vertices[b].lon]] });
      flash(`No encontré calles entre ${name} (fuera de las calles guardadas): se unieron en línea recta.`);
    }
  }, [pathResult]);

  // deja todo como al abrir la app (menos las preferencias)
  const clear = () => {
    if (busy) cancel();
    setError(null);
    setGraph(null);
    setSolution(null);
    setStats(null);
    setDropped([]);
    setArea(null);
    setDrawMode(null);
    setStops([null, null]);
    setPickPoint(null);
    setExplain(0);
    setLayers(ALL);
    setOrigin('');
    setEditTool(null);
    setUndo([]);
  };

  const switchMode = (m: 'cartero' | 'ab') => {
    if (m === mode) return;
    setMode(m);
    setGraph(null);
    setSolution(null);
    setStats(null);
    setArea(null);
    setDrawMode(null);
    setPickPoint(null);
    setExplain(0);
    setLayers(ALL);
    setEditTool(null);
  };

  const gps = () => {
    if (!navigator.geolocation) return setError('Este navegador no da la ubicación');
    setBusyState({ msg: 'Buscando tu ubicación…', since: Date.now() });
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setBusyState(null);
        setStop(0, { name: `Mi ubicación (±${Math.round(pos.coords.accuracy)} m)`, p: [pos.coords.latitude, pos.coords.longitude] });
      },
      (err) => {
        setBusyState(null);
        setError(
          err.code === err.PERMISSION_DENIED
            ? 'No diste permiso de ubicación (o la página no está en https).'
            : 'No se pudo obtener la ubicación.',
        );
      },
      { enableHighAccuracy: true, timeout: 15000 },
    );
  };

  const pickStart = (v: number) => {
    if (solution?.kind === 'ab') return;
    if (graph && v >= graph.vertices.length) return; // un punto de una calle "de moverse": no es del área
    setStart(v);
    if (solution) setSolution(rotateSolution(solution, v));
  };

  const onArea = (ring: number[][]) => {
    setArea(ring);
    setDrawMode(null);
    setGraph(null);
    setSolution(null);
    setStats(null);
  };

  const loadGraph = (g: Graph, label: string, ring: number[][] | null = null) => {
    setArea(ring);
    send({ type: 'load', graph: g }, `Cargando ${label}…`);
  };

  const loadDemo = async (file: string) => {
    try {
      const demo = await (await fetch(`${import.meta.env.BASE_URL}demo/${file}`)).json();
      loadGraph(demo.graph, demo.name, demo.area);
    } catch {
      setError('No se pudo abrir la demo');
    }
  };

  const pos = route.steps.length ? positionAt(route.steps, progress) : null;
  const guide = useMemo(() => buildGuide(route.steps), [route]);
  const estimate = {
    speed: avg,
    waitCross,
    waitTurn,
    crossings: Math.max(0, route.steps.length - 1),
    turns: guide.boundaries.filter((j) => j < route.steps.length - 1).length,
  };

  const reproductor = solution && (
              <>
                <div className="fila reproductor">
                  <button onClick={() => (progress >= route.total ? (seek(0), setPlaying(true)) : setPlaying(!playing))} title={playing ? 'Pausar' : 'Reproducir'}>
                    {playing ? '⏸' : '▶'}
                  </button>
                  <button onClick={restart} title="Volver al inicio">
                    ⟲
                  </button>
                  <input type="range" min={0} max={route.total} step={route.total / 2000} value={progress} onChange={(e) => seek(+e.target.value)} />
                </div>
                <div className="velocidades">
                  <div className="fila fondo promedio">
                    <span>Velocidad del vehículo</span>
                    <input
                      type="number"
                      min={0.1}
                      step={unit === 'kmh' ? 1 : 0.5}
                      value={+fromMs(avg, unit).toFixed(1)}
                      onChange={(e) => +e.target.value > 0 && setAvg(toMs(+e.target.value, unit))}
                      aria-label="Velocidad del vehículo"
                    />
                    <span>{unit === 'kmh' ? 'km/h' : 'm/s'}</span>
                  </div>
                  <div className="fila fondo">
                    {PROMEDIOS.map((p) => (
                      <button key={p.label} className={Math.abs(avg * 3.6 - p.kmh) < 0.01 ? 'on' : ''} onClick={() => setAvg(p.kmh / 3.6)}>
                        {p.label} {p.kmh}
                      </button>
                    ))}
                  </div>
                  <div className="fila fondo">
                    <span>Reproducción</span>
                    <MultSelect value={mult} onChange={setMult} />
                    <span className="ayuda">{multHint(mult)}</span>
                  </div>
                  <div className="fila fondo promedio">
                    <span>Espera por cruce</span>
                    <input type="number" min={0} value={waitCross} onChange={(e) => setWaitCross(Math.max(0, +e.target.value))} aria-label="Segundos por cruce" />
                    <span>s</span>
                  </div>
                  <div className="fila fondo promedio">
                    <span>Espera por giro</span>
                    <input type="number" min={0} value={waitTurn} onChange={(e) => setWaitTurn(Math.max(0, +e.target.value))} aria-label="Segundos por giro" />
                    <span>s</span>
                  </div>
                </div>
                <p className="dato">
                  Paso {pos ? pos.i + 1 : 0} de {route.steps.length} · {fmt(progress)} de {fmt(route.total)}
                </p>
                <label className="check">
                  <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> Seguir al cartero en el mapa
                </label>
              </>
  );
  const km2 = area ? ringAreaKm2(area) : 0;

  return (
    <div className="app">
      <MapView
        ref={mapApi}
        view={view}
        fondo={fondo}
        area={area}
        graph={viewGraph}
        dropped={dropped}
        solution={solution}
        steps={route.steps}
        start={start}
        layers={layers}
        follow={follow}
        drawMode={drawMode}
        onArea={onArea}
        onPickStart={pickStart}
        editTool={editTool}
        onEdit={edit}
        fitKey={fitKey}
        points={stops.flatMap((x, i) =>
          x ? [{ label: LETRAS[i], p: x.p, role: i === 0 ? ('inicio' as const) : i === stops.length - 1 ? ('fin' as const) : ('medio' as const) }] : [],
        )}
        pickPoint={pickPoint !== null}
        onNotice={flash}
        tracing={!!trace}
        trace={{ done: trace?.segs.map((x) => x.geometry) ?? [], points: trace?.points ?? [], preview: tracePreview }}
        onTraceClick={(p) => traceTo(p, false)}
        onTraceHover={(p) => traceTo(p, true)}
        onManualRotate={setManualRot}
        onPickPoint={(p) => {
          const punto = { name: `Punto en el mapa (${p[0].toFixed(5)}, ${p[1].toFixed(5)})`, p };
          if (pickPoint !== null) setStop(pickPoint, punto);
          setPickPoint(null);
        }}
      />
      {view === 'tablero' && (
        <TableroView
          graph={viewGraph}
          solution={solution}
          steps={route.steps}
          progress={progress}
          start={start}
          layers={layers}
          onPickStart={pickStart}
          stats={stats}
          explain={explain}
          onExplain={(step) => {
            setExplain(step);
            if (step === 0) setLayers(ALL);
          }}
          estimate={estimate}
        />
      )}

      {guia && <Guia onClose={() => abrirGuia(false)} />}

      <nav className="vistas">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            className={view === v.id ? 'on' : ''}
            onClick={() => {
              setView(v.id);
              if (v.id === 'navegar' && window.innerWidth < 800) setOpen(false); // en el celular se ve el mapa completo
            }}
          >
            {v.label}
          </button>
        ))}
        <button className={guia ? 'on' : ''} onClick={() => abrirGuia(true)} title="Teoría y fórmulas del cartero chino">
          Teoría
        </button>
        <button
          className="fondo-rapido"
          onClick={() => setFondo(fondo === 'completo' ? 'minimo' : fondo === 'minimo' ? 'ninguno' : 'completo')}
          title="Cuánto mapa de fondo se ve (también en Ajustes)"
        >
          Fondo: {fondo === 'completo' ? 'completo' : fondo === 'minimo' ? 'mínimo' : 'solo grafo'}
        </button>
      </nav>

      {viewGraph && view !== 'tablero' && view !== 'navegar' && (
        <div className="leyenda" aria-label="Qué significa cada color">
          <div>
            <i style={{ borderColor: C.edge }} /> calle a recorrer
          </div>
          {solution && (
            <>
              <div>
                <i style={{ borderColor: C.route }} /> recorrida (1.ª vez)
              </div>
              <div>
                <i style={{ borderColor: C.dup }} /> repetida
              </div>
              {viewGraph.edges.some((e) => e.extra) && (
                <div>
                  <i className="punteada" style={{ borderColor: C.extra }} /> de fuera, solo para moverse
                </div>
              )}
              {layers.parejas && solution.kind !== 'ab' && solution.pairs.length > 0 && (
                <div>
                  <i className="punteada" style={{ borderColor: C.match }} /> pareja de impares
                </div>
              )}
            </>
          )}
          {layers.impares && (
            <div>
              <i className="punto" style={{ background: C.odd }} /> vértice impar
            </div>
          )}
        </div>
      )}

      {view === 'navegar' && pos && viewGraph && (() => {
        const ins = instruction(route.steps, guide, pos.i);
        return (
          <>
            <Banner
              turn={ins.turn}
              left={ins.end - progress}
              street={viewGraph.edges[route.steps[pos.i].edge].name}
              next={ins.nextEdge !== undefined ? viewGraph.edges[ins.nextEdge].name : undefined}
              repeat={route.steps[pos.i].repeat}
            />
            <NavBar
              playing={playing}
              mult={mult}
              onMult={setMult}
              manual={manualRot}
              onFollow={() => mapApi.current?.followHeading()}
              onPlay={() => (progress >= route.total ? (seek(0), setPlaying(true)) : setPlaying(!playing))}
              onRestart={restart}
              onPrev={() => {
                const from = glideTarget.current ?? progress;
                glide([...guide.starts].reverse().find((s) => s < from - 0.5) ?? 0);
              }}
              onNext={() => {
                const from = glideTarget.current ?? progress;
                glide(guide.starts.find((s) => s > from + 0.5) ?? route.total);
              }}
              streetsDone={countBelow(guide.firstVisits, pos.i + (progress >= route.total ? 1 : 0))}
              streets={viewGraph.edges.length}
              left={route.total - progress}
              step={pos.i + 1}
              steps={route.steps.length}
            />
          </>
        );
      })()}

      <aside className={`panel ${open ? '' : 'cerrado'}`}>
        <button className="asa" onClick={() => setOpen(!open)} aria-label="Mostrar u ocultar panel">
          <span />
        </button>
        <div className="panel-body">
          <div className="cabecera">
            <h1>Cartero chino</h1>
            <div className="cabecera-botones">
              <button className={ajustes ? 'on' : ''} onClick={() => setAjustes(!ajustes)} title="Mapa de fondo, unidades y modo proyector">
                Ajustes
              </button>
              <button onClick={clear} title="Borrar el área, el grafo y la ruta">
                Limpiar
              </button>
            </div>
          </div>
          {ajustes && (
            <div className="ajustes">
              <div className="fila fondo">
                <span>Mapa de fondo</span>
                {(
                  [
                    ['completo', 'Completo'],
                    ['minimo', 'Mínimo'],
                    ['ninguno', 'Solo grafo'],
                  ] as const
                ).map(([id, label]) => (
                  <button key={id} className={fondo === id ? 'on' : ''} onClick={() => setFondo(id)}>
                    {label}
                  </button>
                ))}
              </div>
              <div className="fila fondo">
                <span>Velocidades en</span>
                {(
                  [
                    ['kmh', 'km/h'],
                    ['ms', 'm/s'],
                  ] as const
                ).map(([id, label]) => (
                  <button key={id} className={unit === id ? 'on' : ''} onClick={() => setUnit(id)}>
                    {label}
                  </button>
                ))}
              </div>
              <label className="check">
                <input type="checkbox" checked={proyector} onChange={(e) => setProyector(e.target.checked)} /> Modo proyector (letra más grande)
              </label>
            </div>
          )}
          <div className="modos">
            <button className={mode === 'cartero' ? 'on' : ''} onClick={() => switchMode('cartero')}>
              Recorrer todas las calles
            </button>
            <button className={mode === 'ab' ? 'on' : ''} onClick={() => switchMode('ab')}>
              Ir de A a B
            </button>
          </div>

          {mode === 'ab' && (
            <section>
              <h2>Camino más corto</h2>
              {stops.map((x, i) => (
                <Lugar
                  key={i}
                  letra={LETRAS[i]}
                  role={i === 0 ? 'inicio' : i === stops.length - 1 ? 'fin' : 'medio'}
                  value={x}
                  onChange={(p) => setStop(i, p)}
                  picking={pickPoint === i}
                  onPick={() => setPickPoint(pickPoint === i ? null : i)}
                  onGps={i === 0 ? gps : undefined}
                  onRemove={stops.length > 2 ? () => (setStops((s) => s.filter((_, j) => j !== i)), setPickPoint(null)) : undefined}
                  onUp={i > 0 ? () => setStops((s) => s.map((x, j) => (j === i ? s[i - 1] : j === i - 1 ? s[i] : x))) : undefined}
                  onDown={i < stops.length - 1 ? () => setStops((s) => s.map((x, j) => (j === i ? s[i + 1] : j === i + 1 ? s[i] : x))) : undefined}
                />
              ))}
              <div className="fila">
                <button
                  disabled={stops.length >= LETRAS.length}
                  onClick={() => setStops((s) => [...s, null])}
                  title="Agrega una parada al final (pasa a ser el destino)"
                >
                  + Agregar parada
                </button>
              </div>
              {stops.length > 2 && (
                <label className="check">
                  <input type="checkbox" checked={optimize} onChange={(e) => setOptimize(e.target.checked)} /> Ordenar las paradas para el recorrido más corto (problema del
                  viajante)
                </label>
              )}
              {stops.length > 2 && optimize && !roundTrip && (
                <label className="check">
                  <input type="checkbox" checked={fixEnd} onChange={(e) => setFixEnd(e.target.checked)} /> Terminar en la última parada ({LETRAS[stops.length - 1]}).
                  Si lo quitas, solo {LETRAS[0]} queda fija y la ruta termina donde convenga.
                </label>
              )}
              {stops.length > 2 && !optimize && <p className="ayuda">Se visitan en el orden de la lista; usa ↑ ↓ para cambiarlo.</p>}
              <div className="fila fondo">
                <span>Voy</span>
                {(
                  [
                    [false, 'A pie'],
                    [true, 'En carro o moto'],
                  ] as const
                ).map(([v, label]) => (
                  <button
                    key={label}
                    className={vehicle === v ? 'on' : ''}
                    onClick={() => {
                      setVehicle(v);
                      setAvg((v ? 30 : 5) / 3.6);
                      setWaitCross(v ? 6 : 3);
                      setWaitTurn(v ? 8 : 0);
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <label className="check">
                <input type="checkbox" checked={roundTrip} onChange={(e) => setRoundTrip(e.target.checked)} /> Ida y vuelta (A → B → A)
              </label>
              <button
                className="primario"
                disabled={stops.some((x) => !x) || !!busy}
                onClick={() => send({ type: 'route', points: stops.map((x) => x!.p), vehicle, roundTrip, optimize, fixEnd }, 'Buscando el camino…')}
              >
                Calcular camino más corto
              </button>
              {vehicle && <p className="ayuda">Respeta las calles de un solo sentido y los giros prohibidos de OpenStreetMap.</p>}
              {reproductor}
            </section>
          )}

          {mode === 'cartero' && (
          <>
          <section>
            <h2>1. Área</h2>
            <div className="fila">
              <button className={drawMode === 'rectangle' ? 'on' : ''} onClick={() => setDrawMode(drawMode === 'rectangle' ? null : 'rectangle')}>
                Rectángulo
              </button>
              <button className={drawMode === 'polygon' ? 'on' : ''} onClick={() => setDrawMode(drawMode === 'polygon' ? null : 'polygon')}>
                Polígono
              </button>
              <button
                className={trace ? 'on' : ''}
                onClick={() => {
                  setDrawMode(null);
                  setTracePreview(null);
                  setTrace(trace ? null : { points: [], segs: [] });
                }}
                title="Toca cruces: cada punto se une al anterior por las calles"
              >
                Trazar calles
              </button>
              <select
                value=""
                onChange={(e) => {
                  const val = e.target.value;
                  const zona = (zonas as Record<string, number[][]>)[val];
                  if (zona) onArea(zona);
                  const ej = EJEMPLOS.find((x) => x.name === val);
                  if (ej) {
                    exampleRef.current = true;
                    loadGraph(ej.graph, ej.name);
                    setView('tablero');
                  }
                  const demo = DEMOS.find((x) => x.name === val);
                  if (demo) loadDemo(demo.file);
                }}
              >
                <option value="">Más…</option>
                <optgroup label="Ciudades">
                  {Object.keys(zonas).map((z) => (
                    <option key={z}>{z}</option>
                  ))}
                </optgroup>
                <optgroup label="Sin internet (calles ya descargadas)">
                  {DEMOS.map((x) => (
                    <option key={x.file}>{x.name}</option>
                  ))}
                </optgroup>
                <optgroup label="Ejemplos de clase">
                  {EJEMPLOS.map((x) => (
                    <option key={x.name}>{x.name}</option>
                  ))}
                </optgroup>
              </select>
            </div>
            {trace && (
              <div className="trazado">
                <p className="ayuda">
                  {trace.points.length === 0
                    ? 'Toca el cruce donde empieza. Cada punto que agregues se une al anterior por las calles (la línea punteada es la vista previa).'
                    : `${trace.points.length} punto(s) · ${fmt(traceLength)} de calles. Sigue tocando cruces.`}
                </p>
                <div className="fila">
                  <button disabled={!trace.points.length} onClick={() => setTrace({ points: trace.points.slice(0, -1), segs: trace.segs.slice(0, Math.max(0, trace.points.length - 2)) })}>
                    ↶ Quitar último
                  </button>
                  <button disabled={trace.points.length < 3} onClick={() => traceTo(trace.points[0], false)} title="Une el último punto con el primero">
                    Cerrar
                  </button>
                  <button className="on" disabled={!trace.segs.length || !!busy} onClick={finishTrace}>
                    Usar estas calles
                  </button>
                </div>
              </div>
            )}
            {drawMode && (
              <p className="ayuda">
                {drawMode === 'rectangle' ? 'Toca dos esquinas opuestas.' : 'Toca cada esquina y cierra tocando el primer punto.'}
              </p>
            )}
            {area && (
              <p className="dato">
                Área: {km2.toLocaleString('es-CO', { maximumFractionDigits: 2 })} km²
              </p>
            )}
            <details>
              <summary>Qué calles incluir</summary>
              {(
                [
                  ['troncales', 'Vías troncales (Vía 40, Circunvalar…)'],
                  ['peatonales', 'Calles peatonales y senderos'],
                  ['servicio', 'Vías de servicio (parqueaderos, entradas)'],
                ] as const
              ).map(([k, label]) => (
                <label key={k} className="check">
                  <input type="checkbox" checked={options[k]} onChange={(e) => setOptions({ ...options, [k]: e.target.checked })} /> {label}
                </label>
              ))}
              <label className="check">
                <input type="checkbox" checked={source === 'overpass'} onChange={(e) => setSource(e.target.checked ? 'overpass' : 'auto')} /> Descargar en vivo de
                OpenStreetMap (más lento; si no, se usan las calles guardadas de Barranquilla y Soledad)
              </label>
            </details>
          </section>

          <section>
            <h2>2. Grafo</h2>
            <button className="primario" disabled={!area || !!busy} onClick={() => send({ type: 'build', ring: area!, options, source }, 'Preparando…')}>
              Generar grafo
            </button>
            {graph && origin && <p className="ayuda">Fuente: {origin}.</p>}
            {graph && <p className="ayuda">Toca un vértice para elegir dónde empezar (ahora: {graph.vertices[start]?.id}).</p>}
          </section>

          {graph && (
            <section>
              <h2>Editar grafo</h2>
              <div className="fila herramientas">
                {(
                  [
                    ['mover', 'Mover'],
                    ['agregar', 'Agregar cruce'],
                    ['unir', 'Unir'],
                    ['borrar', 'Borrar'],
                    ['borrar-area', 'Borrar área'],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    className={editTool === id ? 'on' : ''}
                    onClick={() => {
                      // al editar se vuelve al grafo del área (la ruta calculada deja de valer)
                      if (solution?.routeGraph) setSolution(null);
                      setEditTool(editTool === id ? null : id);
                    }}
                  >
                    {label}
                  </button>
                ))}
                <button onClick={undoEdit} disabled={!undo.length} title="Deshacer el último cambio">
                  ↶ Deshacer
                </button>
              </div>
              {editTool && (
                <p className="ayuda">
                  {
                    {
                      mover: 'Arrastra un vértice a su sitio; las calles que llegan a él se estiran.',
                      agregar: 'Toca una calle para partirla con un cruce nuevo, o un lugar vacío para un vértice suelto.',
                      unir: 'Toca un vértice y luego otro: se unen con una calle recta.',
                      borrar: 'Toca un vértice (se borra con sus calles) o una calle.',
                      'borrar-area': 'Toca dos esquinas: se borran todos los vértices que queden dentro, con sus calles.',
                    }[editTool]
                  }{' '}
                  Al terminar, vuelve a calcular la ruta.
                </p>
              )}
            </section>
          )}

          <section>
            <h2>3. Ruta</h2>
            {!isExample && (
              <label className="check">
                <input type="checkbox" checked={freeMove} onChange={(e) => setFreeMove(e.target.checked)} /> Para moverse entre calles, usar también las de fuera del
                área (como Google Maps)
              </label>
            )}
            <button className="primario" disabled={!graph || !!busy} onClick={() => send({ type: 'solve', start, freeMove: freeMove && !isExample }, 'Calculando…')}>
              Calcular ruta óptima
            </button>
            {reproductor}
          </section>
          </>
          )}

          {graph && stats && (
            <section>
              <h2>Teoría</h2>
              <div className="capas">
                {(Object.keys(ALL) as (keyof Layers)[]).map((k) => (
                  <button
                    key={k}
                    className={layers[k] ? 'on' : ''}
                    onClick={() => {
                      setExplain(0);
                      setLayers({ ...layers, [k]: !layers[k] });
                    }}
                  >
                    {k}
                  </button>
                ))}
              </div>
              {!solution && <p className="ayuda">Calcula la ruta para poder explicarla paso a paso.</p>}
              {solution && solution.kind !== 'ab' && (
              <div className="fila">
                <button onClick={() => setExplain(explain >= EXPLICAR.length || !solution ? (solution ? 1 : 0) : explain + 1)} disabled={!solution}>
                  {explain === 0 ? 'Explicar paso a paso' : explain < EXPLICAR.length ? 'Siguiente paso' : 'Volver a empezar'}
                </button>
                {explain > 0 && (
                  <button
                    onClick={() => {
                      setExplain(0);
                      setLayers(ALL);
                    }}
                  >
                    Salir
                  </button>
                )}
              </div>
              )}
              <Teoria
                graph={viewGraph!}
                stats={stats}
                solution={solution}
                explain={explain}
                unit={unit}
                estimate={estimate}
              />
            </section>
          )}

          <section>
            <h2>Archivo</h2>
            <div className="fila">
              <input className="nombre" value={name} onChange={(e) => setName(e.target.value)} aria-label="Nombre del recorrido" />
            </div>
            <div className="fila">
              <button disabled={!graph} onClick={() => exportProject({ name, area, options, graph: graph!, solution, start })}>
                Exportar JSON
              </button>
              <label className="boton">
                Importar JSON
                <input
                  type="file"
                  accept="application/json,.json"
                  hidden
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    try {
                      setDriveId(undefined);
                      openProject(await importProject(f));
                    } catch (err) {
                      setError((err as Error).message);
                    }
                    e.target.value = '';
                  }}
                />
              </label>
            </div>
            <div className="fila">
              <button disabled={!graph || !driveConfigured || !!busy} onClick={saveDrive} title={driveId ? 'Reemplaza el archivo abierto' : 'Crea un archivo en la carpeta CarteroChino'}>
                {driveId ? 'Actualizar en Drive' : 'Guardar en Drive'}
              </button>
              <button disabled={!driveConfigured || !!busy} onClick={() => (driveList ? setDriveList(null) : listDriveFiles())}>
                {driveList ? 'Cerrar lista' : 'Abrir de Drive'}
              </button>
            </div>
            {!driveConfigured && <p className="ayuda">Para usar Google Drive falta poner el ID de cliente de Google en el archivo .env.local (VITE_GOOGLE_CLIENT_ID).</p>}
            {driveList && (
              <ul className="drive-lista">
                {driveList.length === 0 && <li className="ayuda">Todavía no hay recorridos guardados en Drive.</li>}
                {driveList.map((f) => (
                  <li key={f.id}>
                    <button onClick={() => openDrive(f)}>
                      <b>{f.name.replace(/\.json$/, '')}</b>
                      <span>{new Date(f.modifiedTime).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' })}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <p className="creditos">Calles © colaboradores de OpenStreetMap (ODbL).</p>
        </div>
      </aside>

      {error && (
        <div className="aviso error" onClick={() => setError(null)} title="Toca para cerrar">
          {error}
        </div>
      )}
      {!error && busy && <Progreso busy={busy} onCancel={cancel} />}
      {!error && !busy && notice && <div className="aviso ok">{notice}</div>}
    </div>
  );
}

function Progreso({ busy, onCancel }: { busy: Busy; onCancel(): void }) {
  const secs = Math.floor((Date.now() - busy.since) / 1000);
  const dl = busy.download;
  const mb = (b: number) => (b < 1e6 ? `${Math.round(b / 1000)} KB` : `${(b / 1e6).toLocaleString('es-CO', { maximumFractionDigits: 1 })} MB`);
  return (
    <div className="aviso progreso">
      <div className="progreso-fila">
        <span className="girando" aria-hidden />
        <b>{busy.msg}</b>
        <span className="progreso-tiempo">{secs} s</span>
        <button onClick={onCancel}>Cancelar</button>
      </div>
      {dl && (
        <div className="progreso-detalle">
          Servidor {dl.host} ({dl.attempt} de {dl.of}) ·{' '}
          {dl.phase === 'esperando' ? 'esperando respuesta… (el servidor arma los datos antes de enviarlos)' : `recibiendo ${mb(dl.bytes)}`}
          {dl.failed.map((f) => (
            <div key={f} className="progreso-fallo">
              ✗ {f}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Banner(p: { turn: Turn; left: number; street?: string; next?: string; repeat: boolean }) {
  const icon: Record<string, string> = { recto: '⬆', derecha: '➡', izquierda: '⬅', 'leve-derecha': '↗', 'leve-izquierda': '↖', vuelta: '⮌', fin: '⚑' };
  return (
    <div className="banner">
      <div className="banner-icono">{icon[p.turn]}</div>
      <div>
        <div className="banner-dist">{fmt(p.left)}</div>
        <div className="banner-texto">
          {TURN_TEXT[p.turn]}
          {p.next && p.turn !== 'fin' ? ` por ${p.next}` : ''}
        </div>
        <div className="banner-calle">
          {p.street ?? 'Calle sin nombre'}
          {p.repeat && <span className="pill">repites esta calle</span>}
        </div>
      </div>
    </div>
  );
}

const multLabel = (x: number) => `×${x.toLocaleString('es-CO')}`;
const multHint = (x: number) =>
  x === 1 ? 'tiempo real' : x < 1 ? `cámara lenta: 1 s real se ve en ${1 / x} s` : x < 60 ? `1 s de animación = ${x} s reales` : `1 s de animación = ${x / 60} min reales`;

/** Reproducción: cuántas veces más rápido (o más lento) que el tiempo real se ve el recorrido. */
function MultSelect({ value, onChange }: { value: number; onChange(x: number): void }) {
  return (
    <select value={value} onChange={(e) => onChange(+e.target.value)} aria-label="Velocidad de reproducción">
      {MULTS.map((x) => (
        <option key={x} value={x}>
          {multLabel(x)}
          {x === 1 ? ' (real)' : x < 1 ? ' (lento)' : ''}
        </option>
      ))}
    </select>
  );
}

/** Controles para simular el recorrido sin caminar: avanzar por indicaciones o "caminar" solo. */
function NavBar(p: {
  playing: boolean;
  mult: number;
  onMult(x: number): void;
  manual: boolean;
  onFollow(): void;
  onPlay(): void;
  onRestart(): void;
  onPrev(): void;
  onNext(): void;
  streetsDone: number;
  streets: number;
  left: number;
  step: number;
  steps: number;
}) {
  return (
    <div className="navbar">
      <div className="navbar-botones">
        <button onClick={p.onRestart} title="Volver al inicio">
          ⟲
        </button>
        <button onClick={p.onPrev} title="Indicación anterior">
          ⏮
        </button>
        <button className="navbar-play" onClick={p.onPlay} title={p.playing ? 'Pausar' : 'Simular el recorrido'}>
          {p.playing ? '⏸' : '▶'}
        </button>
        <button onClick={p.onNext} title="Siguiente indicación">
          ⏭
        </button>
        <MultSelect value={p.mult} onChange={p.onMult} />
        {p.manual && (
          <button className="navbar-seguir" onClick={p.onFollow} title="Volver a seguir al cartero desde atrás">
            🧭
          </button>
        )}
      </div>
      <div className="navbar-datos">
        Calles recorridas <b>{p.streetsDone.toLocaleString('es-CO')}</b> de {p.streets.toLocaleString('es-CO')} · faltan <b>{fmt(p.left)}</b> · paso{' '}
        {p.step.toLocaleString('es-CO')} de {p.steps.toLocaleString('es-CO')}
      </div>
    </div>
  );
}
