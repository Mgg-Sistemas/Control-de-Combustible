import { supabase, selectAllRows } from './supabase';
import { pdfDocument, exportPdf } from './pdf';
import { cmpText } from './text';
import { sectorOf, sectorLabel } from './mapZones';
import { edificioCanonico } from './edificios';
import { listVisits } from './supervisorVisits';
import { listInspectorAssignments } from './machineInspectors';

/**
 * Reporte de ESTADO DE MÁQUINAS (por jornada) en PDF, para un día.
 *
 * Cuatro secciones (según el cliente):
 *  1) 🟢 Máquinas INICIADAS (jornada en curso): rondas del día con
 *     `jornada_start_at` != null.
 *  2) 🕓 Máquinas PENDIENTES por iniciar jornada: máquinas ASIGNADAS a un
 *     inspector (machine_inspectors) que HOY no tienen ronda con jornada iniciada
 *     ni jornada finalizada (sin horas de día/noche registradas hoy).
 *  3) 🔴 Máquinas AVERIADAS: máquinas con avería pendiente — `maintenance_requests`
 *     (material 'MÁQUINA PARADA', status 'pendiente') reportadas ese día, o visitas
 *     de supervisión (supervisor_visits) con estado 'parada' ese día. Muestra quién
 *     reportó y el motivo.
 *  4) ✅ Máquinas con jornada FINALIZADA: rondas con horas (día o noche > 0) y
 *     `jornada_start_at` en null.
 *
 * Cada fila muestra: fecha, hora (de inicio de jornada), lugar (sector/ubicación),
 * edificio, placa/serial e inspector. Se EXCLUYEN los usuarios ADMIN (mismo
 * criterio que el reporte de inspectores). Todo A→Z por código de máquina.
 */

const esc = (v: any) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const dmy = (iso: string) => { const [y, m, d] = (iso || '').split('-'); return y && m && d ? `${d}/${m}/${y}` : iso; };
const r2 = (n: number) => Math.round(n * 100) / 100;

const CARACAS_TZ = 'America/Caracas';

/** Hora "hh:mm a. m./p. m." (Caracas) de un instante ISO; '—' si no hay. */
function caracasClock(ts?: string | null): string {
  if (!ts) return '—';
  try {
    return new Date(ts).toLocaleTimeString('es-VE', { timeZone: CARACAS_TZ, hour: '2-digit', minute: '2-digit', hour12: true });
  } catch { return '—'; }
}

/** Fecha ISO (AAAA-MM-DD) de un instante en horario de Caracas. */
function caracasDate(ts?: string | null): string {
  if (!ts) return '';
  try {
    const p: any = new Intl.DateTimeFormat('en-CA', { timeZone: CARACAS_TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(new Date(ts))
      .reduce((a: any, x: any) => { a[x.type] = x.value; return a; }, {});
    return `${p.year}-${p.month}-${p.day}`;
  } catch { return ''; }
}

/** "Lugar" legible: sector geográfico si hay GPS; si no, la referencia libre. */
function lugarOf(lat: number | null, lng: number | null, ref: string | null | undefined): string {
  const sec = lat != null && lng != null ? sectorOf(lat, lng) : null;
  if (sec) return sectorLabel(sec);
  const r = (ref && String(ref).trim()) || '';
  return r || '—';
}

/** Edificio canónico del catálogo a partir de la referencia (o '—'). */
const edificioOf = (ref: string | null | undefined): string => edificioCanonico(ref) || '—';

/** Placa o, en su defecto, serial de la máquina. */
const psTxt = (r: { plate: string | null; serial: string | null }): string => r.plate || r.serial || '—';

type MRow = { code: string; plate: string | null; serial: string | null; lugar: string; edificio: string; inspector: string; hora: string; horas?: number };
type ARow = { code: string; plate: string | null; serial: string | null; lugar: string; edificio: string; hora: string; reporto: string; motivo: string };

/**
 * Genera y exporta el PDF del reporte de estado de máquinas para un día.
 * @param date día ISO "AAAA-MM-DD".
 * @returns true si el usuario confirmó (imprimió/guardó), false si canceló.
 */
export async function generateEstadoReport(opts: { date: string }): Promise<boolean> {
  const { date } = opts;
  const fecha = dmy(date);

  // 1) Perfiles: nombre por id y set de admins (a excluir, como en Inspectores).
  const { data: profs } = await supabase.from('profiles').select('id, full_name, role');
  const nameById: Record<string, string> = {};
  const adminIds = new Set<string>();
  ((profs ?? []) as any[]).forEach((p) => { if (p.full_name) nameById[p.id] = p.full_name; if (p.role === 'admin') adminIds.add(p.id); });

  // 2) Rondas (jornadas) del día.
  const rounds = await selectAllRows(
    'machine_rounds',
    'machinery_id, day_hours, night_hours, jornada_shift, jornada_start_at, recorded_by, machine:machinery_id(code, serial, plate, sector, referencia, latitude, longitude, company:company_id(name))',
    (q) => q.eq('round_date', date),
  );

  // 3) Asignaciones (CHECK) inspector ↔ máquina; visitas del día; averías pendientes.
  const { rows: assignments } = await listInspectorAssignments();
  const visits = await listVisits(date);
  const { data: maint } = await supabase
    .from('maintenance_requests')
    .select('machinery_id, notes, requested_by, created_at, status, material, machine:machinery_id(code, serial, plate, sector, referencia, latitude, longitude, company:company_id(name))')
    .eq('material', 'MÁQUINA PARADA')
    .eq('status', 'pendiente');

  // ── Secciones 1 (iniciadas) y 4 (finalizadas), a partir de las rondas ────────
  const startedIds = new Set<string>();     // máquinas con jornada EN CURSO hoy
  const finalizedIds = new Set<string>();   // máquinas con jornada FINALIZADA hoy
  const iniciadas: MRow[] = [];
  const finalizadasMap = new Map<string, MRow>();

  ((rounds ?? []) as any[]).forEach((r) => {
    const rb = (r.recorded_by ?? null) as string | null;
    if (rb && adminIds.has(rb)) return; // sin jornadas de admin (pruebas)
    const mm = r.machine || {};
    const lat = mm.latitude != null ? Number(mm.latitude) : null;
    const lng = mm.longitude != null ? Number(mm.longitude) : null;
    const dayH = Number(r.day_hours) || 0;
    const nightH = Number(r.night_hours) || 0;
    const base = {
      code: mm.code ?? '—',
      plate: mm.plate ?? null,
      serial: mm.serial ?? null,
      lugar: lugarOf(lat, lng, mm.referencia),
      edificio: edificioOf(mm.referencia),
      inspector: (rb && nameById[rb]) || '—',
    };
    if (r.jornada_start_at) {
      startedIds.add(r.machinery_id);
      iniciadas.push({ ...base, hora: caracasClock(r.jornada_start_at) });
    } else if (dayH > 0 || nightH > 0) {
      finalizedIds.add(r.machinery_id);
      const cur = finalizadasMap.get(r.machinery_id) ?? { ...base, hora: '—', horas: 0 };
      cur.horas = (cur.horas || 0) + dayH + nightH;
      finalizadasMap.set(r.machinery_id, cur);
    }
  });

  // Finalizadas: excluye las que además tengan una jornada EN CURSO hoy.
  const finalizadas: MRow[] = [];
  finalizadasMap.forEach((v, mid) => { if (!startedIds.has(mid)) finalizadas.push(v); });

  // ── Sección 3: averiadas (avería pendiente VIGENTE hasta ese día, o visita 'parada') ──
  // Se calcula ANTES que las pendientes para excluir de "pendientes por iniciar"
  // las máquinas que en realidad están AVERIADAS (si no, saldrían en ambas).
  const averiadasMap = new Map<string, ARow>();
  ((maint ?? []) as any[]).forEach((m) => {
    if (caracasDate(m.created_at) > date) return; // no contar averías reportadas DESPUÉS del día
    const mm = m.machine || {};
    const lat = mm.latitude != null ? Number(mm.latitude) : null;
    const lng = mm.longitude != null ? Number(mm.longitude) : null;
    averiadasMap.set(m.machinery_id, {
      code: mm.code ?? '—',
      plate: mm.plate ?? null,
      serial: mm.serial ?? null,
      lugar: lugarOf(lat, lng, mm.referencia),
      edificio: edificioOf(mm.referencia),
      hora: caracasClock(m.created_at),
      reporto: (m.requested_by && nameById[m.requested_by]) || '—',
      motivo: (m.notes && String(m.notes).trim()) || '—',
    });
  });
  visits.filter((v) => v.status === 'parada').forEach((v) => {
    if (averiadasMap.has(v.machinery_id)) return; // ya listada por avería de mantenimiento
    averiadasMap.set(v.machinery_id, {
      code: v.machineCode ?? '—',
      plate: v.machinePlate ?? null,
      serial: v.machineSerial ?? null,
      lugar: lugarOf(v.machineLat ?? null, v.machineLng ?? null, v.machineRef ?? null),
      edificio: edificioOf(v.machineRef ?? null),
      hora: caracasClock(v.visited_at),
      reporto: v.supervisor_name || '—',
      motivo: (v.note && String(v.note).trim()) || '—',
    });
  });
  const averiadas = [...averiadasMap.values()];

  // ── Sección 2: pendientes por iniciar (asignadas y sin jornada NI avería hoy) ─
  type Asg = { code: string; plate: string | null; serial: string | null; lugar: string; edificio: string; inspectors: { shift: string; name: string }[] };
  const assignedByMachine = new Map<string, Asg>();
  assignments.forEach((a) => {
    const cur = assignedByMachine.get(a.machinery_id) ?? {
      code: a.code,
      plate: a.plate,
      serial: a.serial,
      lugar: lugarOf(a.latitude, a.longitude, a.referencia),
      edificio: edificioOf(a.referencia),
      inspectors: [],
    };
    cur.inspectors.push({ shift: a.shift, name: a.inspector_name });
    assignedByMachine.set(a.machinery_id, cur);
  });
  const pendientes: MRow[] = [];
  assignedByMachine.forEach((v, mid) => {
    // Excluye iniciadas/finalizadas hoy Y las AVERIADAS (parada vigente): esas van
    // en su propia sección, no como "pendiente por iniciar".
    if (startedIds.has(mid) || finalizedIds.has(mid) || averiadasMap.has(mid)) return;
    const insp = v.inspectors.map((i) => `${i.shift === 'night' ? '🌙' : '☀️'} ${i.name}`).join(' · ');
    pendientes.push({ code: v.code, plate: v.plate, serial: v.serial, lugar: v.lugar, edificio: v.edificio, inspector: insp || '—', hora: '—' });
  });

  // ── HTML ────────────────────────────────────────────────────────────────────
  const tableBasic = (list: MRow[]): string => {
    const rows = list.slice().sort((a, b) => cmpText(a.code, b.code)).map((m, i) =>
      `<tr><td>${i + 1}</td><td><b>${esc(m.code)}</b></td><td>${esc(psTxt(m))}</td><td>${esc(m.lugar)}</td><td>${esc(m.edificio)}</td><td>${esc(fecha)}</td><td class="coord">${esc(m.hora)}</td><td>${esc(m.inspector)}</td></tr>`).join('');
    return `<table class="ir"><thead><tr><th style="width:26px">Nº</th><th>Máquina</th><th>Placa/Serial</th><th>Lugar</th><th>Edificio</th><th>Fecha</th><th>Hora inicio</th><th>Inspector</th></tr></thead><tbody>${rows}</tbody></table>`;
  };

  const tableFinal = (list: MRow[]): string => {
    const rows = list.slice().sort((a, b) => cmpText(a.code, b.code)).map((m, i) =>
      `<tr><td>${i + 1}</td><td><b>${esc(m.code)}</b></td><td>${esc(psTxt(m))}</td><td>${esc(m.lugar)}</td><td>${esc(m.edificio)}</td><td>${esc(fecha)}</td><td>${esc(m.inspector)}</td><td class="r b">${r2(m.horas || 0)}</td></tr>`).join('');
    return `<table class="ir"><thead><tr><th style="width:26px">Nº</th><th>Máquina</th><th>Placa/Serial</th><th>Lugar</th><th>Edificio</th><th>Fecha</th><th>Inspector</th><th class="r">Horas</th></tr></thead><tbody>${rows}</tbody></table>`;
  };

  const tableAver = (list: ARow[]): string => {
    const rows = list.slice().sort((a, b) => cmpText(a.code, b.code)).map((m, i) =>
      `<tr><td>${i + 1}</td><td><b>${esc(m.code)}</b></td><td>${esc(psTxt(m))}</td><td>${esc(m.lugar)}</td><td>${esc(m.edificio)}</td><td>${esc(fecha)}</td><td class="coord">${esc(m.hora)}</td><td>${esc(m.reporto)}</td><td>${esc(m.motivo)}</td></tr>`).join('');
    return `<table class="ir"><thead><tr><th style="width:26px">Nº</th><th>Máquina</th><th>Placa/Serial</th><th>Lugar</th><th>Edificio</th><th>Fecha</th><th>Hora</th><th>Reportó</th><th>Motivo</th></tr></thead><tbody>${rows}</tbody></table>`;
  };

  const section = (icon: string, title: string, count: number, table: string): string =>
    `<h2 class="turno">${icon} ${title} <span class="tcnt">${count} equipo(s)</span></h2>${count ? table : '<p class="none">Sin registros para este día.</p>'}`;

  const body = [
    section('🟢', 'Máquinas iniciadas (jornada en curso)', iniciadas.length, tableBasic(iniciadas)),
    section('🕓', 'Máquinas pendientes por iniciar jornada', pendientes.length, tableBasic(pendientes)),
    section('🔴', 'Máquinas averiadas', averiadas.length, tableAver(averiadas)),
    section('✅', 'Máquinas con jornada finalizada', finalizadas.length, tableFinal(finalizadas)),
  ].join('');

  const extraCss = `
    h2.turno{font-size:15px;color:#1E3A5F;margin:20px 0 6px;padding-bottom:6px;border-bottom:2px solid #1E3A5F}
    h2.turno .tcnt{font-size:11px;color:#6B7280;font-weight:600}
    table.ir{width:100%;border-collapse:collapse;margin:4px 0 10px;font-size:11.5px}
    table.ir th,table.ir td{border:1px solid #ccc;padding:5px 7px;text-align:left;vertical-align:top}
    table.ir th{background:#1E3A5F;color:#fff}
    table.ir td.r,table.ir th.r{text-align:right}
    table.ir td.b{font-weight:800}
    table.ir td.coord{white-space:nowrap;font-size:10.5px;color:#374151}
    .none{color:#6B7280;font-size:12px}
  `;

  const subtitle = `Estado de máquinas · ${fecha} · 🟢 ${iniciadas.length} en curso · 🕓 ${pendientes.length} pendientes · 🔴 ${averiadas.length} averiadas · ✅ ${finalizadas.length} finalizadas`;

  const html = pdfDocument({
    title: 'REPORTE DE ESTADO DE MÁQUINAS',
    subtitle,
    body,
    extraCss,
  });
  return await exportPdf(html, `Reporte - Estado maquinas ${fecha}`);
}
