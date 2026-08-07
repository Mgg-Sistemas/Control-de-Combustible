import { selectAllRows } from './supabase';
import { pdfDocument, exportPdf } from './pdf';
import { cmpText } from './text';
import { sectorOf, sectorLabel } from './mapZones';

/**
 * Reporte JORNADAS POR SECTOR (PDF). Muestra cómo se distribuye el trabajo de la
 * operación entre los distintos SECTORES en un rango de fechas: cuántas horas y
 * cuántas jornadas aportó cada sector, cuántas máquinas distintas trabajaron ahí y
 * qué porcentaje del total representa.
 *
 * Fuente: `machine_rounds` en el rango [from, to]. Horas de una fila = día + noche;
 * una fila con horas > 0 cuenta como una "jornada". El sector de cada fila se resuelve
 * en orden: (1) `machine.sector` si viene cargado; (2) la zona geográfica derivada de
 * la lat/long (sectorOf → sectorLabel) si no es "Sin zona"; (3) la referencia de la
 * máquina; (4) "Sin sector".
 *
 * @param from día ISO "AAAA-MM-DD" (inclusive).
 * @param to   día ISO "AAAA-MM-DD" (inclusive).
 * @returns true si se imprimió/guardó, false si se canceló o no hay datos.
 */

const esc = (v: any) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const dmy = (iso: string) => { const [y, m, d] = (iso || '').split('-'); return y && m && d ? `${d}/${m}/${y}` : iso; };
const n1 = (n: number) => Math.round(n * 10) / 10;

type Agg = { horas: number; jornadas: number; maquinas: Set<string> };

export async function generateJornadasPorSectorReport(opts: { from: string; to: string }): Promise<boolean> {
  const { from, to } = opts;

  // 1) Rondas del rango, con la máquina para poder resolver el sector.
  const rounds = await selectAllRows(
    'machine_rounds',
    'machinery_id, round_date, day_hours, night_hours, machine:machinery_id(code, sector, referencia, latitude, longitude)',
    (q) => q.gte('round_date', from).lte('round_date', to),
  );

  // 2) Agrega por sector.
  const bySector = new Map<string, Agg>();
  ((rounds ?? []) as any[]).forEach((r) => {
    const horas = (Number(r.day_hours) || 0) + (Number(r.night_hours) || 0);
    if (horas <= 0) return; // sólo jornadas con horas cuentan
    const m = r.machine || {};
    // Sector: (1) machine.sector; (2) zona geográfica; (3) referencia; (4) Sin sector.
    let sector = String(m.sector ?? '').trim();
    if (!sector) {
      const s = sectorLabel(sectorOf(m.latitude, m.longitude));
      sector = s && s !== 'Sin zona' ? s : (String(m.referencia ?? '').trim() || 'Sin sector');
    }
    const agg = bySector.get(sector) ?? { horas: 0, jornadas: 0, maquinas: new Set<string>() };
    agg.horas += horas;
    agg.jornadas += 1;
    if (m.code) agg.maquinas.add(String(m.code));
    bySector.set(sector, agg);
  });

  const totalHoras = n1(Array.from(bySector.values()).reduce((s, a) => s + a.horas, 0));

  // 3) Ordena sectores por horas DESC, desempate por nombre.
  const sectores = Array.from(bySector.entries())
    .sort((a, b) => (b[1].horas - a[1].horas) || cmpText(a[0], b[0]));

  const totJornadas = sectores.reduce((s, [, a]) => s + a.jornadas, 0);
  const sectoresCount = sectores.length;

  const filas = sectores.map(([sector, a], i) => {
    const horas = n1(a.horas);
    const pct = totalHoras > 0 ? n1(a.horas / totalHoras * 100) : 0;
    return `<tr>
      <td>${i + 1}</td>
      <td><b>${esc(sector)}</b></td>
      <td class="r b">${horas}</td>
      <td class="r">${pct}%</td>
      <td class="r">${a.jornadas}</td>
      <td class="r">${a.maquinas.size}</td>
      <td><div style="background:#1E3A5F;height:8px;width:${pct}%;border-radius:4px"></div></td>
    </tr>`;
  }).join('');

  const tabla = `<table class="ir"><thead><tr>
      <th style="width:24px">Nº</th><th>Sector</th>
      <th class="r">Horas</th><th class="r">% del total</th>
      <th class="r">Jornadas</th><th class="r">Máquinas</th>
      <th>Distribución</th>
    </tr></thead><tbody>${filas}</tbody>
    <tfoot><tr>
      <td colspan="2">Total · ${sectoresCount} sector(es)</td>
      <td class="r b">${totalHoras}</td>
      <td class="r">100%</td>
      <td class="r">${totJornadas}</td>
      <td colspan="2"></td>
    </tr></tfoot></table>`;

  const extraCss = `
    h3{margin:16px 0 3px;font-size:13px;color:#1E3A5F;padding-bottom:3px;border-bottom:2px solid #1E3A5F}
    table.ir{width:100%;border-collapse:collapse;margin:4px 0 12px;font-size:11px}
    table.ir th,table.ir td{border:1px solid #ccc;padding:5px 7px;text-align:left;vertical-align:middle}
    table.ir th{background:#1E3A5F;color:#fff}
    td.r,th.r{text-align:right} td.b{font-weight:800}
  `;

  const subtitle = `${dmy(from)} — ${dmy(to)} · ${sectoresCount} sector(es) · 🕒 ${totalHoras} h`;

  const html = pdfDocument({
    title: 'JORNADAS POR SECTOR',
    subtitle,
    body: sectores.length ? tabla : '<p>Sin jornadas en el rango.</p>',
    extraCss,
  });
  return await exportPdf(html, `Jornadas por sector ${dmy(from)} a ${dmy(to)}`);
}
