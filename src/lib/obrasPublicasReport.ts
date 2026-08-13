// Reporte DIARIO del Supervisor Externo Obras Públicas — SOLO sus máquinas
// asignadas y SOLO datos op_* (aislado del módulo de inspectores). Mismo look que
// los demás PDF (pdfDocument/exportPdf). El horario usa `horarioNominal` (7am→7pm /
// 7pm→7am), igual que el resto del sistema.
import { supabase } from './supabase';
import { pdfDocument, exportPdf, nowStamp } from './pdf';
import { cmpText } from './text';
import { horarioNominal } from './jornada';
import {
  listMyOpMachineIds, fetchOpRounds, fetchOpMaintPending,
  fetchMyDailyReport, fetchOpDailyReports, fetchOpReportSettings, computeOpAccumulated,
  OpDailyReport, fetchEdificioReportesDia, OpEdificioReporte,
} from './obrasPublicas';

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
    ids.length ? supabase.from('machinery').select('id, code, plate, serial, marca, modelo, tipo, company:company_id(name), parroquia, sector').in('id', ids) : Promise.resolve({ data: [] as any[] }),
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

// ── Reporte de Actividades (consolidado del día + acumulados) ────────────────

/** Miles con "." y decimales con "," (formato local, sin depender de Intl). */
function fmt(n: number): string {
  const r = Math.round((Number(n) || 0) * 10) / 10;
  const neg = r < 0 ? '-' : '';
  const [int, dec] = String(Math.abs(r)).split('.');
  const miles = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${neg}${miles}${dec ? ',' + dec : ''}`;
}

/**
 * PDF del "Reporte de Actividades" de una supervisora en un día: sus métricas
 * del día (m³ removidos, m³ acarreo, cuerpos, traslado camión), su observación y los
 * ACUMULADOS de toda la operación (base + suma de todos los reportes desde el corte).
 */
export async function generateOpActivityReport(opts: {
  supervisorId: string | null; supervisorName: string; roundDate: string; report?: OpDailyReport | null;
}): Promise<boolean> {
  const { supervisorId, supervisorName, roundDate } = opts;
  const rep = opts.report ?? await fetchMyDailyReport(supervisorId, roundDate, supervisorName);
  const [settings, all] = await Promise.all([fetchOpReportSettings(), fetchOpDailyReports(settingsFromDate())]);
  const acc = computeOpAccumulated(all, settings);

  const kpi = (label: string, value: string, unit: string) => `
    <div class="opk">
      <div class="opk-v">${esc(value)}<span class="opk-u"> ${esc(unit)}</span></div>
      <div class="opk-l">${esc(label)}</div>
    </div>`;

  const body = `
    <div class="fecha-dia">📅 ${esc(dmy(roundDate))}</div>
    <h2 style="margin:6px 0">🏛️ Reporte de Actividades${rep.reporte_no != null ? ` · N° ${esc(rep.reporte_no)}` : ''}</h2>
    <p style="margin:2px 0"><b>Supervisor:</b> ${esc(supervisorName)}${rep.edificio ? ` · <b>Edificio:</b> ${esc(rep.edificio)}` : ''}</p>

    <h3 style="margin:12px 0 4px">Del día</h3>
    <div class="opgrid">
      ${kpi('M³ removidos controlada', fmt(rep.m3_removidos_dia), 'm³')}
      ${kpi('M³ acarreo de vestigios', fmt(rep.m3_acarreo_dia), 'm³')}
      ${kpi('Cuerpos siniestrados', fmt(rep.cuerpos_dia), '')}
      ${kpi('Traslado camión', fmt(rep.traslado_camion_dia), '')}
    </div>

    <h3 style="margin:14px 0 4px">Acumulado desde el inicio</h3>
    <div class="opgrid">
      ${kpi('Total m³ acumulados', fmt(acc.m3), 'm³')}
      ${kpi('Total cuerpos siniestrados', fmt(acc.cuerpos), '')}
    </div>

    <h3 style="margin:14px 0 4px">Observación del día</h3>
    <div class="opobs">${rep.observacion ? esc(rep.observacion).replace(/\n/g, '<br>') : '<i style="color:#888">Sin observaciones.</i>'}</div>

    <p style="color:#666;font-size:10px;margin-top:12px">Generado ${esc(nowStamp())} · Acumulados = base registrada + reportes de todas las supervisoras desde el corte. Datos exclusivos de Obras Públicas (no afectan Inspecciones).</p>`;

  const extraCss = `.fecha-dia{font-size:20px;font-weight:800;border:1px solid #ccc;border-radius:8px;padding:6px 10px;display:inline-block;margin-bottom:6px}
    h3{font-size:13px;color:#374151;border-bottom:1px solid #e5e7eb;padding-bottom:2px}
    .opgrid{display:flex;flex-wrap:wrap;gap:8px}
    .opk{flex:1 1 40%;border:1px solid #ddd;border-radius:8px;padding:8px 10px;background:#f9fafb}
    .opk-v{font-size:22px;font-weight:800;color:#111827}
    .opk-u{font-size:12px;font-weight:600;color:#6b7280}
    .opk-l{font-size:11px;color:#6b7280;margin-top:2px;text-transform:uppercase;letter-spacing:.3px}
    .opobs{border:1px solid #ddd;border-radius:8px;padding:8px 10px;font-size:12px;min-height:36px}`;

  const html = pdfDocument({ title: 'Reporte de Actividades', subtitle: `${supervisorName} · ${dmy(roundDate)}`, body, extraCss });
  return exportPdf(html, `reporte-actividades-${supervisorName}-${roundDate}`);
}

/** El corte se ignora para traer reportes; usamos una fecha muy vieja para sumar todos los válidos. */
function settingsFromDate(): string { return '2000-01-01'; }

// ── REPORTE POR EDIFICIO PARA WHATSAPP (Fase 2) ──────────────────────────────
const SIN_SECTOR_WA = 'SIN SUB-SECTOR';
/** Número "bonito" (coma decimal, sin ceros de más). */
const nWa = (n: number) => {
  const r = Math.round((Number(n) || 0) * 100) / 100;
  return (Number.isInteger(r) ? r.toString() : r.toFixed(2)).replace('.', ',');
};

/**
 * Arma el TEXTO del reporte diario POR EDIFICIO listo para pegar/enviar por
 * WhatsApp: encabezado con fecha, luego cada edificio (agrupado por sub-sector)
 * con solo las líneas que tienen dato (removido/acumulado, acarreo, avance,
 * maquinaria, cuerpos, actividades, entregado), y al final los TOTALES del día.
 * Devuelve '' si no hay nada reportado ese día.
 */
export async function buildOpEdificioWhatsApp(date: string): Promise<string> {
  let reportes: OpEdificioReporte[] = [];
  try { reportes = await fetchEdificioReportesDia(date); } catch { reportes = []; }
  // Solo edificios con ALGO reportado (m³ removidos o algún campo de detalle).
  const conDato = reportes.filter((r) =>
    (r.m3 || 0) > 0 || (r.m3_acarreados || 0) > 0 || (r.viajes || 0) > 0 ||
    (r.supervivientes || 0) > 0 || (r.fallecidos || 0) > 0 ||
    (r.maq_en_uso || r.maq_inoperativo || r.maq_requerimiento || r.actividades) || r.entregado);
  if (conDato.length === 0) return '';

  // Agrupa por sub-sector (A→Z natural), edificios A→Z dentro de cada uno.
  const grupos = new Map<string, OpEdificioReporte[]>();
  conDato.forEach((r) => {
    const sec = (r.sub_sector ?? '').trim() || SIN_SECTOR_WA;
    if (!grupos.has(sec)) grupos.set(sec, []);
    grupos.get(sec)!.push(r);
  });
  const secOrden = Array.from(grupos.keys()).sort(cmpText);

  const L: string[] = [];
  L.push('🏛️ *OBRAS PÚBLICAS — REPORTE DIARIO*');
  L.push(`📅 ${dmy(date)}`);
  const supervisor = conDato.find((r) => r.supervisor_name)?.supervisor_name;
  if (supervisor) L.push(`👷 Supervisor: ${supervisor}`);

  for (const sec of secOrden) {
    L.push('');
    L.push(`📍 *${sec}*`);
    for (const r of grupos.get(sec)!.sort((a, b) => cmpText(a.edificio, b.edificio))) {
      L.push(`🏢 *${r.edificio}*${r.entregado ? '  ✅ ENTREGADO' : ''}`);
      if ((r.m3 || 0) > 0 || (r.acumulado || 0) > 0)
        L.push(`   • Removido hoy: ${nWa(r.m3 || 0)} m³  ·  Acumulado: ${nWa(r.acumulado || 0)} m³`);
      if ((r.m3_acarreados || 0) > 0 || (r.viajes || 0) > 0)
        L.push(`   • Acarreados: ${nWa(r.m3_acarreados || 0)} m³  ·  Viajes: ${r.viajes || 0}`);
      if (r.maq_en_uso) L.push(`   • Maq. en uso: ${r.maq_en_uso}`);
      if (r.maq_inoperativo) L.push(`   • Maq. inoperativa: ${r.maq_inoperativo}`);
      if (r.maq_requerimiento) L.push(`   • Maq. por requerimiento: ${r.maq_requerimiento}`);
      if ((r.supervivientes || 0) > 0 || (r.fallecidos || 0) > 0)
        L.push(`   • Cuerpos: ${r.supervivientes || 0} supervivientes · ${r.fallecidos || 0} fallecidos`);
      if (r.actividades) L.push(`   • Actividades: ${r.actividades}`);
    }
  }

  // Totales del día.
  const t = conDato.reduce((a, r) => ({
    rem: a.rem + (r.m3 || 0), aca: a.aca + (r.m3_acarreados || 0), via: a.via + (r.viajes || 0),
    acum: a.acum + (r.acumulado || 0), sup: a.sup + (r.supervivientes || 0), fal: a.fal + (r.fallecidos || 0),
  }), { rem: 0, aca: 0, via: 0, acum: 0, sup: 0, fal: 0 });
  L.push('');
  L.push('━━━━━━━━━━━━━━');
  L.push('📊 *TOTALES DEL DÍA*');
  L.push(`• Removido hoy: ${nWa(t.rem)} m³`);
  if (t.aca > 0 || t.via > 0) L.push(`• Acarreados: ${nWa(t.aca)} m³  ·  Viajes: ${t.via}`);
  L.push(`• Acumulado general: ${nWa(t.acum)} m³`);
  if (t.sup > 0 || t.fal > 0) L.push(`• Cuerpos: ${t.sup} supervivientes · ${t.fal} fallecidos`);
  L.push(`• Edificios reportados: ${conDato.length}`);

  return L.join('\n');
}
