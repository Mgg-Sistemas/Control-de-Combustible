import { supabase, selectAllRows } from './supabase';
import { pdfDocument, exportPdf } from './pdf';
import { cmpText } from './text';
import { sectorOf, sectorLabel } from './mapZones';
import { edificioLabel } from './edificios';
import { listInspectorAssignments, sinInspectorReal } from './machineInspectors';
import { isoYesterday } from './caracasDay';
// MISMA clasificación (avería/parada/iniciada/pendiente) que usa la pantalla en
// vivo (InspectionsSummary.tsx) — antes este PDF tenía su propio cálculo paralelo
// (roundByMachine + avApplies/parApplies) que se desincronizaba con cada ajuste
// de reglas de negocio (bug reportado por el cliente 09-ago-2026: mismo día/
// turno, % de eficiencia y "asignadas" distintos entre pantalla y PDF).
import { buildDaySets, computeMachineVisibilitySets, type DaySetRound, type DaySetMaint, type DaySets } from './inspectorDaySets';

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

  // Lecturas del día en PARALELO (todas dependen solo de `date`) — una sola espera de
  // red en vez de 4 encadenadas. Ventana de avería/parada hasta las 07:00 del día
  // SIGUIENTE (el turno noche cruza medianoche) — igual criterio que buildDaySets.
  const nightEndBound = `${addDaysISO(date, 1)}T07:00:00-04:00`;
  const roundsSelect = 'machinery_id, day_hours, night_hours, jornada_start_at, jornada_shift, declared_day, declared_night';
  const [{ data: rs }, { data: rsAyer }, mr, { rows: assignsAll }] = await Promise.all([
    // 1) Rondas (jornadas) del día — para clasificar iniciada/cerrada/avería/parada por
    //    turno con `buildDaySets` (mismo cálculo que InspectionsSummary.tsx).
    supabase.from('machine_rounds').select(roundsSelect).eq('round_date', date),
    // Jornada de NOCHE que arrancó ANOCHE y sigue abierta: su `round_date` es el de AYER
    // (el día en que inició). Sin este fallback, generar el reporte bien temprano (antes
    // del auto-cierre de las 7am) dejaba la máquina "⏳ sin iniciar" en vez de "🟢 iniciada".
    supabase.from('machine_rounds').select(roundsSelect).eq('round_date', isoYesterday(date)).eq('jornada_shift', 'night').not('jornada_start_at', 'is', null),
    // 2) Averías/paradas PENDIENTES vigentes (arrastradas) + RESUELTAS ese día. Para HOY el
    //    borde es futuro → solo pendientes. Igual que InspectionsSummary. selectAllRows
    //    (pagina): con >1000 pendientes la consulta cruda se truncaba, perdiendo las más viejas.
    selectAllRows('maintenance_requests', 'machinery_id, material, notes, created_at, resolved_at', (q) => q.or(`status.eq.pendiente,resolved_at.gte.${nightEndBound}`).lte('created_at', nightEndBound)),
    // 3) Asignaciones (CHECK) inspector ↔ máquina — la columna vertebral (AMBOS turnos).
    listInspectorAssignments(),
  ]);
  // `buildDaySets` filtra por `round_date === selDay`: se remapean las filas de
  // "anoche" a `date` (representan la jornada de noche de ESTE día de negocio,
  // solo que su fila de calendario quedó fechada ayer) — solo para máquinas que
  // NO tengan ya una fila propia de `date` (si la tienen, esa es la vigente).
  const roundsForDaySets: DaySetRound[] = [];
  const seenToday = new Set<string>();
  ((rs ?? []) as any[]).forEach((r) => {
    if (seenToday.has(r.machinery_id)) return; // 1 ronda por máquina/día
    seenToday.add(r.machinery_id);
    roundsForDaySets.push({ machinery_id: r.machinery_id, round_date: date, day_hours: r.day_hours, night_hours: r.night_hours, jornada_shift: r.jornada_shift, jornada_start_at: r.jornada_start_at, declared_day: r.declared_day, declared_night: r.declared_night });
  });
  ((rsAyer ?? []) as any[]).forEach((r) => {
    if (seenToday.has(r.machinery_id)) return;
    seenToday.add(r.machinery_id);
    roundsForDaySets.push({ machinery_id: r.machinery_id, round_date: date, day_hours: r.day_hours, night_hours: r.night_hours, jornada_shift: r.jornada_shift, jornada_start_at: r.jornada_start_at, declared_day: r.declared_day, declared_night: r.declared_night });
  });

  // selectAllRows pagina por id (no por fecha) — se reordena acá por created_at DESC,
  // que es lo que asume `averiaByMachine` de abajo (la primera fila por máquina = la más reciente).
  (mr as any[]).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  const maintForDaySets: DaySetMaint[] = ((mr ?? []) as any[]).map((m) => ({ machinery_id: m.machinery_id, material: m.material, created_at: m.created_at }));
  // MOTIVO de la avería (texto libre) por máquina — la más reciente (viene
  // ordenado desc). Independiente de la clasificación avería/parada/iniciada
  // (ver `daySetsByShift` abajo): solo se usa cuando esa clasificación ya dice
  // que la fila es "averiada", para no mostrar un motivo contradictorio.
  const averiaByMachine = new Map<string, { motivo: string }>();
  ((mr ?? []) as any[]).forEach((m) => {
    if (m.material === 'MÁQUINA PARADA' || averiaByMachine.has(m.machinery_id)) return;
    const notes = (m.notes && String(m.notes).trim()) || '';
    averiaByMachine.set(m.machinery_id, { motivo: notes || (m.material ? String(m.material) : 'Avería') });
  });

  // `assignsAll` (AMBOS turnos, traído arriba) se le pasa completo a `buildDaySets` (la
  // regla "SIEMPRE ACTIVO" no filtra por turno, igual que en la pantalla); `assigns`
  // (filtrado si se pidió un turno) es lo que efectivamente se imprime.
  const assigns = shift ? assignsAll.filter((a) => a.shift === shift) : assignsAll;

  // 4) Modelo/tipo de máquina + flags de catálogo (active/operational/en_espera,
  //    para la MISMA visibilidad dura/blanda que la pantalla — ver
  //    computeMachineVisibilitySets). No viene en listInspectorAssignments: 1 sola consulta.
  const ids = Array.from(new Set(assigns.map((a) => a.machinery_id)));
  const extraById = new Map<string, { tipo: string | null; clasificacion: string | null }>();
  const machFlags: { id: string; active: boolean | null; operational: boolean | null; en_espera: boolean | null }[] = [];
  if (ids.length) {
    const { data: ms } = await supabase.from('machinery').select('id, tipo, clasificacion, active, operational, en_espera').in('id', ids);
    ((ms ?? []) as any[]).forEach((m) => {
      extraById.set(m.id as string, { tipo: m.tipo ?? null, clasificacion: m.clasificacion ?? null });
      machFlags.push({ id: m.id, active: m.active, operational: m.operational, en_espera: m.en_espera });
    });
  }
  const { machInactiveSet, machHardInactiveSet } = computeMachineVisibilitySets(machFlags);

  // 5) Clasificación (avería/parada/iniciada/pendiente) por turno — MISMA función
  //    (`buildDaySets`) y MISMOS criterios que las tarjetas/gráfica de
  //    InspectionsSummary.tsx: avería > parada > iniciada > pendiente, reactivación
  //    tras avería/parada, ventana del turno noche cruzando medianoche, "SIEMPRE
  //    ACTIVO" y visibilidad dura/blanda. Solo se calcula para el/los turno(s) que
  //    de verdad se van a imprimir (`assigns`).
  const shiftsNeeded: Array<'day' | 'night'> = shift ? [shift] : ['day', 'night'];
  const daySetsByShift: Partial<Record<'day' | 'night', DaySets>> = {};
  shiftsNeeded.forEach((sh) => {
    daySetsByShift[sh] = buildDaySets({
      rounds: roundsForDaySets, maint: maintForDaySets, assignments: assignsAll,
      selDay: date, shiftArg: sh, machInactiveSet, machHardInactiveSet,
    });
  });

  const byKey = new Map<string, Row>();
  assigns.forEach((a) => {
    const k = `${a.inspector_name || '—'}|${a.machinery_id}`;
    if (byKey.has(k)) return;
    const shiftCtx: 'day' | 'night' = a.shift === 'night' ? 'night' : 'day';
    const ds = daySetsByShift[shiftCtx]!;
    // MISMA visibilidad que la pantalla (`visibleOk` en buildDaySets): las
    // "duras" (operational=false/active=false) nunca cuentan; las "en espera"
    // solo si NO tienen una jornada abierta ahora mismo (ds.anyOpenSet).
    const visible = !machHardInactiveSet.has(a.machinery_id) && (!machInactiveSet.has(a.machinery_id) || ds.anyOpenSet.has(a.machinery_id));
    if (!visible) return;
    const averiada = ds.averSet.has(a.machinery_id);
    const parada = !averiada && ds.paradaSet.has(a.machinery_id);
    const enCurso = !averiada && !parada && ds.startedSet.has(a.machinery_id);
    const pendiente = !averiada && !parada && !enCurso;
    const finalizada = false; // no se separa en curso/finalizada; ambas = iniciada
    const motivo = averiada ? (averiaByMachine.get(a.machinery_id)?.motivo || '') : '';
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
      <th style="width:24px">Nº</th><th>Máquina</th><th>Edificio</th><th>Marca-Modelo / Clasif.</th>
      <th>Serial/Placa</th><th>Sector</th><th>Empresa</th>
    </tr></thead><tbody>${rows}</tbody></table>`;
  };

  // Tabla de máquinas AVERIADAS del inspector, indicando el MOTIVO de la avería.
  const tableAveriadas = (list: Row[]): string => {
    const rows = list.slice().sort((a, b) => cmpText(a.code, b.code)).map((r, i) =>
      `<tr>
        <td>${i + 1}</td><td><b>${esc(r.code)}</b></td><td>${esc(r.tipo)}</td><td>${esc(r.motivo || 'Avería')}</td>
        <td>${esc(psTxt(r.plate, r.serial))}</td><td>${esc(r.edificio)}</td><td>${esc(r.companyName)}</td>
      </tr>`).join('');
    return `<table class="ir"><thead><tr>
      <th style="width:24px">Nº</th><th>Máquina</th><th>Marca/Modelo</th><th>Motivo de la avería</th>
      <th>Serial/Placa</th><th>Edificio</th><th>Empresa</th>
    </tr></thead><tbody>${rows}</tbody></table>`;
  };

  // Color según el % de eficiencia: verde 100%, ámbar 50-99%, rojo <50%.
  const efiColor = (e: number): string => (e >= 100 ? '#1E9E4A' : e >= 50 ? '#D9A200' : '#D22B2B');

  // El usuario de sistema "inspector máquinas faltantes"/SOS LA GUAIRA (cubre
  // automáticamente máquinas sin inspector humano) no tiene un % de eficiencia
  // real — cuenta como inspector válido (no está "sin asignar"), pero un %
  // de eficiencia no tiene sentido para él. Misma regla que ya usa la pantalla
  // en vivo (src/lib/machineInspectors.ts `sinInspectorReal`, importada arriba).
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
    const esVirtual = sinInspectorReal(name);
    const eficiencia = !esVirtual && list.length > 0 ? Math.round((chequeadas / list.length) * 100) : null;
    return { name, list, iniciadas, averiadas, paradas, pendientes, chequeadas, eficiencia, esVirtual };
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
    <p class="sum">Eficiencia = % de máquinas asignadas sobre las que el inspector YA ACTUÓ (iniciada, cerrada, parada o avería cuentan como hecha). Solo las que quedaron sin chequear (pendientes) bajan el %.</p>
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
