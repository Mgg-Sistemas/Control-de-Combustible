// Conversión de coordenadas geográficas (lat/lng WGS84) a UTM.
// La Guaira / Caracas caen en la zona UTM 19N. La fórmula es la estándar
// (Snyder / USGS), suficiente para ubicar maquinaria en el mapa.

export type UTM = { zone: number; hemi: 'N' | 'S'; easting: number; northing: number };

export function latLngToUTM(lat: number, lng: number): UTM {
  const a = 6378137.0; // semieje mayor WGS84
  const f = 1 / 298.257223563; // achatamiento
  const e2 = f * (2 - f);
  const k0 = 0.9996;
  const rad = Math.PI / 180;

  const zone = Math.floor((lng + 180) / 6) + 1;
  const lng0 = (zone - 1) * 6 - 180 + 3; // meridiano central de la zona
  const phi = lat * rad;
  const lam = lng * rad;
  const lam0 = lng0 * rad;

  const sinPhi = Math.sin(phi);
  const cosPhi = Math.cos(phi);
  const tanPhi = Math.tan(phi);
  const N = a / Math.sqrt(1 - e2 * sinPhi * sinPhi);
  const T = tanPhi * tanPhi;
  const ep2 = e2 / (1 - e2);
  const C = ep2 * cosPhi * cosPhi;
  const A = cosPhi * (lam - lam0);

  const M = a * (
    (1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 * e2 * e2 / 256) * phi
    - (3 * e2 / 8 + 3 * e2 * e2 / 32 + 45 * e2 * e2 * e2 / 1024) * Math.sin(2 * phi)
    + (15 * e2 * e2 / 256 + 45 * e2 * e2 * e2 / 1024) * Math.sin(4 * phi)
    - (35 * e2 * e2 * e2 / 3072) * Math.sin(6 * phi)
  );

  const easting = k0 * N * (A + (1 - T + C) * A ** 3 / 6 + (5 - 18 * T + T * T + 72 * C - 58 * ep2) * A ** 5 / 120) + 500000;
  let northing = k0 * (M + N * tanPhi * (A * A / 2 + (5 - T + 9 * C + 4 * C * C) * A ** 4 / 24 + (61 - 58 * T + T * T + 600 * C - 330 * ep2) * A ** 6 / 720));
  if (lat < 0) northing += 10000000;

  return { zone, hemi: lat >= 0 ? 'N' : 'S', easting, northing };
}

/** Texto UTM compacto: "19N · 723.456 mE · 1.173.456 mN". */
export function formatUTM(lat: number | null | undefined, lng: number | null | undefined): string {
  if (lat == null || lng == null || isNaN(Number(lat)) || isNaN(Number(lng))) return '—';
  const u = latLngToUTM(Number(lat), Number(lng));
  const e = Math.round(u.easting).toLocaleString('es-VE');
  const n = Math.round(u.northing).toLocaleString('es-VE');
  return `${u.zone}${u.hemi} · ${e} mE · ${n} mN`;
}
