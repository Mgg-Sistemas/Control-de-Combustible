import { supabase } from './supabase';
import { pdfDocument, exportPdf } from './pdf';
import { cmpText } from './text';
import { sectorOf, sectorLabel } from './mapZones';
import { edificioLabel } from './edificios';
import { listInspectorAssignments, inspectorSiempreActivo } from './machineInspectors';
import { isoYesterday, shiftElapsedHours } from './caracasDay';

/**
 * Reporte RESUMEN POR INSPECTOR (PDF), para un día.
 *
 * Por cada inspector (según sus máquinas ASIGNADAS en `machine_inspectors`, el
 * mismo CHECK del teléfono), resume:
 *  - Cuántas máquinas iniciaron jornada (en curso o finalizada).
 *  - Cuántas están averiadas/paradas (avería pendiente vigente ese turno).
 *  - Cuántas le faltaron por iniciar — y de ESAS, el detalle disponible:
 *    edificio, modelo/tipo, serial/placa, sector, referencia y empresa.
 *
 * El ESTADO de cada máquina se resuelve POR TURNO (día/noche) del inspector,
 * igual que la agrupación "Jornadas de máquina (inspector)" de SupervisionScreen
 * (una parada o jornada abierta en OTRO turno no cuenta para este inspector).
 */

const esc = (v: any) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const dmy = (iso: string) => { const [y, m, d] = (iso || '').split('-'); return y && m && d ? `${d}/${m}/${y}` : iso; };
/** Día ISO (AAAA-MM-DD) + n días (n puede ser negativo). */
const addDaysISO = (iso: string, n: number): string => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

const CARACAS_TZ = 'America/Caracas';
/** Hora (0-23) en Caracas de un instante ISO. */
function caracasHourOf(iso: string): number {
  try { return parseInt(new Intl.DateTimeFormat('en-GB', { timeZone: CARACAS_TZ, hour: '2-digit', hour12: false }).format(new Date(iso)), 10) || 0; } catch { return 0; }
}
/** Turno (day/night) al que pertenece una parada según la hora Caracas en que se marcó. */
const paradaShiftOf = (iso: string): 'day' | 'night' => { const h = caracasHourOf(iso); return h >= 7 && h < 19 ? 'day' : 'night'; };

/** Sector legible: geográfico (GPS) si hay; si no, el campo SECTOR manual; si no, '—'. */
function sectorTxt(lat: number | null, lng: number | null, sectorManual: string | null): string {
  const s = sectorLabel(sectorOf(lat, lng));
  if (s && s !== 'Sin zona') return s;
  const m = (sectorManual ?? '').trim();
  return m || '—';
}
/** Referencia libre, descartando valores que sean solo números/coordenadas. */
function referenciaTxt(ref: string | null | undefined): string {
  const t = (ref ?? '').trim();
  return t && !/^[\d.,\s-]+$/.test(t) ? t : '—';
}
/** EDIFICIO unificado (canónico del catálogo, o el texto crudo si no coincide; '—' si vacío). */
const edificioOf = (ref: string | null | undefined): string => edificioLabel(ref);
/** Placa o, en su defecto, serial de la máquina. */
const psTxt = (plate: string | null, serial: string | null): string => plate || serial || '—';

type Row = {
  machinery_id: string; inspector: string; code: string; companyName: string;
  serial: string | null; plate: string | null; sector: string; referencia: string; edificio: string;
  tipo: string; clasificacion: string;
  enCurso: boolean; parada: boolean; pendiente: boolean; finalizada: boolean; averiada: boolean; motivo: string;
  horas: number; // horas REALES trabajadas por esta máquina en el turno (0 si parada/avería/pendiente) — base de la eficiencia
  shiftCtx: 'day' | 'night'; // turno de ESTA fila (el reporte puede incluir ambos si no se filtró uno) — para el denominador de eficiencia
};

/**
 * Genera y exporta el PDF del reporte resumen por inspector para un día.
 * @param date día ISO "AAAA-MM-DD".
 * @param shift turno a incluir ('day' | 'night'). Antes el reporte no filtraba
 *   por turno y mezclaba las asignaciones de DÍA y de NOCHE en un solo reporte
 *   (ej. al pedir el reporte con el switch en ☀️ DÍA, igual traía inspectores/
 *   máquinas del turno 🌙 NOCHE) — ahora respeta el turno que esté elegido en
 *   el dashboard, igual que el resto del panel. Si no se pasa, incluye AMBOS
 *   turnos (comportamiento explícito, no el default implícito de antes).
 * @returns true si el usuario confirmó (imprimió/guardó), false si canceló.
 */
export async function generateSummaryReport(opts: { date: string; shift?: 'day' | 'night' }): Promise<boolean> {
  const { date, shift } = opts;
  const fecha = dmy(date);

  // 1) Rondas (jornadas) del día — estado por máquina (en curso / finalizada / turno).
  const { data: rs } = await supabase
    .from('machine_rounds')
    .select('machinery_id, day_hours, night_hours, jornada_start_at, jornada_shift')
    .eq('round_date', date);
  // Jornada de NOCHE que arrancó ANOCHE y sigue abierta: su `round_date` es el de
  // AYER (el día en que inició), no el de `date` — sin este fallback, generar este
  // reporte bien temprano (antes del auto-cierre de las 7am) no encontraba la ronda
  // y la máquina salía "⏳ sin iniciar" en vez de "🟢 iniciada" (ver `openForShift`
  // más abajo). Mismo criterio que ya usa `computeInspectorData` en inspectorReport.ts.
  const { data: rsAyer } = await supabase
    .from('machine_rounds')
    .select('machinery_id, day_hours, night_hours, jornada_start_at, jornada_shift')
    .eq('round_date', isoYesterday(date))
    .eq('jornada_shift', 'night')
    .not('jornada_start_at', 'is', null);
  const roundByMachine = new Map<string, { startAt: string | null; shift: 'day' | 'night' | null; dayH: number; nightH: number }>();
  ((rs ?? []) as any[]).forEach((r) => {
    if (roundByMachine.has(r.machinery_id)) return; // 1 ronda por máquina/día
    roundByMachine.set(r.machinery_id, {
      startAt: r.jornada_start_at ?? null,
      shift: (r.jornada_shift ?? null) as 'day' | 'night' | null,
      dayH: Number(r.day_hours) || 0,
      nightH: Number(r.night_hours) || 0,
    });
  });
  // Solo rellena con la ronda de "anoche" las máquinas que NO tengan ya una fila de
  // `date` (si la tienen, esa es la vigente).
  ((rsAyer ?? []) as any[]).forEach((r) => {
    if (roundByMachine.has(r.machinery_id)) return;
    roundByMachine.set(r.machinery_id, {
      startAt: r.jornada_start_at ?? null,
      shift: (r.jornada_shift ?? null) as 'day' | 'night' | null,
      dayH: Number(r.day_hours) || 0,
      nightH: Number(r.night_hours) || 0,
    });
  });

  // 2) Averías PENDIENTES vigentes hasta ese día (se arrastran de un día a otro,
  //    igual que en el teléfono, hasta que el inspector las reactive). Por TURNO.
  // La ventana llega hasta las 07:00 del día SIGUIENTE (no medianoche): el turno
  // noche va de 19:00 a 07:00+1, así que una avería/parada marcada a la 1am cae
  // dentro del turno noche de HOY — igual criterio que inspectorReport.ts
  // (`nightEndBound`); cortar en medianoche la dejaba fuera de la consulta.
  const nightEndBound = `${addDaysISO(date, 1)}T07:00:00-04:00`;
  const { data: mr } = await supabase
    .from('maintenance_requests')
    .select('machinery_id, material, notes, created_at')
    .eq('status', 'pendiente')
    .lte('created_at', nightEndBound)
    .order('created_at', { ascending: false });
  const dayStartMs = new Date(`${date}T00:00:00-04:00`).getTime();
  // Parada / avería pendiente por máquina (la más reciente; viene ordenado desc). Se
  // guarda el instante y el TURNO de la marca (por hora Caracas). REGLA por-turno: el
  // estado avería/parada pertenece al turno en que se marcó; el otro turno ve la máquina
  // como pendiente. `createdMs` distingue "marcada HOY" (gana sobre trabajando) de
  // "arrastrada" (pierde si la máquina trabajó ese turno).
  const paradaByMachine = new Map<string, { createdMs: number; shift: 'day' | 'night' }>();
  const averiaByMachine = new Map<string, { motivo: string; createdMs: number; shift: 'day' | 'night' }>();
  ((mr ?? []) as any[]).forEach((m) => {
    if (m.material === 'MÁQUINA PARADA') {
      if (!paradaByMachine.has(m.machinery_id)) paradaByMachine.set(m.machinery_id, { createdMs: new Date(m.created_at).getTime(), shift: paradaShiftOf(m.created_at) });
    } else if (!averiaByMachine.has(m.machinery_id)) {
      const notes = (m.notes && String(m.notes).trim()) || '';
      const motivo = notes || (m.material ? String(m.material) : 'Avería');
      averiaByMachine.set(m.machinery_id, { motivo, createdMs: new Date(m.created_at).getTime(), shift: paradaShiftOf(m.created_at) });
    }
  });

  // 3) Asignaciones (CHECK) inspector ↔ máquina: la columna vertebral — TODAS las
  //    máquinas de cada inspector, para saber cuáles le faltaron por iniciar.
  //    Filtradas por turno si se pidió uno concreto (ver comentario de `shift`
  //    arriba) — así el reporte de DÍA no arrastra inspectores/máquinas de NOCHE.
  const { rows: assignsAll } = await listInspectorAssignments();
  const assigns = shift ? assignsAll.filter((a) => a.shift === shift) : assignsAll;

  // 4) Modelo/tipo de máquina (no viene en listInspectorAssignments): 1 sola consulta.
  const ids = Array.from(new Set(assigns.map((a) => a.machinery_id)));
  const extraById = new Map<string, { tipo: string | null; clasificacion: string | null; active: boolean; operational: boolean; enEspera: boolean }>();
  if (ids.length) {
    const { data: ms } = await supabase.from('machinery').select('id, tipo, clasificacion, active, operational, en_espera').in('id', ids);
    ((ms ?? []) as any[]).forEach((m) => extraById.set(m.id as string, { tipo: m.tipo ?? null, clasificacion: m.clasificacion ?? null, active: m.active !== false, operational: m.operational !== false, enEspera: m.en_espera === true }));
  }

  // 5) Estado real por inspector + máquina — POR TURNO (regla confirmada 06-ago-2026:
  //    el estado avería/parada pertenece al turno de la HORA en que se marcó; el otro
  //    turno ve la máquina como pendiente). Prioridad, igual que el panel:
  //      1) avería de ESTE turno marcada HOY → averiada (gana sobre trabajando)
  //      2) parada de ESTE turno marcada HOY → parada
  //      3) trabajó ESTE turno (horas del turno o jornada abierta del turno) → iniciada
  //      4) avería de ESTE turno arrastrada → averiada (solo si no trabajó el turno)
  //      5) parada de ESTE turno arrastrada → parada
  //      6) resto → pendiente
  const byKey = new Map<string, Row>();
  assigns.forEach((a) => {
    const k = `${a.inspector_name || '—'}|${a.machinery_id}`;
    if (byKey.has(k)) return;
    const shiftCtx: 'day' | 'night' = a.shift === 'night' ? 'night' : 'day';
    const rd = roundByMachine.get(a.machinery_id);
    // INACTIVA del catálogo: máquina marcada NO OPERATIVA con "⛔ Inactiva" (operational=
    // false) o desactivada (active=false) — igual criterio que inspectorReport.ts
    // (inactiveIds), InspectionsSummary.tsx (machHardInactiveSet) y el teléfono
    // (visibleParaInspector): NUNCA cuenta acá, solo sale en el reporte por empresa y en
    // Control. `operational` solo lo cambia el botón del admin; la avería/parada de campo
    // (maintenance_requests) NO lo toca, así que una máquina averiada pero OPERATIVA sigue
    // contando con su estado real.
    const ex = extraById.get(a.machinery_id);
    const inactiva = ex ? !ex.active || !ex.operational || ex.enEspera : false;
    if (inactiva && !rd?.startAt) return;
    // Trabajó ESTE turno: horas del turno, o jornada abierta cuyo turno (por marca o hora
    // de inicio) es este turno.
    const hoursForShift = shiftCtx === 'night' ? (rd?.nightH ?? 0) : (rd?.dayH ?? 0);
    const openShift = rd?.shift ?? (rd?.startAt ? paradaShiftOf(rd.startAt) : null);
    const openForShift = !!rd?.startAt && openShift === shiftCtx;
    const worked = hoursForShift > 0 || openForShift;
    // Avería/parada SOLO si su turno de marca es este turno (por hora). Hoy gana sobre
    // trabajando; arrastrada solo si no trabajó el turno.
    const av = averiaByMachine.get(a.machinery_id);
    const par = paradaByMachine.get(a.machinery_id);
    // REGLA "SIEMPRE ACTIVO" (SOS LA GUAIRA): sus máquinas nunca cuentan avería/parada.
    const siempreActivo = inspectorSiempreActivo(a.inspector_name);
    const avApplies = !siempreActivo && !!av && av.shift === shiftCtx && (av.createdMs < dayStartMs ? !worked : true);
    const parApplies = !siempreActivo && !!par && par.shift === shiftCtx && (par.createdMs < dayStartMs ? !worked : true);
    let averiada = false, parada = false, enCurso = false, pendiente = false;
    if (avApplies) averiada = true;                // 1/4) avería de este turno
    else if (parApplies) parada = true;            // 2/5) parada de este turno
    else if (worked) enCurso = true;               // 3) trabajó este turno
    else pendiente = true;                          // 6) pendiente por iniciar
    const finalizada = false; // no se separa en curso/finalizada; ambas = iniciada
    const motivo = averiada && av ? av.motivo : '';
    const extra = extraById.get(a.machinery_id);
    byKey.set(k, {
      machinery_id: a.machinery_id,
      inspector: a.inspector_name || '—',
      code: a.code,
      companyName: a.companyName,
      serial: a.serial,
      plate: a.plate,
      sector: sectorTxt(a.latitude, a.longitude, a.sector),
      referencia: referenciaTxt(a.referencia),
      edificio: edificioOf(a.referencia),
      tipo: (extra?.tipo && String(extra.tipo).trim()) || '—',
      clasificacion: (extra?.clasificacion && String(extra.clasificacion).trim()) || '—',
      enCurso, parada, pendiente, finalizada, averiada, motivo,
      horas: Math.min(12, Math.max(0, hoursForShift)),
      shiftCtx,
    });
  });

  const all = Array.from(byKey.values());
  const byInspector = new Map<string, Row[]>();
  all.forEach((r) => { const k = r.inspector; if (!byInspector.has(k)) byInspector.set(k, []); byInspector.get(k)!.push(r); });
  const inspectores = Array.from(byInspector.entries()).sort((a, b) => cmpText(a[0], b[0]));

  // ── HTML ────────────────────────────────────────────────────────────────────
  const tablePendientes = (list: Row[]): string => {
    const rows = list.slice().sort((a, b) => cmpText(a.code, b.code)).map((r, i) => {
      const modelo = r.tipo !== '—' || r.clasificacion !== '—'
        ? [r.tipo !== '—' ? r.tipo : null, r.clasificacion !== '—' ? r.clasificacion : null].filter(Boolean).join(' / ')
        : '—';
      return `<tr>
        <td>${i + 1}</td><td><b>${esc(r.code)}</b></td><td>${esc(r.edificio)}</td>
        <td>${esc(modelo)}</td><td>${esc(psTxt(r.plate, r.serial))}</td>
        <td>${esc(r.sector)}</td><td>${esc(r.companyName)}</td>
      </tr>`;
    }).join('');
    return `<table class="ir"><thead><tr>
      <th style="width:24px">Nº</th><th>Máquina</th><th>Edificio</th><th>Modelo/Tipo</th>
      <th>Serial/Placa</th><th>Sector</th><th>Empresa</th>
    </tr></thead><tbody>${rows}</tbody></table>`;
  };

  // Tabla de máquinas AVERIADAS del inspector, indicando el MOTIVO de la avería.
  const tableAveriadas = (list: Row[]): string => {
    const rows = list.slice().sort((a, b) => cmpText(a.code, b.code)).map((r, i) =>
      `<tr>
        <td>${i + 1}</td><td><b>${esc(r.code)}</b></td><td>${esc(r.motivo || 'Avería')}</td>
        <td>${esc(psTxt(r.plate, r.serial))}</td><td>${esc(r.edificio)}</td><td>${esc(r.companyName)}</td>
      </tr>`).join('');
    return `<table class="ir"><thead><tr>
      <th style="width:24px">Nº</th><th>Máquina</th><th>Motivo de la avería</th>
      <th>Serial/Placa</th><th>Edificio</th><th>Empresa</th>
    </tr></thead><tbody>${rows}</tbody></table>`;
  };

  // Color según el % de eficiencia: verde 100%, ámbar 50-99%, rojo <50%.
  const efiColor = (e: number): string => (e >= 100 ? '#1E9E4A' : e >= 50 ? '#D9A200' : '#D22B2B');

  // El usuario de sistema "inspector máquinas faltantes"/SOS LA GUAIRA (cubre
  // automáticamente máquinas sin inspector humano) no tiene un % de eficiencia
  // real — cuenta como inspector válido (no está "sin asignar"), pero un %
  // de eficiencia no tiene sentido para él. Misma regla que ya usa la pantalla
  // en vivo (InspectionsSummary.tsx `sinInspectorReal`) — antes este PDF no la
  // aplicaba y mostraba un % contradictorio con lo que se ve en pantalla.
  const sinInspReal = (nm: string) => !nm || /faltant/i.test(nm);
  // EFICIENCIA (versión final, pedido cliente 09-ago-2026): % de máquinas asignadas
  // sobre las que el inspector YA ACTUÓ. Cuentan como hechas iniciadas, cerradas,
  // PARADAS y AVERIADAS (marcarlas también es su trabajo); SOLO las PENDIENTES (sin
  // tocar) bajan el %. NO depende de horas ni del reloj → cerrar una jornada o marcar
  // parada/avería NUNCA baja el indicador. Misma fórmula que la pantalla (InspectionsSummary).
  const inspectoresConEficiencia = inspectores.map(([name, list]) => {
    const iniciadas = list.filter((r) => r.enCurso || r.finalizada).length;
    const averiadas = list.filter((r) => r.averiada);
    const paradas = list.filter((r) => r.parada).length;
    const pendientes = list.filter((r) => r.pendiente);
    const chequeadas = list.length - pendientes.length;
    const esVirtual = sinInspReal(name);
    const horasTrabajadas = list.reduce((s, r) => s + r.horas, 0);
    const horasEsperadas = list.reduce((s, r) => s + shiftElapsedHours(date, r.shiftCtx), 0);
    const eficiencia = !esVirtual && list.length > 0 ? Math.round((chequeadas / list.length) * 100) : null;
    return { name, list, iniciadas, averiadas, paradas, pendientes, chequeadas, horasTrabajadas, horasEsperadas, eficiencia, esVirtual };
  });

  const secciones = inspectoresConEficiencia.map(({ name, list, iniciadas, averiadas, paradas, pendientes, eficiencia }) => {
    const efiTxt = eficiencia === null ? '—' : `${eficiencia}%`;
    const efiColorTxt = eficiencia === null ? '#6B7280' : efiColor(eficiencia);
    const resumen = `<p class="sum">
      <b>${list.length}</b> máquina(s) asignada(s) ·
      <b style="color:#1E9E4A">🟢 ${iniciadas} iniciada(s)</b> ·
      <b style="color:#D22B2B">🔧 ${averiadas.length} averiada(s)</b> ·
      <b style="color:#D9A200">🟡 ${paradas} parada(s)</b> ·
      <b style="color:#D9A200">⏳ ${pendientes.length} sin iniciar</b> ·
      <b style="color:${efiColorTxt}">⚡ Eficiencia: ${efiTxt}</b>
    </p>`;
    const detAver = averiadas.length ? `<h4>🔧 Máquinas averiadas · motivo</h4>${tableAveriadas(averiadas)}` : '';
    const detPend = pendientes.length
      ? `<h4>⏳ Máquinas que faltaron por iniciar jornada</h4>${tablePendientes(pendientes)}`
      : (averiadas.length ? '' : `<p class="ok">✓ Todas sus máquinas asignadas iniciaron jornada.</p>`);
    return `<h3>👮 ${esc(name)} · ${list.length} máquina(s)</h3>${resumen}${detAver}${detPend}`;
  }).join('');

  // Tabla-resumen de eficiencia por inspector, ordenada de menor a mayor eficiencia
  // (los más bajos primero, para que el jefe los identifique de un vistazo). El
  // usuario de sistema (esVirtual) queda FUERA de este ranking — no compite con
  // inspectores reales, igual que en la pantalla en vivo.
  const efiRankeados = inspectoresConEficiencia.filter((e) => !e.esVirtual).slice().sort((a, b) => (a.eficiencia ?? -1) - (b.eficiencia ?? -1));
  const filasEficiencia = efiRankeados.map(({ name, list, chequeadas, pendientes, eficiencia }, i) => {
    const efiTxt = eficiencia === null ? '—' : `${eficiencia}%`;
    const efiColorTxt = eficiencia === null ? '#6B7280' : efiColor(eficiencia);
    return `<tr>
      <td>${i + 1}</td><td><b>${esc(name)}</b></td><td>${list.length}</td><td>${chequeadas}</td>
      <td>${pendientes.length}</td>
      <td style="background:${efiColorTxt};color:#fff;font-weight:700;text-align:center">${efiTxt}</td>
    </tr>`;
  }).join('');
  const tablaEficiencia = `
    <h3>⚡ Eficiencia por inspector</h3>
    <p class="sum">Eficiencia = horas realmente trabajadas ÷ horas de turno esperadas de sus máquinas asignadas (12 h cada una). Las paradas y averías restan horas trabajadas, igual que las máquinas sin iniciar jornada.</p>
    <table class="efi"><thead><tr>
      <th style="width:24px">Nº</th><th>Inspector</th><th>Asignadas</th><th>Chequeadas</th><th>Sin chequear</th><th>Eficiencia</th>
    </tr></thead><tbody>${filasEficiencia || '<tr><td colspan="6">Sin inspectores para este día.</td></tr>'}</tbody></table>
  `;

  const totalIni = all.filter((r) => r.enCurso || r.finalizada).length;
  const totalAver = all.filter((r) => r.averiada).length;
  const totalPar = all.filter((r) => r.parada).length;
  const totalPend = all.filter((r) => r.pendiente).length;
  const eficienciasValidas = inspectoresConEficiencia.map((e) => e.eficiencia).filter((e): e is number => e !== null);
  const eficienciaProm = eficienciasValidas.length ? Math.round(eficienciasValidas.reduce((a, b) => a + b, 0) / eficienciasValidas.length) : null;

  const extraCss = `
    h3{margin:18px 0 2px;font-size:14px;color:#1E3A5F;padding-bottom:4px;border-bottom:2px solid #1E3A5F}
    h4{margin:8px 0 2px;font-size:12px;color:#B45309}
    p.sum{margin:0 0 6px;font-size:11.5px;color:#333}
    p.ok{color:#1E9E4A;font-weight:700;font-size:12px;margin:4px 0 10px}
    p.none{color:#6B7280;font-size:12px}
    table.ir{width:100%;border-collapse:collapse;margin:4px 0 12px;font-size:11px}
    table.ir th,table.ir td{border:1px solid #ccc;padding:5px 7px;text-align:left;vertical-align:top}
    table.ir th{background:#1E3A5F;color:#fff}
    table.efi{width:100%;border-collapse:collapse;margin:4px 0 16px;font-size:11px}
    table.efi th,table.efi td{border:1px solid #ccc;padding:5px 7px;text-align:left;vertical-align:top}
    table.efi th{background:#1E3A5F;color:#fff}
  `;

  const turnoTxt = shift === 'night' ? ' · Turno 🌙 NOCHE' : shift === 'day' ? ' · Turno ☀️ DÍA' : '';
  const subtitle = `${fecha}${turnoTxt} · ${inspectores.length} inspector(es) · ${all.length} máquina(s) asignada(s) · 🟢 ${totalIni} iniciadas · 🔧 ${totalAver} averiadas · 🟡 ${totalPar} paradas · ⏳ ${totalPend} sin iniciar${eficienciaProm !== null ? ` · ⚡ eficiencia promedio ${eficienciaProm}%` : ''}`;

  const html = pdfDocument({
    title: 'REPORTE RESUMEN POR INSPECTOR',
    subtitle,
    body: inspectores.length ? (tablaEficiencia + secciones) : '<p class="none">Sin asignaciones para este día.</p>',
    extraCss,
  });
  return await exportPdf(html, `Reporte - Resumen por inspector ${fecha}`);
}
