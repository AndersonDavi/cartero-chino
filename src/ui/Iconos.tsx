import type { ReactNode } from 'react';

/** Iconos de línea (24×24, toman el color del texto). Se dibujan aquí para no depender de emojis. */
const TRAZOS: Record<string, ReactNode> = {
  peaton: (
    <>
      <circle cx="13" cy="4" r="1.8" />
      <path d="M9.5 21l2.2-6.5 3 3V21" />
      <path d="M8 12.5l3.5-4.5 3 2.2 3 1.3" />
      <path d="M11.5 8l-1.3 6" />
    </>
  ),
  carro: (
    <>
      <path d="M4 15l1.8-5.2A2 2 0 0 1 7.7 8.5h8.6a2 2 0 0 1 1.9 1.3L20 15" />
      <path d="M3 15h18v3h-2.5M5.5 18H3v-3" />
      <circle cx="7.5" cy="18" r="1.8" />
      <circle cx="16.5" cy="18" r="1.8" />
    </>
  ),
  ubicacion: (
    <>
      <circle cx="12" cy="12" r="3" />
      <circle cx="12" cy="12" r="7" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
    </>
  ),
  pin: (
    <>
      <path d="M12 21s-6.5-5.6-6.5-10.5a6.5 6.5 0 0 1 13 0C18.5 15.4 12 21 12 21z" />
      <circle cx="12" cy="10.5" r="2.3" />
    </>
  ),
  intercambiar: <path d="M7 4v16M7 4L4 7M7 4l3 3M17 20V4M17 20l-3-3M17 20l3-3" />,
  ajustes: (
    <>
      <path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1" />
      <circle cx="15" cy="6" r="2" />
      <circle cx="9" cy="12" r="2" />
      <circle cx="17" cy="18" r="2" />
    </>
  ),
  mas: <path d="M12 5v14M5 12h14" />,
  bici: (
    <>
      <circle cx="6" cy="16" r="3.5" />
      <circle cx="18" cy="16" r="3.5" />
      <path d="M6 16l4-7h5l3 7M10 9l3 7h-7M9 6.5h3M15 9l-1-2.5h2" />
    </>
  ),
  moto: (
    <>
      <circle cx="5.5" cy="16" r="3" />
      <circle cx="18.5" cy="16" r="3" />
      <path d="M8.5 16h6l2.5-5h-5.5L9 13H5.5M14 6.5h2.5l2 9.5M11 11l-1.5-2.5H7" />
    </>
  ),
  estrella: <path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" />,
  buscar: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M20 20l-4.2-4.2" />
    </>
  ),
};

export type NombreIcono = keyof typeof TRAZOS;

export function Icono({ nombre, size = 20 }: { nombre: NombreIcono; size?: number }) {
  return (
    <svg
      className="icono"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {TRAZOS[nombre]}
    </svg>
  );
}
