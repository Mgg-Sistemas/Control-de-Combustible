// Modelo Digital del Terreno (MDT): triangulación Delaunay (TIN) sobre los puntos,
// interpolación a una rejilla regular y curvas de nivel por marching-squares.
// Todo el cálculo se hace en el plano UTM (metros); la salida para el mapa se
// convierte a lat/lon. Sin dependencias pesadas: solo `delaunator`.
import Delaunator from 'delaunator';
import { utmToLatLng } from './utm';

export type XYZ = { x: number; y: number; z: number }; // x=Este, y=Norte, z=cota
export type Grid = { grid: Float64Array; nx: number; ny: number; minX: number; minY: number; cell: number };
export type GridSpec = { minX: number; minY: number; cell: number; nx: number; ny: number };

const MAX_NODES = 400; // tope por eje (rendimiento)

/** Caja envolvente (bbox) de un conjunto de puntos en el plano UTM. */
export function bboxOf(pts: XYZ[]): { minX: number; minY: number; maxX: number; maxY: number } | null {
  if (!pts.length) return null;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of pts) { if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x; if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y; }
  return { minX, minY, maxX, maxY };
}

/** Interpola los puntos al TIN sobre una MALLA DADA (spec). NaN fuera del casco. */
export function buildGridOn(pts: XYZ[], spec: GridSpec): Float64Array {
  const { minX, minY, cell, nx, ny } = spec;
  const grid = new Float64Array(nx * ny).fill(NaN);
  if (pts.length < 3) return grid;
  const coords = new Float64Array(pts.length * 2);
  for (let i = 0; i < pts.length; i++) { coords[i * 2] = pts[i].x; coords[i * 2 + 1] = pts[i].y; }
  const DCtor: any = (Delaunator as any)?.default ?? Delaunator; // interop ESM/CJS
  const d = new DCtor(coords);
  const tri = d.triangles as Uint32Array;
  for (let t = 0; t < tri.length; t += 3) {
    const a = pts[tri[t]], b = pts[tri[t + 1]], c = pts[tri[t + 2]];
    const gx0 = Math.max(0, Math.floor((Math.min(a.x, b.x, c.x) - minX) / cell)), gx1 = Math.min(nx - 1, Math.ceil((Math.max(a.x, b.x, c.x) - minX) / cell));
    const gy0 = Math.max(0, Math.floor((Math.min(a.y, b.y, c.y) - minY) / cell)), gy1 = Math.min(ny - 1, Math.ceil((Math.max(a.y, b.y, c.y) - minY) / cell));
    const det = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
    if (Math.abs(det) < 1e-12) continue;
    for (let gy = gy0; gy <= gy1; gy++) {
      const wy = minY + gy * cell;
      for (let gx = gx0; gx <= gx1; gx++) {
        const wx = minX + gx * cell;
        const l1 = ((b.y - c.y) * (wx - c.x) + (c.x - b.x) * (wy - c.y)) / det;
        const l2 = ((c.y - a.y) * (wx - c.x) + (a.x - c.x) * (wy - c.y)) / det;
        const l3 = 1 - l1 - l2;
        if (l1 >= -1e-6 && l2 >= -1e-6 && l3 >= -1e-6) grid[gy * nx + gx] = l1 * a.z + l2 * b.z + l3 * c.z;
      }
    }
  }
  return grid;
}

/** Deriva una malla (spec) para una bbox con un tamaño de celda (respeta el tope). */
export function specFor(minX: number, minY: number, maxX: number, maxY: number, cellHint?: number): GridSpec | null {
  const sizeX = maxX - minX, sizeY = maxY - minY;
  if (!(sizeX > 0) && !(sizeY > 0)) return null;
  let cell = cellHint && cellHint > 0 ? cellHint : Math.max(Math.max(sizeX, sizeY) / 150, 0.2);
  let nx = Math.floor(sizeX / cell) + 1, ny = Math.floor(sizeY / cell) + 1;
  if (nx > MAX_NODES || ny > MAX_NODES) { cell = Math.max(sizeX, sizeY) / (MAX_NODES - 1); nx = Math.floor(sizeX / cell) + 1; ny = Math.floor(sizeY / cell) + 1; }
  return { minX, minY, cell, nx, ny };
}

/** Interpola los puntos a una rejilla regular usando el TIN. NaN fuera del casco. */
export function buildGrid(pts: XYZ[], cellHint?: number): Grid | null {
  const bb = bboxOf(pts);
  if (!bb) return null;
  const spec = specFor(bb.minX, bb.minY, bb.maxX, bb.maxY, cellHint);
  if (!spec) return null;
  return { grid: buildGridOn(pts, spec), nx: spec.nx, ny: spec.ny, minX: spec.minX, minY: spec.minY, cell: spec.cell };
}

/** Segmentos (en coord. mundo UTM) de la curva de nivel `level` sobre la rejilla. */
export function marchingSquares(g: Grid, level: number): [number, number][][] {
  const { grid, nx, ny, minX, minY, cell } = g;
  const segs: [number, number][][] = [];
  const V = (gx: number, gy: number) => grid[gy * nx + gx];
  const wx = (gx: number) => minX + gx * cell;
  const wy = (gy: number) => minY + gy * cell;
  const interp = (x1: number, v1: number, x2: number, v2: number) => x1 + (x2 - x1) * ((level - v1) / (v2 - v1));
  for (let gy = 0; gy < ny - 1; gy++) {
    for (let gx = 0; gx < nx - 1; gx++) {
      const tl = V(gx, gy + 1), tr = V(gx + 1, gy + 1), br = V(gx + 1, gy), bl = V(gx, gy);
      if (isNaN(tl) || isNaN(tr) || isNaN(br) || isNaN(bl)) continue;
      let idx = 0;
      if (tl > level) idx |= 8; if (tr > level) idx |= 4; if (br > level) idx |= 2; if (bl > level) idx |= 1;
      if (idx === 0 || idx === 15) continue;
      const x0 = wx(gx), x1 = wx(gx + 1), y0 = wy(gy), y1 = wy(gy + 1);
      const eTop: [number, number] = [interp(x0, tl, x1, tr), y1];
      const eBottom: [number, number] = [interp(x0, bl, x1, br), y0];
      const eLeft: [number, number] = [x0, interp(y0, bl, y1, tl)];
      const eRight: [number, number] = [x1, interp(y0, br, y1, tr)];
      const push = (p: [number, number], q: [number, number]) => segs.push([p, q]);
      switch (idx) {
        case 1: case 14: push(eLeft, eBottom); break;
        case 2: case 13: push(eBottom, eRight); break;
        case 3: case 12: push(eLeft, eRight); break;
        case 4: case 11: push(eTop, eRight); break;
        case 5: push(eLeft, eTop); push(eBottom, eRight); break;
        case 6: case 9: push(eTop, eBottom); break;
        case 7: case 8: push(eLeft, eTop); break;
        case 10: push(eLeft, eBottom); push(eTop, eRight); break;
      }
    }
  }
  return segs;
}

/** Muestrea la cota (Z) interpolada en (x,y) sobre una rejilla (bilineal). NaN fuera. */
export function sampleZ(g: Grid, x: number, y: number): number {
  const { grid, nx, ny, minX, minY, cell } = g;
  const fx = (x - minX) / cell, fy = (y - minY) / cell;
  const gx = Math.floor(fx), gy = Math.floor(fy);
  if (gx < 0 || gy < 0 || gx >= nx - 1 || gy >= ny - 1) return NaN;
  const q11 = grid[gy * nx + gx], q21 = grid[gy * nx + gx + 1], q12 = grid[(gy + 1) * nx + gx], q22 = grid[(gy + 1) * nx + gx + 1];
  if (isNaN(q11) || isNaN(q21) || isNaN(q12) || isNaN(q22)) return NaN;
  const tx = fx - gx, ty = fy - gy;
  return q11 * (1 - tx) * (1 - ty) + q21 * tx * (1 - ty) + q12 * (1 - tx) * ty + q22 * tx * ty;
}

/** Perfil longitudinal entre A y B (UTM): muestrea la superficie en `n` estaciones. */
export function profile(g: Grid, ax: number, ay: number, bx: number, by: number, n = 80): { dist: number; z: number | null }[] {
  const out: { dist: number; z: number | null }[] = [];
  const total = Math.hypot(bx - ax, by - ay);
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const z = sampleZ(g, ax + (bx - ax) * t, ay + (by - ay) * t);
    out.push({ dist: total * t, z: isNaN(z) ? null : z });
  }
  return out;
}

/** Triángulos del TIN como triples de índices (base para caras LandXML/DXF). */
export function triangles(pts: XYZ[]): number[][] {
  if (pts.length < 3) return [];
  const coords = new Float64Array(pts.length * 2);
  for (let i = 0; i < pts.length; i++) { coords[i * 2] = pts[i].x; coords[i * 2 + 1] = pts[i].y; }
  const DCtor: any = (Delaunator as any)?.default ?? Delaunator;
  const tri = new DCtor(coords).triangles as Uint32Array;
  const out: number[][] = [];
  for (let t = 0; t < tri.length; t += 3) out.push([tri[t], tri[t + 1], tri[t + 2]]);
  return out;
}

/** Segmentos de las curvas de nivel EN COORDENADAS UTM (para exportar a DXF/CAD). */
export function contourSegmentsUTM(pts: XYZ[], interval: number): { level: number; segs: [number, number][][] }[] {
  const g = buildGrid(pts);
  if (!g || interval <= 0) return [];
  let zmin = Infinity, zmax = -Infinity;
  for (const p of pts) { if (p.z < zmin) zmin = p.z; if (p.z > zmax) zmax = p.z; }
  const out: { level: number; segs: [number, number][][] }[] = [];
  const start = Math.ceil(zmin / interval) * interval;
  let n = 0;
  for (let lv = start; lv <= zmax && n < 300; lv += interval, n++) {
    const segs = marchingSquares(g, lv);
    if (segs.length) out.push({ level: Number(lv.toFixed(3)), segs });
  }
  return out;
}

export type ContourResult = { geojson: any; grid: Grid | null; zmin: number; zmax: number; levels: number };

/** Genera las curvas de nivel a `interval` metros como GeoJSON (lat/lon) para el mapa. */
export function contours(pts: XYZ[], interval: number, zone = 19, north = true): ContourResult {
  const g = buildGrid(pts);
  let zmin = Infinity, zmax = -Infinity;
  for (const p of pts) { if (p.z < zmin) zmin = p.z; if (p.z > zmax) zmax = p.z; }
  if (!g || !isFinite(zmin) || interval <= 0) return { geojson: { type: 'FeatureCollection', features: [] }, grid: g, zmin, zmax, levels: 0 };
  const features: any[] = [];
  const start = Math.ceil(zmin / interval) * interval;
  let levels = 0;
  for (let lv = start; lv <= zmax && levels < 300; lv += interval, levels++) {
    const segs = marchingSquares(g, lv);
    if (!segs.length) continue;
    const coords = segs.map((s) => s.map(([x, y]) => { const ll = utmToLatLng(x, y, zone, north); return [ll.lng, ll.lat]; }));
    const major = Math.abs((lv / interval) % 5) < 1e-6;
    features.push({
      type: 'Feature',
      properties: { level: Number(lv.toFixed(3)), label: `${Number(lv.toFixed(2))} m`, style: { color: major ? '#7C3E00' : '#B45309', weight: major ? 2 : 1, opacity: 0.9 } },
      geometry: { type: 'MultiLineString', coordinates: coords },
    });
  }
  return { geojson: { type: 'FeatureCollection', features }, grid: g, zmin, zmax, levels: features.length };
}
