import { supabase, selectAllRows } from './supabase';
import { pdfDocument, exportPdf } from './pdf';
import { cmpText } from './text';
import { listInspectorAssignments } from './machineInspectors';

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
const dash = (v: any) => { const s = String(v ?? '').trim(); return s || '—'; };
const n2 = (n: number) => Math.round(n * 100) / 100;
/** Hora (Caracas) "HH:MM am/pm" de un instante ISO, o '—'. */
const horaCaracas = (iso: string | null): string => {
  if (!iso) return '—';
  try { return new Intl.DateTimeFormat('es-VE', { timeZone: 'America/Caracas', hour: '2-digit', minute: '2-digit', hour12: true }).format(new Date(iso)); } catch { return '—'; }
};

type Fila = {
  inactiva: boolean;
  code: string; serialPlaca: string; inspector: string;
  horaIni: string; horaFin: string; trabajadas: number; paradasDia: number; paradasNoche: number; averia: string;
  timeline: string;
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
    'id, code, serial, plate, active, company_id, company:company_id(name)',
    (q) => q.in('company_id', companyIds),
  );
  const ids = ((machs ?? []) as any[]).map((m) => m.id);
  if (!ids.length) return false;
  const machById = new Map<string, any>();
  ((machs ?? []) as any[]).forEach((m) => machById.set(m.id, m));

  // 2) Rondas del día (horas trabajadas y paradas).
  const rounds = await selectAllRows(
    'machine_rounds',
    'machinery_id, day_hours, night_hours, hours_stopped, overtime_hours, jornada_start_at, jornada_shift',
    (q) => q.eq('round_date', date).in('machinery_id', ids),
  );
  const roundBy = new Map<string, any>();
  ((rounds ?? []) as any[]).forEach((r) => roundBy.set(r.machinery_id, r));

  // 2b) Tramos trabajados del día (machine_work_segments) — se guarda CADA fila (no
  //     solo el agregado) para poder reconstruir la línea de tiempo completa: HORA de
  //     inicio/fin de cada tramo, y las HORAS PARADAS = span total − trabajado (ej.:
  //     trabajó 7-11am y 3-7pm → span 12h, trabajado 8h → 4h paradas). Cero cambios al
  //     pago (no toca day_hours ni hours_stopped).
  const segs = await selectAllRows(
    'machine_work_segments',
    'machinery_id, started_at, ended_at, hours',
    (q) => q.eq('round_date', date).in('machinery_id', ids),
  );
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

  // 3) Inspector asignado (CHECK) por turno.
  const { rows: assigns } = await listInspectorAssignments();
  const dayInsp = new Map<string, string>();
  const nightInsp = new Map<string, string>();
  assigns.forEach((a) => { (a.shift === 'night' ? nightInsp : dayInsp).set(a.machinery_id, a.inspector_name || ''); });

  // 4) Avería/parada PENDIENTE vigente hasta ese día (se arrastra hasta resolver).
  //    CORREGIDO: antes, apenas veía el registro paralelo "MÁQUINA PARADA" (que se
  //    crea SIEMPRE junto al de avería real, ver SupervisorScreen.marcarParadaAveria),
  //    pisaba el motivo real que escribió el inspector con el texto genérico
  //    "NO TRABAJÓ · PARADA" — el reporte nunca mostraba POR QUÉ se paró. Ahora: si
  //    hay un registro de avería real (material distinto) se usa SU motivo/material;
  //    solo se usa el texto de "no trabajó" cuando de verdad no hubo avería, y en ese
  //    caso se limpia la nota (quita las coordenadas GPS, deja edificio/referencia).
  // Trae PENDIENTES vigentes (arrastradas) + las que se RESOLVIERON justo este día
  // (para poder mostrar la hora de reactivación en la línea de tiempo). Una parada
  // resuelta otro día distinto no entra acá (no corresponde a la jornada de este día).
  const { data: mr } = await supabase
    .from('maintenance_requests')
    .select('machinery_id, material, notes, created_at, status, resolved_at')
    .in('machinery_id', ids)
    .lte('created_at', `${date}T23:59:59.999-04:00`)
    .or(`status.eq.pendiente,and(resolved_at.gte.${date}T00:00:00-04:00,resolved_at.lte.${date}T23:59:59.999-04:00)`)
    .order('created_at', { ascending: false });
  const limpiarNoTrabajo = (notes: string): string => {
    const sinUbicacion = notes.replace(/\s*·\s*Ubicaci[óo]n:.*$/i, '').trim();
    return sinUbicacion.replace(/^NO TRABAJ[ÓO] LA M[ÁA]QUINA\s*·\s*/i, 'No trabajó · ') || 'No trabajó';
  };
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
    let dia = 0, noche = 0;
    eps.forEach((p) => {
      const start = Math.max(p.start, dayBoundStart);
      const end = Math.min(p.end ?? nowMs, dayBoundEnd);
      if (end <= start) return;
      dia += overlapH(start, end, day7, day19);
      noche += overlapH(start, end, dayBoundStart, day7) + overlapH(start, end, day19, dayBoundEnd);
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

  // Totales GLOBALES por turno (solo de las máquinas que SÍ se reportan). Las horas de
  // día = day_hours (+ extra); las de noche = night_hours. Las paradas se reparten por el
  // turno donde trabajó la máquina (si trabajó día y noche, proporcional) para que
  // Σparadas_día + Σparadas_noche = Σparadas (coincide con el total de la columna).
  let totDayH = 0, totNightH = 0, totParDay = 0, totParNight = 0;
  // Por empresa → filas (solo máquinas con actividad o avería/parada ese día).
  const porEmpresa = new Map<string, Fila[]>();
  ids.forEach((id) => {
    const m = machById.get(id);
    const empresa = m?.company?.name || 'Sin empresa';
    const inactiva = m?.active === false;
    const r = roundBy.get(id);
    const seg = segBy.get(id);
    // Horas trabajadas por turno (día = day_hours + extra; noche = night_hours).
    let dh = n2((Number(r?.day_hours) || 0) + (Number(r?.overtime_hours) || 0));
    let nh = n2(Number(r?.night_hours) || 0);
    // EN VIVO: una jornada ABIERTA (jornada_start_at, aún sin finalizar) suma las horas
    // transcurridas hasta AHORA a su turno — así el reporte crece con el tiempo mientras
    // la máquina trabaja (las horas se banquean recién al finalizar/parar). Tope 12h =
    // duración del turno (igual que el auto-cierre del servidor).
    const jStart = r?.jornada_start_at ? new Date(r.jornada_start_at).getTime() : null;
    const jShift = r?.jornada_shift === 'night' ? 'night' : r?.jornada_shift === 'day' ? 'day' : null;
    // La jornada abierta suma en vivo SOLO si estamos viendo HOY y arrancó DENTRO de
    // este día (si arrancó otro día — p. ej. máquina averiada arrastrada — no infla el
    // día seleccionado; solo cuenta lo banqueado de esa fecha).
    const jStartHoy = jStart != null && jStart >= dayBoundStart && jStart <= dayBoundEnd;
    if (isToday && jStart && jShift && jStartHoy) {
      const elapsed = Math.max(0, Math.min(12, (nowMs - jStart) / 3600000));
      if (jShift === 'day') dh = n2(dh + elapsed); else nh = n2(nh + elapsed);
    }
    // Tope por turno: DÍA máx 12h, NOCHE máx 12h (una máquina "corrida" puede tener
    // ambos → hasta 24h de jornada, pero nunca >12 en un mismo turno).
    dh = n2(Math.min(12, dh));
    nh = n2(Math.min(12, nh));
    const trab = n2(dh + nh);
    // Horas paradas totales (fallback sin episodios) + reparto día/noche por episodio.
    let par = 0;
    if (seg && seg.minStart !== Infinity && seg.maxEnd !== -Infinity) {
      const spanH = (seg.maxEnd - seg.minStart) / 3600000;
      par = Math.max(0, n2(spanH - seg.sum));
    } else {
      par = n2(Number(r?.hours_stopped) || 0);
    }
    const epSplit = paradasDiaNoche(id);
    const hayEpisodios = epSplit.dia > 0 || epSplit.noche > 0;
    // Fallback sin episodios (solo hours_stopped/span): se topa también a 12h de día.
    const paradasDia = hayEpisodios ? epSplit.dia : n2(Math.min(12, par));
    const paradasNoche = hayEpisodios ? epSplit.noche : 0;
    const horaIni = seg && seg.minStart !== Infinity ? horaCaracas(new Date(seg.minStart).toISOString()) : '—';
    const horaFin = seg && seg.maxEnd !== -Infinity ? horaCaracas(new Date(seg.maxEnd).toISOString()) : '—';
    const averiaBase = averiaTxt(id);
    // Las ACTIVAS solo se listan si tuvieron algo ese día; las INACTIVAS aparecen
    // SIEMPRE (solo en este reporte por empresa) con su estado 🚫 INACTIVA.
    if (!inactiva && trab <= 0 && paradasDia <= 0 && paradasNoche <= 0 && !averiaBase) return;
    totDayH = n2(totDayH + dh); totNightH = n2(totNightH + nh);
    totParDay = n2(totParDay + paradasDia); totParNight = n2(totParNight + paradasNoche);
    const averia = inactiva ? (averiaBase ? `🚫 INACTIVA · ${averiaBase}` : '🚫 INACTIVA') : averiaBase;
    const fila: Fila = {
      inactiva,
      code: m?.code || '—',
      serialPlaca: m?.serial || m?.plate || '—',
      inspector: inspTxt(id),
      horaIni, horaFin,
      trabajadas: trab, paradasDia, paradasNoche, averia,
      timeline: buildTimeline(id),
    };
    if (!porEmpresa.has(empresa)) porEmpresa.set(empresa, []);
    porEmpresa.get(empresa)!.push(fila);
  });

  const empresas = Array.from(porEmpresa.entries()).sort((a, b) => cmpText(a[0], b[0]));

  const tabla = (filas: Fila[]): string => {
    const rows = filas.slice().sort((a, b) => cmpText(a.code, b.code)).map((f, i) =>
      `<tr${f.inactiva ? ' class="inact"' : ''}>
        <td>${i + 1}</td><td><b>${esc(f.code)}</b></td><td>${esc(dash(f.serialPlaca))}</td>
        <td>${esc(f.inspector)}</td>
        <td class="r b">${f.trabajadas > 0 ? f.trabajadas : '—'}</td>
        <td class="r${f.paradasDia > 0 ? ' par' : ''}">${f.paradasDia > 0 ? `☀️ -${f.paradasDia}` : '—'}</td>
        <td class="r${f.paradasNoche > 0 ? ' par' : ''}">${f.paradasNoche > 0 ? `🌙 -${f.paradasNoche}` : '—'}</td>
        <td>${esc(dash(f.averia))}</td>
      </tr>`).join('');
    const tTrab = n2(filas.reduce((s, f) => s + f.trabajadas, 0));
    const tParDia = n2(filas.reduce((s, f) => s + f.paradasDia, 0));
    const tParNoche = n2(filas.reduce((s, f) => s + f.paradasNoche, 0));
    return `<table class="ir"><thead><tr>
      <th style="width:24px">Nº</th><th>Máquina</th><th>Serial/Placa</th><th>Inspector asignado</th>
      <th class="r">Horas trab.</th><th class="r">Paradas día</th><th class="r">Paradas noche</th><th>Avería / motivo</th>
    </tr></thead><tbody>${rows}</tbody>
    <tfoot><tr><td colspan="4">Total · ${filas.length} equipo(s)</td><td class="r b">${tTrab}</td><td class="r${tParDia > 0 ? ' par' : ''}">${tParDia > 0 ? `☀️ -${tParDia}` : '—'}</td><td class="r${tParNoche > 0 ? ' par' : ''}">${tParNoche > 0 ? `🌙 -${tParNoche}` : '—'}</td><td></td></tr></tfoot></table>`;
  };

  const secciones = empresas.map(([name, filas]) =>
    `<h3>🏢 ${esc(name)} · ${filas.length} máquina(s)</h3>${tabla(filas)}`).join('');

  const totMach = empresas.reduce((s, [, f]) => s + f.length, 0);
  const totTrab = n2(empresas.reduce((s, [, f]) => s + f.reduce((x, y) => x + y.trabajadas, 0), 0));
  const totParDia = n2(empresas.reduce((s, [, f]) => s + f.reduce((x, y) => x + y.paradasDia, 0), 0));
  const totParNoche = n2(empresas.reduce((s, [, f]) => s + f.reduce((x, y) => x + y.paradasNoche, 0), 0));

  // TOTAL DE JORNADA = solo el total de horas ACTIVAS (trabajadas). NO se le restan las
  // paradas (pedido del cliente): antes daba negativo cuando las paradas en vivo eran
  // grandes. Las paradas se ven aparte en sus propias tarjetas.
  const totJornada = totTrab;
  // Tarjetas de TOTALES arriba: HRS DÍA · PARADAS DÍA · HRS NOCHE · PARADA NOCHE · JORNADA.
  const kpis = `
    <div class="kpis">
      <div class="kpi"><div class="k">Total hrs día</div><div class="v">${totDayH} H</div></div>
      <div class="kpi warn"><div class="k">Total hrs paradas día</div><div class="v">☀️ ${totParDay > 0 ? `-${totParDay}` : '0'} H</div></div>
      <div class="kpi"><div class="k">Total hrs noche</div><div class="v">${totNightH} H</div></div>
      <div class="kpi warn"><div class="k">Total hrs parada noche</div><div class="v">🌙 ${totParNight > 0 ? `-${totParNight}` : '0'} H</div></div>
      <div class="kpi ok"><div class="k">Total de jornada</div><div class="v">${totJornada} H</div></div>
    </div>
    <div class="kpi-note">Total de jornada = total de horas ACTIVAS (trabajadas). · ⏱️ Horas EN VIVO al momento de generar (las jornadas abiertas siguen sumando).</div>`;

  const extraCss = `
    h3{margin:16px 0 3px;font-size:13px;color:#1E3A5F;padding-bottom:3px;border-bottom:2px solid #1E3A5F}
    table.ir{width:100%;border-collapse:collapse;margin:4px 0 12px;font-size:11px}
    table.ir th,table.ir td{border:1px solid #ccc;padding:5px 7px;text-align:left;vertical-align:top}
    table.ir th{background:#1E3A5F;color:#fff}
    td.r,th.r{text-align:right} td.b{font-weight:800}
    td.par{color:#B42318;font-weight:700}
    table.ir tr.inact td.par{color:#B42318}
    table.ir tr.inact td{color:#9CA3AF;background:#F9FAFB;font-style:italic}
    .kpis{display:flex;flex-wrap:wrap;gap:8px;margin:6px 0 4px}
    .kpi{flex:1;min-width:120px;border:1px solid #E5E7EB;border-radius:10px;padding:9px 12px;background:#F8FAFC}
    .kpi .k{font-size:9px;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:0.4px}
    .kpi .v{font-size:20px;font-weight:800;color:#1E3A5F;margin-top:2px}
    .kpi.warn{background:#FEF3F2;border-color:#FECDCA} .kpi.warn .v{color:#B42318}
    .kpi.ok{background:#ECFDF3;border-color:#ABEFC6} .kpi.ok .v{color:#067647}
    .kpi-note{font-size:10px;color:#6B7280;margin:0 0 12px}
  `;

  const subtitle = `${fecha} · ${empresas.length} empresa(s) · ${totMach} máquina(s) · 🏁 ${totTrab} h trabajadas · 🟡 ${totParDia} h paradas día · 🌙 ${totParNoche} h paradas noche`;

  const html = pdfDocument({
    title: 'REPORTE DEL DÍA POR EMPRESA',
    subtitle,
    body: empresas.length ? (kpis + secciones) : '<p>Sin actividad para las empresas elegidas en este día.</p>',
    extraCss,
  });
  return await exportPdf(html, `Reporte del dia por empresa ${fecha}`);
}
