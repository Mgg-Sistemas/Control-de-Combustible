import { selectAllRows } from './supabase';
import { pdfDocument, exportPdf } from './pdf';
import { cmpText } from './text';
import { isVolteoVolqueta } from './equipos';

/**
 * Reporte "CAMIONES SIN ASISTENCIA" (PDF). Lista los camiones (volteo/volqueta/
 * toronto) registrados que NO se presentaron en NINGÚN día del período elegido.
 *
 * Concepto "presente" en un día para (camión, día):
 *  - AUTO (machine_rounds): hubo jornada (`jornada_start_at`) o se registraron horas
 *    (`day_hours + night_hours > 0`).
 *  - MANUAL (truck_attendance): status 'presente' cuenta como presente; 'ausente' NO
 *    cuenta (y no anula la presencia auto de OTRO día del rango).
 *
 * "Sin asistencia" en el período = camión que NUNCA estuvo presente en ningún día
 * del rango (basta 1 día presente para quedar fuera de esta lista).
 */

const esc = (v: any) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const dmy = (iso: string) => { const [y, m, d] = (iso || '').split('-'); return y && m && d ? `${d}/${m}/${y}` : iso; };
const dash = (v: any) => { const s = String(v ?? '').trim(); return s || '—'; };

type Camion = {
  code: string; plate: string; serial: string; sector: string; encargado: string; empresa: string;
};

/**
 * Genera y exporta el PDF de camiones sin asistencia en el período.
 * @param from día ISO "AAAA-MM-DD" (inclusive).
 * @param to día ISO "AAAA-MM-DD" (inclusive).
 * @returns true si el usuario confirmó (imprimió/guardó), false si canceló.
 */
export async function generateCamionesSinAsistenciaReport(opts: { from: string; to: string }): Promise<boolean> {
  const { from, to } = opts;

  // 1) Camiones registrados: máquinas activas cuyo código es volteo/volqueta/toronto.
  const machs = await selectAllRows(
    'machinery',
    'id, code, plate, serial, encargado, sector, referencia, active, company:company_id(name)',
  );
  const camiones = ((machs ?? []) as any[]).filter((m) => m.active !== false && isVolteoVolqueta(m.code));

  if (!camiones.length) {
    const html = pdfDocument({
      title: 'CAMIONES SIN ASISTENCIA',
      subtitle: `${dmy(from)} — ${dmy(to)}`,
      body: '<p>No hay camiones (volteo/volqueta/toronto) registrados.</p>',
    });
    return await exportPdf(html, `Camiones sin asistencia ${dmy(from)} a ${dmy(to)}`);
  }

  // 2) Rondas del rango: presencia auto por (máquina, día).
  const rounds = await selectAllRows(
    'machine_rounds',
    'machinery_id, round_date, jornada_start_at, day_hours, night_hours',
    (q) => q.gte('round_date', from).lte('round_date', to),
  );

  // 3) Ajustes manuales del rango (prioriza sobre auto).
  const manual = await selectAllRows(
    'truck_attendance',
    'machinery_id, work_date, status',
    (q) => q.gte('work_date', from).lte('work_date', to),
  );

  // Set de máquinas con ALGUNA presencia en el rango.
  const presentes = new Set<string>();
  ((rounds ?? []) as any[]).forEach((r) => {
    const horas = (Number(r.day_hours) || 0) + (Number(r.night_hours) || 0);
    if (r.jornada_start_at || horas > 0) presentes.add(r.machinery_id);
  });
  ((manual ?? []) as any[]).forEach((a) => {
    if (a.status === 'presente') presentes.add(a.machinery_id);
  });

  // "Sin asistencia": camiones cuyo id NO está en el set de presentes.
  const sinAsistencia: Camion[] = camiones
    .filter((m) => !presentes.has(m.id))
    .map((m) => ({
      code: m.code || '—',
      plate: m.plate || '',
      serial: m.serial || '',
      sector: m.sector || m.referencia || '',
      encargado: m.encargado || '',
      empresa: m.company?.name || 'Sin empresa',
    }));

  const totalCamiones = camiones.length;
  const totalSin = sinAsistencia.length;

  const extraCss = `
    h3{margin:16px 0 3px;font-size:13px;color:#1E3A5F;padding-bottom:3px;border-bottom:2px solid #1E3A5F}
    table.ir{width:100%;border-collapse:collapse;margin:4px 0 12px;font-size:11px}
    table.ir th,table.ir td{border:1px solid #ccc;padding:5px 7px;text-align:left;vertical-align:top}
    table.ir th{background:#1E3A5F;color:#fff}
  `;

  // Si TODOS asistieron.
  if (totalSin === 0) {
    const html = pdfDocument({
      title: 'CAMIONES SIN ASISTENCIA',
      subtitle: `${dmy(from)} — ${dmy(to)} · 0 camión(es) sin asistencia de ${totalCamiones} · 0 empresa(s)`,
      body: '<h3 style="color:#1B7F3B;border-bottom-color:#1B7F3B">✅ Todos los camiones registraron asistencia en el período.</h3>',
      extraCss,
    });
    return await exportPdf(html, `Camiones sin asistencia ${dmy(from)} a ${dmy(to)}`);
  }

  // Agrupa por empresa (A→Z).
  const porEmpresa = new Map<string, Camion[]>();
  sinAsistencia.forEach((c) => {
    if (!porEmpresa.has(c.empresa)) porEmpresa.set(c.empresa, []);
    porEmpresa.get(c.empresa)!.push(c);
  });
  const empresas = Array.from(porEmpresa.entries()).sort((a, b) => cmpText(a[0], b[0]));

  const tabla = (filas: Camion[]): string => {
    const rows = filas.slice().sort((a, b) => cmpText(a.code, b.code)).map((f, i) =>
      `<tr>
        <td>${i + 1}</td><td><b>${esc(f.code)}</b></td><td>${esc(dash(f.plate))}</td>
        <td>${esc(dash(f.serial))}</td><td>${esc(dash(f.sector))}</td><td>${esc(dash(f.encargado))}</td>
      </tr>`).join('');
    return `<table class="ir"><thead><tr>
      <th style="width:24px">Nº</th><th>Camión</th><th>Placa</th><th>Serial</th><th>Sector</th><th>Encargado</th>
    </tr></thead><tbody>${rows}</tbody></table>`;
  };

  const secciones = empresas.map(([name, filas]) =>
    `<h3>🏢 ${esc(name)} · ${filas.length} camión(es)</h3>${tabla(filas)}`).join('');

  const subtitle = `${dmy(from)} — ${dmy(to)} · ${totalSin} camión(es) sin asistencia de ${totalCamiones} · ${empresas.length} empresa(s)`;

  const html = pdfDocument({
    title: 'CAMIONES SIN ASISTENCIA',
    subtitle,
    body: secciones,
    extraCss,
  });
  return await exportPdf(html, `Camiones sin asistencia ${dmy(from)} a ${dmy(to)}`);
}
