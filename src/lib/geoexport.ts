// Exportación del levantamiento a formatos de intercambio topográfico:
//  · DXF (AutoCAD)  · KML (Google Earth)  · GeoJSON (GIS: QGIS/ArcGIS → SHP/GeoPackage)
//  · LandXML (proyectistas y GUIADO DE MAQUINARIA: Trimble/Topcon importan la superficie).
// Los puntos y curvas se exportan en UTM (E,N,Z) para CAD/CAD-máquina; KML/GeoJSON en lat/lon.
import { Platform } from 'react-native';
import { XYZ, contourSegmentsUTM, triangles } from './tin';

export type ExpPoint = {
  code: string | null; norte_m: number | null; este_m: number | null; cota_z: number | null;
  lat: number | null; lon: number | null; layer: string | null; is_gcp?: boolean;
};

const layerName = (p: ExpPoint) => (p.is_gcp ? 'GCP' : (p.layer || 'PUNTOS').toUpperCase().replace(/[^A-Z0-9_]/g, '_') || 'PUNTOS');

/** DXF ASCII (R12): puntos como POINT + su código como TEXT, y curvas como LINE por cota. */
export function buildDxf(points: ExpPoint[], surfacePts?: XYZ[], interval = 1): string {
  const e: string[] = [];
  const line = (code: string | number, v: string | number) => { e.push(String(code)); e.push(String(v)); };
  e.push('0', 'SECTION', '2', 'ENTITIES');
  for (const p of points) {
    if (p.este_m == null || p.norte_m == null) continue;
    const z = p.cota_z ?? 0;
    line(0, 'POINT'); line(8, layerName(p)); line(10, p.este_m); line(20, p.norte_m); line(30, z);
    if (p.code) { line(0, 'TEXT'); line(8, 'CODIGOS'); line(10, p.este_m); line(20, p.norte_m); line(30, z); line(40, 0.3); line(1, p.code); }
  }
  if (surfacePts && surfacePts.length >= 3) {
    for (const c of contourSegmentsUTM(surfacePts, interval)) {
      const ly = `CURVAS_${String(c.level).replace(/[.\-]/g, '_')}`;
      for (const [[x1, y1], [x2, y2]] of c.segs) {
        line(0, 'LINE'); line(8, ly); line(10, x1); line(20, y1); line(30, c.level); line(11, x2); line(21, y2); line(31, c.level);
      }
    }
  }
  e.push('0', 'ENDSEC', '0', 'EOF');
  return e.join('\n');
}

/** KML (lat/lon): puntos como Placemark + curvas como LineString (si hay superficie). */
export function buildKml(name: string, points: ExpPoint[], contoursGeoJson?: any): string {
  const esc = (s: any) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const marks = points.filter((p) => p.lat != null && p.lon != null).map((p) => `
    <Placemark><name>${esc(p.code || 'punto')}</name>
      <description>${esc([p.layer, p.cota_z != null ? `Z=${p.cota_z} m` : '', p.is_gcp ? 'GCP' : ''].filter(Boolean).join(' · '))}</description>
      <Point><coordinates>${p.lon},${p.lat},${p.cota_z ?? 0}</coordinates></Point>
    </Placemark>`).join('');
  let lines = '';
  if (contoursGeoJson?.features?.length) {
    lines = contoursGeoJson.features.map((f: any) => (f.geometry?.coordinates || []).map((seg: number[][]) => `
    <Placemark><name>${esc(f.properties?.label || 'curva')}</name><Style><LineStyle><color>ff0973b4</color><width>1</width></LineStyle></Style>
      <LineString><coordinates>${seg.map((c) => `${c[0]},${c[1]}`).join(' ')}</coordinates></LineString>
    </Placemark>`).join('')).join('');
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${esc(name)}</name>${marks}${lines}</Document></kml>`;
}

/** GeoJSON (lat/lon): puntos + curvas. Lo importan QGIS/ArcGIS y se puede guardar como SHP/GeoPackage. */
export function buildGeoJson(points: ExpPoint[], contoursGeoJson?: any): string {
  const feats: any[] = points.filter((p) => p.lat != null && p.lon != null).map((p) => ({
    type: 'Feature',
    properties: { code: p.code, z: p.cota_z, layer: p.layer, gcp: !!p.is_gcp, norte: p.norte_m, este: p.este_m },
    geometry: { type: 'Point', coordinates: [p.lon, p.lat, p.cota_z ?? 0] },
  }));
  if (contoursGeoJson?.features?.length) feats.push(...contoursGeoJson.features);
  return JSON.stringify({ type: 'FeatureCollection', features: feats });
}

/** LandXML 1.2: CgPoints + superficie TIN (Pnts + Faces). Importa a software de proyecto
 *  y a sistemas de GUIADO DE MAQUINARIA (Trimble/Topcon/Leica). Coordenadas north/east/elev. */
export function buildLandXml(name: string, surfacePts: XYZ[]): string {
  const cg = surfacePts.map((p, i) => `<CgPoint name="${i + 1}">${p.y.toFixed(4)} ${p.x.toFixed(4)} ${p.z.toFixed(4)}</CgPoint>`).join('');
  const pnts = surfacePts.map((p, i) => `<P id="${i + 1}">${p.y.toFixed(4)} ${p.x.toFixed(4)} ${p.z.toFixed(4)}</P>`).join('');
  const faces = triangles(surfacePts).map((t) => `<F>${t[0] + 1} ${t[1] + 1} ${t[2] + 1}</F>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<LandXML xmlns="http://www.landxml.org/schema/LandXML-1.2" version="1.2" date="2026-01-01" time="00:00:00">
 <Units><Metric linearUnit="meter" areaUnit="squareMeter" volumeUnit="cubicMeter" temperatureUnit="celsius" pressureUnit="mmHG"/></Units>
 <CgPoints name="${name}">${cg}</CgPoints>
 <Surfaces><Surface name="${name}"><Definition surfType="TIN"><Pnts>${pnts}</Pnts><Faces>${faces}</Faces></Definition></Surface></Surfaces>
</LandXML>`;
}

/** Descarga un archivo de texto (solo web; en nativo el llamador avisa). */
export function downloadText(filename: string, text: string, mime = 'text/plain'): boolean {
  if (Platform.OS !== 'web') return false;
  const blob = new Blob([text], { type: `${mime};charset=utf-8;` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
  return true;
}
