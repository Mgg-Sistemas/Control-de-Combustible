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

/** Inverso: UTM (easting/northing) → lat/lng WGS84. Snyder/USGS estándar.
 *  Por defecto zona 19N (La Guaira). Sirve para dibujar en el mapa geometría
 *  calculada en el plano UTM (curvas de nivel, mapas de diferencias). */
export function utmToLatLng(easting: number, northing: number, zone = 19, north = true): { lat: number; lng: number } {
  const a = 6378137.0;
  const f = 1 / 298.257223563;
  const e2 = f * (2 - f);
  const k0 = 0.9996;
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const x = easting - 500000;
  let y = northing;
  if (!north) y -= 10000000;
  const M = y / k0;
  const mu = M / (a * (1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 * e2 * e2 / 256));
  const phi1 = mu
    + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * Math.sin(2 * mu)
    + (21 * e1 * e1 / 16 - 55 * e1 ** 4 / 32) * Math.sin(4 * mu)
    + (151 * e1 ** 3 / 96) * Math.sin(6 * mu)
    + (1097 * e1 ** 4 / 512) * Math.sin(8 * mu);
  const sinPhi1 = Math.sin(phi1);
  const cosPhi1 = Math.cos(phi1);
  const tanPhi1 = Math.tan(phi1);
  const ep2 = e2 / (1 - e2);
  const N1 = a / Math.sqrt(1 - e2 * sinPhi1 * sinPhi1);
  const T1 = tanPhi1 * tanPhi1;
  const C1 = ep2 * cosPhi1 * cosPhi1;
  const R1 = a * (1 - e2) / Math.pow(1 - e2 * sinPhi1 * sinPhi1, 1.5);
  const D = x / (N1 * k0);
  const lat = phi1 - (N1 * tanPhi1 / R1) * (
    D * D / 2
    - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * D ** 4 / 24
    + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * D ** 6 / 720
  );
  const lngRad = (
    D
    - (1 + 2 * T1 + C1) * D ** 3 / 6
    + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * D ** 5 / 120
  ) / cosPhi1;
  const lng0 = (zone - 1) * 6 - 180 + 3;
  const deg = 180 / Math.PI;
  return { lat: lat * deg, lng: lng0 + lngRad * deg };
}

/** Texto UTM compacto: "19N · 723.456 mE · 1.173.456 mN". */
export function formatUTM(lat: number | null | undefined, lng: number | null | undefined): string {
  if (lat == null || lng == null || isNaN(Number(lat)) || isNaN(Number(lng))) return '—';
  const u = latLngToUTM(Number(lat), Number(lng));
  const e = Math.round(u.easting).toLocaleString('es-VE');
  const n = Math.round(u.northing).toLocaleString('es-VE');
  return `${u.zone}${u.hemi} · ${e} mE · ${n} mN`;
}
