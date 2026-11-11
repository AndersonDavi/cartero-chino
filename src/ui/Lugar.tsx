import { useEffect, useRef, useState } from 'react';
import type { LatLon } from '../core/types';

export interface Punto {
  name: string;
  p: LatLon;
}

interface Sugerencia extends Punto {
  detail: string;
}

// Photon (komoot) es un buscador gratuito sobre datos de OpenStreetMap que permite
// buscar mientras se escribe. Se limita a Barranquilla y Soledad.
const PHOTON = 'https://photon.komoot.io/api/';
const BBOX = '-74.95,10.85,-74.70,11.12';

async function buscar(q: string, signal: AbortSignal): Promise<Sugerencia[]> {
  const url = `${PHOTON}?q=${encodeURIComponent(q)}&limit=6&lat=10.96&lon=-74.80&bbox=${BBOX}`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`buscador: ${res.status}`);
  const data = (await res.json()) as {
    features: { properties: Record<string, string>; geometry: { coordinates: [number, number] } }[];
  };
  return data.features.map(({ properties: p, geometry: g }) => {
    const street = p.street ? `${p.street}${p.housenumber ? ` ${p.housenumber}` : ''}` : '';
    const name = p.name || street || p.locality || 'Sin nombre';
    const detail = [...new Set([p.name ? street : '', p.locality || p.district, p.city].filter(Boolean))].join(' · ');
    return { name, detail, p: [g.coordinates[1], g.coordinates[0]] };
  });
}

export function Lugar(props: {
  letra: string;
  role: 'inicio' | 'medio' | 'fin';
  onRemove?: () => void; // paradas intermedias: se pueden quitar
  onUp?: () => void; // subir o bajar en el orden
  onDown?: () => void;
  value: Punto | null;
  onChange(p: Punto | null): void;
  picking: boolean;
  onPick(): void;
  onGps?: () => void;
}) {
  const [q, setQ] = useState('');
  const [list, setList] = useState<Sugerencia[]>([]);
  const [error, setError] = useState('');
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    if (q.trim().length < 3) {
      setList([]);
      return;
    }
    const id = setTimeout(() => {
      abort.current?.abort();
      const ctrl = new AbortController();
      abort.current = ctrl;
      buscar(q, ctrl.signal)
        .then((l) => {
          setList(l);
          setError(l.length ? '' : 'Sin resultados');
        })
        .catch((e) => {
          if (!ctrl.signal.aborted) setError(`No se pudo buscar (${(e as Error).message})`);
        });
    }, 350);
    return () => clearTimeout(id);
  }, [q]);

  return (
    <div className="lugar">
      <div className="lugar-fila">
        <span className={`lugar-letra ${props.role}`}>{props.letra}</span>
        {props.value ? (
          <button className="lugar-elegido" onClick={() => props.onChange(null)} title="Cambiar">
            {props.value.name} <span>✕</span>
          </button>
        ) : (
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={props.role === 'inicio' ? 'Desde… (ej. Estadio Metropolitano)' : props.role === 'fin' ? 'Hasta… (ej. Portal del Prado)' : 'Parada… (ej. Parque Venezuela)'}
            aria-label={props.role === 'inicio' ? 'Origen' : props.role === 'fin' ? 'Destino' : `Parada ${props.letra}`}
          />
        )}
        {(props.onUp || props.onDown) && (
          <span className="lugar-orden">
            <button onClick={props.onUp} disabled={!props.onUp} title="Subir en el orden">
              ↑
            </button>
            <button onClick={props.onDown} disabled={!props.onDown} title="Bajar en el orden">
              ↓
            </button>
          </span>
        )}
        {props.onRemove && (
          <button className="lugar-quitar" onClick={props.onRemove} title="Quitar esta parada">
            −
          </button>
        )}
      </div>
      {!props.value && (
        <div className="lugar-acciones">
          {props.onGps && <button onClick={props.onGps}>📍 Mi ubicación</button>}
          <button className={props.picking ? 'on' : ''} onClick={props.onPick}>
            {props.picking ? 'Toca el mapa…' : 'Elegir en el mapa'}
          </button>
        </div>
      )}
      {!props.value && list.length > 0 && (
        <ul className="lugar-lista">
          {list.map((s, i) => (
            <li key={i}>
              <button
                onClick={() => {
                  props.onChange(s);
                  setQ('');
                  setList([]);
                }}
              >
                <b>{s.name}</b>
                {s.detail && <span>{s.detail}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {!props.value && error && q.trim().length >= 3 && <p className="ayuda">{error}</p>}
    </div>
  );
}
