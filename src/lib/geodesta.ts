// Helpers del módulo de GEODESTA: captura GPS de alta precisión (con tolerancia),
// conversión a coordenadas UTM (N/E) y lectura/escritura de CSV de puntos.
import { Platform } from 'react-native';
import { latLngToUTM } from './utm';
import { norm } from './text';

export type GpsFix = { ok: boolean; error?: string; lat?: number; lng?: number; accuracy?: number; altitude?: number };

/** Captura una posición GPS de ALTA precisión (para topografía) devolviendo también
 *  la precisión estimada en metros, para poder rechazar tomas peores a la tolerancia
 *  del proyecto. En web usa navigator.geolocation; en nativo expo-location. */
export async function captureHighAccuracy(timeoutMs = 12000): Promise<GpsFix> {
  if (Platform.OS === 'web') {
    const geo = (globalThis as any)?.navigator?.geolocation;
    if (!geo) return { ok: false, error: 'Este navegador no tiene GPS disponible.' };
    return new Promise<GpsFix>((resolve) => {
      let done = false;
      const finish = (r: GpsFix) => { if (!done) { done = true; resolve(r); } };
      try {
        geo.getCurrentPosition(
          (p: any) => finish({ ok: true, lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy ?? undefined, altitude: p.coords.altitude ?? undefined }),
          (e: any) => finish({ ok: false, error: e?.message || 'No se pudo obtener la ubicación. Permite el acceso al GPS.' }),
          { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 }
        );
      } catch (e: any) { finish({ ok: false, error: e?.message || 'Error de GPS.' }); }
    });
  }
  try {
    const Location = require('expo-location');
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return { ok: false, error: 'Permiso de ubicación denegado.' };
    const cur: any = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.BestForNavigation });
    return { ok: true, lat: cur.coords.latitude, lng: cur.coords.longitude, accuracy: cur.coords.accuracy ?? undefined, altitude: cur.coords.altitude ?? undefined };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'El GPS tardó demasiado. Inténtalo al aire libre.' };
  }
}

/** N/E (UTM 19N, metros) a partir de lat/lon. Nota: usa datum WGS84; para el GPS del
 *  teléfono (3-10 m) la diferencia con REGVEN es despreciable. Los datos de RTK /
 *  estación total se importan ya en N/E y se guardan tal cual. */
export function neFromLatLng(lat: number, lng: number): { norte: number; este: number } {
  const u = latLngToUTM(lat, lng);
  return { norte: u.northing, este: u.easting };
}

/** Paleta de capas/códigos (para colorear puntos por capa en el mapa). */
export const LAYER_PALETTE = ['#2563EB', '#16A34A', '#D97706', '#DC2626', '#7C3AED', '#0891B2', '#DB2777', '#65A30D', '#EA580C', '#4F46E5'];
export function layerColor(layer: string | null | undefined, order: string[]): string {
  const key = (layer || '—').trim() || '—';
  const i = order.indexOf(key);
  return LAYER_PALETTE[(i < 0 ? 0 : i) % LAYER_PALETTE.length];
}

export type ParsedPoint = {
  code?: string; norte_m?: number; este_m?: number; cota_z?: number;
  lat?: number; lon?: number; layer?: string; description?: string;
};

const NUM = (s: any): number | undefined => {
  if (s === undefined || s === null || String(s).trim() === '') return undefined;
  const n = Number(String(s).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : undefined;
};

/** Detecta a qué campo corresponde un encabezado de columna. */
function headerKind(h: string): keyof ParsedPoint | 'skip' {
  const n = norm(h);
  if (/^(p|pto|punto|code|codigo|id|nombre|name)$/.test(n)) return 'code';
  if (/^(n|norte|northing|y)$/.test(n)) return 'norte_m';
  if (/^(e|este|easting|x)$/.test(n)) return 'este_m';
  if (/^(z|cota|elev|elevacion|altura|h)$/.test(n)) return 'cota_z';
  if (/^(lat|latitud|latitude)$/.test(n)) return 'lat';
  if (/^(lon|lng|long|longitud|longitude)$/.test(n)) return 'lon';
  if (/^(capa|layer|cod|codigo capa)$/.test(n)) return 'layer';
  if (/^(desc|descripcion|description|obs|observacion|nota)$/.test(n)) return 'description';
  return 'skip';
}

/** Lee un CSV/TXT de puntos. Con encabezado, mapea por nombre de columna; sin él,
 *  asume el orden clásico P,N,E,Z,desc. Separador coma, punto y coma o tab. */
export function parsePointsCsv(text: string): ParsedPoint[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return [];
  const splitLine = (l: string) => l.split(/[;,\t]/).map((c) => c.trim());
  const first = splitLine(lines[0]);
  const hasHeader = first.some((c) => headerKind(c) !== 'skip' && !NUM(c));
  const out: ParsedPoint[] = [];
  if (hasHeader) {
    const kinds = first.map(headerKind);
    for (let i = 1; i < lines.length; i++) {
      const cols = splitLine(lines[i]);
      const p: ParsedPoint = {};
      kinds.forEach((k, idx) => {
        if (k === 'skip') return;
        const v = cols[idx];
        if (k === 'code' || k === 'layer' || k === 'description') { if (v) (p as any)[k] = v; }
        else { const n = NUM(v); if (n !== undefined) (p as any)[k] = n; }
      });
      if (p.code || p.norte_m !== undefined || p.lat !== undefined) out.push(p);
    }
  } else {
    // Orden clásico: P, N, E, Z, desc
    for (const l of lines) {
      const c = splitLine(l);
      const p: ParsedPoint = { code: c[0] || undefined, norte_m: NUM(c[1]), este_m: NUM(c[2]), cota_z: NUM(c[3]), description: c[4] || undefined };
      if (p.code || p.norte_m !== undefined) out.push(p);
    }
  }
  return out;
}

/** Genera el CSV de exportación (encabezado P,N,E,Z,capa,desc,lat,lon). */
export function pointsToCsv(rows: { code: string | null; norte_m: number | null; este_m: number | null; cota_z: number | null; layer: string | null; description: string | null; lat: number | null; lon: number | null }[]): string {
  const head = 'P,N,E,Z,capa,desc,lat,lon';
  const esc = (v: any) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const body = rows.map((r) => [r.code, r.norte_m, r.este_m, r.cota_z, r.layer, r.description, r.lat, r.lon].map(esc).join(','));
  return [head, ...body].join('\n');
}
