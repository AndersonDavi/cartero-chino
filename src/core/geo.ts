import type { LatLon } from './types';

const R = 6371008.8; // radio medio de la Tierra en metros
const rad = (d: number) => (d * Math.PI) / 180;

/** Distancia en metros entre dos puntos (fórmula de haversine). */
export function haversine(a: LatLon, b: LatLon): number {
  const dLat = rad(b[0] - a[0]);
  const dLon = rad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function polylineLength(pts: LatLon[]): number {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += haversine(pts[i - 1], pts[i]);
  return s;
}

/** Rumbo en grados (0 = norte, 90 = este) de a hacia b. */
export function bearing(a: LatLon, b: LatLon): number {
  const y = Math.sin(rad(b[1] - a[1])) * Math.cos(rad(b[0]));
  const x = Math.cos(rad(a[0])) * Math.sin(rad(b[0])) - Math.sin(rad(a[0])) * Math.cos(rad(b[0])) * Math.cos(rad(b[1] - a[1]));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Punto dentro de polígono por el método del rayo. ring = [[lon, lat], ...] (GeoJSON). */
export function pointInRing(lat: number, lon: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** ¿El punto está a menos de `meters` del borde del anillo? (proyección plana local) */
export function nearRing(lat: number, lon: number, ring: number[][], meters: number): boolean {
  const kx = 111320 * Math.cos(rad(lat));
  const ky = 110574;
  for (let i = 1; i < ring.length; i++) {
    const ax = (ring[i - 1][0] - lon) * kx;
    const ay = (ring[i - 1][1] - lat) * ky;
    const bx = (ring[i][0] - lon) * kx;
    const by = (ring[i][1] - lat) * ky;
    const len2 = (bx - ax) ** 2 + (by - ay) ** 2;
    const t = len2 ? Math.max(0, Math.min(1, -(ax * (bx - ax) + ay * (by - ay)) / len2)) : 0;
    if (Math.hypot(ax + t * (bx - ax), ay + t * (by - ay)) < meters) return true;
  }
  return false;
}

/** Margen al recortar: un cruce a pocos metros por fuera del área dibujada también cuenta. */
export const AREA_MARGIN = 30;

export function insideArea(lat: number, lon: number, ring: number[][]): boolean {
  return pointInRing(lat, lon, ring) || nearRing(lat, lon, ring, AREA_MARGIN);
}

/** Área aproximada en km² de un anillo [[lon, lat], ...]. */
export function ringAreaKm2(ring: number[][]): number {
  const lat0 = rad(ring.reduce((s, p) => s + p[1], 0) / ring.length);
  const kx = 111.32 * Math.cos(lat0);
  const ky = 110.57;
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += ring[j][0] * kx * (ring[i][1] * ky) - ring[i][0] * kx * (ring[j][1] * ky);
  }
  return Math.abs(a / 2);
}

/** Punto a una distancia d (metros) a lo largo de la polilínea, y el rumbo en ese tramo. */
export function pointAlong(pts: LatLon[], d: number): { p: LatLon; heading: number } {
  for (let i = 1; i < pts.length; i++) {
    const seg = haversine(pts[i - 1], pts[i]);
    if (d <= seg || i === pts.length - 1) {
      const t = seg > 0 ? Math.min(1, Math.max(0, d / seg)) : 1;
      const a = pts[i - 1];
      const b = pts[i];
      return { p: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], heading: bearing(a, b) };
    }
    d -= seg;
  }
  return { p: pts[pts.length - 1], heading: 0 };
}

/** Prefijo de la polilínea hasta la distancia d. */
export function sliceAlong(pts: LatLon[], d: number): LatLon[] {
  const out: LatLon[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const seg = haversine(pts[i - 1], pts[i]);
    if (d < seg) {
      const t = seg > 0 ? d / seg : 1;
      const a = pts[i - 1];
      const b = pts[i];
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      return out;
    }
    out.push(pts[i]);
    d -= seg;
  }
  return out;
}
