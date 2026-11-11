export const fmt = (m: number) =>
  m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toLocaleString('es-CO', { maximumFractionDigits: m < 100000 ? 2 : 0 })} km`;

export type Unit = 'kmh' | 'ms';

/** Velocidad (guardada en m/s) escrita en la unidad elegida. */
export const fmtSpeed = (ms: number, unit: Unit) => {
  const v = unit === 'kmh' ? ms * 3.6 : ms;
  return `${v.toLocaleString('es-CO', { maximumFractionDigits: v < 10 ? 1 : 0 })} ${unit === 'kmh' ? 'km/h' : 'm/s'}`;
};

export const toMs = (v: number, unit: Unit) => (unit === 'kmh' ? v / 3.6 : v);
export const fromMs = (ms: number, unit: Unit) => (unit === 'kmh' ? ms * 3.6 : ms);
