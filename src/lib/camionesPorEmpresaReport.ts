import { selectAllRows } from './supabase';
import { pdfDocument, exportPdf } from './pdf';
import { cmpText } from './text';
import { isVolteoVolqueta } from './equipos';

/**
 * Reporte "ASISTENCIA DE CAMIONES POR EMPRESA" (PDF). Compara el cumplimiento de
 * asistencia entre las EMPRESAS contratistas, para sus CAMIONES (volteo, volqueta o
 * toronto), en un rango de fechas.
 *
 * "Camión" no tiene flag en la BD: se detecta por el código con
 * `isVolteoVolqueta(code)` (incluye 'volteo', 'volqueta' o 'toronto').
 *
 * Presencia de un (camión, día):
 *  - AUTOMÁTICA por rondas (`machine_rounds`): presente si hubo jornada iniciada o
 *    horas (día+noche > 0).
 *  - MANUAL (`truck_attendance`, status 'presente'|'ausente'): tiene PRIORIDAD sobre
 *    la automática cuando existe para ese camión+día.
 *
 * Por empresa: nCamiones, diasPosibles = nCamiones · nDiasRango, presencias (suma de
 * (camión,día) presentes) y cumplimiento% = presencias / diasPosibles · 100.
 */

const esc = (v: any) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const dmy = (iso: string) => { const [y, m, d] = (iso || '').split('-'); return y && m && d ? `${d}/${m}/${y}` : iso; };
const n1 = (n: number) => Math.round(n * 10) / 10;

/** Lista de fechas ISO 'AAAA-MM-DD' de `from`..`to` inclusive (iterando en UTC). */
function rangoDias(from: string, to: string): string[] {
  const out: string[] = [];
  const [fy, fm, fd] = (from || '').split('-').map(Number);
  const [ty, tm, td] = (to || '').split('-').map(Number);
  if (!fy || !fm || !fd || !ty || !tm || !td) return out;
  let cur = Date.UTC(fy, fm - 1, fd);
  const end = Date.UTC(ty, tm - 1, td);
  while (cur <= end) {
    const d = new Date(cur);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    out.push(`${y}-${m}-${day}`);
    cur += 86400000;
  }
  return out;
}

type FilaEmpresa = {
  empresa: string;
  nCamiones: number;
  diasPosibles: number;
  presencias: number;
  cumplimiento: number;
};

/**
 * Genera y exporta el PDF del reporte de asistencia de camiones por empresa.
 * @param opts.from día ISO "AAAA-MM-DD" inicial (inclusive).
 * @param opts.to día ISO "AAAA-MM-DD" final (inclusive).
 * @returns true si el usuario confirmó (imprimió/guardó), false si canceló.
 */
export async function generateCamionesPorEmpresaReport(opts: { from: string; to: string }): Promise<boolean> {
  const { from, to } = opts;
  const dias = rangoDias(from, to);
  const nDiasRango = dias.length;

  // 1) Máquinas camión activas (filtro en cliente: no hay flag en BD).
  const machs = await selectAllRows(
    'machinery',
    'id, code, plate, serial, active, company:company_id(name)',
  );
  const camiones = ((machs ?? []) as any[]).filter(
    (m) => m.active !== false && isVolteoVolqueta(m.code || ''),
  );

  if (!camiones.length) {
    const html = pdfDocument({
      title: 'ASISTENCIA DE CAMIONES POR EMPRESA',
      subtitle: `${dmy(from)} — ${dmy(to)}`,
      body: '<p>No hay camiones (volteo/volqueta/toronto) registrados.</p>',
    });
    return await exportPdf(html, `Camiones por empresa ${dmy(from)} a ${dmy(to)}`);
  }

  const camionIds = new Set(camiones.map((m) => m.id));
  const empresaDe = new Map<string, string>();
  camiones.forEach((m) => empresaDe.set(m.id, m?.company?.name || 'Sin empresa'));

  // 2) Rondas del rango → presencia AUTOMÁTICA por (máquina, día).
  const rounds = await selectAllRows(
    'machine_rounds',
    'machinery_id, round_date, jornada_start_at, day_hours, night_hours',
    (q) => q.gte('round_date', from).lte('round_date', to),
  );
  const autoBy = new Map<string, boolean>(); // `${machinery_id}|${dia}` → presente-auto
  ((rounds ?? []) as any[]).forEach((r) => {
    if (!camionIds.has(r.machinery_id)) return;
    const presente = !!r.jornada_start_at || (Number(r.day_hours) || 0) + (Number(r.night_hours) || 0) > 0;
    if (presente) autoBy.set(`${r.machinery_id}|${r.round_date}`, true);
  });

  // 3) Ajustes MANUALES del rango (prioridad sobre lo automático).
  const manuales = await selectAllRows(
    'truck_attendance',
    'machinery_id, work_date, status',
    (q) => q.gte('work_date', from).lte('work_date', to),
  );
  const manualBy = new Map<string, string>(); // `${machinery_id}|${dia}` → 'presente'|'ausente'
  ((manuales ?? []) as any[]).forEach((a) => {
    if (!camionIds.has(a.machinery_id)) return;
    manualBy.set(`${a.machinery_id}|${a.work_date}`, a.status);
  });

  // Presencia efectiva de un (camión, día): manual manda; si no, automática.
  const estaPresente = (machineryId: string, dia: string): boolean => {
    const key = `${machineryId}|${dia}`;
    const manual = manualBy.get(key);
    if (manual) return manual === 'presente';
    return autoBy.get(key) === true;
  };

  // 4) Agregado por EMPRESA.
  const camionesPorEmpresa = new Map<string, string[]>(); // empresa → ids
  camiones.forEach((m) => {
    const emp = empresaDe.get(m.id)!;
    if (!camionesPorEmpresa.has(emp)) camionesPorEmpresa.set(emp, []);
    camionesPorEmpresa.get(emp)!.push(m.id);
  });

  const filas: FilaEmpresa[] = [];
  camionesPorEmpresa.forEach((ids, empresa) => {
    const nCamiones = ids.length;
    const diasPosibles = nCamiones * nDiasRango;
    let presencias = 0;
    ids.forEach((id) => {
      dias.forEach((dia) => { if (estaPresente(id, dia)) presencias += 1; });
    });
    const cumplimiento = diasPosibles > 0 ? n1((presencias / diasPosibles) * 100) : 0;
    filas.push({ empresa, nCamiones, diasPosibles, presencias, cumplimiento });
  });

  // Orden: cumplimiento% DESC; desempate por nombre de empresa.
  filas.sort((a, b) => (b.cumplimiento - a.cumplimiento) || cmpText(a.empresa, b.empresa));

  const totalCamiones = filas.reduce((s, f) => s + f.nCamiones, 0);
  const totalPosibles = filas.reduce((s, f) => s + f.diasPosibles, 0);
  const totalPresencias = filas.reduce((s, f) => s + f.presencias, 0);
  const cumplGlobal = totalPosibles > 0 ? n1((totalPresencias / totalPosibles) * 100) : 0;
  const empresasCount = filas.length;

  const colorCumpl = (p: number): string => (p >= 80 ? '#1B7F3B' : p >= 50 ? '#B45309' : '#B00');

  const rows = filas.map((f, i) =>
    `<tr>
      <td class="r">${i + 1}</td>
      <td><b>${esc(f.empresa)}</b></td>
      <td class="r">${f.nCamiones}</td>
      <td class="r">${f.diasPosibles}</td>
      <td class="r">${f.presencias}</td>
      <td class="r b" style="color:${colorCumpl(f.cumplimiento)}">${n1(f.cumplimiento)} %</td>
    </tr>`).join('');

  const tabla = `<table class="ir"><thead><tr>
      <th class="r" style="width:24px">Nº</th><th>Empresa</th>
      <th class="r">Camiones</th><th class="r">Días posibles</th>
      <th class="r">Presencias</th><th class="r">Cumplimiento %</th>
    </tr></thead><tbody>${rows}</tbody>
    <tfoot><tr>
      <td colspan="2" class="b">Total · ${empresasCount} empresa(s)</td>
      <td class="r b">${totalCamiones}</td>
      <td class="r b">${totalPosibles}</td>
      <td class="r b">${totalPresencias}</td>
      <td class="r b" style="color:${colorCumpl(cumplGlobal)}">${n1(cumplGlobal)} %</td>
    </tr></tfoot></table>`;

  const extraCss = `
    h3{margin:16px 0 3px;font-size:13px;color:#1E3A5F;padding-bottom:3px;border-bottom:2px solid #1E3A5F}
    table.ir{width:100%;border-collapse:collapse;margin:4px 0 12px;font-size:11px}
    table.ir th,table.ir td{border:1px solid #ccc;padding:5px 7px;text-align:left;vertical-align:top}
    table.ir th{background:#1E3A5F;color:#fff}
    td.r,th.r{text-align:right} td.b{font-weight:800}
  `;

  const subtitle = `${dmy(from)} — ${dmy(to)} · ${nDiasRango} día(s) · ${empresasCount} empresa(s) · ${totalCamiones} camión(es)`;

  const html = pdfDocument({
    title: 'ASISTENCIA DE CAMIONES POR EMPRESA',
    subtitle,
    body: tabla,
    extraCss,
  });
  return await exportPdf(html, `Camiones por empresa ${dmy(from)} a ${dmy(to)}`);
}
