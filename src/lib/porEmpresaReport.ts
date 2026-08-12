import { supabase, selectAllRows } from './supabase';
import { pdfDocument, exportPdf } from './pdf';
import { cmpText, norm } from './text';
import { workedFromShifts } from './hours';
import { motivoParada } from './paradaMotivo';
import { horarioNominal } from './jornada';
import { listInspectorAssignments, inspectorSiempreActivo } from './machineInspectors';
import { isoYesterday } from './caracasDay';

/**
 * Reporte del DÍA por EMPRESA (PDF). Para las empresas elegidas (tipo check) y un
 * día, lista por cada empresa sus máquinas con: Máquina, Serial/Placa, Inspector
 * asignado (día/noche), Horas trabajadas, Horas paradas/avería, la Avería/motivo y
 * una LÍNEA DE TIEMPO (pedida por el cliente: a qué hora inició, a qué hora paró y
 * por qué, cuánto duró la parada, y a qué hora se reactivó — reconstruida cruzando
 * TODOS los tramos de `machine_work_segments` con TODAS las paradas de
 * `maintenance_requests` de ese día, no solo el resumen agregado).
 *
 * Incluye las máquinas de esas empresas que tuvieron ACTIVIDAD ese día (horas
 * trabajadas o paradas) o una avería/parada pendiente vigente — es un "resumen del
 * día", no todo el catálogo. Horas trabajadas = día+noche+extra (los tramos que de
 * verdad se trabajaron); Horas paradas = hours_stopped; la avería sale de
 * maintenance_requests (motivo en notes, o el material si no hay nota).
 */

const esc = (v: any) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const dmy = (iso: string) => { const [y, m, d] = (iso || '').split('-'); return y && m && d ? `${d}/${m}/${y}` : iso; };
// Fecha larga en español para el banner grande: "lunes 10 de agosto de 2026"
// (el PDF la muestra en MAYÚSCULAS por el text-transform del membrete).
const MESES_LARGOS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DIAS_SEMANA = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const fechaLarga = (iso: string): string => {
  const [y, m, d] = (iso || '').split('-').map(Number);
  if (!y || !m || !d) return iso;
  const dt = new Date(y, m - 1, d); // hora local (mediodía implícito) → sin corrimiento de zona
  return `${DIAS_SEMANA[dt.getDay()]} ${d} de ${MESES_LARGOS[m - 1]} de ${y}`;
};
/** Día ISO (AAAA-MM-DD) + n días (n puede ser negativo). */
const addDaysISO = (iso: string, n: number): string => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
const dash = (v: any) => { const s = String(v ?? '').trim(); return s || '—'; };
const n2 = (n: number) => Math.round(n * 100) / 100;
/** Hora (Caracas) "HH:MM am/pm" de un instante ISO, o '—'. */
const horaCaracas = (iso: string | null): string => {
  if (!iso) return '—';
  try { return new Intl.DateTimeFormat('es-VE', { timeZone: 'America/Caracas', hour: '2-digit', minute: '2-digit', hour12: true }).format(new Date(iso)); } catch { return '—'; }
};

type Grupo = 'activa' | 'averia' | 'inactiva';
type Fila = {
  grupo: Grupo;
  code: string; modelo: string; serialPlaca: string; inspector: string;
  // Horario por turno: DÍA (7am→7pm) y NOCHE (7pm→7am). "—" si no trabajó ese turno.
  diaIni: string; diaFin: string; nocheIni: string; nocheFin: string;
  // EN CURSO = la jornada de ese turno sigue abierta (aún no finaliza) → FIN en verde.
  diaEnCurso: boolean; nocheEnCurso: boolean;
  // Total de horas del turno (para mostrar EN VERDE: p. ej. 7am–7pm = 12 h).
  diaHoras: number; nocheHoras: number;
  // Motivo de avería/parada (solo grupo 'averia') — se muestra EN LÍNEA en la fila.
  motivo: string;
};

/**
 * Genera y exporta el PDF del reporte del día por empresa.
 * @param date día ISO "AAAA-MM-DD".
 * @param companyIds IDs de las empresas seleccionadas.
 * @param encargados (opcional) nombres de ENCARGADO por los que filtrar. Vacío = todos.
 * @returns true si el usuario confirmó (imprimió/guardó), false si canceló.
 */
export async function generateEmpresaDiaReport(opts: { date: string; companyIds: string[]; encargados?: string[] }): Promise<boolean> {
  const { date, companyIds } = opts;
  const encargados = opts.encargados ?? [];
  const fecha = dmy(date);
  if (!companyIds.length) return false;

  // 1) Máquinas de las empresas elegidas (y, si se filtró, solo de esos encargados).
  //    `tipo` = MODELO de la máquina (CAT 320, Komatsu PC200…); `encargado` para filtrar.
  const machs = await selectAllRows(
    'machinery',
    'id, code, serial, plate, tipo, encargado, active, operational, company_id, company:company_id(name)',
    (q) => { let qq = q.in('company_id', companyIds); if (encargados.length) qq = qq.in('encargado', encargados); return qq; },
  );
  const ids = ((machs ?? []) as any[]).map((m) => m.id);
  if (!ids.length) return false;
  const machById = new Map<string, any>();
  ((machs ?? []) as any[]).forEach((m) => machById.set(m.id, m));

  // Lecturas del día en PARALELO (todas dependen solo de `ids`/`date`) — una sola
  // espera de red en vez de 5 encadenadas al generar el reporte.
  const roundsSelect = 'machinery_id, day_hours, night_hours, hours_stopped, overtime_hours, jornada_start_at, jornada_shift';
  // La ventana de avería/parada llega hasta las 07:00 del día SIGUIENTE (no medianoche):
  // el turno noche va de 19:00 a 07:00+1, así que una avería/parada marcada (o reactivada)
  // a la 1am cae dentro del turno noche de HOY — igual criterio que inspectorReport.ts.
  const nightEndBound = `${addDaysISO(date, 1)}T07:00:00-04:00`;
  const [rounds, roundsNocheAyer, segs, { rows: assigns }, { data: mr }] = await Promise.all([
    // 2) Rondas del día (horas trabajadas y paradas).
    selectAllRows('machine_rounds', roundsSelect, (q) => q.eq('round_date', date).in('machinery_id', ids)),
    // Jornada de NOCHE que arrancó ANOCHE y sigue abierta: su `round_date` es el de AYER
    // (el día en que inició), no el de `date`. Sin este fallback, generar el reporte bien
    // temprano (antes del auto-cierre de las 7am) dejaba a esa máquina sin sumar sus horas
    // EN VIVO. Mismo criterio que `computeInspectorData` en inspectorReport.ts.
    selectAllRows('machine_rounds', roundsSelect, (q) => q.eq('round_date', isoYesterday(date)).eq('jornada_shift', 'night').not('jornada_start_at', 'is', null).in('machinery_id', ids)),
    // 2b) Tramos trabajados del día (machine_work_segments) — CADA fila (no solo el
    //     agregado) para reconstruir la línea de tiempo y las horas paradas (span − trabajado).
    selectAllRows('machine_work_segments', 'machinery_id, started_at, ended_at, hours', (q) => q.eq('round_date', date).in('machinery_id', ids)),
    // 3) Inspector asignado (CHECK) por turno.
    listInspectorAssignments(),
    // 4) Avería/parada PENDIENTE vigente (arrastrada) + las RESUELTAS este día (para la
    //    hora de reactivación en la línea de tiempo). Para HOY el borde es futuro → solo pendientes.
    supabase.from('maintenance_requests')
      .select('machinery_id, material, notes, created_at, status, resolved_at')
      .in('machinery_id', ids)
      .lte('created_at', nightEndBound)
      .or(`status.eq.pendiente,resolved_at.gt.${nightEndBound}`)
      .order('created_at', { ascending: false }),
  ]);
  const roundBy = new Map<string, any>();
  ((rounds ?? []) as any[]).forEach((r) => roundBy.set(r.machinery_id, r));
  // Solo rellena con la ronda de "anoche" las máquinas que NO tengan ya una fila de
  // `date` (si la tienen, esa es la vigente).
  ((roundsNocheAyer ?? []) as any[]).forEach((r) => { if (!roundBy.has(r.machinery_id)) roundBy.set(r.machinery_id, r); });

  // Agrega los tramos del día (`segs`, traídos arriba): por máquina el total, el primer
  // inicio y el último fin, y la lista de tramos para la línea de tiempo. HORAS PARADAS =
  // span total − trabajado. Cero cambios al pago (no toca day_hours ni hours_stopped).
  const segBy = new Map<string, { sum: number; minStart: number; maxEnd: number }>();
  const segsByMachine = new Map<string, { start: number; end: number }[]>();
  ((segs ?? []) as any[]).forEach((s) => {
    const st = s.started_at ? new Date(s.started_at).getTime() : NaN;
    const en = s.ended_at ? new Date(s.ended_at).getTime() : NaN;
    const h = Number(s.hours) || 0;
    const prev = segBy.get(s.machinery_id) ?? { sum: 0, minStart: Infinity, maxEnd: -Infinity };
    prev.sum += h;
    if (!isNaN(st)) prev.minStart = Math.min(prev.minStart, st);
    if (!isNaN(en)) prev.maxEnd = Math.max(prev.maxEnd, en);
    segBy.set(s.machinery_id, prev);
    if (!isNaN(st) && !isNaN(en)) {
      const list = segsByMachine.get(s.machinery_id) ?? [];
      list.push({ start: st, end: en });
      segsByMachine.set(s.machinery_id, list);
    }
  });

  // 3) Inspector asignado (CHECK) por turno (`assigns`, traído arriba).
  const dayInsp = new Map<string, string>();
  const nightInsp = new Map<string, string>();
  assigns.forEach((a) => { (a.shift === 'night' ? nightInsp : dayInsp).set(a.machinery_id, a.inspector_name || ''); });
  // REGLA "SIEMPRE ACTIVO" (SOS LA GUAIRA): estas máquinas nunca muestran parada/avería
  // ni horas paradas en el reporte por empresa (se ignora su historial de mantenimiento).
  const siempreActivoIds = new Set<string>();
  assigns.forEach((a) => { if (inspectorSiempreActivo(a.inspector_name)) siempreActivoIds.add(a.machinery_id); });

  // 4) Motivo de avería/parada — procesa `mr` (traído arriba). CORREGIDO: antes el
  //    registro paralelo "MÁQUINA PARADA" (que se crea SIEMPRE junto al de avería real,
  //    ver SupervisorScreen.marcarParadaAveria) pisaba el motivo real del inspector con
  //    el genérico "NO TRABAJÓ · PARADA" — el reporte nunca mostraba POR QUÉ se paró.
  //    Ahora: si hay avería real (material distinto) se usa SU motivo/material; solo se
  //    usa "no trabajó" cuando de verdad no hubo avería, limpiando la nota (quita GPS,
  //    deja edificio/referencia). `mr` trae PENDIENTES vigentes (arrastradas) + las
  //    RESUELTAS este día (para la hora de reactivación en la línea de tiempo).
  // Deja SOLO el motivo (texto fijo "NO TRABAJÓ" + motivo del inspector), sin Ubicación
  // ni Edificio — normalización ÚNICA compartida con Inspecciones/teléfono (src/lib/paradaMotivo).
  const limpiarNoTrabajo = (notes: string): string => motivoParada(notes) || 'No trabajó';
  const mrByMachine = new Map<string, any[]>();
  ((mr ?? []) as any[]).forEach((m) => {
    const list = mrByMachine.get(m.machinery_id) ?? [];
    list.push(m);
    mrByMachine.set(m.machinery_id, list);
  });
  // El motivo (avería/parada) se compone POR TURNO más abajo (averiaTxt), etiquetando
  // ☀️ día / 🌙 noche según la HORA en que se registró — así el "no trabajó" de noche
  // no se confunde con el trabajo del día. Usa mrByMachine (arriba) como fuente.

  // Línea de tiempo por máquina: cada fila 'MÁQUINA PARADA' es UN episodio de parada
  // (created_at = cuándo paró, resolved_at = cuándo se reactivó, o sigue en curso si
  // es null). El motivo real se toma de la fila de avería REAL creada casi al mismo
  // instante (mismo flujo marcarParadaAveria — inserta ambas juntas), o si no existe
  // (caso "no trabajó"), de la propia nota limpia.
  const paradaRows = ((mr ?? []) as any[]).filter((m) => m.material === 'MÁQUINA PARADA');
  const otrasByMachine = new Map<string, any[]>();
  ((mr ?? []) as any[]).filter((m) => m.material !== 'MÁQUINA PARADA').forEach((m) => {
    const list = otrasByMachine.get(m.machinery_id) ?? [];
    list.push(m);
    otrasByMachine.set(m.machinery_id, list);
  });
  const paradasByMachine = new Map<string, { start: number; end: number | null; motivo: string }[]>();
  paradaRows.forEach((p) => {
    if (siempreActivoIds.has(p.machinery_id)) return; // SOS LA GUAIRA: sin paradas
    const startMs = new Date(p.created_at).getTime();
    const endMs = p.resolved_at ? new Date(p.resolved_at).getTime() : null;
    const pareja = (otrasByMachine.get(p.machinery_id) || []).find(
      (c) => Math.abs(new Date(c.created_at).getTime() - startMs) < 120000, // ±2 min = mismo evento
    );
    let motivo: string;
    if (pareja) {
      const notes = (pareja.notes && String(pareja.notes).trim()) || '';
      motivo = notes || String(pareja.material || 'Avería');
    } else {
      const notes = (p.notes && String(p.notes).trim()) || '';
      motivo = notes ? limpiarNoTrabajo(notes) : 'Parada (sin motivo)';
    }
    const list = paradasByMachine.get(p.machinery_id) ?? [];
    list.push({ start: startMs, end: endMs, motivo });
    paradasByMachine.set(p.machinery_id, list);
  });

  const horasDuracion = (min: number): string => (min >= 60 ? `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}` : `${min}min`);
  // Arma el texto de la línea de tiempo cruzando tramos trabajados + episodios de
  // parada de esa máquina, en orden cronológico: "07:00am–11:15am trabajó · 11:15am
  // 🟡 paró: manguera rota (47min) → 12:02pm reactivada · 12:02pm–07:00pm trabajó".
  const buildTimeline = (id: string): string => {
    const tramos = segsByMachine.get(id) || [];
    const paradas = paradasByMachine.get(id) || [];
    if (!tramos.length && !paradas.length) return '';
    const evs: { t: number; label: string }[] = [];
    tramos.forEach((s) => evs.push({ t: s.start, label: `${horaCaracas(new Date(s.start).toISOString())}–${horaCaracas(new Date(s.end).toISOString())} trabajó` }));
    paradas.forEach((p) => {
      const durMin = p.end != null ? Math.round((p.end - p.start) / 60000) : null;
      const durTxt = durMin != null ? ` (${horasDuracion(durMin)})` : ' (sigue parada)';
      const finTxt = p.end != null ? ` → ${horaCaracas(new Date(p.end).toISOString())} reactivada` : '';
      evs.push({ t: p.start, label: `${horaCaracas(new Date(p.start).toISOString())} 🟡 paró: ${p.motivo}${durTxt}${finTxt}` });
    });
    evs.sort((a, b) => a.t - b.t);
    return evs.map((e) => e.label).join(' · ');
  };

  // Separa las horas paradas en DÍA/NOCHE (pedido del cliente 07/08/2026: "tiene
  // que mostrar total paradas día y total parada noche"). Usa los episodios
  // reales de `maintenance_requests` (MÁQUINA PARADA, con hora exacta de inicio)
  // como fuente — mismo criterio día 7am–7pm / noche resto que `paradaShiftOf`
  // en SupervisorScreen.tsx — y acota cada episodio a la ventana de ESTE día
  // reportado (una parada que sigue abierta o que arrancó otro día solo cuenta
  // las horas que caen dentro de esta fecha).
  const paradaShiftOf = (ms: number): 'day' | 'night' => {
    const h = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Caracas', hour: '2-digit', hour12: false }).format(ms));
    return h >= 7 && h < 19 ? 'day' : 'night';
  };
  // Franjas del día reportado (Caracas): DÍA = 07:00–19:00 (12h) · NOCHE = 00:00–07:00
  // y 19:00–24:00 (12h). Cada turno tiene un máximo de 12h.
  const dayBoundStart = new Date(`${date}T00:00:00-04:00`).getTime();
  const dayBoundEnd = new Date(`${date}T23:59:59.999-04:00`).getTime();
  const day7 = new Date(`${date}T07:00:00-04:00`).getTime();
  const day19 = new Date(`${date}T19:00:00-04:00`).getTime();
  const nowMs = Date.now();
  // ¿El día reportado es HOY (Caracas)? El cálculo "en vivo" (jornada abierta que sigue
  // sumando) solo aplica hoy; un día pasado muestra únicamente lo que quedó banqueado.
  const caracasHoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Caracas', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const isToday = date === caracasHoy;
  /** Horas de solapamiento entre [a1,a2] y [b1,b2]. */
  const overlapH = (a1: number, a2: number, b1: number, b2: number) => Math.max(0, Math.min(a2, b2) - Math.max(a1, b1)) / 3600000;
  // Reparte las horas paradas por la FRANJA real donde caen (no por la hora de inicio):
  // una parada que arranca de día y sigue de noche cuenta sus horas en cada turno.
  // Solo cuenta lo que cae DENTRO del día seleccionado (una parada de varios días no
  // infla el día) y cada turno se topa en 12h.
  const paradasDiaNoche = (id: string): { dia: number; noche: number } => {
    const eps = paradasByMachine.get(id) || [];
    const r = roundBy.get(id);
    const jOpenMs = r?.jornada_start_at ? new Date(r.jornada_start_at).getTime() : null;
    const jOpenShift: 'day' | 'night' | null = jOpenMs != null
      ? (r.jornada_shift === 'night' ? 'night' : r.jornada_shift === 'day' ? 'day' : paradaShiftOf(jOpenMs))
      : null;
    let dia = 0, noche = 0;
    eps.forEach((p) => {
      // Turno de la MARCA (no la franja horaria): el episodio completo pertenece al turno
      // en que se paró, igual que el reporte por inspector y las tarjetas en vivo.
      const sh = paradaShiftOf(p.start);
      // REACTIVADA: si la jornada de ESE turno arrancó en el mismo instante o DESPUÉS de
      // la parada, la máquina volvió a trabajar → el episodio ya no cuenta (mismo criterio
      // que `reactivadaTras` de las tarjetas y `activa` del reporte por inspector).
      if (jOpenMs != null && jOpenShift === sh && jOpenMs >= p.start) return;
      const start = Math.max(p.start, dayBoundStart);
      const end = Math.min(p.end ?? nowMs, dayBoundEnd);
      if (end <= start) return;
      // Acota a la ventana del turno de la marca (día 7am–7pm; noche 00:00–7am + 7pm–24:00).
      // Antes se repartía por franja horaria, así una parada arrastrada aún abierta sumaba
      // ~12h fantasma (7h de "noche" 00:00–7am + 5h de "día") — la queja de "12h paradas".
      if (sh === 'day') dia += overlapH(start, end, day7, day19);
      else noche += overlapH(start, end, dayBoundStart, day7) + overlapH(start, end, day19, dayBoundEnd);
    });
    return { dia: n2(Math.min(12, dia)), noche: n2(Math.min(12, noche)) };
  };

  // Motivo (avería/parada) de UN turno para una máquina, o undefined si ese turno no
  // tuvo nada. Clasifica cada registro por la HORA (Caracas) en que se creó.
  const motivoDe = (rows: any[], sh: 'day' | 'night'): string | undefined => {
    const shiftRows = rows.filter((r) => paradaShiftOf(new Date(r.created_at).getTime()) === sh);
    if (!shiftRows.length) return undefined;
    const real = shiftRows.find((r) => r.material !== 'MÁQUINA PARADA');
    if (real) { const notes = (real.notes && String(real.notes).trim()) || ''; return notes || String(real.material || 'Avería'); }
    const parada = shiftRows.find((r) => r.material === 'MÁQUINA PARADA');
    if (parada) { const notes = (parada.notes && String(parada.notes).trim()) || ''; return notes ? limpiarNoTrabajo(notes) : 'Parada (sin motivo)'; }
    return undefined;
  };
  // Avería/motivo etiquetado por turno: "☀️ <día> · 🌙 <noche>" (solo los que existan).
  const averiaTxt = (id: string): string => {
    if (siempreActivoIds.has(id)) return ''; // SOS LA GUAIRA: nunca avería/parada
    const rows = mrByMachine.get(id) || [];
    if (!rows.length) return '';
    const d = motivoDe(rows, 'day'); const nn = motivoDe(rows, 'night');
    const parts: string[] = [];
    if (d) parts.push(`☀️ ${d}`);
    if (nn) parts.push(`🌙 ${nn}`);
    return parts.join(' · ');
  };

  const sinInspReal = (nm: string) => !nm || /faltant/i.test(nm);
  const inspTxt = (id: string): string => {
    const d = dayInsp.get(id); const nn = nightInsp.get(id);
    const parts: string[] = [];
    if (d && !sinInspReal(d)) parts.push(`☀️ ${d}`);
    if (nn && !sinInspReal(nn)) parts.push(`🌙 ${nn}`);
    return parts.length ? parts.join(' · ') : '—';
  };

  // Totales GLOBALES por turno (solo de las máquinas ACTIVAS que trabajaron). Día = dd,
  // noche = nn (horas reales, con anclaje de inicio de turno). Las averiadas/paradas van
  // en su propio grupo marcadas en 0 y NO suman a estos totales.
  let totDayH = 0, totNightH = 0;
  const HORA_DIA_INI = horarioNominal('day').ini, HORA_DIA_FIN = horarioNominal('day').fin;
  const HORA_NOCHE_INI = horarioNominal('night').ini, HORA_NOCHE_FIN = horarioNominal('night').fin;
  const nowHora = horaCaracas(new Date(nowMs).toISOString());
  // Por empresa → filas.
  const porEmpresa = new Map<string, Fila[]>();
  ids.forEach((id) => {
    const m = machById.get(id);
    const empresa = m?.company?.name || 'Sin empresa';
    // Inactiva = fuera de servicio en el catálogo (active=false). Regla confirmada
    // 08-ago-2026: una máquina averiada/parada (operational=false) pero ACTIVA y con
    // inspector asignado sigue contando como ACTIVA con su estado real (la avería ya
    // se refleja en la columna "Avería/motivo" vía averiaTxt) — ya no se agrupa como
    // "🚫 INACTIVA" solo por operational=false (antes sí, y eso la sacaba del bloque
    // de Activas aunque siguiera trabajando/asignada).
    // INACTIVA = NO OPERATIVA (botón "⛔ Inactiva" del catálogo, operational=false) o
    // desactivada (active=false). Estas SÍ salen acá (con 🚫 INACTIVA y 0 horas) y en
    // Control — pero NO en la vista de inspectores ni en el reporte por inspector.
    const inactiva = m?.active === false || m?.operational === false;
    // Las INACTIVAS (fuera de servicio) NO se muestran en este reporte (pedido cliente).
    if (inactiva) return;
    const r = roundBy.get(id);
    // Horas de turno crudas (día/noche/parada/extra) de la ronda — MISMA fuente que el
    // Informe por jornada. Las horas trabajadas se calculan con `workedFromShifts` (la
    // fórmula canónica compartida) para que AMBOS reportes COINCIDAN: ceil(día)+ceil(noche)
    // − paradas + extras (las paradas SÍ se descuentan, igual que facturación/pagos).
    let dd = Number(r?.day_hours) || 0;
    let nn = Number(r?.night_hours) || 0;
    // Umbral mínimo defensivo (mismo criterio que MIN_WORKED_HOURS en
    // inspectorDaySets.ts): un round con round_date mal calculado por cruce de
    // medianoche del turno NOCHE (BUG 10-ago-2026, ya corregido en el guardado —
    // ver businessRoundDateOf en caracasDay.ts) podía dejar un residuo mínimo de
    // horas (~0.02h) pegado al round de HOY. Sin este umbral, ese residuo hacía
    // que este reporte mostrara "HORARIO NOCHE: 07:00 p.m. → 07:00 a.m." como si
    // el turno noche ya hubiera ocurrido, aunque siguiera corriendo el turno día.
    // 0.05h (3 min) está muy por debajo de cualquier jornada real.
    const MIN_WORKED_HOURS = 0.05;
    if (dd <= MIN_WORKED_HOURS) dd = 0;
    if (nn <= MIN_WORKED_HOURS) nn = 0;
    const sRaw = Number(r?.hours_stopped) || 0;
    const oRaw = Number(r?.overtime_hours) || 0;
    // EN VIVO: una jornada ABIERTA cuenta desde el INICIO DE SU TURNO (no desde que la
    // marcaron): DÍA desde las 7am, NOCHE desde las 7pm (jornadas fijas 7am–7pm / 7pm–7am).
    // Así, aunque la marquen a las 9am o 9pm, cuenta el turno completo. Si estuvo averiada/
    // parada y luego la reactivaron, la resta de paradas (workedFromShifts) deja SOLO las
    // horas ACTIVAS. Mismo anclaje en el Informe por jornada → ambos reportes coinciden.
    const jStart = r?.jornada_start_at ? new Date(r.jornada_start_at).getTime() : null;
    const jShift = r?.jornada_shift === 'night' ? 'night' : r?.jornada_shift === 'day' ? 'day' : null;
    // La jornada abierta suma en vivo SOLO si estamos viendo HOY y arrancó DENTRO de
    // este día (si arrancó otro día — p. ej. máquina averiada arrastrada — no infla el día).
    const jStartHoy = jStart != null && jStart >= dayBoundStart && jStart <= dayBoundEnd;
    if (isToday && jStart && jShift && jStartHoy) {
      const shiftStart = jShift === 'night' ? day19 : day7; // 7pm noche · 7am día
      const elapsed = Math.min(12, Math.max(0, (nowMs - shiftStart) / 3600000));
      if (jShift === 'night') nn = Math.max(nn, elapsed); else dd = Math.max(dd, elapsed);
    }
    // Horas trabajadas = workedFromShifts (misma fórmula que Informe/Pagos/Control) → cuadra.
    const trab = workedFromShifts(dd, nn, sRaw, oRaw);
    const averiaBase = averiaTxt(id); // '' si es SOS "siempre activo"
    // ¿DECLARÓ jornada de este día pero cerró con 0h y SIN ticket de avería/parada?
    // `jornada_shift` persiste tras el auto-cierre aunque `jornada_start_at` se nule y
    // las horas queden en 0 — es el `declaredSet` de las tarjetas (inspectorDaySets.ts).
    // Regla del cliente "0 horas = parada": estas máquinas son PARADA, no "no listadas".
    // SIN esta rama el reporte por empresa OMITÍA la máquina que las tarjetas contaban
    // como 🟡 Parada — la desincronización que reportó el cliente (11-ago-2026). Se exige
    // jornada CERRADA (`!jornada_start_at`): una jornada aún abierta es actividad, no parada.
    const esParadaDeclarada = trab <= 0 && !averiaBase && !siempreActivoIds.has(id)
      && !!r && !r.jornada_start_at && (r.jornada_shift === 'day' || r.jornada_shift === 'night');
    // CLASIFICACIÓN en 2 grupos:
    //  · averia  → averiada/parada que NO trabajó (trab<=0 con avería/parada, o jornada en 0); se marca en 0.
    //  · activa  → trabajó (trab>0).
    // Una máquina sin actividad, SIN avería y que NUNCA declaró jornada (pendiente pura) no se lista.
    const esAveria = trab <= 0 && !!averiaBase;
    if (trab <= 0 && !esAveria && !esParadaDeclarada) return;
    const grupo: Grupo = (esAveria || esParadaDeclarada) ? 'averia' : 'activa';
    // Solo las ACTIVAS muestran horario y suman a los totales; las averiadas van en 0.
    const ddAct = grupo === 'activa' ? dd : 0;
    const nnAct = grupo === 'activa' ? nn : 0;
    const dayOpen = isToday && jShift === 'day' && jStart != null && jStartHoy;
    const nightOpen = isToday && jShift === 'night' && jStart != null && jStartHoy;
    totDayH = n2(totDayH + ddAct); totNightH = n2(totNightH + nnAct);
    const fila: Fila = {
      grupo,
      code: m?.code || '—',
      modelo: (m?.tipo && String(m.tipo).trim()) || '—',
      serialPlaca: m?.serial || m?.plate || '—',
      inspector: inspTxt(id),
      // Horario DÍA (7am→7pm) y NOCHE (7pm→7am). Si la jornada de ese turno sigue ABIERTA
      // hoy, el FIN muestra la hora actual (en curso); si ya cerró, el fin del turno.
      diaIni: ddAct > 0 ? HORA_DIA_INI : '—',
      diaFin: ddAct > 0 ? (dayOpen ? 'EN CURSO' : HORA_DIA_FIN) : '—',
      nocheIni: nnAct > 0 ? HORA_NOCHE_INI : '—',
      nocheFin: nnAct > 0 ? (nightOpen ? 'EN CURSO' : HORA_NOCHE_FIN) : '—',
      diaEnCurso: ddAct > 0 && dayOpen,
      nocheEnCurso: nnAct > 0 && nightOpen,
      diaHoras: n2(ddAct), nocheHoras: n2(nnAct),
      motivo: esAveria ? averiaBase : esParadaDeclarada ? 'Parada · jornada en 0 h' : '',
    };
    if (!porEmpresa.has(empresa)) porEmpresa.set(empresa, []);
    porEmpresa.get(empresa)!.push(fila);
  });

  const empresas = Array.from(porEmpresa.entries()).sort((a, b) => cmpText(a[0], b[0]));

  // Tabla de un GRUPO con columnas: Nº · Máquina · Modelo/Marca · Serial/Placa ·
  // Inspector · Horario DÍA (inicio arriba / fin abajo) · Horario NOCHE (idem).
  const tabla = (filas: Fila[]): string => {
    const cls = (g: Grupo) => g === 'averia' ? ' class="aver"' : '';
    // Celda de un turno: INICIO (arriba) · FIN (abajo, en verde "EN CURSO" si sigue abierta)
    // · TOTAL de horas del turno EN VERDE (p. ej. 12 h).
    const celda = (ini: string, fin: string, enCurso: boolean, horas: number) =>
      `<td class="hr"><div class="ini">${esc(ini)}</div>` +
      `<div class="${enCurso ? 'curso' : 'fin'}">${esc(fin)}</div>` +
      `${horas > 0 ? `<div class="tot">${n2(horas)} h</div>` : ''}</td>`;
    const rows = filas.slice().sort((a, b) => cmpText(a.code, b.code)).map((f, i) => {
      // Averiadas/Paradas: en 0, y el MOTIVO va EN LÍNEA ocupando las dos columnas de horario.
      const horario = f.grupo === 'averia'
        ? `<td colspan="2" class="mot">🔴 ${esc(dash(f.motivo))}</td>`
        : celda(f.diaIni, f.diaFin, f.diaEnCurso, f.diaHoras) + celda(f.nocheIni, f.nocheFin, f.nocheEnCurso, f.nocheHoras);
      return `<tr${cls(f.grupo)}>
        <td>${i + 1}</td><td><b>${esc(f.code)}</b></td><td>${esc(dash(f.modelo))}</td><td>${esc(dash(f.serialPlaca))}</td>
        <td>${esc(f.inspector)}</td>
        ${horario}
      </tr>`;
    }).join('');
    return `<table class="ir"><thead><tr>
      <th style="width:24px">Nº</th><th>Máquina</th><th>Modelo / Marca</th><th>Serial/Placa</th><th>Inspector asignado</th>
      <th>Horario DÍA<br><span class="sub">inicio · fin</span></th><th>Horario NOCHE<br><span class="sub">inicio · fin</span></th>
    </tr></thead><tbody>${rows}</tbody></table>`;
  };

  // Por empresa: ACTIVAS, luego AVERIADAS/PARADAS (agrupadas, en 0). Las INACTIVAS ya no se muestran.
  const secciones = empresas.map(([name, filas]) => {
    const activas = filas.filter((f) => f.grupo === 'activa');
    const averias = filas.filter((f) => f.grupo === 'averia');
    let out = `<h3>🏢 ${esc(name)} · ${filas.length} máquina(s)</h3>`;
    out += `<div class="grp grp-ok">✅ Activas · ${activas.length}</div>`;
    out += activas.length ? tabla(activas) : '<p class="vacio">Sin máquinas activas este día.</p>';
    if (averias.length) {
      out += `<div class="grp grp-aver">🔴 Averiadas / Paradas (en 0) · ${averias.length}</div>`;
      out += tabla(averias);
    }
    return out;
  }).join('');

  const totMach = empresas.reduce((s, [, f]) => s + f.length, 0);

  // Banner con la FECHA DEL REPORTE EN GRANDE (pedido del cliente), justo bajo el
  // membrete. Tamaño similar al título; la fecha completa en texto es más legible.
  const fechaBanner = `<div class="fecha-dia">📅 ${esc(fechaLarga(date))}</div>`;

  // Tarjetas de TOTALES arriba: TOTAL HORAS DÍA · TOTAL HORAS NOCHE · TOTAL DE JORNADA.
  const kpis = `
    <div class="kpis">
      <div class="kpi"><div class="k">Total horas día</div><div class="v">${n2(totDayH)} H</div></div>
      <div class="kpi"><div class="k">Total horas noche</div><div class="v">${n2(totNightH)} H</div></div>
      <div class="kpi ok"><div class="k">Total de jornada</div><div class="v">${n2(totDayH + totNightH)} H</div></div>
    </div>`;

  const extraCss = `
    /* Orientación HORIZONTAL (se aprecian mejor los textos largos). Mantiene el
       margen 2cm del membrete base (las reglas @page se combinan). */
    @page{size:A4 landscape}
    h3{margin:16px 0 3px;font-size:13px;color:#1E3A5F;padding-bottom:3px;border-bottom:2px solid #1E3A5F}
    table.ir{width:100%;border-collapse:collapse;margin:4px 0 12px;font-size:11px}
    table.ir th,table.ir td{border:1px solid #ccc;padding:5px 7px;text-align:left;vertical-align:top}
    table.ir th{background:#1E3A5F;color:#fff}
    td.r,th.r{text-align:right} td.b{font-weight:800}
    td.ok{color:#067647;font-weight:800}
    /* Horario por turno: inicio arriba (negro) y fin abajo (gris). */
    td.hr{white-space:nowrap} td.hr .ini{font-weight:700} td.hr .fin{color:#6B7280;font-size:10px}
    td.hr .curso{color:#067647;font-weight:800;font-size:10px}
    td.hr .tot{color:#067647;font-weight:800;font-size:11px;margin-top:1px}
    td.mot{color:#B42318;font-weight:700}
    th .sub{font-weight:400;font-size:8.5px;opacity:.85}
    table.ir tr.aver td{color:#B42318;background:#FEF3F2}
    table.ir tr.inact td{color:#9CA3AF;background:#F9FAFB;font-style:italic}
    .grp{margin:10px 0 2px;font-size:11px;font-weight:800;letter-spacing:.4px;padding:3px 8px;border-radius:6px;display:inline-block}
    .grp-ok{color:#067647;background:#ECFDF3;border:1px solid #ABEFC6}
    .grp-aver{color:#B42318;background:#FEF3F2;border:1px solid #FECDCA}
    .grp-inact{color:#6B7280;background:#F3F4F6;border:1px solid #E5E7EB}
    .vacio{font-size:10.5px;color:#9CA3AF;margin:2px 0 10px}
    .kpis{display:flex;flex-wrap:wrap;gap:8px;margin:6px 0 12px}
    .kpi{flex:1;min-width:120px;border:1px solid #E5E7EB;border-radius:10px;padding:9px 12px;background:#F8FAFC}
    .kpi .k{font-size:9px;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:0.4px}
    .kpi .v{font-size:20px;font-weight:800;color:#1E3A5F;margin-top:2px}
    .kpi.ok{background:#ECFDF3;border-color:#ABEFC6} .kpi.ok .v{color:#067647}
    /* FECHA DEL REPORTE EN GRANDE (banner bajo el membrete). */
    .fecha-dia{font-size:23px;font-weight:800;color:#1E3A5F;letter-spacing:.6px;text-align:center;
      margin:2px 0 12px;padding:9px 14px;border:2px solid #1E3A5F;border-radius:10px;background:#F1F5F9}
  `;

  // `encargados` trae TODAS las variantes de escritura seleccionadas (p. ej. "Alberto"
  // y "ALBERTO" del mismo encargado); se unifican por clave normalizada para no
  // mostrar duplicados ni inflar el conteo en el subtítulo del PDF.
  const encargadosUnicos = (() => {
    const vistos = new Map<string, string>();
    encargados.forEach((e) => { const k = norm(e); if (!vistos.has(k)) vistos.set(k, e); });
    return [...vistos.values()];
  })();
  const filtroEnc = encargadosUnicos.length ? ` · 👤 ${encargadosUnicos.length} encargado(s): ${encargadosUnicos.join(', ')}` : '';
  const subtitle = `${fecha} · ${empresas.length} empresa(s) · ${totMach} máquina(s)${filtroEnc} · ☀️ ${n2(totDayH)} h día · 🌙 ${n2(totNightH)} h noche`;

  const html = pdfDocument({
    title: 'REPORTE DEL DÍA POR EMPRESA',
    subtitle,
    body: empresas.length ? (fechaBanner + kpis + secciones) : (fechaBanner + '<p>Sin actividad para las empresas elegidas en este día.</p>'),
    extraCss,
  });
  return await exportPdf(html, `Reporte del dia por empresa ${fecha}`);
}
