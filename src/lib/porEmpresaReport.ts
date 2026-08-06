import { supabase, selectAllRows } from './supabase';
import { pdfDocument, exportPdf } from './pdf';
import { cmpText } from './text';
import { listInspectorAssignments } from './machineInspectors';

/**
 * Reporte del DÍA por EMPRESA (PDF). Para las empresas elegidas (tipo check) y un
 * día, lista por cada empresa sus máquinas con: Máquina, Serial/Placa, Inspector
 * asignado (día/noche), Horas trabajadas, Horas paradas/avería y la Avería/motivo.
 *
 * Incluye las máquinas de esas empresas que tuvieron ACTIVIDAD ese día (horas
 * trabajadas o paradas) o una avería/parada pendiente vigente — es un "resumen del
 * día", no todo el catálogo. Horas trabajadas = día+noche+extra (los tramos que de
 * verdad se trabajaron); Horas paradas = hours_stopped; la avería sale de
 * maintenance_requests (motivo en notes, o el material si no hay nota).
 */

const esc = (v: any) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const dmy = (iso: string) => { const [y, m, d] = (iso || '').split('-'); return y && m && d ? `${d}/${m}/${y}` : iso; };
const dash = (v: any) => { const s = String(v ?? '').trim(); return s || '—'; };
const n2 = (n: number) => Math.round(n * 100) / 100;

type Fila = {
  code: string; serialPlaca: string; inspector: string;
  trabajadas: number; paradas: number; averia: string;
};

/**
 * Genera y exporta el PDF del reporte del día por empresa.
 * @param date día ISO "AAAA-MM-DD".
 * @param companyIds IDs de las empresas seleccionadas.
 * @returns true si el usuario confirmó (imprimió/guardó), false si canceló.
 */
export async function generateEmpresaDiaReport(opts: { date: string; companyIds: string[] }): Promise<boolean> {
  const { date, companyIds } = opts;
  const fecha = dmy(date);
  if (!companyIds.length) return false;

  // 1) Máquinas de las empresas elegidas.
  const machs = await selectAllRows(
    'machinery',
    'id, code, serial, plate, company_id, company:company_id(name)',
    (q) => q.in('company_id', companyIds),
  );
  const ids = ((machs ?? []) as any[]).map((m) => m.id);
  if (!ids.length) return false;
  const machById = new Map<string, any>();
  ((machs ?? []) as any[]).forEach((m) => machById.set(m.id, m));

  // 2) Rondas del día (horas trabajadas y paradas).
  const rounds = await selectAllRows(
    'machine_rounds',
    'machinery_id, day_hours, night_hours, hours_stopped, overtime_hours',
    (q) => q.eq('round_date', date).in('machinery_id', ids),
  );
  const roundBy = new Map<string, any>();
  ((rounds ?? []) as any[]).forEach((r) => roundBy.set(r.machinery_id, r));

  // 3) Inspector asignado (CHECK) por turno.
  const { rows: assigns } = await listInspectorAssignments();
  const dayInsp = new Map<string, string>();
  const nightInsp = new Map<string, string>();
  assigns.forEach((a) => { (a.shift === 'night' ? nightInsp : dayInsp).set(a.machinery_id, a.inspector_name || ''); });

  // 4) Avería/parada PENDIENTE vigente hasta ese día (se arrastra hasta resolver).
  const { data: mr } = await supabase
    .from('maintenance_requests')
    .select('machinery_id, material, notes, created_at')
    .eq('status', 'pendiente')
    .lte('created_at', `${date}T23:59:59.999-04:00`)
    .in('machinery_id', ids)
    .order('created_at', { ascending: false });
  const averBy = new Map<string, string>(); // motivo más reciente por máquina
  ((mr ?? []) as any[]).forEach((m) => {
    if (averBy.has(m.machinery_id)) return; // ya viene ordenado desc: la 1ª es la más reciente
    const notes = (m.notes && String(m.notes).trim()) || '';
    const esParada = m.material === 'MÁQUINA PARADA';
    averBy.set(m.machinery_id, esParada ? (notes || 'Parada') : (notes || (m.material ? String(m.material) : 'Avería')));
  });

  const sinInspReal = (nm: string) => !nm || /faltant/i.test(nm);
  const inspTxt = (id: string): string => {
    const d = dayInsp.get(id); const nn = nightInsp.get(id);
    const parts: string[] = [];
    if (d && !sinInspReal(d)) parts.push(`☀️ ${d}`);
    if (nn && !sinInspReal(nn)) parts.push(`🌙 ${nn}`);
    return parts.length ? parts.join(' · ') : '—';
  };

  // Por empresa → filas (solo máquinas con actividad o avería/parada ese día).
  const porEmpresa = new Map<string, Fila[]>();
  ids.forEach((id) => {
    const r = roundBy.get(id);
    const trab = n2((Number(r?.day_hours) || 0) + (Number(r?.night_hours) || 0) + (Number(r?.overtime_hours) || 0));
    const par = n2(Number(r?.hours_stopped) || 0);
    const averia = averBy.get(id) || '';
    if (trab <= 0 && par <= 0 && !averia) return; // sin nada que reportar ese día
    const m = machById.get(id);
    const empresa = m?.company?.name || 'Sin empresa';
    const fila: Fila = {
      code: m?.code || '—',
      serialPlaca: m?.serial || m?.plate || '—',
      inspector: inspTxt(id),
      trabajadas: trab, paradas: par, averia,
    };
    if (!porEmpresa.has(empresa)) porEmpresa.set(empresa, []);
    porEmpresa.get(empresa)!.push(fila);
  });

  const empresas = Array.from(porEmpresa.entries()).sort((a, b) => cmpText(a[0], b[0]));

  const tabla = (filas: Fila[]): string => {
    const rows = filas.slice().sort((a, b) => cmpText(a.code, b.code)).map((f, i) =>
      `<tr>
        <td>${i + 1}</td><td><b>${esc(f.code)}</b></td><td>${esc(dash(f.serialPlaca))}</td>
        <td>${esc(f.inspector)}</td>
        <td class="r b">${f.trabajadas > 0 ? f.trabajadas : '—'}</td>
        <td class="r">${f.paradas > 0 ? f.paradas : '—'}</td>
        <td>${esc(dash(f.averia))}</td>
      </tr>`).join('');
    const tTrab = n2(filas.reduce((s, f) => s + f.trabajadas, 0));
    const tPar = n2(filas.reduce((s, f) => s + f.paradas, 0));
    return `<table class="ir"><thead><tr>
      <th style="width:24px">Nº</th><th>Máquina</th><th>Serial/Placa</th><th>Inspector asignado</th>
      <th class="r">Horas trab.</th><th class="r">Horas parada</th><th>Avería / motivo</th>
    </tr></thead><tbody>${rows}</tbody>
    <tfoot><tr><td colspan="4">Total · ${filas.length} equipo(s)</td><td class="r b">${tTrab}</td><td class="r">${tPar}</td><td></td></tr></tfoot></table>`;
  };

  const secciones = empresas.map(([name, filas]) =>
    `<h3>🏢 ${esc(name)} · ${filas.length} máquina(s)</h3>${tabla(filas)}`).join('');

  const totMach = empresas.reduce((s, [, f]) => s + f.length, 0);
  const totTrab = n2(empresas.reduce((s, [, f]) => s + f.reduce((x, y) => x + y.trabajadas, 0), 0));
  const totPar = n2(empresas.reduce((s, [, f]) => s + f.reduce((x, y) => x + y.paradas, 0), 0));

  const extraCss = `
    h3{margin:16px 0 3px;font-size:13px;color:#1E3A5F;padding-bottom:3px;border-bottom:2px solid #1E3A5F}
    table.ir{width:100%;border-collapse:collapse;margin:4px 0 12px;font-size:11px}
    table.ir th,table.ir td{border:1px solid #ccc;padding:5px 7px;text-align:left;vertical-align:top}
    table.ir th{background:#1E3A5F;color:#fff}
    td.r,th.r{text-align:right} td.b{font-weight:800}
  `;

  const subtitle = `${fecha} · ${empresas.length} empresa(s) · ${totMach} máquina(s) · 🏁 ${totTrab} h trabajadas · 🟡 ${totPar} h paradas`;

  const html = pdfDocument({
    title: 'REPORTE DEL DÍA POR EMPRESA',
    subtitle,
    body: empresas.length ? secciones : '<p>Sin actividad para las empresas elegidas en este día.</p>',
    extraCss,
  });
  return await exportPdf(html, `Reporte del dia por empresa ${fecha}`);
}
