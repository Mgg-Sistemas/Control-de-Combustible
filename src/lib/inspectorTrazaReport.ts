import { supabase, selectAllRows } from './supabase';
import { pdfDocument, exportPdf } from './pdf';
import { cmpText } from './text';
import { sectorOf, sectorLabel } from './mapZones';
import { horasTurnoDelDia, type RondaHoras } from './hours';
import { paradaShiftOf } from './inspectorDaySets';

/**
 * Reporte "RECORRIDO DEL INSPECTOR" (PDF). Reconstruye la SECUENCIA HORARIA de las
 * revisiones (check-ins) que hizo cada inspector durante un día: a qué hora revisó
 * cada máquina, en qué sector/ubicación estaba, en qué estado la encontró
 * (trabajando / parada / no está), si estaba CERCA del equipo (distancia GPS) y —
 * desde 17-ago-2026 — las HORAS DE SU JORNADA más QUIÉN INICIÓ la jornada.
 *
 * Fuente del recorrido: `supervisor_visits` (un registro por check-in). Se filtra por
 * `visit_date` y, opcionalmente, por los inspectores elegidos. Las filas se ordenan por
 * `visited_at` ascendente para leer el recorrido en orden cronológico. El sector se
 * deriva del GPS del inspector (sectorLabel(sectorOf(lat,lng))); si no cae en zona,
 * cae a la referencia de la máquina.
 *
 * POR QUÉ LAS HORAS VAN AQUÍ (pedido del cliente 17-ago-2026): este reporte agrupa por
 * `supervisor_visits.supervisor_name`, que es QUIÉN HIZO EL CHECK-IN DE VERDAD,
 * congelado en el momento de la visita. El Histórico de Jornadas atribuye por la
 * asignación ACTUAL (`machine_inspectors`), así que reescribe el pasado cuando se
 * reasignan máquinas; este documento es históricamente fiel.
 *
 * Fuente de las horas: `machine_rounds` del mismo `round_date`, calculadas con
 * `horasTurnoDelDia` (src/lib/hours.ts) — la FÓRMULA ÚNICA del sistema. NO se
 * reimplementa nada acá: el proyecto ya tuvo un incidente grave por tener 13 fórmulas
 * de horas distintas en 8 archivos (un inspector veía 137,38 h en el teléfono y
 * 35,38 h en la web).
 *
 * ⚠️ DOS REGLAS DE ORO DE LOS TOTALES (las dos son de PAGO, no de estética):
 *
 * 1. SOLO EL TURNO QUE CUBRIÓ. Una máquina puede trabajar los DOS turnos el mismo día
 *    (el 16-ago-2026: 102 de 173 máquinas). Al inspector le tocan ÚNICAMENTE las horas
 *    del turno en que la revisó — el turno sale de la HORA de su check-in
 *    (`paradaShiftOf`). Sumarle el día completo sería acreditarle el trabajo del
 *    inspector del otro turno. Las columnas "Máquina día/noche" quedan a la vista como
 *    contexto, pero el total del inspector NO es su suma.
 *
 * 2. NADA SE CUENTA DOS VECES. Las filas son POR VISITA (una máquina puede revisarse
 *    varias veces), pero las horas son POR MÁQUINA Y TURNO. `totalesDe` deduplica por
 *    el par (máquina, turno) antes de sumar; sumar fila por fila multiplicaría las
 *    horas por la cantidad de revisiones.
 */

const esc = (v: any) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const dmy = (iso: string) => { const [y, m, d] = (iso || '').split('-'); return y && m && d ? `${d}/${m}/${y}` : iso; };
/** Horas con 2 decimales, mismo formato numérico que el resto de los PDFs de horas. */
const h2 = (n: number) => (Number(n) || 0).toFixed(2);
/** Hora (Caracas) "HH:MM am/pm" de un instante ISO, o '—'. */
const horaCaracas = (iso: string | null): string => {
  if (!iso) return '—';
  try { return new Intl.DateTimeFormat('es-VE', { timeZone: 'America/Caracas', hour: '2-digit', minute: '2-digit', hour12: true }).format(new Date(iso)); } catch { return '—'; }
};

const estadoTxt = (s: any): string => {
  const v = String(s ?? '').trim();
  if (v === 'trabajando') return '🟢 Trabajando';
  if (v === 'parada') return '🟡 Parada';
  if (v === 'no_esta') return '🔴 No está';
  return v || '—';
};

/**
 * MARCA / MODELO reales del catálogo. Antes esta celda renderizaba `machine.tipo` bajo
 * el encabezado "Marca/Modelo" — `tipo` es el marca-modelo COMBINADO histórico, no la
 * marca. Ahora se muestran las columnas propias `marca` y `modelo` (las mismas que usa
 * el reporte de Catálogo) y solo se cae a `tipo` cuando la máquina es vieja y todavía
 * no tiene los campos separados llenos.
 */
const marcaModeloTxt = (m: any): string => {
  const partes = [m?.marca, m?.modelo].map((x) => String(x ?? '').trim()).filter(Boolean);
  if (partes.length) return partes.join(' ');
  const t = String(m?.tipo ?? '').trim();
  return t || '—';
};

/** Sector según GPS del inspector; si no hay zona, cae a la referencia de la máquina. */
const ubicacionTxt = (lat: any, lng: any, machine: any): string => {
  const lbl = sectorLabel(sectorOf(lat, lng));
  if (lbl && lbl !== 'Sin zona') return lbl;
  return (machine?.referencia && String(machine.referencia).trim()) || '—';
};

/** "✓ (47 m)" si está cerca, "120 m" si no; '—' si no hay distancia. */
const cercaTxt = (near: any, distanceM: any): string => {
  if (distanceM == null) return '—';
  const m = Math.round(Number(distanceM));
  return near ? `✓ (${m} m)` : `${m} m`;
};

/** Fila de `machine_rounds` tal como la lee este reporte (horas + traza de quién inició). */
type RondaDia = RondaHoras & {
  machinery_id: string;
  jornada_marked_by?: string | null;
  status?: string | null;
};

/** Horas del día de UNA máquina, calculadas UNA SOLA VEZ (nunca por visita). */
type HorasDia = { dia: number; noche: number; trabajadas: number; iniPor: string; parada: boolean };

/**
 * Totales de un grupo de visitas, con cada par (máquina, turno) contado UNA SOLA VEZ.
 * `suyas` es LO QUE LE TOCA AL INSPECTOR: solo las horas del turno en que revisó.
 * `dia` / `noche` son el contexto de sus máquinas (el día completo), que sirve para
 * ver de dónde sale la diferencia, pero NO es lo que esa persona trabajó.
 */
type Totales = { maquinas: number; conRonda: number; dia: number; noche: number; suyas: number };

/**
 * Turno al que pertenece una VISITA, por la hora en que se hizo (Caracas): día
 * 7am–7pm, noche el resto. Se reusa `paradaShiftOf`, el mismo criterio que ya usa
 * la clasificación de estados (y que su suite de tests cubre) — no se inventa uno
 * nuevo, que es como este sistema terminó con 13 fórmulas de horas distintas.
 *
 * POR QUÉ IMPORTA: una máquina puede trabajar los DOS turnos el mismo día (el
 * 16-ago-2026 le pasó a 102 de 173 máquinas). Si al inspector de día se le suman
 * también las horas de la noche, se le acredita el trabajo del inspector de noche
 * — y estas horas son la base del pago.
 */
const turnoDeVisita = (visitedAt: string | null): 'day' | 'night' =>
  visitedAt ? paradaShiftOf(visitedAt) : 'day';

/** Horas que le corresponden al inspector por esa máquina, según el turno que cubrió. */
const horasDelTurno = (hm: HorasDia | undefined, turno: 'day' | 'night'): number =>
  !hm ? 0 : (turno === 'night' ? hm.noche : hm.dia);

/**
 * Genera y exporta el PDF del recorrido del inspector.
 * @param date día ISO "AAAA-MM-DD".
 * @param inspectors nombres de inspectores a incluir (opcional; vacío = todos).
 * @returns true si el usuario confirmó (imprimió/guardó), false si canceló.
 */
export async function generateInspectorTrazaReport(opts: { date: string; inspectors?: string[] }): Promise<boolean> {
  const { date, inspectors } = opts;
  const fecha = dmy(date);
  // UN SOLO "ahora" para todo el documento: `horasTurnoDelDia` lo usa para el cálculo
  // EN VIVO de las jornadas abiertas. Si cada máquina tomara su propio Date.now(), dos
  // filas del mismo PDF podrían quedar desfasadas entre sí.
  const nowMs = Date.now();

  let query = supabase
    .from('supervisor_visits')
    .select('supervisor_name, machinery_id, visited_at, status, lat, lng, distance_m, near, machine:machinery_id(code, serial, plate, tipo, marca, modelo, referencia, company:company_id(name))')
    .eq('visit_date', date);
  if (inspectors && inspectors.length) query = query.in('supervisor_name', inspectors);
  const { data } = await query.order('visited_at', { ascending: true });

  const rows = (data ?? []) as any[];

  // ── HORAS DEL DÍA: una entrada POR MÁQUINA (nunca por visita) ──────────────
  // Se consulta `machine_rounds` del mismo `round_date` solo para las máquinas que
  // aparecen en el recorrido. Las horas se calculan con `horasTurnoDelDia` (fuente
  // ÚNICA del sistema) y se guardan en un Map por `machinery_id`: aunque el inspector
  // haya revisado la misma máquina 5 veces, sus horas se calculan y se cuentan UNA vez.
  const machineIds = Array.from(new Set(rows.map((r) => String(r.machinery_id ?? '')).filter(Boolean)));
  const horasByMachine = new Map<string, HorasDia>();
  if (machineIds.length) {
    const rondas = (await selectAllRows(
      'machine_rounds',
      'machinery_id, day_hours, night_hours, hours_stopped, overtime_hours, jornada_start_at, jornada_shift, jornada_marked_by, status',
      (q) => q.eq('round_date', date).in('machinery_id', machineIds),
    )) as RondaDia[];
    // "Inició": nombre de quien MARCÓ el inicio de la jornada (`jornada_marked_by`
    // resuelto contra `profiles`) — misma traza y mismo patrón `nameById` que
    // inspectorReport.ts y porEmpresaReport.ts. Solo se consultan los ids que aparecen.
    const idsPersona = new Set<string>();
    rondas.forEach((r) => { if (r.jornada_marked_by) idsPersona.add(r.jornada_marked_by); });
    const nameById: Record<string, string> = {};
    if (idsPersona.size) {
      const { data: profs } = await supabase.from('profiles').select('id, full_name').in('id', [...idsPersona]);
      ((profs ?? []) as any[]).forEach((p) => { if (p.full_name) nameById[p.id] = p.full_name; });
    }
    rondas.forEach((r) => {
      const id = String(r.machinery_id ?? '');
      if (!id || horasByMachine.has(id)) return; // una ronda por máquina y día
      const { dia, noche, trabajadas } = horasTurnoDelDia(r, date, nowMs);
      horasByMachine.set(id, {
        dia, noche, trabajadas,
        iniPor: nameById[r.jornada_marked_by || ''] || '',
        parada: String(r.status ?? '') === 'parada',
      });
    });
  }

  /**
   * Totales de un grupo de visitas DEDUPLICANDO por `machinery_id`. Es el único camino
   * para cualquier total del reporte: las filas son por visita y las horas por máquina,
   * así que sumar fila por fila multiplicaría las horas por la cantidad de revisiones.
   * `conRonda` cuenta cuántas de esas máquinas tienen ronda (las que no, no suman nada
   * y en el detalle salen "—": no es lo mismo "no trabajó" que "no hay dato").
   */
  const totalesDe = (visitas: any[]): Totales => {
    // Dos llaves distintas a propósito:
    //  · `maquinas`   — máquinas DISTINTAS que revisó (una máquina vista de día y de
    //                   noche sigue siendo UNA máquina).
    //  · `parCubierto` — (máquina, turno). Es la unidad de las HORAS: si cubrió la
    //                   misma máquina en los dos turnos, le tocan las horas de ambos,
    //                   pero cada turno una sola vez por más visitas que haya hecho.
    const maquinas = new Set<string>();
    const parCubierto = new Set<string>();
    let dia = 0, noche = 0, suyas = 0, conRonda = 0;
    visitas.forEach((v) => {
      const id = String(v.machinery_id ?? '');
      if (!id) return;
      const turno = turnoDeVisita(v.visited_at);
      const par = `${id}|${turno}`;
      if (parCubierto.has(par)) return;
      parCubierto.add(par);
      const hm = horasByMachine.get(id);
      // El contexto del día completo se cuenta UNA vez por máquina, no por turno.
      if (!maquinas.has(id)) {
        maquinas.add(id);
        if (hm) { conRonda += 1; dia += hm.dia; noche += hm.noche; }
      }
      suyas += horasDelTurno(hm, turno);
    });
    return { maquinas: maquinas.size, conRonda, dia, noche, suyas };
  };

  // Agrupa por inspector (manteniendo el orden cronológico ya aplicado).
  const porInspector = new Map<string, any[]>();
  rows.forEach((r) => {
    const nombre = String(r.supervisor_name ?? '').trim() || 'Sin nombre';
    if (!porInspector.has(nombre)) porInspector.set(nombre, []);
    porInspector.get(nombre)!.push(r);
  });

  const inspectores = Array.from(porInspector.entries()).sort((a, b) => cmpText(a[0], b[0]));

  const tabla = (visitas: any[], t: Totales): string => {
    const trs = visitas.map((v, i) => {
      const m = v.machine || {};
      const hm = horasByMachine.get(String(v.machinery_id ?? ''));
      // Sin ronda del día → "—" en las tres columnas de horas (y en "Inició"): NO hay
      // dato, que es distinto de "trabajó 0 horas".
      const celdaH = (val: number, extraCls = '') =>
        hm ? `<td class="r${extraCls}">${h2(val)}</td>` : '<td class="r nd">—</td>';
      // La ronda quedó marcada 'parada' y sin horas → se resalta en ámbar (regla del
      // sistema "0 horas = parada"), sin inventar un valor distinto de 0.00.
      const turno = turnoDeVisita(v.visited_at);
      const suyas = horasDelTurno(hm, turno);
      const suyasCls = hm && hm.parada && suyas <= 0 ? ' par' : ' b';
      return `<tr>
        <td>${i + 1}</td>
        <td>${esc(horaCaracas(v.visited_at))}</td>
        <td class="c-tur">${turno === 'night' ? '🌙 Noche' : '☀️ Día'}</td>
        <td><b>${esc(m.code || '—')}</b></td>
        <td>${esc(marcaModeloTxt(m))}</td>
        <td>${esc(m.serial || m.plate || '—')}</td>
        <td>${esc(ubicacionTxt(v.lat, v.lng, m))}</td>
        <td>${esc(estadoTxt(v.status))}</td>
        <td>${esc(cercaTxt(v.near, v.distance_m))}</td>
        ${celdaH(hm?.dia ?? 0)}${celdaH(hm?.noche ?? 0)}${celdaH(suyas, suyasCls)}
        <td class="ini">${hm && hm.iniPor ? esc(hm.iniPor) : '—'}</td>
      </tr>`;
    }).join('');
    // Pie con los TOTALES del inspector. Ojo: "su jornada" NO es la suma de las dos
    // columnas anteriores — esas son del día completo de la máquina, y a él solo le
    // toca su turno (ver `totalesDe`).
    const tfoot = `<tfoot><tr>
      <td colspan="9">Total · ${t.maquinas} máquina(s) distinta(s) · ${visitas.length} revisión(es)</td>
      <td class="r">${h2(t.dia)}</td><td class="r">${h2(t.noche)}</td><td class="r b">${h2(t.suyas)}</td><td></td>
    </tr></tfoot>`;
    return `<table class="ir"><thead><tr>
      <th class="c-num">Nº</th><th class="c-hora">Hora</th><th class="c-tur">Turno</th><th class="c-maq">Máquina</th><th class="c-mm">Marca/Modelo</th><th class="c-ser">Serial/Placa</th>
      <th class="c-sec">Sector/Ubicación</th><th class="c-est">Estado</th><th class="c-cer">Cerca</th>
      <th class="r c-h">Máquina<br>día</th><th class="r c-h">Máquina<br>noche</th><th class="r c-h">Su<br>jornada</th><th class="c-ini">Inició</th>
    </tr></thead><tbody>${trs}</tbody>${tfoot}</table>`;
  };

  const secciones = inspectores.map(([nombre, visitas]) => {
    const t = totalesDe(visitas);
    const sinRonda = t.maquinas - t.conRonda;
    const resumen = `<div class="tot-insp">`
      + `🚜 <b>${t.maquinas}</b> máquina(s) distinta(s) · 🕒 HORAS DE SU JORNADA: <b>${h2(t.suyas)} h</b>`
      + `<div class="nota">Solo el turno que cubrió. Sus máquinas, en el día completo, dan `
      + `☀️ ${h2(t.dia)} h de día y 🌙 ${h2(t.noche)} h de noche (${h2(t.dia + t.noche)} h en total), `
      + `pero esa diferencia es de los otros turnos y no le corresponde. `
      + `Cada máquina cuenta UNA sola vez por turno, por más veces que la haya revisado`
      + `${sinRonda > 0 ? ` · ${sinRonda} sin ronda registrada (—)` : ''}.</div>`
      + `</div>`;
    // Sin línea de firma, a diferencia del reporte diario: este documento es de
    // CONSULTA (se saca cualquier día para mirar las horas), no un papel que se
    // firme en sitio. Decisión expresa del cliente (17-ago-2026).
    return `<h3>👮 ${esc(nombre)} · ${visitas.length} revisión(es)</h3>${resumen}${tabla(visitas, t)}`;
  }).join('');

  const totalVisitas = rows.length;
  const inspectoresCount = inspectores.length;
  // RESUMEN GENERAL: deduplicado sobre TODAS las visitas del documento. Ojo: si dos
  // inspectores revisaron la misma máquina, la suma de los totales por inspector es
  // MAYOR que este general — acá cada máquina cuenta una sola vez en todo el reporte.
  const tg = totalesDe(rows);

  const kpis = `
    <div class="kpis">
      <div class="kpi"><div class="k">Inspectores</div><div class="v">${inspectoresCount}</div></div>
      <div class="kpi"><div class="k">Revisiones</div><div class="v">${totalVisitas}</div></div>
      <div class="kpi"><div class="k">Máquinas distintas</div><div class="v">${tg.maquinas}</div></div>
      <div class="kpi"><div class="k">Máquinas · día</div><div class="v">${h2(tg.dia)}</div></div>
      <div class="kpi"><div class="k">Máquinas · noche</div><div class="v">${h2(tg.noche)}</div></div>
      <div class="kpi ok"><div class="k">Horas de jornada</div><div class="v">${h2(tg.suyas)}</div></div>
    </div>
    <div class="nota-gen">Las horas salen de la jornada del día de cada máquina (misma fórmula que el Reporte por Empresa
    y el Control de maquinaria). Cada máquina se cuenta UNA sola vez aunque tenga varias revisiones; si dos inspectores
    revisaron la misma máquina, ella suma en el total de cada uno pero una sola vez en este resumen general.</div>`;

  const extraCss = `
    /* Orientación HORIZONTAL: con las columnas de horas + "Inició" la tabla ya no cabe
       en vertical (mismo criterio que el Reporte del día por empresa). */
    @page{size:A4 landscape}
    h3{margin:14px 0 3px;font-size:13px;color:#1E3A5F;padding-bottom:3px;border-bottom:2px solid #1E3A5F}
    /* table-layout:fixed + anchos en % = la tabla NUNCA se desborda del ancho útil
       (A4 horizontal − 2 cm de margen); los textos largos parten de línea. */
    table.ir{width:100%;table-layout:fixed;border-collapse:collapse;margin:4px 0 12px;font-size:9.5px}
    table.ir th,table.ir td{border:1px solid #ccc;padding:3px 4px;text-align:left;vertical-align:top;overflow-wrap:anywhere}
    table.ir th{background:#1E3A5F;color:#fff;font-size:9px;line-height:1.15}
    /* Las 3 columnas de horas van en nowrap (para no partir "0.00"), así que su
       encabezado TIENE que caber: 8px deja "TRABAJADAS" dentro del 6.5% sin pisar
       la columna "Inició" de al lado. */
    table.ir th.c-h{font-size:8px}
    table.ir td.r,table.ir th.r{text-align:right;white-space:nowrap}
    table.ir td.b{font-weight:800;color:#067647}
    table.ir td.nd{color:#9CA3AF}
    table.ir td.par{font-weight:800;color:#B45309}
    table.ir td.ini{font-size:9px;color:#059669;font-weight:700}
    table.ir tfoot td{background:#F1F5F9;font-weight:800;border-top:2px solid #1E3A5F}
    /* Anchos EXPLÍCITOS que suman 100% (c-h se repite 3 veces: 6.5 × 3 = 19.5). */
    .c-num{width:2.5%} .c-hora{width:5.5%} .c-tur{width:5%} .c-maq{width:8.5%} .c-mm{width:12.5%} .c-ser{width:9.5%}
    .c-sec{width:13%} .c-est{width:8%} .c-cer{width:5%} .c-h{width:6.5%} .c-ini{width:11%}
    table.ir td.c-tur{white-space:nowrap;font-size:9px}
    .tot-insp{font-size:10.5px;color:#1E3A5F;background:#F1F5F9;border:1px solid #CBD5E1;border-radius:8px;padding:5px 9px;margin:4px 0 2px}
    .tot-insp .nota{font-size:8.5px;color:#6B7280;font-weight:400;margin-top:2px;text-transform:none}
    .nota-gen{font-size:8.5px;color:#6B7280;margin:-6px 0 10px;text-transform:none}
    .kpis{display:flex;flex-wrap:wrap;gap:8px;margin:6px 0 10px}
    .kpi{flex:1;min-width:110px;border:1px solid #E5E7EB;border-radius:10px;padding:8px 11px;background:#F8FAFC}
    .kpi .k{font-size:8.5px;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:0.4px}
    .kpi .v{font-size:19px;font-weight:800;color:#1E3A5F;margin-top:2px}
    .kpi.ok{background:#ECFDF3;border-color:#ABEFC6} .kpi.ok .v{color:#067647}
  `;

  const subtitle = `${fecha} · ${inspectoresCount} inspector(es) · ${totalVisitas} revisión(es) · ${tg.maquinas} máquina(s) · 🕒 ${h2(tg.suyas)} h de jornada`;

  const html = pdfDocument({
    title: 'RECORRIDO DEL INSPECTOR',
    subtitle,
    body: rows.length ? (kpis + secciones) : '<p>Sin revisiones para ese día.</p>',
    extraCss,
  });
  return await exportPdf(html, `Recorrido inspector ${fecha}`);
}
