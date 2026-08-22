// Cálculo de VOLÚMENES de movimiento de tierra (corte / relleno) por el método de
// rejilla: se interpolan ambas superficies a una malla común y se integra la
// diferencia de cotas celda a celda (Σ Δz · área). Genera además el "mapa de
// diferencias" (GeoJSON en lat/lon) para colorear zonas de corte vs relleno.
import { XYZ, GridSpec, specFor, buildGridOn, bboxOf } from './tin';
import { utmToLatLng } from './utm';

export type VolumeResult = {
  cut: number;        // m³ de CORTE (excavación; la nueva superficie está más baja)
  fill: number;       // m³ de RELLENO (la nueva superficie está más alta)
  net: number;        // fill − cut (positivo = falta traer material; negativo = sobra)
  area: number;       // m² comparados (celdas válidas)
  cellsCompared: number;
  cell: number;
  geojson: any;       // mapa de diferencias
  ok: boolean;
  error?: string;
};

const MAX_DIFF_CELLS = 4000; // tope de polígonos en el mapa de diferencias

function cellPolygon(minX: number, minY: number, gx: number, gy: number, cell: number, zone: number, north: boolean): number[][] {
  const x0 = minX + gx * cell, y0 = minY + gy * cell, x1 = x0 + cell, y1 = y0 + cell;
  return [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]].map(([x, y]) => { const ll = utmToLatLng(x, y, zone, north); return [ll.lng, ll.lat]; });
}

// Color por diferencia: corte (Δ<0) rojo, relleno (Δ>0) azul, intensidad por |Δ|.
function diffColor(dz: number, ref: number): string {
  const t = Math.max(0, Math.min(1, Math.abs(dz) / (ref || 1)));
  const alpha = 0.15 + 0.55 * t;
  return dz < 0 ? `rgba(220,38,38,${alpha.toFixed(2)})` : `rgba(37,99,235,${alpha.toFixed(2)})`;
}

/** Integra la diferencia zNew − zBase sobre una malla; arma corte/relleno/neto + mapa. */
function integrate(zBase: Float64Array, zNew: Float64Array, spec: GridSpec, zone: number, north: boolean): VolumeResult {
  const { minX, minY, cell, nx, ny } = spec;
  const area = cell * cell;
  let cut = 0, fill = 0, cells = 0, maxAbs = 0;
  const diffs: { gx: number; gy: number; dz: number }[] = [];
  for (let gy = 0; gy < ny; gy++) {
    for (let gx = 0; gx < nx; gx++) {
      const i = gy * nx + gx;
      const b = zBase[i], n = zNew[i];
      if (isNaN(b) || isNaN(n)) continue;
      const dz = n - b;
      cells++;
      if (dz < 0) cut += -dz * area; else fill += dz * area;
      if (Math.abs(dz) > maxAbs) maxAbs = Math.abs(dz);
      if (Math.abs(dz) > 1e-4) diffs.push({ gx, gy, dz });
    }
  }
  // Submuestreo si hay demasiadas celdas para el mapa.
  const step = Math.max(1, Math.ceil(diffs.length / MAX_DIFF_CELLS));
  const features = diffs.filter((_, i) => i % step === 0).map((d) => ({
    type: 'Feature',
    properties: { dz: Number(d.dz.toFixed(3)), style: { color: '#00000000', weight: 0, fillColor: diffColor(d.dz, maxAbs), fillOpacity: 1 }, label: `${d.dz > 0 ? 'Relleno' : 'Corte'} ${Math.abs(d.dz).toFixed(2)} m` },
    geometry: { type: 'Polygon', coordinates: [cellPolygon(minX, minY, d.gx, d.gy, cell, zone, north)] },
  }));
  return { cut, fill, net: fill - cut, area: cells * area, cellsCompared: cells, cell, geojson: { type: 'FeatureCollection', features }, ok: cells > 0 };
}

/** Volumen entre DOS superficies (base = terreno natural / fecha 1; nueva = proyecto /
 *  fecha 2). Se comparan sobre la intersección de sus bbox. */
export function volumeBetween(base: XYZ[], nueva: XYZ[], cellHint?: number, zone = 19, north = true): VolumeResult {
  const bb = bboxOf(base), bn = bboxOf(nueva);
  if (!bb || !bn || base.length < 3 || nueva.length < 3) return empty('Se necesitan ambas superficies con al menos 3 puntos.');
  const minX = Math.max(bb.minX, bn.minX), minY = Math.max(bb.minY, bn.minY);
  const maxX = Math.min(bb.maxX, bn.maxX), maxY = Math.min(bb.maxY, bn.maxY);
  if (!(maxX > minX) || !(maxY > minY)) return empty('Las dos superficies no se solapan en planta.');
  const spec = specFor(minX, minY, maxX, maxY, cellHint);
  if (!spec) return empty('No se pudo construir la malla de comparación.');
  return integrate(buildGridOn(base, spec), buildGridOn(nueva, spec), spec, zone, north);
}

/** Volumen de una superficie contra un NIVEL de diseño (cota plana). Relleno donde el
 *  terreno está por debajo del nivel; corte donde está por encima. */
export function volumeToLevel(pts: XYZ[], level: number, cellHint?: number, zone = 19, north = true): VolumeResult {
  const bb = bboxOf(pts);
  if (!bb || pts.length < 3) return empty('Se necesita la superficie con al menos 3 puntos.');
  const spec = specFor(bb.minX, bb.minY, bb.maxX, bb.maxY, cellHint);
  if (!spec) return empty('No se pudo construir la malla.');
  const zTerr = buildGridOn(pts, spec);
  const zDesign = new Float64Array(zTerr.length);
  for (let i = 0; i < zTerr.length; i++) zDesign[i] = isNaN(zTerr[i]) ? NaN : level;
  // base = terreno, nueva = diseño → dz = level − terreno (relleno si terreno<nivel).
  return integrate(zTerr, zDesign, spec, zone, north);
}

function empty(error: string): VolumeResult {
  return { cut: 0, fill: 0, net: 0, area: 0, cellsCompared: 0, cell: 0, geojson: { type: 'FeatureCollection', features: [] }, ok: false, error };
}

export const fmtM3 = (v: number) => `${v.toLocaleString('es-VE', { maximumFractionDigits: 1 })} m³`;
