// Reporte DIARIO del Supervisor Externo Obras Públicas — SOLO sus máquinas
// asignadas y SOLO datos op_* (aislado del módulo de inspectores). Mismo look que
// los demás PDF (pdfDocument/exportPdf). El horario usa `horarioNominal` (7am→7pm /
// 7pm→7am), igual que el resto del sistema.
import { supabase } from './supabase';
import { pdfDocument, exportPdf, nowStamp } from './pdf';
import { cmpText } from './text';
import { horarioNominal } from './jornada';
import { listMyOpMachineIds, fetchOpRounds, fetchOpMaintPending } from './obrasPublicas';

const esc = (s: any) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Fecha ISO "AAAA-MM-DD" → "DD/MM/AAAA". */
function dmy(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

export async function generateObrasPublicasDailyReport(opts: { supervisorId: string | null; supervisorName: string; roundDate: string }): Promise<boolean> {
  const { supervisorId, supervisorName, roundDate } = opts;
  if (!supervisorId) return false;
  const ids = await listMyOpMachineIds(supervisorId);
  const [{ data: machs }, rounds, maint] = await Promise.all([
    ids.length ? supabase.from('machinery').select('id, code, plate, serial, marca, modelo, tipo, company:company_id(name), parroquia, sector') : Promise.resolve({ data: [] as any[] }),
    fetchOpRounds(ids, roundDate),
    fetchOpMaintPending(ids),
  ]);
  const lista = ((machs ?? []) as any[]).sort((a, b) => cmpText(a.code ?? '', b.code ?? ''));

  const estadoTxt = (id: string): { txt: string; color: string } => {
    const mt = maint[id];
    if (mt?.tipo === 'averia') return { txt: '🔴 Averiada', color: '#B91C1C' };
    if (mt?.tipo === 'parada') return { txt: '🟡 Parada', color: '#B45309' };
    const r = rounds[id];
    if (r?.jornada_start_at) return { txt: '🟢 Trabajando', color: '#15803D' };
    if (r && (r.day_hours > 0 || r.night_hours > 0)) return { txt: '🔵 Trabajó', color: '#2563EB' };
    return { txt: '⏳ Por revisar', color: '#6B7280' };
  };

  let totH = 0;
  const rows = lista.map((m, i) => {
    const r = rounds[m.id];
    const dh = r?.day_hours ?? 0, nh = r?.night_hours ?? 0;
    const h = r2(dh + nh); totH = r2(totH + h);
    const est = estadoTxt(m.id);
    const nom = horarioNominal(dh >= nh ? 'day' : 'night');
    const horario = h > 0 ? `${nom.ini} → ${nom.fin}` : '—';
    const mm = [m.marca, m.modelo].filter(Boolean).join(' ') || m.tipo || '—';
    return `<tr><td>${i + 1}</td><td><b>${esc(m.code)}</b></td><td>${esc(m.plate || m.serial || '—')}</td><td>${esc(mm)}</td>`
      + `<td style="color:${est.color};font-weight:700;white-space:nowrap">${esc(est.txt)}</td>`
      + `<td>${esc(m.company?.name || '—')}</td><td>${esc(m.sector || '—')}</td>`
      + `<td style="white-space:nowrap">${horario}</td><td class="r b">${h > 0 ? h : '—'}</td></tr>`;
  }).join('');

  const body = `
    <div class="fecha-dia">📅 ${esc(dmy(roundDate))}</div>
    <h2 style="margin:6px 0">🏛️ Reporte diario · Obras Públicas</h2>
    <p style="margin:2px 0"><b>Supervisor:</b> ${esc(supervisorName)} · <b>Máquinas:</b> ${lista.length}</p>
    <table class="ir"><thead><tr>
      <th style="width:26px">Nº</th><th>Máquina</th><th>Placa / Serial</th><th>Marca-Modelo</th>
      <th>Estado</th><th>Empresa</th><th>Sector</th><th>Horario</th><th>Horas</th>
    </tr></thead><tbody>${rows || '<tr><td colspan="9">Sin máquinas asignadas.</td></tr>'}</tbody>
    <tfoot><tr><td colspan="8">Total · ${lista.length} equipo(s)</td><td class="r b">${totH} h</td></tr></tfoot></table>
    <p style="color:#666;font-size:10px;margin-top:8px">Generado ${esc(nowStamp())} · Datos exclusivos de Obras Públicas (no afectan Inspecciones).</p>`;

  const extraCss = `.fecha-dia{font-size:20px;font-weight:800;border:1px solid #ccc;border-radius:8px;padding:6px 10px;display:inline-block;margin-bottom:6px}
    table.ir{width:100%;border-collapse:collapse;font-size:11px} table.ir th,table.ir td{border:1px solid #ddd;padding:4px 6px;text-align:left}
    table.ir th{background:#f3f4f6} .r{text-align:right} .b{font-weight:800}`;

  const html = pdfDocument({ title: 'Reporte diario · Obras Públicas', subtitle: supervisorName, body, extraCss });
  return exportPdf(html, `obras-publicas-${supervisorName}-${roundDate}`);
}
