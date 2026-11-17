import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export interface Opcion {
  value: string;
  label: string;
  grupo?: string;
}

/** true en pantallas de celular (el mismo corte que usa el CSS). */
export function useEsCelular() {
  const q = '(max-width: 799px)';
  const [es, setEs] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q);
    const f = () => setEs(m.matches);
    m.addEventListener('change', f);
    return () => m.removeEventListener('change', f);
  }, []);
  return es;
}

// para buscar sin importar tildes ni mayúsculas
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

interface Props {
  value: string;
  opciones: Opcion[];
  placeholder: string;
  titulo: string; // título de la hoja en el celular
  onChange(value: string): void;
  onAbrir?(): void; // por ejemplo, para cargar la lista la primera vez
  disabled?: boolean;
  buscar?: boolean; // muestra un buscador (para listas largas)
  cargando?: boolean;
}

/**
 * Lista para elegir una opción. En escritorio es un select normal; en el celular
 * abre una hoja desde abajo con opciones grandes, fáciles de tocar, y buscador.
 */
export function Escoger({ value, opciones, placeholder, titulo, onChange, onAbrir, disabled, buscar, cargando }: Props) {
  const celular = useEsCelular();
  const [abierta, setAbierta] = useState(false);
  const elegida = opciones.find((o) => o.value === value);

  if (!celular) {
    const grupos = [...new Set(opciones.map((o) => o.grupo ?? ''))];
    const opts = (g: string) =>
      opciones
        .filter((o) => (o.grupo ?? '') === g)
        .map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ));
    return (
      <select value={value} onFocus={onAbrir} onPointerDown={onAbrir} onChange={(e) => onChange(e.target.value)} disabled={disabled} aria-label={titulo}>
        <option value="">{placeholder}</option>
        {grupos.map((g) =>
          g ? (
            <optgroup key={g} label={g}>
              {opts(g)}
            </optgroup>
          ) : (
            opts(g)
          ),
        )}
      </select>
    );
  }

  return (
    <>
      <button
        type="button"
        className={`escoger-boton ${elegida ? '' : 'vacio'}`}
        disabled={disabled}
        onClick={() => {
          onAbrir?.();
          setAbierta(true);
        }}
        aria-haspopup="dialog"
      >
        <span>{elegida?.label ?? placeholder}</span>
        <i aria-hidden="true">▾</i>
      </button>
      {abierta && (
        <Hoja
          titulo={titulo}
          opciones={opciones}
          value={value}
          buscar={buscar}
          cargando={cargando}
          onCerrar={() => setAbierta(false)}
          onElegir={(v) => {
            setAbierta(false);
            onChange(v);
          }}
        />
      )}
    </>
  );
}

function Hoja({
  titulo,
  opciones,
  value,
  buscar,
  cargando,
  onCerrar,
  onElegir,
}: {
  titulo: string;
  opciones: Opcion[];
  value: string;
  buscar?: boolean;
  cargando?: boolean;
  onCerrar(): void;
  onElegir(v: string): void;
}) {
  const [q, setQ] = useState('');
  const lista = useRef<HTMLUListElement>(null);
  useEffect(() => {
    // la opción elegida queda a la vista al abrir
    lista.current?.querySelector('.on')?.scrollIntoView({ block: 'center' });
  }, []);
  const visibles = useMemo(() => {
    const t = norm(q.trim());
    return t ? opciones.filter((o) => norm(o.label).includes(t)) : opciones;
  }, [q, opciones]);

  let grupo: string | undefined;
  return (
    <HojaBase titulo={titulo} onCerrar={onCerrar}>
        {buscar && (
          <input className="hoja-buscar" type="search" placeholder="Buscar…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar" />
        )}
        <ul className="hoja-lista" ref={lista}>
          {cargando && <li className="hoja-nada">Cargando…</li>}
          {!cargando && visibles.length === 0 && <li className="hoja-nada">No hay resultados para «{q}».</li>}
          {visibles.map((o) => {
            const titulo = o.grupo && o.grupo !== grupo ? o.grupo : null;
            grupo = o.grupo;
            return (
              <li key={o.value}>
                {titulo && <p className="hoja-grupo">{titulo}</p>}
                <button type="button" className={o.value === value ? 'on' : ''} onClick={() => onElegir(o.value)}>
                  <span>{o.label}</span>
                  {o.value === value && <i aria-hidden="true">✓</i>}
                </button>
              </li>
            );
          })}
        </ul>
    </HojaBase>
  );
}

/** Hoja que sube desde abajo (celular): fondo oscuro, barrita, título y botón de cerrar. */
export function HojaBase({ titulo, onCerrar, children }: { titulo: string; onCerrar(): void; children: ReactNode }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onCerrar();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onCerrar]);
  return createPortal(
    <div className="hoja-fondo" onClick={onCerrar}>
      <div className="hoja" role="dialog" aria-label={titulo} onClick={(e) => e.stopPropagation()}>
        <div className="hoja-asa" />
        <header className="hoja-head">
          <h3>{titulo}</h3>
          <button type="button" onClick={onCerrar} aria-label="Cerrar">
            ✕
          </button>
        </header>
        {children}
      </div>
    </div>,
    document.body,
  );
}
