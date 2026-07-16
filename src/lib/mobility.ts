// Clasificación DERIVADA de un equipo como FIJO o MÓVIL, deducida de las
// ubicaciones reales que dejan los escaneos del QR (inicio/fin de jornada, etc.).
// Nadie la edita a mano: el sistema la recalcula a medida que entran datos, igual
// que el nivel de tanque es derivado de los movimientos.
//
// Regla (definida con el usuario):
//  · Dos puntos separados por MÁS de 300 m se consideran "ubicaciones distintas".
//  · Con 2 ubicaciones distintas o más → MÓVIL. Si todo cae dentro de 300 m → FIJA.
//  · Con menos de 2 puntos con GPS → SIN DETERMINAR (provisional).

export type MobilityStatus = 'fija' | 'movil' | 'indef';
export type LatLng = { lat: number; lng: number };

/** Distancia en metros entre dos coordenadas (Haversine). */
function distM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000, toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat), dLng = toRad(bLng - aLng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Radio: dos puntos a más de esta distancia = ubicaciones distintas. */
export const MOBILITY_RADIUS_M = 300;

function isValid(p: LatLng | null | undefined): p is LatLng {
  return !!p && isFinite(p.lat) && isFinite(p.lng) && !(p.lat === 0 && p.lng === 0);
}

/**
 * Clasifica un equipo por sus puntos GPS. Devuelve el estado, la dispersión
 * máxima (metros entre los dos puntos más lejanos) y cuántos puntos válidos había.
 */
export function classifyMobility(points: (LatLng | null | undefined)[]): {
  status: MobilityStatus;
  spreadM: number;
  points: number;
} {
  // Limita a los últimos puntos para no hacer O(n²) sobre históricos enormes.
  const pts = (points || []).filter(isValid).slice(0, 200);
  if (pts.length < 2) return { status: 'indef', spreadM: 0, points: pts.length };
  let maxD = 0;
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const d = distM(pts[i].lat, pts[i].lng, pts[j].lat, pts[j].lng);
      if (d > maxD) maxD = d;
    }
  }
  return { status: maxD > MOBILITY_RADIUS_M ? 'movil' : 'fija', spreadM: maxD, points: pts.length };
}

/** Etiqueta legible del estado. */
export function mobilityLabel(s: MobilityStatus): string {
  return s === 'movil' ? 'MÓVIL' : s === 'fija' ? 'FIJA' : 'Sin determinar';
}

/** Emoji/badge del estado (para pintar un chip). */
export function mobilityBadge(s: MobilityStatus): { emoji: string; text: string } {
  if (s === 'movil') return { emoji: '🔵', text: 'MÓVIL' };
  if (s === 'fija') return { emoji: '🟢', text: 'FIJA' };
  return { emoji: '⚪', text: 'Sin determinar' };
}
