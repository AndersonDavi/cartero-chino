import { useEffect, useRef, useState } from 'react';
import type { LatLon } from '../core/types';
import { HojaBase, useEsCelular } from './Escoger';
import { Icono } from './Iconos';

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
  const celular = useEsCelular();
  const [hoja, setHoja] = useState(false); // celular: el buscador se abre en una hoja desde abajo
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

  const nombre = props.role === 'inicio' ? 'Origen' : props.role === 'fin' ? 'Destino' : `Parada ${props.letra}`;
  const placeholder =
    props.role === 'inicio' ? 'Desde… (ej. Estadio Metropolitano)' : props.role === 'fin' ? 'Hasta… (ej. Portal del Prado)' : 'Parada… (ej. Parque Venezuela)';
  const elegir = (s: Sugerencia) => {
    props.onChange(s);
    setQ('');
    setList([]);
    setHoja(false);
  };

  if (celular) {
    return (
      <div className="lugar">
        <div className="lugar-fila">
          <span className={`lugar-letra ${props.role}`}>{props.letra}</span>
          <button
            type="button"
            className={`lugar-campo ${props.value ? 'lleno' : ''} ${props.picking ? 'eligiendo' : ''}`}
            onClick={() => setHoja(true)}
          >
            <Icono nombre={props.value ? 'pin' : 'buscar'} size={18} />
            <span>{props.picking ? 'Toca el mapa para elegir…' : (props.value?.name ?? placeholder)}</span>
          </button>
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
        {hoja && (
          <HojaBase titulo={`${nombre} (${props.letra})`} onCerrar={() => setHoja(false)}>
            <input className="hoja-buscar" type="search" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} aria-label={nombre} />
            <div className="hoja-atajos">
              {props.onGps && (
                <button
                  type="button"
                  onClick={() => {
                    setHoja(false);
                    props.onGps?.();
                  }}
                >
                  <Icono nombre="ubicacion" /> Mi ubicación
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setHoja(false);
                  if (!props.picking) props.onPick();
                }}
              >
                <Icono nombre="pin" /> Elegir en el mapa
              </button>
              {props.value && (
                <button type="button" onClick={() => props.onChange(null)}>
                  ✕ Quitar
                </button>
              )}
            </div>
            <ul className="hoja-lista">
              {q.trim().length < 3 && <li className="hoja-nada">Escribe al menos 3 letras para buscar en Barranquilla y Soledad.</li>}
              {q.trim().length >= 3 && error && <li className="hoja-nada">{error}</li>}
              {list.map((s, i) => (
                <li key={i}>
                  <button type="button" className="hoja-lugar" onClick={() => elegir(s)}>
                    <Icono nombre="pin" />
                    <span>
                      <b>{s.name}</b>
                      {s.detail && <small>{s.detail}</small>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </HojaBase>
        )}
      </div>
    );
  }

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
            placeholder={placeholder}
            aria-label={nombre}
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
          {props.onGps && (
            <button onClick={props.onGps}>
              <Icono nombre="ubicacion" size={16} /> Mi ubicación
            </button>
          )}
          <button className={props.picking ? 'on' : ''} onClick={props.onPick}>
            <Icono nombre="pin" size={16} /> {props.picking ? 'Toca el mapa…' : 'Elegir en el mapa'}
          </button>
        </div>
      )}
      {!props.value && list.length > 0 && (
        <ul className="lugar-lista">
          {list.map((s, i) => (
            <li key={i}>
              <button onClick={() => elegir(s)}>
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
