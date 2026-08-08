import { supabase, selectAllRows } from './supabase';
import { pdfDocument, exportPdf, nowStamp } from './pdf';
import { cmpText } from './text';
import { sectorOf, sectorLabel } from './mapZones';
import { listVisits } from './supervisorVisits';
import { edificioLabel } from './edificios';
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
/** Día ISO (AAAA-MM-DD) + n días (n puede ser negativo). */
const addDaysISO = (iso: string, n: number): string => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
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
type EstadoKey = 'averia' | 'encurso' | 'parada' | 'finalizada' | 'pendiente';
type Mach = { id: string; code: string; serial: string | null; plate: string | null; company: string; sector: string; referencia: string; edificio: string; lat: number | null; lng: number | null; dayH: number; nightH: number; estado: EstadoKey; motivo: string; horasParada: number };
/** Hora (Caracas) "HH:MM am/pm" de un instante (ms). */
const horaCaracasMs = (ms: number): string => {
  try { return new Intl.DateTimeFormat('es-VE', { timeZone: CARACAS_TZ, hour: '2-digit', minute: '2-digit', hour12: true }).format(new Date(ms)); } catch { return '—'; }
};
const horasDuracion = (min: number): string => (min >= 60 ? `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}` : `${min}min`);
type EventoParada = { motivo: string; start: number; end: number | null };
const ESTADO_META: Record<EstadoKey, { txt: string; color: string }> = {
  averia: { txt: '🔴 Averiada', color: '#B91C1C' },
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
export async function computeInspectorData(date: string, companies?: string[] | null): Promise<InspectorData> {
  const cos = companies && companies.length ? companies : null;

  // INACTIVAS del catálogo (NO OPERATIVA `operational=false`, botón "⛔ Inactiva", o
  // desactivada `active=false`): NUNCA entran a este reporte de inspectores — igual que
  // las tarjetas en vivo (`machHardInactiveSet` de InspectionsSummary) y el teléfono
  // (`visibleParaInspector`). Solo salen en el reporte por empresa y en Control. Así el
  // PDF firmado y la pantalla muestran EXACTAMENTE las mismas máquinas.
  const { data: inactRows } = await supabase.from('machinery').select('id').or('operational.eq.false,active.eq.false');
  const inactiveIds = new Set(((inactRows ?? []) as any[]).map((m) => m.id as string));

  // 1) Perfiles: nombre por id y set de admins (a excluir, como en Supervisión).
  const { data: profs } = await supabase.from('profiles').select('id, full_name, role');
  const nameById: Record<string, string> = {};
  const adminIds = new Set<string>();
  ((profs ?? []) as any[]).forEach((p) => { if (p.full_name) nameById[p.id] = p.full_name; if (p.role === 'admin') adminIds.add(p.id); });

  // 2) Jornadas de inspección del día (machine_rounds con recorded_by = inspector).
  const nextDate = addDaysISO(date, 1);
  const rounds = await selectAllRows(
    'machine_rounds',
    'machinery_id, day_hours, night_hours, jornada_shift, recorded_by, jornada_start_at, machine:machinery_id(code, serial, plate, sector, parroquia, referencia, latitude, longitude, company:company_id(name))',
    (q) => q.eq('round_date', date)
  );
  // Jornada de NOCHE que arrancó ANOCHE y sigue abierta: su `round_date` es el de
  // AYER (el día en que inició), no el de hoy — sin este fallback, generar el reporte
  // de "hoy" bien temprano (antes del auto-cierre de las 7am) no encontraba la ronda
  // y la máquina salía "⏳ por iniciar" en vez de "● en curso". Mismo criterio que ya
  // usa SupervisorScreen.tsx para el círculo 🟢 del teléfono.
  const roundsNocheAyer = await selectAllRows(
    'machine_rounds',
    'machinery_id, day_hours, night_hours, jornada_shift, recorded_by, jornada_start_at, machine:machinery_id(code, serial, plate, sector, parroquia, referencia, latitude, longitude, company:company_id(name))',
    (q) => q.eq('round_date', addDaysISO(date, -1)).eq('jornada_shift', 'night').not('jornada_start_at', 'is', null),
  );

  // 3) Asignaciones (CHECK): columna vertebral — TODAS las máquinas de cada
  //    inspector, por turno. Y paradas VIGENTES (pendientes hasta ese día) para el
  //    estado (igual criterio que la app: por máquina, sin filtrar por fecha de marca).
  //    Se trae también `status`/`resolved_at` (además de las pendientes, las que se
  //    RESOLVIERON justo este día) para poder armar la línea de tiempo con la hora de
  //    reactivación — igual patrón que porEmpresaReport.ts.
  const { rows: assignments } = await listInspectorAssignments();
  // La ventana llega hasta las 07:00 del día SIGUIENTE (no medianoche): el turno
  // noche va de 19:00 a 07:00+1, así que una avería/parada marcada a la 1am, o
  // resuelta esa misma madrugada, cae dentro del turno noche de HOY pero antes se
  // quedaba fuera del rango y el reporte no la mostraba en absoluto.
  const nightEndBound = `${nextDate}T07:00:00-04:00`;
  const resolvedHoyFilter = `status.eq.pendiente,and(resolved_at.gte.${date}T00:00:00-04:00,resolved_at.lte.${nightEndBound})`;
  const { data: maint } = await supabase
    .from('maintenance_requests')
    .select('machinery_id, notes, created_at, status, resolved_at')
    .eq('material', 'MÁQUINA PARADA')
    .lte('created_at', nightEndBound)
    .or(resolvedHoyFilter)
    .order('created_at', { ascending: false });
  // Averías REALES pendientes (material != MÁQUINA PARADA): la máquina queda AVERIADA.
  // Igual que teléfono/admin: la de HOY gana sobre trabajando; la ARRASTRADA pierde si
  // la máquina inició jornada. Se separan por fecha de marca respecto al día del reporte.
  const { data: maintAver } = await supabase
    .from('maintenance_requests')
    .select('machinery_id, notes, material, created_at, status, resolved_at')
    .neq('material', 'MÁQUINA PARADA')
    .lte('created_at', nightEndBound)
    .or(resolvedHoyFilter)
    .order('created_at', { ascending: false });
  // 3b) Tramos trabajados del día (machine_work_segments, CON turno) — para la línea
  //     de tiempo: a qué hora empezó/terminó cada tramo, filtrado por turno para no
  //     mezclar el trabajo de día con el de noche en la misma fila.
  const segs = await selectAllRows(
    'machine_work_segments',
    'machinery_id, started_at, ended_at, shift',
    (q) => q.eq('round_date', date),
  );
  const segsByMachine = new Map<string, { start: number; end: number; shift: Turno }[]>();
  ((segs ?? []) as any[]).forEach((s) => {
    const st = s.started_at ? new Date(s.started_at).getTime() : NaN;
    const en = s.ended_at ? new Date(s.ended_at).getTime() : NaN;
    if (isNaN(st) || isNaN(en)) return;
    const list = segsByMachine.get(s.machinery_id) ?? [];
    list.push({ start: st, end: en, shift: s.shift === 'night' ? 'night' : 'day' });
    segsByMachine.set(s.machinery_id, list);
  });
  // Parada POR TURNO: machine → turno → {motivo, hora de parada, hora de reactivación}.
  // Así la parada del inspector de DÍA no afecta al de NOCHE (misma máquina, 2
  // inspectores) ni tapa la jornada del otro turno. Parada de HOY por turno (respeta
  // el turno). ARRASTRADA (marcada antes del día del reporte) aplica a TODA la
  // máquina (ambos turnos), PERO solo si NO trabaja hoy: si iniciaron jornada la
  // máquina se reactivó y está EN CURSO (la vieja pierde).
  // Deja SOLO el motivo en la nota: quita la Ubicación (GPS) y el Edificio — el
  // reporte muestra POR QUÉ, no dónde (el Edificio ya tiene su propia columna).
  const soloMotivo = (notes: any): string =>
    String(notes ?? '')
      .replace(/\s*·\s*Ubicaci[óo]n:.*$/i, '')
      .replace(/\s*·\s*Edificio:.*$/i, '')
      .replace(/^NO TRABAJ[ÓO] LA M[ÁA]QUINA\s*·?\s*/i, 'No trabajó · ')
      .replace(/·\s*$/, '')
      .trim();
  const paradaHoyByShift = new Map<string, Map<Turno, EventoParada>>();
  const paradaArrByShift = new Map<string, Map<Turno, EventoParada>>();
  const dayStartMs = new Date(`${date}T00:00:00-04:00`).getTime();
  const nowMs = Date.now();
  ((maint ?? []) as any[]).forEach((m) => {
    const id = m.machinery_id as string;
    const start = new Date(m.created_at).getTime();
    const end = m.resolved_at ? new Date(m.resolved_at).getTime() : null;
    const motivo = soloMotivo(m.notes) || 'No trabajó';
    // TODO por TURNO (por la hora de la marca): así una parada/avería de NOCHE NO
    // aparece en el inspector de DÍA (ej. "no trabaja de noche"). Aplica tanto a la
    // de HOY como a la ARRASTRADA (día anterior): cada una pertenece a su turno.
    const sh = paradaShiftOf(m.created_at);
    const target = start < dayStartMs ? paradaArrByShift : paradaHoyByShift;
    const mm = target.get(id) ?? new Map<Turno, EventoParada>();
    if (!mm.has(sh)) mm.set(sh, { motivo, start, end });
    target.set(id, mm);
  });
  // Avería HOY (marcada en el día del reporte) vs ARRASTRADA (antes). El motivo es el
  // material/nota de la avería.
  const averiaHoyByShift = new Map<string, Map<Turno, EventoParada>>();
  const averiaArrByShift = new Map<string, Map<Turno, EventoParada>>();
  ((maintAver ?? []) as any[]).forEach((m) => {
    const id = m.machinery_id as string;
    const start = new Date(m.created_at).getTime();
    const end = m.resolved_at ? new Date(m.resolved_at).getTime() : null;
    const motivo = soloMotivo(m.notes) || String(m.material ?? '') || 'Avería';
    const sh = paradaShiftOf(m.created_at); // avería por TURNO (igual que la parada)
    const target = start < dayStartMs ? averiaArrByShift : averiaHoyByShift;
    const mm = target.get(id) ?? new Map<Turno, EventoParada>();
    if (!mm.has(sh)) mm.set(sh, { motivo, start, end });
    target.set(id, mm);
  });

  // 4) Ubicaciones por máquina (todos los check-in del día, ubicaciones distintas).
  const visits = await listVisits(date);
  const locByMachine = new Map<string, LocInfo[]>();
  // `listVisits` viene ordenado por `visited_at` DESCENDENTE (el más reciente primero);
  // se recorre en orden CRONOLÓGICO (ascendente) para quedarse con la PRIMERA vez que
  // se vio cada ubicación — antes se quedaba con la última (por ser la primera en el
  // orden descendente), así que si una máquina volvía a un sitio ya visitado, la tabla
  // "cambió de ubicación" mostraba la hora de la visita más reciente a ese sitio en vez
  // de cuándo llegó realmente ahí, invirtiendo o desfasando la línea de tiempo.
  visits.slice().sort((a, b) => String(a.visited_at).localeCompare(String(b.visited_at))).forEach((v) => {
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
  // Solo rellena con la ronda de "anoche" las máquinas que NO tengan ya una fila de
  // HOY (si la tienen, esa es la vigente — ver comentario del fetch más arriba).
  ((roundsNocheAyer ?? []) as any[]).forEach((r) => { if (!roundByMachine.has(r.machinery_id)) roundByMachine.set(r.machinery_id, r); });

  const data = new Map<Turno, Map<string, Map<string, Mach>>>();
  const putMach = (turno: Turno, insp: string, id: string, base: { code: string; serial: string | null; plate: string | null; company: string; sector: string; referencia: string; lat: number | null; lng: number | null }) => {
    if (cos && !cos.includes(base.company)) return;
    if (inactiveIds.has(id)) return; // INACTIVA del catálogo: fuera del reporte de inspectores
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
    // Turno de la jornada ABIERTA: si `jornada_shift` viene nulo se INFIERE por la hora
    // de inicio (Caracas 7am–7pm = día), EXACTAMENTE igual que las tarjetas en vivo
    // (`openShiftOf` en InspectionsSummary). Antes el reporte exigía
    // `jornada_shift === turno` sin inferir, así que una jornada reabierta sin turno
    // explícito NO se detectaba como reactivación → el PDF firmado seguía diciendo
    // "🔴/🟡" mientras las tarjetas ya la mostraban en curso ("el reporte dice una
    // cosa y las tarjetas otra").
    const openShift: Turno | null = rd?.jornada_start_at
      ? (rd.jornada_shift === 'night' ? 'night' : rd.jornada_shift === 'day' ? 'day' : paradaShiftOf(rd.jornada_start_at))
      : null;
    const openForShift = !!rd?.jornada_start_at && openShift === turno;
    // Prioridad UNIFICADA (igual que el teléfono `segmentoDe` y el admin):
    //  avería HOY > parada HOY > trabajando > avería ARRASTRADA > parada ARRASTRADA >
    //  finalizada (con horas) > por iniciar. Lo de HOY gana sobre "trabajando"; lo
    //  arrastrado pierde si la máquina inició jornada (se reactivó).
    // La arrastrada se suprime si la máquina se REACTIVÓ hoy: sigue abierta AHORA
    // (openForShift) o YA trabajó y cerró con horas (hoursForShift > 0). Antes solo
    // miraba `openForShift`, así que una máquina con avería/parada de días atrás que
    // el inspector abrió y CERRÓ hoy (con horas) seguía saliendo "🔴 Averiada"/"🟡
    // Parada" en este reporte, mientras el teléfono del inspector (que sí considera
    // "trabajó hoy" para suprimirla) ya no mostraba ninguna marca — la misma máquina
    // se veía distinta en el PDF del jefe y en el teléfono del inspector.
    const reactivadaHoy = openForShift || hoursForShift > 0;
    // BUG (08/08/2026): una máquina AVERIADA que el inspector volvió a "iniciar
    // jornada" seguía saliendo 🔴 AVERIADA en este reporte. Dos causas: (a) la
    // consulta trae también las averías RESUELTAS hoy (para la línea de tiempo), y se
    // contaban como averiada; (b) la avería de HOY ganaba aunque la jornada se
    // reiniciara DESPUÉS de ella. Regla: una avería/parada cuenta como estado ACTUAL
    // solo si sigue SIN resolver (end == null) y la jornada NO se reinició después de
    // ella (si jornada_start_at > la marca, la máquina se reactivó → trabaja).
    const jStartMs = openForShift ? new Date(rd.jornada_start_at).getTime() : null;
    // `>=` (no `>`) para IGUALAR el criterio de las tarjetas/tlf (`reactivadaTras` /
    // `reactivada`): si la jornada arrancó en el mismo instante o DESPUÉS de la marca,
    // la máquina volvió a trabajar y la avería/parada ya no cuenta.
    const activa = (ev?: EventoParada): EventoParada | undefined =>
      ev && ev.end == null && !(jStartMs != null && jStartMs >= ev.start) ? ev : undefined;
    const parHoy = activa(paradaHoyByShift.get(id)?.get(turno));
    const averHoyMot = activa(averiaHoyByShift.get(id)?.get(turno));
    const averArrMot = !reactivadaHoy ? activa(averiaArrByShift.get(id)?.get(turno)) : undefined;
    const parArrMot = !reactivadaHoy ? activa(paradaArrByShift.get(id)?.get(turno)) : undefined;
    const estado: EstadoKey =
      averHoyMot != null ? 'averia'
      : parHoy != null ? 'parada'
      : openForShift ? 'encurso'
      : averArrMot != null ? 'averia'
      : parArrMot != null ? 'parada'
      : hoursForShift > 0 ? 'finalizada'
      : 'pendiente';
    const evParada: EventoParada | undefined =
      estado === 'averia' ? (averHoyMot ?? averArrMot)
      : estado === 'parada' ? (parHoy ?? parArrMot)
      : undefined;
    const motivo = evParada?.motivo ?? '';
    // Línea de tiempo de ESTE turno: tramos trabajados de `machine_work_segments`
    // filtrados por turno (para no mezclar día con noche) + el episodio de
    // parada/avería vigente para este turno (si hay), en orden cronológico.
    const tramosTurno = (segsByMachine.get(id) || []).filter((s) => s.shift === turno);
    const evs: { t: number; label: string }[] = tramosTurno.map((s) => ({
      t: s.start, label: `${horaCaracasMs(s.start)}–${horaCaracasMs(s.end)} trabajó`,
    }));
    if (evParada) {
      const durMin = evParada.end != null ? Math.round((evParada.end - evParada.start) / 60000) : null;
      const durTxt = durMin != null ? ` (${horasDuracion(durMin)})` : ' (sigue parada)';
      const finTxt = evParada.end != null ? ` → ${horaCaracasMs(evParada.end)} reactivada` : '';
      evs.push({ t: evParada.start, label: `${horaCaracasMs(evParada.start)} 🟡 paró: ${evParada.motivo || 'sin motivo'}${durTxt}${finTxt}` });
    }
    evs.sort((a, b) => a.t - b.t);
    // HORAS PARADA de ESTE turno: duración del episodio de parada/avería vigente,
    // acotada a la ventana del turno (día 7am–7pm; noche 7pm–7am+1). Reemplaza la
    // "línea de tiempo".
    const shiftStartMs = turno === 'night'
      ? new Date(date + 'T19:00:00-04:00').getTime()
      : new Date(date + 'T07:00:00-04:00').getTime();
    const shiftEndMs = turno === 'night'
      ? new Date(date + 'T07:00:00-04:00').getTime() + 86400000
      : new Date(date + 'T19:00:00-04:00').getTime();
    let horasParada = 0;
    if (evParada) {
      // Si SIGUE parada (sin reactivar) el "fin" es AHORA cuando el turno todavía está
      // en curso (no el fin del turno): una máquina parada a las 7am, a las 12:46pm
      // lleva ~5.7h paradas, NO 12h. Solo se topa al fin del turno cuando el turno ya
      // terminó (día pasado, o ya son >7pm/>7am). Una parada ya resuelta usa su hora
      // real de reactivación (evParada.end).
      const abierto = evParada.end == null ? Math.min(nowMs, shiftEndMs) : evParada.end;
      const pStart = Math.max(evParada.start, shiftStartMs);
      const pEnd = Math.min(abierto, shiftEndMs);
      horasParada = Math.max(0, r2((pEnd - pStart) / 3600000));
    }
    // Horas EN VIVO para una jornada que sigue "en curso" (estado === 'encurso'):
    // day_hours/night_hours en la BD quedan en 0 hasta que la jornada CIERRA (al
    // finalizar o por el auto-cierre de las 7am/7pm) — antes de eso, este reporte
    // mostraba 0 en Trabajando/Jornada para cualquier máquina todavía activa, aunque
    // llevara horas trabajando (bug: "no trae ningún dato" para el inspector con
    // máquinas en curso). Se suma el tiempo transcurrido desde `jornada_start_at`
    // hasta ahora, igual que ya hace el panel en vivo de Inspecciones (`liveHorasOf`).
    // Solo se suma en vivo si el estado FINAL es 'encurso': si hay avería/parada de
    // HOY, esa gana en la prioridad de arriba aunque la jornada siga técnicamente
    // abierta (`openForShift`) — antes esto sumaba igual, así que el reporte mostraba
    // "🔴 Averiada" con las horas de Trabajando/Jornada creciendo solas, como si
    // operara con normalidad.
    // Tope por turno: DÍA máx 12h, NOCHE máx 12h (el elapsed en vivo y el total del
    // turno nunca superan las 12h de duración del turno).
    const liveElapsedH = estado === 'encurso' && rd?.jornada_start_at
      ? Math.max(0, Math.min(12, (Date.now() - new Date(rd.jornada_start_at).getTime()) / 3600000))
      : 0;
    const dayHDisp = turno === 'day' && estado === 'encurso' ? r2(Math.min(12, dayH + liveElapsedH)) : r2(Math.min(12, dayH));
    const nightHDisp = turno === 'night' && estado === 'encurso' ? r2(Math.min(12, nightH + liveElapsedH)) : r2(Math.min(12, nightH));
    iMap.set(id, {
      id,
      code: base.code,
      serial: base.serial,
      plate: base.plate,
      company: base.company,
      sector: base.sector || 'Sin sector',
      referencia: base.referencia,
      edificio: edificioLabel(base.referencia),
      lat: base.lat,
      lng: base.lng,
      dayH: dayHDisp,
      nightH: nightHDisp,
      estado,
      motivo,
      horasParada,
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

  const estRank = (e: EstadoKey) => (e === 'averia' ? 0 : e === 'encurso' ? 1 : e === 'parada' ? 2 : e === 'pendiente' ? 3 : 4);
  const renderInspector = (turno: Turno, insp: string, machMap: Map<string, Mach>): string => {
    const list = [...machMap.values()].sort((a, b) => estRank(a.estado) - estRank(b.estado) || cmpText(a.code, b.code));
    // SOLO las horas del TURNO de este inspector (día si es de día, noche si es de noche).
    const hLabel = turno === 'day' ? 'H. Día' : 'H. Noche';
    let tWork = 0, tPar = 0, tJor = 0;
    const rows = list.map((m, i) => {
      const shiftH = r2(turno === 'day' ? m.dayH : m.nightH);       // horas de SU turno
      const jornada = shiftH;                                        // jornada = horas ACTIVAS (trabajadas)
      tWork = r2(tWork + shiftH); tPar = r2(tPar + m.horasParada); tJor = r2(tJor + jornada);
      const moved = machineLocs(m.id).length > 1;
      const em = ESTADO_META[m.estado];
      const estCell = `<span style="color:${em.color};font-weight:700;white-space:nowrap">${esc(em.txt)}</span>`;
      // MOTIVO en su PROPIA columna (ya no debajo del estado). Solo para avería/parada.
      const motivoCell = ((m.estado === 'averia' || m.estado === 'parada') && m.motivo)
        ? `<span style="color:${m.estado === 'averia' ? '#B91C1C' : '#B45309'};font-size:10px">${esc(m.motivo)}</span>`
        : '—';
      return `<tr><td>${i + 1}</td><td><b>${esc(m.code)}</b>${moved ? ' <span class="moved">↔ cambió de ubicación</span>' : ''}</td><td>${estCell}</td><td>${motivoCell}</td><td>${esc(m.company)}</td><td>${esc(m.sector)}</td><td>${esc(m.edificio || '—')}</td><td>${esc(m.plate || m.serial || '—')}</td><td class="r b">${shiftH}</td><td class="r">${r2(m.horasParada)}</td><td class="r b">${jornada}</td></tr>`;
    }).join('');
    const machTable = `<table class="ir"><thead><tr><th style="width:26px">Nº</th><th>Máquina</th><th>Estado</th><th>Motivo</th><th>Empresa</th><th>Sector</th><th>Edificio</th><th>Placa / Serial</th><th class="r">${hLabel}</th><th class="r">Parada</th><th class="r">Jornada</th></tr></thead><tbody>${rows}</tbody><tfoot><tr><td colspan="8">Total · ${list.length} equipo(s)</td><td class="r b">${tWork}</td><td class="r">${tPar}</td><td class="r b">${tJor}</td></tr></tfoot></table>`;

    // Desglose por SECTOR con subtotales (solo horas del turno de este inspector).
    const bySec = new Map<string, { c: number; h: number }>();
    list.forEach((m) => { const s = bySec.get(m.sector) ?? { c: 0, h: 0 }; s.c += 1; s.h += (turno === 'day' ? m.dayH : m.nightH); bySec.set(m.sector, s); });
    const secRows = [...bySec.entries()].sort((a, b) => cmpText(a[0], b[0]))
      .map(([s, v]) => `<tr><td>${esc(s)}</td><td class="r">${v.c}</td><td class="r b">${r2(v.h)}</td></tr>`).join('');
    const secTable = `<div class="sub">📍 Desglose por sector</div><table class="ir"><thead><tr><th>Sector</th><th class="r">Equipos</th><th class="r">${hLabel}</th></tr></thead><tbody>${secRows}</tbody></table>`;

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
    const totHoras = `<div class="tot-horas">🕒 Total de horas de ${totLabel}: <b>${tWork} h</b> · Parada: <b>${tPar} h</b> · Jornada: <b>${tJor} h</b></div>`;

    // Firma del inspector de ESTA sección (nombre completo + línea + rótulo).
    const firmaInsp = `<div class="firma-insp"><div class="line"></div><div class="fname">${esc(insp)}</div><div class="frole">Inspector</div></div>`;

    // Resumen de estados del inspector (todas sus máquinas a ese nivel).
    const cAve = list.filter((m) => m.estado === 'averia').length;
    const cEn = list.filter((m) => m.estado === 'encurso').length;
    const cPar = list.filter((m) => m.estado === 'parada').length;
    const cPen = list.filter((m) => m.estado === 'pendiente').length;
    const cFin = list.filter((m) => m.estado === 'finalizada').length;
    const resumen = [
      cAve ? `<span style="color:#B91C1C">🔴 ${cAve} averiada(s)</span>` : '',
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
  // TOTALES arriba, MISMO formato que el reporte por empresa (día y noche se muestran
  // igual): HRS DÍA · PARADAS DÍA · HRS NOCHE · PARADA NOCHE · JORNADA. Se suman de los
  // turnos e inspectores REALMENTE incluidos: día usa dayH/parada del turno día; noche,
  // nightH/parada del turno noche. Jornada = trabajando − paradas.
  let tDayH = 0, tParDay = 0, tNightH = 0, tParNight = 0;
  turnos.forEach((t) => {
    const tMap = data.get(t); if (!tMap) return;
    tMap.forEach((mm, insp) => {
      if (inspFilter && !inspFilter.has(insp)) return;
      mm.forEach((m) => {
        if (t === 'day') { tDayH += m.dayH; tParDay += m.horasParada; }
        else { tNightH += m.nightH; tParNight += m.horasParada; }
      });
    });
  });
  const tJornada = r2(tDayH + tNightH); // Total de jornada = solo horas ACTIVAS (trabajadas)
  // Solo se muestran las tarjetas del/los turno(s) del reporte: un reporte de DÍA no
  // enseña las de noche y viceversa (pedido del cliente). En "ambos" salen las 5.
  const showDay = turnos.includes('day');
  const showNight = turnos.includes('night');
  const kpis = `
    <div class="kpis">
      ${showDay ? `<div class="kpi"><div class="k">Total hrs día</div><div class="v">${r2(tDayH)} H</div></div>
      <div class="kpi warn"><div class="k">Total hrs paradas día</div><div class="v">${r2(tParDay)} H</div></div>` : ''}
      ${showNight ? `<div class="kpi"><div class="k">Total hrs noche</div><div class="v">${r2(tNightH)} H</div></div>
      <div class="kpi warn"><div class="k">Total hrs parada noche</div><div class="v">${r2(tParNight)} H</div></div>` : ''}
      <div class="kpi ok"><div class="k">Total de jornada</div><div class="v">${tJornada} H</div></div>
    </div>
    <div class="kpi-note">Total de jornada = total de horas ACTIVAS (trabajadas).</div>`;
  const body = hasAny
    ? (kpis + turnos.map(renderTurno).join(''))
    : `<p class="none">Sin jornadas de inspección para el día ${dmy(date)}${shift === 'both' ? '' : ` (${shift === 'day' ? 'turno día' : 'turno noche'})`}.</p>`;

  const extraCss = `
    /* Orientación HORIZONTAL (mejor lectura de textos largos). Mantiene el margen
       2cm del membrete base (las reglas @page se combinan). */
    @page{size:A4 landscape}
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
    .kpis{display:flex;flex-wrap:wrap;gap:8px;margin:6px 0 4px}
    .kpi{flex:1;min-width:120px;border:1px solid #E5E7EB;border-radius:10px;padding:9px 12px;background:#F8FAFC}
    .kpi .k{font-size:9px;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:0.4px}
    .kpi .v{font-size:20px;font-weight:800;color:#1E3A5F;margin-top:2px}
    .kpi.warn{background:#FEF3F2;border-color:#FECDCA} .kpi.warn .v{color:#B42318}
    .kpi.ok{background:#ECFDF3;border-color:#ABEFC6} .kpi.ok .v{color:#067647}
    .kpi-note{font-size:10px;color:#6B7280;margin:0 0 12px}
    .tot-horas{margin:12px 0 2px;font-size:12.5px;color:#1E3A5F;font-weight:700;background:#EEF2F7;border-radius:6px;padding:6px 10px;display:inline-block}
    .firma-insp{width:260px;margin:64px 0 8px;page-break-inside:avoid}
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

/**
 * Imagen PNG "recibo" del cierre de jornada de UN inspector — descargable desde
 * su propio teléfono al terminar el turno (todas sus máquinas ya finalizadas),
 * como respaldo personal. Usa la MISMA agregación (`computeInspectorData`) que
 * el reporte de inspectores que imprime el jefe, así que los números SIEMPRE
 * coinciden entre ambos documentos.
 */
export async function generateMyShiftReceipt(opts: { date: string; shift: 'day' | 'night'; inspectorName: string }): Promise<void> {
  const { date, shift, inspectorName } = opts;
  const { data } = await computeInspectorData(date, null);
  const machMap = data.get(shift)?.get(inspectorName);
  const list = machMap ? [...machMap.values()].sort((a, b) => cmpText(a.code, b.code)) : [];

  // SOLO las horas del TURNO del inspector: si es de día, sus horas de DÍA; si es de
  // noche, sus horas de NOCHE (no se mezcla el otro turno de la misma máquina). Con su
  // total de paradas y la jornada (horas del turno − paradas).
  let tH = 0, tPar = 0, tJor = 0;
  const rows = list.map((m) => {
    const shiftH = r2(shift === 'day' ? m.dayH : m.nightH);       // horas de SU turno
    const jornada = shiftH;                                        // jornada = horas ACTIVAS (trabajadas)
    tH += shiftH; tPar += m.horasParada; tJor += jornada;
    const em = ESTADO_META[m.estado];
    const motivo = (m.estado === 'averia' || m.estado === 'parada') && m.motivo
      ? `<div class="mot">${esc(m.motivo)}</div>` : '';
    return `<div class="row">
      <div class="rtop"><span class="code">${esc(m.code)}</span><span class="est" style="color:${em.color}">${esc(em.txt)}</span></div>
      ${motivo}
      <div class="rnums">Trabajó ${shiftH}h · Parada ${r2(m.horasParada)}h · <b>Jornada ${jornada}h</b></div>
    </div>`;
  }).join('');

  const turnoTxt = shift === 'day' ? '☀️ Turno Día (7:00am–7:00pm)' : '🌙 Turno Noche';
  // TOTALES ARRIBA en tarjetas, MISMO formato que el reporte por empresa (día y noche
  // se ven IGUAL): HRS DÍA · PARADAS DÍA · HRS NOCHE · PARADA NOCHE · JORNADA. El lado que
  // no es del turno del inspector queda en 0. Jornada = trabajando − paradas.
  const isDay = shift === 'day';
  const kpis = `
    <div class="kpis">
      <div class="kpi"><div class="k">Total hrs día</div><div class="v">${isDay ? r2(tH) : 0} H</div></div>
      <div class="kpi warn"><div class="k">Total hrs paradas día</div><div class="v">${isDay ? r2(tPar) : 0} H</div></div>
      <div class="kpi"><div class="k">Total hrs noche</div><div class="v">${!isDay ? r2(tH) : 0} H</div></div>
      <div class="kpi warn"><div class="k">Total hrs parada noche</div><div class="v">${!isDay ? r2(tPar) : 0} H</div></div>
      <div class="kpi ok"><div class="k">Total de jornada</div><div class="v">${r2(tJor)} H</div></div>
    </div>
    <div class="kpi-note">Máquinas: ${list.length} · Jornada = total de horas ACTIVAS (trabajadas).</div>`;
  // Antes se descargaba como IMAGEN PNG (exportReceiptImage) y en algunos teléfonos se
  // veía cortada/borrosa. Ahora es un PDF con el mismo formato que el resto del sistema.
  const body = `
    <div class="stamp">Generado ${esc(nowStamp())}</div>
    ${kpis}
    <div class="rows">${rows || '<div class="none">Sin máquinas asignadas este turno.</div>'}</div>`;

  const extraCss = `
    .stamp{color:#9CA3AF;font-size:10px;margin-bottom:8px}
    .kpis{display:flex;flex-wrap:wrap;gap:8px;margin:4px 0 14px;max-width:640px}
    .kpi{flex:1;min-width:132px;border:1px solid #E5E7EB;border-radius:10px;padding:10px 12px;background:#F8FAFC;page-break-inside:avoid}
    .kpi .k{font-size:9.5px;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:0.4px}
    .kpi .v{font-size:22px;font-weight:800;color:#1E3A5F;margin-top:2px}
    .kpi.warn{background:#FEF3F2;border-color:#FECDCA}
    .kpi.warn .v{color:#B42318}
    .kpi.ok{background:#ECFDF3;border-color:#ABEFC6}
    .kpi.ok .v{color:#067647}
    .rows{max-width:520px}
    .row{border:1px solid #E5E7EB;border-radius:8px;padding:8px 10px;margin-bottom:6px;page-break-inside:avoid}
    .rtop{display:flex;justify-content:space-between;align-items:center;font-size:12.5px}
    .rtop .code{font-weight:800;color:#111}
    .rtop .est{font-weight:700;font-size:11px;white-space:nowrap}
    .mot{font-size:10.5px;color:#B45309;margin-top:2px}
    .rnums{font-size:10.5px;color:#374151;margin-top:3px}
    .none{color:#6B7280;font-size:12px;text-align:center;padding:10px 0}
  `;

  const html = pdfDocument({
    title: 'CIERRE DE JORNADA — INSPECTOR',
    subtitle: `👷 ${inspectorName} · ${dmy(date)} · ${turnoTxt}`,
    body,
    extraCss,
  });
  await exportPdf(html, `Cierre de jornada - ${inspectorName} - ${dmy(date)} ${shift === 'day' ? 'dia' : 'noche'}`);
}
