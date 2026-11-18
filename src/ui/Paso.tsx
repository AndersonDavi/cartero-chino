import { useEffect, useState, type ReactNode } from 'react';

export type EstadoPaso = 'hecho' | 'actual' | 'pendiente';

/**
 * Un paso del recorrido (zona → grafo → ruta) con su número, qué hay que hacer y
 * si ya está hecho. El paso actual se resalta; los pendientes quedan atenuados.
 */
export function Paso({
  n,
  titulo,
  ayuda,
  estado,
  resumen,
  children,
}: {
  n: number;
  titulo: string;
  ayuda?: ReactNode;
  estado: EstadoPaso;
  resumen?: ReactNode; // si el paso ya está hecho, se pliega y muestra solo esto
  children: ReactNode;
}) {
  const [abierto, setAbierto] = useState(false);
  useEffect(() => {
    if (estado !== 'hecho') setAbierto(false);
  }, [estado]);
  const plegado = estado === 'hecho' && !!resumen && !abierto;
  return (
    <section className={`paso-card ${estado}`}>
      <header className="paso-head">
        <span className="paso-num" aria-label={estado === 'hecho' ? `Paso ${n} hecho` : `Paso ${n}`}>
          {estado === 'hecho' ? '✓' : n}
        </span>
        <div>
          <h2>{titulo}</h2>
          {plegado ? <p className="paso-resumen">{resumen}</p> : ayuda && <p className="paso-ayuda">{ayuda}</p>}
        </div>
        {estado === 'hecho' && resumen && (
          <button type="button" className="paso-cambiar" onClick={() => setAbierto(!abierto)} aria-expanded={abierto}>
            {abierto ? 'Listo' : 'Cambiar'}
          </button>
        )}
      </header>
      {!plegado && <div className="paso-body">{children}</div>}
    </section>
  );
}

/** Selector de cantidad con − y + (más fácil de tocar en el celular que un campo numérico). */
export function Contador({
  value,
  min,
  max,
  onChange,
  label,
  disabled = false,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <div className="contador" role="group" aria-label={label}>
      <button type="button" onClick={() => onChange(Math.max(min, value - 1))} disabled={disabled || value <= min} aria-label="Uno menos">
        −
      </button>
      <span aria-live="polite">{value}</span>
      <button type="button" onClick={() => onChange(Math.min(max, value + 1))} disabled={disabled || value >= max} aria-label="Uno más">
        +
      </button>
    </div>
  );
}
