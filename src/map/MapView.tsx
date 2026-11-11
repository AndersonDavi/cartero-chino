import maplibregl, { type GeoJSONSource, type LngLatBoundsLike, type Map as MlMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { TerraDraw, TerraDrawPolygonMode, TerraDrawRectangleMode } from 'terra-draw';
import { TerraDrawMapLibreGLAdapter } from 'terra-draw-maplibre-gl-adapter';
import { moveVertex, nearestOnLine, type EditOp } from '../core/editar';
import { degrees } from '../core/graph';
import { positionAt, type RouteStep } from '../core/route';
import { sliceAlong } from '../core/geo';
import type { Edge, Graph, LatLon, Solution } from '../core/types';
import { geometryLength } from '../core/route';

export type View = 'plano' | 'aerea' | '3d' | 'navegar' | 'tablero';
export type Fondo = 'completo' | 'minimo' | 'ninguno';
export type EditTool = 'mover' | 'agregar' | 'unir' | 'borrar' | 'borrar-area';
export interface Layers { grafo: boolean; impares: boolean; parejas: boolean; duplicadas: boolean; ruta: boolean }

export interface MapApi {
  setProgress(d: number): void;
  fit(): void;
  followHeading(): void; // volver a girar con la ruta después de un giro manual
}

interface Props {
  view: View;
  fondo: Fondo;
  area: number[][] | null;
  graph: Graph | null;
  dropped: Edge[];
  solution: Solution | null;
  steps: RouteStep[];
  start: number;
  layers: Layers;
  follow: boolean;
  drawMode: 'rectangle' | 'polygon' | null;
  onArea(ring: number[][]): void;
  onPickStart(v: number): void;
  editTool: EditTool | null;
  onEdit(op: EditOp): void;
  onNotice(msg: string): void;
  fitKey: number; // cambia cuando hay un grafo nuevo (no cuando se edita): ahí se reencuadra
  onManualRotate(manual: boolean): void;
  tracing: boolean; // herramienta "Trazar calles"
  trace: { done: LatLon[][]; points: LatLon[]; preview: LatLon[] | null };
  onTraceClick(p: LatLon): void;
  onTraceHover(p: LatLon): void;
  points: { label: string; p: LatLon; role: 'inicio' | 'medio' | 'fin' }[]; // paradas de la ruta
  pickPoint: boolean;
  onPickPoint(p: LatLon): void;
}

const STYLE = 'https://tiles.openfreemap.org/styles/liberty';
const CENTER: [number, number] = [-74.8, 10.98];
export const C = { edge: '#334155', odd: '#dc2626', start: '#16a34a', dup: '#f97316', route: '#2563eb', match: '#a21caf', dropped: '#94a3b8', extra: '#0d9488' };

const ll = (p: LatLon): [number, number] => [p[1], p[0]];
const fc = (features: GeoJSON.Feature[]): GeoJSON.FeatureCollection => ({ type: 'FeatureCollection', features });
const line = (pts: LatLon[], properties: Record<string, unknown> = {}): GeoJSON.Feature => ({
  type: 'Feature',
  properties,
  geometry: { type: 'LineString', coordinates: pts.map(ll) },
});

export const MapView = forwardRef<MapApi, Props>(function MapView(props, ref) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const draw = useRef<TerraDraw | null>(null);
  const marker = useRef<maplibregl.Marker | null>(null);
  const heading = useRef(0);
  const baseVisibility = useRef(new Map<string, string>());
  const latest = useRef(props);
  const manual = useRef(false); // el usuario arrastró el mapa en navegar (cámara libre)
  const manualBearing = useRef(false); // el usuario giró el mapa a mano (se respeta su ángulo)
  const interacting = useRef(false); // el usuario está arrastrando la cámara ahora mismo
  const lastTick = useRef(0);
  const userZoom = useRef(false); // el usuario está haciendo zoom (rueda o pellizco)
  const lastIdx = useRef(-1);
  latest.current = props;
  const [ready, setReady] = useState(false);
  // con recarga en caliente el mapa se recrea y `ready` puede seguir en true un
  // instante: los efectos revisan además que el mapa actual haya terminado de cargar
  const loaded = useRef(false);

  // --- crear el mapa una sola vez ---
  useEffect(() => {
    const m = new maplibregl.Map({ container: box.current!, style: STYLE, center: CENTER, zoom: 12.5, maxPitch: 75, attributionControl: { compact: true } });
    map.current = m;
    if (import.meta.env.DEV) (window as unknown as { mapa: MlMap }).mapa = m;
    m.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
    // Mientras la animación corre, la cámara se recoloca en cada cuadro, y eso cancela
    // cualquier gesto del usuario (MapLibre detiene los gestos al mover la cámara). Por eso
    // se mira directo en el navegador si el usuario tiene el dedo o el mouse abajo, gira la
    // rueda o usa los botones: mientras tanto la animación no toca la cámara.
    const cont = m.getContainer();
    let quietTimer = 0;
    const busyFor = (ms: number) => {
      userZoom.current = true;
      clearTimeout(quietTimer);
      quietTimer = window.setTimeout(() => (userZoom.current = false), ms);
    };
    cont.addEventListener('pointerdown', () => (interacting.current = true), { capture: true });
    window.addEventListener('pointerup', () => (interacting.current = false));
    window.addEventListener('pointercancel', () => (interacting.current = false));
    cont.addEventListener('wheel', () => busyFor(400), { capture: true, passive: true });
    m.on('zoomstart', (e) => e.originalEvent && busyFor(700)); // botones + y −
    m.on('zoomend', (e) => e.originalEvent && busyFor(250));
    // En navegar: girar o inclinar a mano deja ese ángulo (sigue al cartero); arrastrar el
    // mapa deja la cámara libre. La brújula del panel vuelve a la vista por detrás.
    const gesture = (e: { originalEvent?: Event }) => !!e.originalEvent && e.originalEvent.type !== 'click';
    m.on('rotatestart', (e) => {
      if (!gesture(e) || latest.current.view !== 'navegar') return;
      manualBearing.current = true;
      latest.current.onManualRotate(true);
    });
    m.on('dragstart', (e) => {
      if (!gesture(e) || latest.current.view !== 'navegar') return;
      manual.current = true;
      latest.current.onManualRotate(true);
    });
    m.on('load', () => {
      for (const l of m.getStyle().layers) baseVisibility.current.set(l.id, (l.layout?.visibility as string) ?? 'visible');
      m.addSource('satelite', {
        type: 'raster',
        tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
        tileSize: 256,
        maxzoom: 19,
        attribution: 'Imágenes © Esri, Maxar, Earthstar Geographics',
      });
      m.addLayer({ id: 'satelite', type: 'raster', source: 'satelite', layout: { visibility: 'none' } }, m.getStyle().layers[1]?.id);
      addOverlay(m);

      const td = new TerraDraw({
        adapter: new TerraDrawMapLibreGLAdapter({ map: m }),
        modes: [
          new TerraDrawRectangleMode({ styles: { fillColor: '#2563eb', fillOpacity: 0.12, outlineColor: '#2563eb', outlineWidth: 2 } }),
          new TerraDrawPolygonMode({ styles: { fillColor: '#2563eb', fillOpacity: 0.12, outlineColor: '#2563eb', outlineWidth: 2, closingPointColor: '#2563eb', closingPointWidth: 6 } }),
        ],
      });
      td.start();
      td.on('finish', (id) => {
        const f = td.getSnapshotFeature(id);
        if (f && f.geometry.type === 'Polygon') {
          const ring = f.geometry.coordinates[0] as number[][];
          // con la herramienta "Borrar área" el rectángulo no elige el área: borra lo que encierra
          if (latest.current.editTool === 'borrar-area') latest.current.onEdit({ type: 'removeArea', ring });
          else latest.current.onArea(ring);
        }
        td.clear();
      });
      draw.current = td;

      const box = (pt: { x: number; y: number }, r: number): [[number, number], [number, number]] => [
        [pt.x - r, pt.y - r],
        [pt.x + r, pt.y + r],
      ];
      const near = (pt: { x: number; y: number }, layer: string, r = 10) =>
        m.queryRenderedFeatures(box(pt, r), { layers: [layer] })[0]?.properties.i as number | undefined;
      // capas de calles del mapa de fondo (para pegar los puntos a una calle real)
      const roadLayers = m
        .getStyle()
        .layers.filter((l) => l.type === 'line' && /^(road|bridge|tunnel)_/.test(l.id) && !/rail/.test(l.id))
        .map((l) => l.id);

      /** Punto de calle más cercano (de nuestro grafo o del mapa de fondo) a menos de 25 px. */
      const snap = (pt: { x: number; y: number }, skipVertex?: number): { p: LatLon; edge?: number } | null => {
        const g = latest.current.graph;
        const layers = ['edges', ...roadLayers.filter((id) => m.getLayer(id) && m.getLayoutProperty(id, 'visibility') !== 'none')];
        let best: { p: LatLon; edge?: number; px: number } | null = null;
        for (const f of m.queryRenderedFeatures(box(pt, 25), { layers })) {
          const own = f.layer.id === 'edges';
          const i = own ? (f.properties.i as number) : undefined;
          if (own && g && skipVertex !== undefined && i !== undefined && (g.edges[i].u === skipVertex || g.edges[i].v === skipVertex)) continue;
          const lines =
            own && g && i !== undefined
              ? [g.edges[i].geometry]
              : f.geometry.type === 'LineString'
                ? [f.geometry.coordinates.map(([x, y]) => [y, x] as LatLon)]
                : f.geometry.type === 'MultiLineString'
                  ? f.geometry.coordinates.map((l) => l.map(([x, y]) => [y, x] as LatLon))
                  : [];
          const at = m.unproject([pt.x, pt.y]);
          for (const ln of lines) {
            if (ln.length < 2) continue;
            const q = nearestOnLine(ln, [at.lat, at.lng]).point;
            const qp = m.project(ll(q));
            const px = Math.hypot(qp.x - pt.x, qp.y - pt.y);
            // se prefieren nuestras aristas cuando están casi igual de cerca
            const score = own ? px - 3 : px;
            if (!best || score < best.px) best = { p: q, edge: i, px: score };
          }
        }
        return best && best.px <= 25 ? { p: best.p, edge: best.edge } : null;
      };
      const point = (p: LatLon | null) =>
        fc(p ? [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: ll(p) } }] : []);
      const clearHover = () => {
        m.setFilter('hover-v', ['==', ['get', 'i'], -1]);
        m.setFilter('hover-e', ['==', ['get', 'i'], -1]);
        (m.getSource('snap') as GeoJSONSource).setData(fc([]));
        (m.getSource('preview') as GeoJSONSource).setData(fc([]));
      };
      clearHoverRef.current = clearHover;

      const pick = (e: maplibregl.MapMouseEvent) => {
        const p = latest.current;
        if (p.pickPoint) return p.onPickPoint([e.lngLat.lat, e.lngLat.lng]);
        if (p.tracing) return p.onTraceClick([e.lngLat.lat, e.lngLat.lng]);
        if (p.drawMode) return;
        const g = p.graph;
        const v = near(e.point, 'vertices', 12);
        if (p.editTool === 'agregar') {
          const sp = snap(e.point);
          if (!sp) return p.onNotice('Ahí no hay una calle: toca sobre una calle para agregar el cruce.');
          if (sp.edge !== undefined) {
            p.onEdit({ type: 'add', p: sp.p, edge: sp.edge });
            p.onNotice(`Cruce agregado: partió la calle ${g?.edges[sp.edge].id}${g?.edges[sp.edge].name ? ` (${g.edges[sp.edge].name})` : ''}.`);
          } else {
            p.onEdit({ type: 'add', p: sp.p });
            p.onNotice('Cruce agregado sobre una calle que no estaba en el grafo: todavía no tiene conexión. Usa "Unir" para conectarlo.');
          }
          return clearHover();
        }
        if (p.editTool === 'unir') {
          if (v === undefined) return p.onNotice('Toca un vértice (un punto del grafo).');
          if (selected.current === null || selected.current === v) {
            selected.current = v;
            p.onNotice(`${g?.vertices[v].id} elegido: ahora toca el otro vértice.`);
          } else {
            p.onEdit({ type: 'connect', a: selected.current, b: v });
            selected.current = null;
          }
          clearHover();
          return m.setFilter('sel', ['==', ['get', 'i'], selected.current ?? -1]);
        }
        if (p.editTool === 'borrar') {
          if (v !== undefined) {
            const n = g ? g.edges.filter((ed) => ed.u === v || ed.v === v).length : 0;
            p.onEdit({ type: 'removeVertex', v });
            p.onNotice(`Borrado ${g?.vertices[v].id} y ${n} calle(s).`);
          } else {
            const ed = near(e.point, 'edges', 6);
            if (ed === undefined) return p.onNotice('Toca un vértice o una calle del grafo para borrarlo.');
            p.onEdit({ type: 'removeEdge', e: ed });
            p.onNotice(`Borrada la calle ${g?.edges[ed].id}.`);
          }
          return clearHover();
        }
        if (p.editTool === 'mover' || p.editTool === 'borrar-area') return;
        if (v !== undefined) p.onPickStart(v);
      };
      m.on('click', pick);

      // vista previa al trazar: el camino por calles desde el último punto hasta el mouse
      let lastTrace = 0;
      m.on('mousemove', (e) => {
        if (!latest.current.tracing) return;
        const now = performance.now();
        if (now - lastTrace < 120) return;
        lastTrace = now;
        latest.current.onTraceHover([e.lngLat.lat, e.lngLat.lng]);
      });

      // resaltar lo que va a cambiar al pasar el mouse, según la herramienta
      let hoverRaf = 0;
      m.on('mousemove', (e) => {
        const tool = latest.current.editTool;
        if (!tool || tool === 'borrar-area' || dragging.current) return;
        cancelAnimationFrame(hoverRaf);
        hoverRaf = requestAnimationFrame(() => {
          const v = near(e.point, 'vertices', 12);
          const ed = v === undefined ? near(e.point, 'edges', 8) : undefined;
          clearHover();
          if (tool === 'agregar') {
            const sp = snap(e.point);
            (m.getSource('snap') as GeoJSONSource).setData(point(sp?.p ?? null));
            if (sp?.edge !== undefined) m.setFilter('hover-e', ['==', ['get', 'i'], sp.edge]);
          } else if (tool === 'borrar') {
            if (v !== undefined) {
              m.setFilter('hover-v', ['==', ['get', 'i'], v]);
              m.setFilter('hover-e', ['any', ['==', ['get', 'u'], v], ['==', ['get', 'v'], v]]);
            } else if (ed !== undefined) m.setFilter('hover-e', ['==', ['get', 'i'], ed]);
          } else if (v !== undefined) {
            m.setFilter('hover-v', ['==', ['get', 'i'], v]);
            const g = latest.current.graph;
            if (tool === 'unir' && selected.current !== null && selected.current !== v && g) {
              const a = g.vertices[selected.current];
              const b = g.vertices[v];
              (m.getSource('preview') as GeoJSONSource).setData(fc([line([[a.lat, a.lon], [b.lat, b.lon]])]));
            }
          }
          m.setPaintProperty('hover-e', 'line-color', tool === 'borrar' ? '#dc2626' : tool === 'agregar' ? '#16a34a' : '#2563eb');
          m.setPaintProperty('hover-v', 'circle-stroke-color', tool === 'borrar' ? '#dc2626' : '#2563eb');
        });
      });

      // arrastrar un vértice con la herramienta "mover": se ve en vivo y se pega a una calle
      const startDrag = (e: maplibregl.MapMouseEvent | maplibregl.MapTouchEvent) => {
        if (latest.current.editTool !== 'mover' || !latest.current.graph) return;
        const v = near(e.point, 'vertices', 12);
        if (v === undefined) return;
        e.preventDefault();
        dragging.current = true;
        clearHover();
        m.dragPan.disable();
        const g0 = latest.current.graph;
        let target: LatLon | null = null;
        let raf = 0;
        const move = (ev: maplibregl.MapMouseEvent | maplibregl.MapTouchEvent) => {
          cancelAnimationFrame(raf);
          raf = requestAnimationFrame(() => {
            const sp = snap(ev.point, v);
            target = sp?.p ?? null;
            const p: LatLon = target ?? [ev.lngLat.lat, ev.lngLat.lng];
            const preview = graphData(moveVertex(g0, v, p));
            src('edges').setData(preview.edges);
            src('vertices').setData(preview.vertices);
            (m.getSource('snap') as GeoJSONSource).setData(point(target));
          });
        };
        const end = () => {
          cancelAnimationFrame(raf);
          m.off('mousemove', move);
          m.off('touchmove', move);
          m.dragPan.enable();
          dragging.current = false;
          clearHover();
          if (target) latest.current.onEdit({ type: 'move', v, p: target });
          else {
            const back = graphData(g0);
            src('edges').setData(back.edges);
            src('vertices').setData(back.vertices);
            latest.current.onNotice('Suelta el vértice sobre una calle (no dentro de una manzana).');
          }
        };
        m.on('mousemove', move);
        m.on('touchmove', move);
        m.once('mouseup', end);
        m.once('touchend', end);
      };
      m.on('mousedown', startDrag);
      m.on('touchstart', startDrag);
      loaded.current = true;
      setReady(true);
    });
    const el = document.createElement('div');
    el.className = 'cartero';
    el.innerHTML = '<svg viewBox="0 0 40 40" width="40" height="40"><circle cx="20" cy="20" r="17" fill="#2563eb" stroke="white" stroke-width="3"/><path d="M20 8 L29 28 L20 23 L11 28 Z" fill="white"/></svg>';
    marker.current = new maplibregl.Marker({ element: el, rotationAlignment: 'map', pitchAlignment: 'map' }).setLngLat(CENTER);
    return () => {
      loaded.current = false;
      setReady(false);
      m.remove();
    };
  }, []);

  // --- puntos A y B de la ruta ---
  const pins = useRef(new Map<string, maplibregl.Marker>());
  const selected = useRef<number | null>(null);
  const dragging = useRef(false);
  const clearHoverRef = useRef<() => void>(() => {});
  useEffect(() => {
    const m = map.current;
    if (!ready || !loaded.current || !m) return;
    const want = new Map(props.points.map((x) => [`${x.label}:${x.role}`, x]));
    for (const [key, mk] of pins.current) {
      if (!want.has(key)) {
        mk.remove();
        pins.current.delete(key);
      }
    }
    for (const [key, x] of want) {
      let mk = pins.current.get(key);
      if (!mk) {
        const el = document.createElement('div');
        // el marcador mueve el elemento con transform, así que se rota uno interno
        el.innerHTML = `<div class="pin pin-${x.role}"><span>${x.label}</span></div>`;
        mk = new maplibregl.Marker({ element: el, anchor: 'bottom' });
        pins.current.set(key, mk);
      }
      mk.setLngLat(ll(x.p)).addTo(m);
    }
    const ps = props.points.map((x) => x.p);
    if (ps.length >= 2 && !props.solution) {
      const lats = ps.map((p) => p[0]);
      const lons = ps.map((p) => p[1]);
      m.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]], { padding: 120, maxZoom: 16, duration: 600 });
    } else if (ps.length === 1) {
      m.easeTo({ center: ll(ps[0]), zoom: Math.max(m.getZoom(), 14), duration: 600 });
    }
  }, [ready, props.points.map((x) => `${x.label}${x.p}`).join('|')]);

  useEffect(() => {
    if (!ready || !loaded.current) return;
    const cursors: Record<EditTool, string> = { mover: 'move', agregar: 'crosshair', unir: 'crosshair', borrar: 'not-allowed', 'borrar-area': 'crosshair' };
    map.current!.getCanvas().style.cursor = props.pickPoint || props.tracing ? 'crosshair' : props.editTool ? cursors[props.editTool] : '';
    selected.current = null;
    map.current!.setFilter('sel', ['==', ['get', 'i'], -1]);
    clearHoverRef.current();
  }, [ready, props.pickPoint, props.editTool, props.tracing]);

  // --- trazado a mano ---
  useEffect(() => {
    if (!ready || !loaded.current) return;
    const t = props.trace;
    src('trace').setData(fc(t.done.filter((g) => g.length > 1).map((g) => line(g))));
    src('trace-preview').setData(fc(t.preview && t.preview.length > 1 ? [line(t.preview)] : []));
    src('trace-pts').setData(
      fc(t.points.map((p, i) => ({ type: 'Feature', properties: { first: i === 0 }, geometry: { type: 'Point', coordinates: ll(p) } }))),
    );
  }, [ready, props.trace]);

  // --- modo de dibujo ---
  useEffect(() => {
    if (!ready || !loaded.current || !draw.current) return;
    const borrarArea = props.editTool === 'borrar-area';
    draw.current.setModeStyles('rectangle', {
      fillColor: borrarArea ? '#dc2626' : '#2563eb',
      fillOpacity: borrarArea ? 0.18 : 0.12,
      outlineColor: borrarArea ? '#dc2626' : '#2563eb',
      outlineWidth: 2,
    });
    draw.current.setMode(props.drawMode ?? (borrarArea ? 'rectangle' : 'static'));
  }, [ready, props.drawMode, props.editTool]);

  // --- vistas (plano, aérea, 3D, navegar) y cuánto mapa de fondo se ve ---
  useEffect(() => {
    const m = map.current;
    if (!ready || !loaded.current || !m || props.view === 'tablero') return;
    const aerea = props.view === 'aerea';
    const tresD = props.view === '3d' || props.view === 'navegar';
    const fondo = props.fondo;
    // mínimo: solo agua y nombres de calles y barrios; nada: solo el color de fondo
    const minimo = (id: string) => id === 'background' || id.startsWith('water') || id.startsWith('highway-name') || id.startsWith('label_');
    for (const [id, vis] of baseVisibility.current) {
      const type = m.getLayer(id)?.type;
      let v = vis;
      if (aerea && type !== 'symbol') v = 'none';
      if (id === 'building-3d') v = tresD && !aerea ? 'visible' : 'none';
      if (id === 'building') v = aerea ? 'none' : vis;
      if (fondo === 'minimo' && !minimo(id)) v = 'none';
      if (fondo === 'ninguno' && id !== 'background') v = 'none';
      m.setLayoutProperty(id, 'visibility', v);
    }
    m.setLayoutProperty('satelite', 'visibility', aerea && fondo !== 'ninguno' ? 'visible' : 'none');
    m.setPaintProperty('satelite', 'raster-opacity', fondo === 'minimo' ? 0.35 : 1);
    const claro = aerea && fondo !== 'ninguno';
    m.setPaintProperty('edges', 'line-color', claro ? '#f8fafc' : C.edge);
    m.setPaintProperty('edges', 'line-opacity', claro ? 0.9 : 0.75);
  }, [ready, props.view, props.fondo]);

  useEffect(() => {
    const m = map.current;
    if (!ready || !loaded.current || !m || props.view === 'tablero') return;
    const noPad = { top: 0, bottom: 0, left: 0, right: 0 };
    // la aérea se ve siempre desde arriba; el plano empieza desde arriba pero se puede inclinar
    // (sirve para ver en perspectiva sin los edificios 3D)
    const tilt = props.view !== 'aerea';
    m.setMaxPitch(tilt ? 75 : 0);
    if (props.view === '3d') m.easeTo({ pitch: 60, bearing: -25, padding: noPad, duration: 900 });
    else if (props.view === 'navegar') {
      manual.current = false;
      manualBearing.current = false;
      latest.current.onManualRotate(false);
      lastTick.current = 0;
      m.easeTo({ pitch: 62, zoom: Math.max(m.getZoom(), 17), duration: 700 });
    } else m.easeTo({ pitch: 0, bearing: 0, padding: noPad, duration: 900 });
    setTimeout(() => m.resize(), 0);
  }, [ready, props.view]);

  // --- área seleccionada ---
  useEffect(() => {
    if (!ready || !loaded.current) return;
    const ring = props.area;
    src('area').setData(fc(ring ? [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } }] : []));
  }, [ready, props.area]);

  // --- grafo ---
  useEffect(() => {
    if (!ready || !loaded.current) return;
    const g = props.graph;
    if (!g) {
      ['edges', 'vertices', 'dropped'].forEach((s) => src(s).setData(fc([])));
      return;
    }
    const data = graphData(g);
    src('edges').setData(data.edges);
    src('vertices').setData(data.vertices);
    src('dropped').setData(fc(props.dropped.map((e) => line(e.geometry))));
  }, [ready, props.graph, props.dropped]);

  useEffect(() => {
    if (ready && loaded.current) fitGraph();
  }, [ready, props.fitKey]);

  // --- solución: parejas, duplicadas y ruta completa ---
  useEffect(() => {
    if (!ready || !loaded.current) return;
    const g = props.graph;
    const sol = props.solution;
    if (!g || !sol) {
      ['matching', 'dups', 'route', 'route-current', 'giros'].forEach((s) => src(s).setData(fc([])));
      marker.current?.remove();
      return;
    }
    src('matching').setData(fc(sol.pairs.map((p) => line([[g.vertices[p.a].lat, g.vertices[p.a].lon], [g.vertices[p.b].lat, g.vertices[p.b].lon]]))));
    src('dups').setData(fc(sol.duplicated.map((e) => line(g.edges[e].geometry))));
    src('giros').setData(
      fc((sol.ab?.turns?.onRoute ?? []).map((p) => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: ll(p) } }))),
    );
    src('route').setData(fc(props.steps.map((s, idx) => line(s.geometry, { idx, repeat: s.repeat, extra: !!g.edges[s.edge].extra }))));
    lastIdx.current = -1;
    // en la ruta de A a B toda la trayectoria se ve desde el principio
    map.current!.setPaintProperty('route-todo', 'line-opacity', sol.kind === 'ab' ? 0.55 : 0.12);
    marker.current?.addTo(map.current!);
    api.setProgress(0);
  }, [ready, props.solution, props.steps]);

  // --- inicio ---
  useEffect(() => {
    if (!ready || !loaded.current) return;
    map.current!.setFilter('start', ['==', ['get', 'i'], props.start]);
  }, [ready, props.start, props.graph]);

  // --- capas visibles ---
  useEffect(() => {
    if (!ready || !loaded.current) return;
    const m = map.current!;
    const show = (ids: string[], on: boolean) => ids.forEach((id) => m.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none'));
    const L = props.layers;
    show(['edges', 'edges-extra', 'edges-label', 'vertices', 'vertices-label', 'start', 'dropped'], L.grafo);
    show(['odd'], L.impares);
    show(['matching'], L.parejas);
    show(['dups'], L.duplicadas);
    show(['route-done', 'route-current', 'route-todo'], L.ruta);
    const el = marker.current?.getElement();
    if (el) el.style.display = L.ruta ? '' : 'none';
  }, [ready, props.layers, props.solution]);

  function src(id: string) {
    return map.current!.getSource(id) as GeoJSONSource;
  }

  function fitGraph() {
    const g = latest.current.graph;
    const m = map.current;
    if (!g || !m || g.vertices.length === 0) return;
    let [w, s, e, n] = [180, 90, -180, -90];
    for (const v of g.vertices) {
      w = Math.min(w, v.lon);
      e = Math.max(e, v.lon);
      s = Math.min(s, v.lat);
      n = Math.max(n, v.lat);
    }
    const mobile = window.innerWidth < 800;
    m.fitBounds([[w, s], [e, n]] as LngLatBoundsLike, {
      padding: mobile ? { top: 70, bottom: window.innerHeight * 0.45, left: 20, right: 20 } : { top: 60, bottom: 40, left: 420, right: 60 },
      maxZoom: 18,
      duration: 800,
    });
  }

  const api: MapApi = {
    setProgress(d: number) {
      const m = map.current;
      const steps = latest.current.steps;
      if (!m || !ready || steps.length === 0) return;
      const pos = positionAt(steps, d);
      const s = steps[pos.i];
      // el filtro solo cambia al pasar a otra calle (no en cada cuadro)
      if (pos.i !== lastIdx.current) {
        m.setFilter('route-done', ['<', ['get', 'idx'], pos.i]);
        lastIdx.current = pos.i;
      }
      const frac = s.length > 0 ? pos.offset / s.length : 0;
      const partial = sliceAlong(s.geometry, frac * geometryLength(s.geometry));
      src('route-current').setData(fc(partial.length > 1 ? [line(partial, { repeat: s.repeat, extra: !!latest.current.graph?.edges[s.edge].extra })] : []));
      marker.current?.setLngLat(ll(pos.p)).setRotation(pos.heading);
      // la cámara gira suave hacia el rumbo de la calle (como en Waze), según el tiempo
      // transcurrido y no por cuadro, así no da un giro brusco en los cruces
      const now = performance.now();
      const dt = lastTick.current ? Math.min(0.5, (now - lastTick.current) / 1000) : 1;
      lastTick.current = now;
      const diff = ((pos.heading - heading.current + 540) % 360) - 180;
      heading.current = (heading.current + diff * (1 - Math.exp(-dt / 0.45)) + 360) % 360;
      const p = latest.current;
      if (p.view === 'navegar') {
        // como en Waze: el cartero va abajo y se ve más calle hacia adelante
        const h = window.innerHeight;
        const padding = window.innerWidth < 800 ? { top: h * 0.3, bottom: h * 0.45, left: 0, right: 0 } : { top: h * 0.35, bottom: 0, left: 400, right: 0 };
        // se respetan el zoom y la inclinación que ponga el usuario; si giró el mapa a mano, también el giro
        // con la cámara libre solo se mueve el cartero; si no, la cámara lo sigue por detrás
        if (!manual.current && !interacting.current && !userZoom.current) {
          m.jumpTo(manualBearing.current ? { center: ll(pos.p), padding } : { center: ll(pos.p), bearing: heading.current, padding });
        }
      } else if (p.follow && !userZoom.current && !interacting.current) {
        m.jumpTo({ center: ll(pos.p) });
      }
    },
    fit: fitGraph,
    followHeading() {
      manual.current = false;
      manualBearing.current = false;
      latest.current.onManualRotate(false);
    },
  };
  useImperativeHandle(ref, () => api);

  return <div ref={box} className="map" style={{ display: props.view === 'tablero' ? 'none' : 'block' }} />;
});

/** Capas de vértices y aristas del grafo (las aristas llevan u y v para resaltar). */
function graphData(g: Graph) {
  const deg = degrees(g);
  const small = g.vertices.length <= 400;
  return {
    edges: fc(g.edges.map((e, i) => line(e.geometry, { i, u: e.u, v: e.v, id: e.id, label: small ? e.id : '', extra: !!e.extra }))),
    vertices: fc(
      g.vertices.map((v, i) => ({
        type: 'Feature' as const,
        properties: { i, id: v.id, odd: deg[i] % 2 === 1, label: small ? v.id : '' },
        geometry: { type: 'Point' as const, coordinates: [v.lon, v.lat] },
      })),
    ),
  };
}

function addOverlay(m: MlMap) {
  const empty = fc([]);
  for (const id of ['area', 'dropped', 'edges', 'dups', 'matching', 'route', 'route-current', 'vertices', 'giros', 'drag', 'snap', 'preview', 'trace', 'trace-preview', 'trace-pts']) {
    m.addSource(id, { type: 'geojson', data: empty });
  }
  const font = ['Noto Sans Bold'];
  m.addLayer({ id: 'area-fill', type: 'fill', source: 'area', paint: { 'fill-color': '#2563eb', 'fill-opacity': 0.06 } });
  m.addLayer({ id: 'area-line', type: 'line', source: 'area', paint: { 'line-color': '#2563eb', 'line-width': 2, 'line-dasharray': [2, 2] } });
  m.addLayer({ id: 'dropped', type: 'line', source: 'dropped', paint: { 'line-color': C.dropped, 'line-width': 2, 'line-dasharray': [1, 1.5] } });
  m.addLayer({
    id: 'edges-extra',
    type: 'line',
    source: 'edges',
    filter: ['==', ['get', 'extra'], true],
    paint: { 'line-color': C.extra, 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 1.5, 16, 4, 19, 7], 'line-dasharray': [1.2, 1] },
  });
  m.addLayer({
    id: 'edges',
    type: 'line',
    source: 'edges',
    filter: ['!=', ['get', 'extra'], true],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': C.edge, 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 1.2, 16, 3, 19, 6], 'line-opacity': 0.75 },
  });
  m.addLayer({
    id: 'route-todo',
    type: 'line',
    source: 'route',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': C.route, 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 1, 16, 3, 19, 6], 'line-opacity': 0.12 },
  });
  m.addLayer({
    id: 'dups',
    type: 'line',
    source: 'dups',
    layout: { 'line-cap': 'round' },
    paint: {
      'line-color': C.dup,
      'line-width': ['interpolate', ['linear'], ['zoom'], 12, 1.5, 16, 3.5, 19, 6],
      'line-offset': ['interpolate', ['linear'], ['zoom'], 12, 1.5, 16, 5, 19, 9],
    },
  });
  const routePaint = {
    'line-color': ['case', ['get', 'extra'], C.extra, ['get', 'repeat'], C.dup, C.route],
    'line-width': ['interpolate', ['linear'], ['zoom'], 12, 2, 16, 5, 19, 9],
  } as const;
  m.addLayer({ id: 'route-done', type: 'line', source: 'route', filter: ['<', ['get', 'idx'], 0], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: routePaint as never });
  m.addLayer({ id: 'route-current', type: 'line', source: 'route-current', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: routePaint as never });
  m.addLayer({ id: 'matching', type: 'line', source: 'matching', paint: { 'line-color': C.match, 'line-width': 2.5, 'line-dasharray': [2, 1.5] } });
  m.addLayer({
    id: 'edges-label',
    type: 'symbol',
    source: 'edges',
    minzoom: 15,
    layout: { 'symbol-placement': 'line-center', 'text-field': ['get', 'label'], 'text-font': font, 'text-size': 11 },
    paint: { 'text-color': '#475569', 'text-halo-color': '#fff', 'text-halo-width': 1.5 },
  });
  m.addLayer({
    id: 'vertices',
    type: 'circle',
    source: 'vertices',
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 1.5, 16, 5, 19, 9],
      'circle-color': '#fff',
      'circle-stroke-color': C.edge,
      'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 12, 0.8, 16, 2],
    },
  });
  m.addLayer({
    id: 'odd',
    type: 'circle',
    source: 'vertices',
    filter: ['==', ['get', 'odd'], true],
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 2.5, 16, 7, 19, 11],
      'circle-color': C.odd,
      'circle-stroke-color': '#fff',
      'circle-stroke-width': 1.5,
    },
  });
  m.addLayer({
    id: 'start',
    type: 'circle',
    source: 'vertices',
    filter: ['==', ['get', 'i'], 0],
    paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 6, 16, 10, 19, 14], 'circle-color': C.start, 'circle-stroke-color': '#fff', 'circle-stroke-width': 2.5 },
  });
  m.addLayer({
    id: 'trace',
    type: 'line',
    source: 'trace',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#7c3aed', 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 3, 16, 7], 'line-opacity': 0.85 },
  });
  m.addLayer({
    id: 'trace-preview',
    type: 'line',
    source: 'trace-preview',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#7c3aed', 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 2, 16, 5], 'line-opacity': 0.6, 'line-dasharray': [1.5, 1] },
  });
  m.addLayer({
    id: 'trace-pts',
    type: 'circle',
    source: 'trace-pts',
    paint: {
      'circle-radius': ['case', ['get', 'first'], 9, 6],
      'circle-color': ['case', ['get', 'first'], '#16a34a', '#7c3aed'],
      'circle-stroke-color': '#fff',
      'circle-stroke-width': 2,
    },
  });
  m.addLayer({
    id: 'hover-e',
    type: 'line',
    source: 'edges',
    filter: ['==', ['get', 'i'], -1],
    layout: { 'line-cap': 'round' },
    paint: { 'line-color': '#dc2626', 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 4, 16, 8], 'line-opacity': 0.8 },
  });
  m.addLayer({
    id: 'preview',
    type: 'line',
    source: 'preview',
    paint: { 'line-color': '#2563eb', 'line-width': 3, 'line-dasharray': [2, 1.5] },
  });
  m.addLayer({
    id: 'hover-v',
    type: 'circle',
    source: 'vertices',
    filter: ['==', ['get', 'i'], -1],
    paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 8, 16, 14], 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': '#dc2626', 'circle-stroke-width': 3 },
  });
  m.addLayer({
    id: 'snap',
    type: 'circle',
    source: 'snap',
    paint: { 'circle-radius': 7, 'circle-color': '#16a34a', 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 },
  });
  m.addLayer({
    id: 'sel',
    type: 'circle',
    source: 'vertices',
    filter: ['==', ['get', 'i'], -1],
    paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 7, 16, 13], 'circle-color': 'rgba(37,99,235,0.25)', 'circle-stroke-color': '#2563eb', 'circle-stroke-width': 3 },
  });
  m.addLayer({
    id: 'drag',
    type: 'circle',
    source: 'drag',
    paint: { 'circle-radius': 9, 'circle-color': '#2563eb', 'circle-stroke-color': '#fff', 'circle-stroke-width': 3 },
  });
  m.addLayer({
    id: 'giros',
    type: 'circle',
    source: 'giros',
    paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 4, 16, 9], 'circle-color': '#fbbf24', 'circle-stroke-color': '#7c2d12', 'circle-stroke-width': 2 },
  });
  m.addLayer({
    id: 'vertices-label',
    type: 'symbol',
    source: 'vertices',
    minzoom: 15,
    layout: { 'text-field': ['get', 'label'], 'text-font': font, 'text-size': 12, 'text-offset': [0, -1.3] },
    paint: { 'text-color': '#0f172a', 'text-halo-color': '#fff', 'text-halo-width': 2 },
  });
}
