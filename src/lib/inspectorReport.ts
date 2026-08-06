import { supabase, selectAllRows } from './supabase';
import { pdfDocument, exportPdf } from './pdf';
import { cmpText } from './text';
import { sectorOf, sectorLabel } from './mapZones';
import { listVisits } from './supervisorVisits';
import { edificioCanonico } from './edificios';
import { listInspectorAssignments } from './machineInspectors';

/**
 * Reporte de INSPECTORES (jornadas de inspección) en PDF.
 *
 * Reglas del cliente:
 * - Agrupado POR INSPECTOR. Cada jornada de inspección la registra un inspector
 *   (`machine_rounds.recorded_by`) y pertenece a un TURNO (`jornada_shift`):
 *   ☀️ Día o 🌙 Noche. La jornada de DÍA es de un inspector y la de NOCHE de otro.
 * - El filtro permite ver solo Día, solo Noche o AMBOS (juntos, con secciones
 *   separadas por turno → inspector).
 * - Por inspector: TODAS sus máquinas ASIGNADAS (machine_inspectors), cada una con
 *   su ESTADO (● en curso · 🟡 parada · ⏳ por iniciar · ✅ finalizada), horas de día,
 *   de noche y TOTAL; y un desglose por SECTOR con subtotales. El estado se resuelve
 *   por máquina (ronda del día + parada vigente), no solo por jornada registrada.
 * - Por cada máquina se muestra además su UBICACIÓN (coordenadas legibles),
 *   REFERENCIA (texto libre del catálogo) y EDIFICIO (nombre canónico del catálogo).
 * - Si una máquina CAMBIÓ de ubicación durante la jornada (más de un check-in en
 *   `supervisor_visits` con ubicación distinta), se listan TODAS las ubicaciones.
 * - Al pie de la sección de CADA inspector va su nombre completo + línea de FIRMA
 *   con el rótulo "Inspector" (en "Ambos" cada turno/inspector con su firma).
 * - Se filtra a los usuarios ADMIN (mismo criterio que la Supervisión).
 */
export type InspectorShift = 'day' | 'night' | 'both';

const esc = (v: any) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const dmy = (iso: string) => { const [y, m, d] = (iso || '').split('-'); return y && m && d ? `${d}/${m}/${y}` : iso; };
const r2 = (n: number) => Math.round(n * 100) / 100;
// Hora Caracas (UTC-4) del ISO y turno de la PARADA según esa hora (día 7-19, noche resto).
// Mismo criterio que la app: la parada pertenece al TURNO en que se marcó.
const caracasHour = (iso: string): number => { const d = new Date(iso); let h = d.getUTCHours() - 4; if (h < 0) h += 24; return h; };
const paradaShiftOf = (iso: string): 'day' | 'night' => { const h = caracasHour(iso); return h >= 7 && h < 19 ? 'day' : 'night'; };
const CARACAS_TZ = 'America/Caracas';
// Fecha+hora (Caracas) legible de un check-in, para la tabla de cambio de ubicación.
const dmyHm = (iso: string): string => {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    const fecha = d.toLocaleDateString('es-VE', { timeZone: CARACAS_TZ, day: '2-digit', month: '2-digit' });
    const hora = d.toLocaleTimeString('es-VE', { timeZone: CARACAS_TZ, hour: '2-digit', minute: '2-digit', hour12: true });
    return `${fecha} ${hora}`;
  } catch { return '—'; }
};

type Turno = 'day' | 'night';
type EstadoKey = 'encurso' | 'parada' | 'finalizada' | 'pendiente';
type Mach = { id: string; code: string; serial: string | null; plate: string | null; company: string; sector: string; referencia: string; edificio: string; lat: number | null; lng: number | null; dayH: number; nightH: number; estado: EstadoKey; motivo: string };
const ESTADO_META: Record<EstadoKey, { txt: string; color: string }> = {
  encurso: { txt: '● En curso', color: '#B45309' },
  parada: { txt: '🟡 Parada', color: '#B45309' },
  finalizada: { txt: '✅ Finalizada', color: '#166534' },
  pendiente: { txt: '⏳ Por iniciar', color: '#6B7280' },
};
type LocInfo = { key: string; label: string; at: string; lat: number | null; lng: number | null };
type InspectorData = {
  data: Map<Turno, Map<string, Map<string, Mach>>>;
  machineLocs: (id: string) => LocInfo[];
  machCoords: (m: Mach) => { lat: number | null; lng: number | null };
  coordTxt: (lat: number | null, lng: number | null) => string;
};

/** Etiqueta legible + clave para deduplicar una ubicación (GPS del check-in + edificio/referencia). */
function locLabel(lat: number | null, lng: number | null, ref: string | null): { key: string; label: string } {
  const cleanRef = (ref && String(ref).trim()) || '';
  // Ignora referencias que son SOLO números (p. ej. "46564.0"): no aportan lugar.
  const meaningfulRef = cleanRef && !/^[\d.,\s\/-]+$/.test(cleanRef) ? cleanRef : '';
  const sec = lat != null && lng != null ? sectorOf(lat, lng) : null;
  const secTxt = sec ? sectorLabel(sec) : '';
  const parts: string[] = [];
  if (meaningfulRef) parts.push(meaningfulRef);
  if (secTxt) parts.push(secTxt);
  if (lat != null && lng != null) parts.push(`${lat.toFixed(5)}, ${lng.toFixed(5)}`);
  const label = parts.length ? parts.join(' · ') : 'Sin ubicación';
  // Clave: coordenadas redondeadas (≈11 m) o, si no hay GPS, el edificio/referencia.
  const key = lat != null && lng != null ? `${lat.toFixed(4)},${lng.toFixed(4)}` : (meaningfulRef.toLowerCase() || 'sin');
  return { key, label };
}

/**
 * Reúne y agrega los datos del reporte de inspectores (turno → inspector → máquina)
 * para un día, SIN filtrar por turno ni por inspector — eso lo hace quien consuma el
 * resultado (el PDF o el selector de inspectores de la pantalla). Es la única fuente
 * de verdad: así el selector de checkboxes de la pantalla siempre muestra EXACTAMENTE
 * los inspectores que después saldrán en el PDF.
 * @param date día ISO "AAAA-MM-DD"
 * @param companies (opcional) filtra por nombre de empresa (vacío/null = todas)
 */
async function computeInspectorData(date: string, companies?: string[] | null): Promise<InspectorData> {
  const cos = companies && companies.length ? companies : null;

  // 1) Perfiles: nombre por id y set de admins (a excluir, como en Supervisión).
  const { data: profs } = await supabase.from('profiles').select('id, full_name, role');
  const nameById: Record<string, string> = {};
  const adminIds = new Set<string>();
  ((profs ?? []) as any[]).forEach((p) => { if (p.full_name) nameById[p.id] = p.full_name; if (p.role === 'admin') adminIds.add(p.id); });

  // 2) Jornadas de inspección del día (machine_rounds con recorded_by = inspector).
  const rounds = await selectAllRows(
    'machine_rounds',
    'machinery_id, day_hours, night_hours, jornada_shift, recorded_by, jornada_start_at, machine:machinery_id(code, serial, plate, sector, parroquia, referencia, latitude, longitude, company:company_id(name))',
    (q) => q.eq('round_date', date)
  );

  // 3) Asignaciones (CHECK): columna vertebral — TODAS las máquinas de cada
  //    inspector, por turno. Y paradas VIGENTES (pendientes hasta ese día) para el
  //    estado (igual criterio que la app: por máquina, sin filtrar por fecha de marca).
  const { rows: assignments } = await listInspectorAssignments();
  const { data: maint } = await supabase
    .from('maintenance_requests')
    .select('machinery_id, notes, created_at')
    .eq('material', 'MÁQUINA PARADA')
    .eq('status', 'pendiente')
    .lte('created_at', `${date}T23:59:59.999-04:00`)
    .order('created_at', { ascending: false });
  // Parada POR TURNO: machine → turno → motivo. Así la parada del inspector de DÍA no
  // afecta al de NOCHE (misma máquina, 2 inspectores) ni tapa la jornada del otro turno.
  // Parada de HOY por turno (respeta el turno). ARRASTRADA (marcada antes del día del
  // reporte) aplica a TODA la máquina (ambos turnos), PERO solo si NO trabaja hoy:
  // si iniciaron jornada la máquina se reactivó y está EN CURSO (la vieja pierde).
  const paradaHoyByShift = new Map<string, Map<Turno, string>>();
  const paradaArr = new Map<string, string>();
  const dayStartMs = new Date(`${date}T00:00:00-04:00`).getTime();
  ((maint ?? []) as any[]).forEach((m) => {
    const id = m.machinery_id as string;
    const motivo = String(m.notes ?? '').trim();
    if (new Date(m.created_at).getTime() < dayStartMs) {
      if (!paradaArr.has(id)) paradaArr.set(id, motivo);
    } else {
      const sh = paradaShiftOf(m.created_at);
      const mm = paradaHoyByShift.get(id) ?? new Map<Turno, string>();
      if (!mm.has(sh)) mm.set(sh, motivo);
      paradaHoyByShift.set(id, mm);
    }
  });

  // 4) Ubicaciones por máquina (todos los check-in del día, ubicaciones distintas).
  const visits = await listVisits(date);
  const locByMachine = new Map<string, LocInfo[]>();
  visits.forEach((v) => {
    const lat = (v.lat ?? v.machineLat ?? null) as number | null;
    const lng = (v.lng ?? v.machineLng ?? null) as number | null;
    const { key, label } = locLabel(lat, lng, v.machineRef ?? null);
    const arr = locByMachine.get(v.machinery_id) ?? [];
    if (!arr.some((x) => x.key === key)) arr.push({ key, label, at: v.visited_at, lat, lng });
    locByMachine.set(v.machinery_id, arr);
  });
  const machineLocs = (id: string): LocInfo[] =>
    (locByMachine.get(id) ?? []).slice().sort((a, b) => String(a.at).localeCompare(String(b.at)));

  // Coordenadas de la máquina: primero las del catálogo; si no, el último check-in con GPS.
  const machCoords = (m: Mach): { lat: number | null; lng: number | null } => {
    if (m.lat != null && m.lng != null) return { lat: m.lat, lng: m.lng };
    const withGps = machineLocs(m.id).filter((l) => l.lat != null && l.lng != null);
    const last = withGps[withGps.length - 1];
    return last ? { lat: last.lat, lng: last.lng } : { lat: null, lng: null };
  };
  const coordTxt = (lat: number | null, lng: number | null): string =>
    lat != null && lng != null ? `${lat.toFixed(5)}, ${lng.toFixed(5)}` : '—';

  // 5) Agregación: turno → inspector → máquina. La columna vertebral son las
  //    ASIGNACIONES (todas las máquinas del inspector), y el ESTADO/horas se resuelve
  //    por máquina desde la ronda del día (una por máquina) y la parada vigente. Así
  //    salen TODAS las máquinas del inspector (en curso · parada · por iniciar ·
  //    finalizada), no solo las que tienen jornada registrada.
  const roundByMachine = new Map<string, any>();
  ((rounds ?? []) as any[]).forEach((r) => { if (!roundByMachine.has(r.machinery_id)) roundByMachine.set(r.machinery_id, r); });

  const data = new Map<Turno, Map<string, Map<string, Mach>>>();
  const putMach = (turno: Turno, insp: string, id: string, base: { code: string; serial: string | null; plate: string | null; company: string; sector: string; referencia: string; lat: number | null; lng: number | null }) => {
    if (cos && !cos.includes(base.company)) return;
    const tMap = data.get(turno) ?? new Map<string, Map<string, Mach>>();
    data.set(turno, tMap);
    const iMap = tMap.get(insp) ?? new Map<string, Mach>();
    tMap.set(insp, iMap);
    if (iMap.has(id)) return; // una fila por máquina/inspector
    const rd = roundByMachine.get(id);
    const dayH = Number(rd?.day_hours) || 0;
    const nightH = Number(rd?.night_hours) || 0;
    // Estado RELATIVO al turno del inspector: un inspector de noche no está "en curso"
    // porque haya una jornada de DÍA abierta en su máquina (esa es del inspector de día).
    const hoursForShift = turno === 'night' ? nightH : dayH;
    const openForShift = !!rd?.jornada_start_at && rd?.jornada_shift === turno;
    // Parada de HOY del mismo turno gana; una ARRASTRADA solo aplica si NO trabaja hoy
    // (si iniciaron jornada, la máquina se reactivó → en curso, no parada vieja).
    const parHoy = paradaHoyByShift.get(id)?.get(turno);
    const parMot = parHoy != null ? parHoy : (!openForShift ? paradaArr.get(id) : undefined);
    const parada = parMot != null;
    const estado: EstadoKey = parada ? 'parada' : openForShift ? 'encurso' : hoursForShift > 0 ? 'finalizada' : 'pendiente';
    iMap.set(id, {
      id,
      code: base.code,
      serial: base.serial,
      plate: base.plate,
      company: base.company,
      sector: base.sector || 'Sin sector',
      referencia: base.referencia,
      edificio: edificioCanonico(base.referencia) || '',
      lat: base.lat,
      lng: base.lng,
      dayH,
      nightH,
      estado,
      motivo: parada ? (parMot || '') : '',
    });
  };

  // a) TODAS las máquinas ASIGNADAS, cada una bajo su turno (día/noche).
  assignments.forEach((a) => {
    putMach(a.shift as Turno, a.inspector_name || '—', a.machinery_id, {
      code: a.code,
      serial: a.serial ?? null,
      plate: a.plate ?? null,
      company: a.companyName,
      sector: (a.sector && String(a.sector).trim()) || 'Sin sector',
      referencia: (a.referencia && String(a.referencia).trim()) || '',
      lat: a.latitude != null ? Number(a.latitude) : null,
      lng: a.longitude != null ? Number(a.longitude) : null,
    });
  });
  // b) Máquinas con ronda iniciada por un inspector real aunque NO le estén
  //    asignadas (escaneo suelto / reasignación) → bajo quien la registró.
  ((rounds ?? []) as any[]).forEach((r) => {
    const rb = (r.recorded_by ?? null) as string | null;
    if (!rb || adminIds.has(rb)) return;
    const dayH = Number(r.day_hours) || 0;
    const nightH = Number(r.night_hours) || 0;
    if (!(r.jornada_start_at || dayH > 0 || nightH > 0)) return;
    const turno: Turno = r.jornada_shift === 'night' ? 'night'
      : r.jornada_shift === 'day' ? 'day'
      : (nightH > 0 && dayH === 0 ? 'night' : 'day');
    const mm = r.machine || {};
    putMach(turno, nameById[rb] || '—', r.machinery_id, {
      code: mm.code ?? '—',
      serial: mm.serial ?? null,
      plate: mm.plate ?? null,
      company: mm.company?.name ?? 'Sin empresa',
      sector: (mm.sector && String(mm.sector).trim()) || 'Sin sector',
      referencia: (mm.referencia && String(mm.referencia).trim()) || '',
      lat: mm.latitude != null ? Number(mm.latitude) : null,
      lng: mm.longitude != null ? Number(mm.longitude) : null,
    });
  });

  return { data, machineLocs, machCoords, coordTxt };
}

/**
 * Nombres de inspectores disponibles para un día, separados por turno (día/noche),
 * calculados con la MISMA agregación que el PDF (`computeInspectorData`). Sirve para
 * poblar el selector dinámico de checkboxes de la pantalla de Reportes: al elegir el
 * turno, se listan solo los inspectores que realmente tienen algo que reportar ese día.
 * @param date día ISO "AAAA-MM-DD"
 * @param companies (opcional) filtra por nombre de empresa (vacío/null = todas)
 */
export async function listInspectorNames(date: string, companies?: string[] | null): Promise<{ day: string[]; night: string[] }> {
  const { data } = await computeInspectorData(date, companies);
  const day = [...(data.get('day')?.keys() ?? [])].sort(cmpText);
  const night = [...(data.get('night')?.keys() ?? [])].sort(cmpText);
  return { day, night };
}

/**
 * Genera y exporta el PDF del reporte de inspectores para un día y un turno.
 * @param date  día ISO "AAAA-MM-DD"
 * @param shift 'day' | 'night' | 'both'
 * @param companies (opcional) filtra por nombre de empresa (vacío/null = todas)
 * @param inspectors (opcional) nombres de inspectores marcados en la pantalla
 *   (vacío/null = todos los del turno, igual que "companies")
 * @returns true si el usuario confirmó (imprimió/guardó), false si canceló.
 */
export async function generateInspectorReport(opts: { date: string; shift: InspectorShift; companies?: string[] | null; inspectors?: string[] | null }): Promise<boolean> {
  const { date, shift } = opts;
  const inspFilter = opts.inspectors && opts.inspectors.length ? new Set(opts.inspectors) : null;
  const { data, machineLocs } = await computeInspectorData(date, opts.companies);

  // ── HTML ──────────────────────────────────────────────────────────────────
  const turnoMeta: Record<Turno, { icon: string; label: string }> = {
    day: { icon: '☀️', label: 'Jornada de día' },
    night: { icon: '🌙', label: 'Jornada de noche' },
  };

  const estRank = (e: EstadoKey) => (e === 'encurso' ? 0 : e === 'parada' ? 1 : e === 'pendiente' ? 2 : 3);
  const renderInspector = (turno: Turno, insp: string, machMap: Map<string, Mach>): string => {
    const list = [...machMap.values()].sort((a, b) => estRank(a.estado) - estRank(b.estado) || cmpText(a.code, b.code));
    let tD = 0, tN = 0;
    const rows = list.map((m, i) => {
      const tot = r2(m.dayH + m.nightH);
      tD += m.dayH; tN += m.nightH;
      const moved = machineLocs(m.id).length > 1;
      const em = ESTADO_META[m.estado];
      const estCell = `<span style="color:${em.color};font-weight:700;white-space:nowrap">${esc(em.txt)}</span>${m.estado === 'parada' && m.motivo ? `<div style="color:#B45309;font-size:10px">${esc(m.motivo)}</div>` : ''}`;
      return `<tr><td>${i + 1}</td><td><b>${esc(m.code)}</b>${moved ? ' <span class="moved">↔ cambió de ubicación</span>' : ''}</td><td>${estCell}</td><td>${esc(m.company)}</td><td>${esc(m.sector)}</td><td>${esc(m.referencia || '—')}</td><td>${esc(m.edificio || '—')}</td><td>${esc(m.plate || m.serial || '—')}</td><td class="r">${r2(m.dayH)}</td><td class="r">${r2(m.nightH)}</td><td class="r b">${tot}</td></tr>`;
    }).join('');
    const machTable = `<table class="ir"><thead><tr><th style="width:26px">Nº</th><th>Máquina</th><th>Estado</th><th>Empresa</th><th>Sector</th><th>Referencia</th><th>Edificio</th><th>Placa / Serial</th><th class="r">H. Día</th><th class="r">H. Noche</th><th class="r">Total</th></tr></thead><tbody>${rows}</tbody><tfoot><tr><td colspan="8">Total · ${list.length} equipo(s)</td><td class="r">${r2(tD)}</td><td class="r">${r2(tN)}</td><td class="r b">${r2(tD + tN)}</td></tr></tfoot></table>`;

    // Desglose por SECTOR con subtotales.
    const bySec = new Map<string, { c: number; d: number; n: number }>();
    list.forEach((m) => { const s = bySec.get(m.sector) ?? { c: 0, d: 0, n: 0 }; s.c += 1; s.d += m.dayH; s.n += m.nightH; bySec.set(m.sector, s); });
    const secRows = [...bySec.entries()].sort((a, b) => cmpText(a[0], b[0]))
      .map(([s, v]) => `<tr><td>${esc(s)}</td><td class="r">${v.c}</td><td class="r">${r2(v.d)}</td><td class="r">${r2(v.n)}</td><td class="r b">${r2(v.d + v.n)}</td></tr>`).join('');
    const secTable = `<div class="sub">📍 Desglose por sector</div><table class="ir"><thead><tr><th>Sector</th><th class="r">Equipos</th><th class="r">H. Día</th><th class="r">H. Noche</th><th class="r">Total</th></tr></thead><tbody>${secRows}</tbody></table>`;

    // Ubicaciones múltiples: solo máquinas que cambiaron de sitio en la jornada.
    // Una fila por CADA transición consecutiva (origen → destino), con sector,
    // referencia y coordenadas de cada punto (ya incluidos en `label`) y la
    // fecha/hora (Caracas) en que se registró la ubicación nueva.
    const moved = list.filter((m) => machineLocs(m.id).length > 1);
    const locRows = moved.flatMap((m) => {
      const locs = machineLocs(m.id);
      const trs: string[] = [];
      for (let i = 0; i < locs.length - 1; i++) {
        const prev = locs[i];
        const next = locs[i + 1];
        trs.push(`<tr><td><b>${esc(m.code)}</b></td><td>${esc(prev.label)}</td><td>${esc(next.label)}</td><td class="coord">${esc(dmyHm(next.at))}</td></tr>`);
      }
      return trs;
    });
    const locHtml = locRows.length
      ? `<div class="sub">🗺️ Máquinas que cambiaron de ubicación</div><table class="ir loc-table"><thead><tr><th>Máquina / Equipo</th><th>Ubicación anterior</th><th>Ubicación nueva</th><th>Hora / Fecha</th></tr></thead><tbody>${locRows.join('')}</tbody></table>`
      : '';

    // Total de horas del TURNO de esta sección (junto a la firma). Para el inspector
    // de día muestra el total de horas de día; para el de noche, las de noche.
    const totLabel = turno === 'day' ? 'día' : 'noche';
    const totTurno = turno === 'day' ? tD : tN;
    const totHoras = `<div class="tot-horas">🕒 Total de horas de ${totLabel}: <b>${r2(totTurno)} h</b> · General (día + noche): <b>${r2(tD + tN)} h</b></div>`;

    // Firma del inspector de ESTA sección (nombre completo + línea + rótulo).
    const firmaInsp = `<div class="firma-insp"><div class="line"></div><div class="fname">${esc(insp)}</div><div class="frole">Inspector</div></div>`;

    // Resumen de estados del inspector (todas sus máquinas a ese nivel).
    const cEn = list.filter((m) => m.estado === 'encurso').length;
    const cPar = list.filter((m) => m.estado === 'parada').length;
    const cPen = list.filter((m) => m.estado === 'pendiente').length;
    const cFin = list.filter((m) => m.estado === 'finalizada').length;
    const resumen = [
      cEn ? `<span style="color:#B45309">● ${cEn} en curso</span>` : '',
      cPar ? `<span style="color:#B45309">🟡 ${cPar} parada(s)</span>` : '',
      cPen ? `<span style="color:#6B7280">⏳ ${cPen} por iniciar</span>` : '',
      cFin ? `<span style="color:#166534">✅ ${cFin} finalizada(s)</span>` : '',
    ].filter(Boolean).join(' · ');

    return `<div class="insp">👷 Inspector: <b>${esc(insp)}</b> <span class="cnt">${list.length} equipo(s)</span>${resumen ? `<div class="estres">${resumen}</div>` : ''}</div>${machTable}${secTable}${locHtml}${totHoras}${firmaInsp}`;
  };

  const renderTurno = (turno: Turno): string => {
    const tMap = data.get(turno);
    const meta = turnoMeta[turno];
    if (!tMap || !tMap.size) {
      // Solo se muestra el encabezado vacío cuando el usuario pidió ese turno explícito o "ambos".
      return `<h2 class="turno">${meta.icon} ${meta.label}</h2><p class="none">Sin jornadas de inspección en este turno.</p>`;
    }
    const inspNames = [...tMap.keys()].filter((n) => !inspFilter || inspFilter.has(n)).sort(cmpText);
    if (!inspNames.length) {
      return `<h2 class="turno">${meta.icon} ${meta.label}</h2><p class="none">Sin inspectores seleccionados en este turno.</p>`;
    }
    return `<h2 class="turno">${meta.icon} ${meta.label} <span class="tcnt">${inspNames.length} inspector(es)</span></h2>${inspNames.map((n) => renderInspector(turno, n, tMap.get(n)!)).join('')}`;
  };

  const turnos: Turno[] = shift === 'day' ? ['day'] : shift === 'night' ? ['night'] : ['day', 'night'];
  const hasAny = turnos.some((t) => {
    const tMap = data.get(t);
    if (!tMap || !tMap.size) return false;
    return [...tMap.keys()].some((n) => !inspFilter || inspFilter.has(n));
  });

  // Nota: la firma va al pie de la sección de CADA inspector (ver renderInspector),
  // por lo que en "Ambos" cada turno/inspector queda con su propia línea de firma.

  const shiftTxt = shift === 'day' ? 'Turno día ☀️' : shift === 'night' ? 'Turno noche 🌙' : 'Ambos turnos ☀️ 🌙';
  const body = hasAny
    ? turnos.map(renderTurno).join('')
    : `<p class="none">Sin jornadas de inspección para el día ${dmy(date)}${shift === 'both' ? '' : ` (${shift === 'day' ? 'turno día' : 'turno noche'})`}.</p>`;

  const extraCss = `
    h2.turno{font-size:15px;color:#1E3A5F;margin:20px 0 6px;padding-bottom:6px;border-bottom:2px solid #1E3A5F}
    h2.turno .tcnt{font-size:11px;color:#6B7280;font-weight:600}
    .insp{margin:14px 0 4px;font-size:12.5px;color:#111;border-left:4px solid #1E3A5F;padding-left:8px}
    .insp .cnt{background:#EEF2F7;color:#1E3A5F;border-radius:10px;padding:1px 8px;font-size:11px;font-weight:700;margin-left:6px}
    .insp .estres{margin-top:3px;font-size:10.5px;font-weight:700}
    .sub{margin:12px 0 2px;font-size:12px;font-weight:700;color:#374151}
    table.ir{width:100%;border-collapse:collapse;margin:4px 0 10px;font-size:11.5px}
    table.ir th,table.ir td{border:1px solid #ccc;padding:5px 7px;text-align:left;vertical-align:top}
    table.ir th{background:#1E3A5F;color:#fff}
    table.ir td.r,table.ir th.r{text-align:right}
    table.ir td.b{font-weight:800}
    table.ir td.coord{white-space:nowrap;font-size:10.5px;color:#374151}
    table.ir tfoot td{background:#EEF2F7;font-weight:800}
    .moved{color:#B45309;font-size:10px;font-weight:700}
    table.loc-table{font-size:11px}
    table.loc-table th{background:#B45309}
    table.loc-table td{page-break-inside:avoid}
    table.loc-table tr{page-break-inside:avoid;page-break-after:auto}
    .none{color:#6B7280;font-size:12px}
    .tot-horas{margin:12px 0 2px;font-size:12.5px;color:#1E3A5F;font-weight:700;background:#EEF2F7;border-radius:6px;padding:6px 10px;display:inline-block}
    .firma-insp{width:260px;margin:20px 0 8px;page-break-inside:avoid}
    .firma-insp .line{border-top:1px solid #333;margin-bottom:4px}
    .firma-insp .fname{font-size:12px;font-weight:700;color:#111}
    .firma-insp .frole{font-size:10px;color:#6B7280}
  `;

  const html = pdfDocument({
    title: 'REPORTE DE INSPECTORES',
    subtitle: `Jornadas de inspección · ${dmy(date)} · ${shiftTxt}`,
    body,
    extraCss,
  });
  return await exportPdf(html, `Reporte - Inspectores ${dmy(date)}`);
}
