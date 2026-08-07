import { supabase } from './supabase';
import { pdfDocument, exportPdf } from './pdf';
import { cmpText } from './text';
import { sectorOf, sectorLabel } from './mapZones';

/**
 * Reporte "RECORRIDO DEL INSPECTOR" (PDF). Reconstruye la SECUENCIA HORARIA de las
 * revisiones (check-ins) que hizo cada inspector durante un día: a qué hora revisó
 * cada máquina, en qué sector/ubicación estaba, en qué estado la encontró
 * (trabajando / parada / no está) y si estaba CERCA del equipo (distancia GPS).
 *
 * Fuente: `supervisor_visits` (un registro por check-in). Se filtra por `visit_date`
 * y, opcionalmente, por los inspectores elegidos. Las filas se ordenan por
 * `visited_at` ascendente para leer el recorrido en orden cronológico. El sector se
 * deriva del GPS del inspector (sectorLabel(sectorOf(lat,lng))); si no cae en zona,
 * cae a la referencia de la máquina.
 */

const esc = (v: any) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const dmy = (iso: string) => { const [y, m, d] = (iso || '').split('-'); return y && m && d ? `${d}/${m}/${y}` : iso; };
/** Hora (Caracas) "HH:MM am/pm" de un instante ISO, o '—'. */
const horaCaracas = (iso: string | null): string => {
  if (!iso) return '—';
  try { return new Intl.DateTimeFormat('es-VE', { timeZone: 'America/Caracas', hour: '2-digit', minute: '2-digit', hour12: true }).format(new Date(iso)); } catch { return '—'; }
};

const estadoTxt = (s: any): string => {
  const v = String(s ?? '').trim();
  if (v === 'trabajando') return '🟢 Trabajando';
  if (v === 'parada') return '🟡 Parada';
  if (v === 'no_esta') return '🔴 No está';
  return v || '—';
};

/** Sector según GPS del inspector; si no hay zona, cae a la referencia de la máquina. */
const ubicacionTxt = (lat: any, lng: any, machine: any): string => {
  const lbl = sectorLabel(sectorOf(lat, lng));
  if (lbl && lbl !== 'Sin zona') return lbl;
  return (machine?.referencia && String(machine.referencia).trim()) || '—';
};

/** "✓ (47 m)" si está cerca, "120 m" si no; '—' si no hay distancia. */
const cercaTxt = (near: any, distanceM: any): string => {
  if (distanceM == null) return '—';
  const m = Math.round(Number(distanceM));
  return near ? `✓ (${m} m)` : `${m} m`;
};

/**
 * Genera y exporta el PDF del recorrido del inspector.
 * @param date día ISO "AAAA-MM-DD".
 * @param inspectors nombres de inspectores a incluir (opcional; vacío = todos).
 * @returns true si el usuario confirmó (imprimió/guardó), false si canceló.
 */
export async function generateInspectorTrazaReport(opts: { date: string; inspectors?: string[] }): Promise<boolean> {
  const { date, inspectors } = opts;
  const fecha = dmy(date);

  let query = supabase
    .from('supervisor_visits')
    .select('supervisor_name, machinery_id, visited_at, status, lat, lng, distance_m, near, machine:machinery_id(code, serial, plate, referencia, company:company_id(name))')
    .eq('visit_date', date);
  if (inspectors && inspectors.length) query = query.in('supervisor_name', inspectors);
  const { data } = await query.order('visited_at', { ascending: true });

  const rows = (data ?? []) as any[];

  // Agrupa por inspector (manteniendo el orden cronológico ya aplicado).
  const porInspector = new Map<string, any[]>();
  rows.forEach((r) => {
    const nombre = String(r.supervisor_name ?? '').trim() || 'Sin nombre';
    if (!porInspector.has(nombre)) porInspector.set(nombre, []);
    porInspector.get(nombre)!.push(r);
  });

  const inspectores = Array.from(porInspector.entries()).sort((a, b) => cmpText(a[0], b[0]));

  const tabla = (visitas: any[]): string => {
    const trs = visitas.map((v, i) => {
      const m = v.machine || {};
      return `<tr>
        <td>${i + 1}</td>
        <td>${esc(horaCaracas(v.visited_at))}</td>
        <td><b>${esc(m.code || '—')}</b></td>
        <td>${esc(m.serial || m.plate || '—')}</td>
        <td>${esc(ubicacionTxt(v.lat, v.lng, m))}</td>
        <td>${esc(estadoTxt(v.status))}</td>
        <td>${esc(cercaTxt(v.near, v.distance_m))}</td>
      </tr>`;
    }).join('');
    return `<table class="ir"><thead><tr>
      <th style="width:24px">Nº</th><th>Hora</th><th>Máquina</th><th>Serial/Placa</th>
      <th>Sector/Ubicación</th><th>Estado</th><th>Cerca</th>
    </tr></thead><tbody>${trs}</tbody></table>`;
  };

  const secciones = inspectores.map(([nombre, visitas]) =>
    `<h3>👮 ${esc(nombre)} · ${visitas.length} revisión(es)</h3>${tabla(visitas)}`).join('');

  const totalVisitas = rows.length;
  const inspectoresCount = inspectores.length;

  const extraCss = `
    h3{margin:16px 0 3px;font-size:13px;color:#1E3A5F;padding-bottom:3px;border-bottom:2px solid #1E3A5F}
    table.ir{width:100%;border-collapse:collapse;margin:4px 0 12px;font-size:11px}
    table.ir th,table.ir td{border:1px solid #ccc;padding:5px 7px;text-align:left;vertical-align:top}
    table.ir th{background:#1E3A5F;color:#fff}
  `;

  const subtitle = `${fecha} · ${inspectoresCount} inspector(es) · ${totalVisitas} revisión(es)`;

  const html = pdfDocument({
    title: 'RECORRIDO DEL INSPECTOR',
    subtitle,
    body: rows.length ? secciones : '<p>Sin revisiones para ese día.</p>',
    extraCss,
  });
  return await exportPdf(html, `Recorrido inspector ${fecha}`);
}
