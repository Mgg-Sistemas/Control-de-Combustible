import { supabase, selectAllRows } from './supabase';
import { pdfDocument, exportPdf } from './pdf';
import { cmpText, norm } from './text';
import { horasTurnoDelDia, type RondaHoras } from './hours';
import { paradaShiftOf } from './inspectorDaySets';

/**
 * Reporte "HISTÓRICO POR INSPECTOR" (PDF). Documento NUEVO (17-ago-2026), hermano del
 * "RECORRIDO DEL INSPECTOR" (`inspectorTrazaReport.ts`) — que NO se toca: aquel se queda
 * tal cual está desplegado, con su día único y su recorrido cronológico.
 *
 * PARA QUÉ SIRVE — el caso que lo motivó
 * ─────────────────────────────────────
 * Un inspector (CÉSAR FLAMES) se fue de la empresa y sus máquinas se le reasignaron a
 * otro (JOSÉ CARDONA). `machine_inspectors` guarda SOLO el estado de HOY (a quién está
 * asignada cada máquina ahora), sin fechas de "desde/hasta": no es una tabla histórica.
 * Por eso, en cuanto se reasigna una máquina, TODO reporte que atribuya por asignación
 * REESCRIBE EL PASADO — las horas de ayer aparecen bajo el inspector nuevo y el que de
 * verdad cubrió el turno desaparece del sistema.
 *
 * Pero la historia real SÍ existe: `supervisor_visits` guarda cada check-in con
 * `supervisor_name`, `machinery_id`, `visit_date` y `visited_at`, CONGELADO en el momento
 * en que se hizo. Nadie lo reescribe al reasignar. Este reporte se para sobre esa tabla:
 * agrupa por el nombre congelado, así que un inspector que ya no está sigue apareciendo
 * con sus días y sus horas, y se le marca con un aviso para que se entienda por qué no
 * figura entre los activos.
 *
 * A diferencia del "Recorrido del inspector" (un solo día), este trabaja sobre un RANGO
 * de fechas — es lo que lo hace un histórico — y agrupa inspector → fecha → máquinas.
 *
 * ⏳ CUANDO EXISTAN `machine_rounds.inspector_day` / `inspector_night`
 * ───────────────────────────────────────────────────────────────────
 * Hay un SQL PENDIENTE de correr (`supabase/congelar_inspector_en_la_ronda.sql`) que
 * agrega a cada ronda quién era el inspector de esa máquina ese día, por turno. HOY esas
 * columnas NO EXISTEN: seleccionarlas rompería la consulta, así que este reporte NO las
 * usa. Cuando se corran y estén pobladas, ESTE reporte debe PREFERIRLAS por encima de
 * `supervisor_visits`: la ronda cubre también las máquinas-turno que trabajaron pero que
 * NINGÚN inspector llegó a marcar (hoy esas no salen acá, porque sin check-in no hay
 * rastro histórico de quién las tenía). `supervisor_visits` quedaría como respaldo para
 * las rondas viejas que el relleno no haya podido completar.
 *
 * ⚠️ HORAS — LAS TRES REGLAS QUE NO SE NEGOCIAN
 * ─────────────────────────────────────────────
 *  1. Se calculan con `horasTurnoDelDia` (src/lib/hours.ts), la FÓRMULA ÚNICA del
 *     sistema. Acá no se reimplementa NADA: el proyecto ya tuvo 13 fórmulas de horas
 *     repartidas en 8 archivos y un inspector llegó a ver 137,38 h en el teléfono contra
 *     35,38 h en la web por esa misma razón.
 *  2. SOLO LAS HORAS DEL TURNO QUE CUBRIÓ. Una misma máquina puede trabajar de día Y de
 *     noche el mismo día (el 16-ago-2026 le pasó a 102 de 173 máquinas). Si al inspector
 *     de día se le suma la noche, se le acredita el trabajo del nocturno — y esto es la
 *     base del pago. El turno de cada visita sale de la HORA del check-in
 *     (`paradaShiftOf`: día 7am–7pm), la misma función que ya usa la clasificación de
 *     Inspecciones y que está cubierta por `npm run test:clasificacion`.
 *  3. NADA SE CUENTA DOS VECES. Las filas de `supervisor_visits` son POR VISITA (una
 *     máquina puede revisarse varias veces el mismo día y turno), pero las horas son POR
 *     MÁQUINA, DÍA Y TURNO. Se deduplica por esa TERNA al construir las entradas, y
 *     `totalesDe` — la ÚNICA función que calcula totales en este archivo, por la que
 *     pasan TODOS ellos (por fecha, por inspector y el general) — vuelve a deduplicar por
 *     si acaso. Sumar fila por fila multiplicaría las horas por la cantidad de revisiones.
 *
 * Y una cuarta, de honestidad: si una máquina NO tiene ronda en `machine_rounds` ese día,
 * sus horas salen "—", nunca "0.00". "No hay dato" y "trabajó cero" no son lo mismo.
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

const turnoTxt = (t: 'day' | 'night') => (t === 'night' ? '🌙 Noche' : '☀️ Día');

/**
 * MARCA / MODELO reales del catálogo (columnas propias `marca` y `modelo`, las mismas
 * que usa el reporte de Catálogo). Solo se cae a `tipo` —el marca-modelo COMBINADO
 * histórico— cuando la máquina es vieja y aún no tiene los campos separados llenos.
 */
const marcaModeloTxt = (m: any): string => {
  const partes = [m?.marca, m?.modelo].map((x) => String(x ?? '').trim()).filter(Boolean);
  if (partes.length) return partes.join(' ');
  const t = String(m?.tipo ?? '').trim();
  return t || '—';
};

/** Fila de `machine_rounds` tal como la lee este reporte (horas del día de una máquina). */
type RondaDia = RondaHoras & { machinery_id: string; round_date: string };

/** Horas del DÍA COMPLETO de una máquina, calculadas UNA SOLA VEZ (nunca por visita). */
type HorasDia = { dia: number; noche: number };

/**
 * Una ENTRADA del histórico = una MÁQUINA en una FECHA y un TURNO, para un inspector.
 * Es la unidad ya DEDUPLICADA: por más veces que el inspector haya revisado esa máquina
 * ese día en ese turno, hay UNA sola entrada (y `revisiones` dice cuántas fueron).
 */
type Entrada = {
  /** `machinery_id|fecha|turno` — la TERNA por la que se deduplica todo. */
  key: string;
  machineryId: string;
  fecha: string;
  turno: 'day' | 'night';
  machine: any;
  /** Horas QUE LE CORRESPONDEN: las de SU turno. `null` = no hay ronda ese día ("—"). */
  horas: number | null;
  /** Contexto del día completo de la máquina (para poder auditar la diferencia). */
  diaCompleto: number | null;
  nocheCompleta: number | null;
  /** Primer check-in del turno y cuántas revisiones hubo en total. */
  primeraVisita: string;
  revisiones: number;
  estado: any;
};

/** Totales de un grupo de entradas, con cada terna contada UNA SOLA VEZ. */
type Totales = { entradas: number; maquinas: number; dias: number; revisiones: number; horas: number; sinRonda: number };

/**
 * TOTALES — la ÚNICA función que suma en este reporte. Todos los totales del documento
 * (por fecha, por inspector y el resumen general) pasan por acá.
 *
 * Deduplica por la TERNA (máquina, fecha, turno) aunque las entradas ya vengan
 * deduplicadas: es la red de seguridad que garantiza que ningún total pueda inflarse si
 * mañana alguien arma la lista de otra manera. `sinRonda` cuenta las entradas sin ronda
 * registrada — no suman nada y en el detalle salen "—".
 */
const totalesDe = (entradas: Entrada[]): Totales => {
  const vistas = new Set<string>();
  const maquinas = new Set<string>();
  const dias = new Set<string>();
  let horas = 0, revisiones = 0, sinRonda = 0;
  entradas.forEach((e) => {
    if (vistas.has(e.key)) return;
    vistas.add(e.key);
    maquinas.add(e.machineryId);
    dias.add(e.fecha);
    revisiones += e.revisiones;
    if (e.horas == null) sinRonda += 1; else horas += e.horas;
  });
  return { entradas: vistas.size, maquinas: maquinas.size, dias: dias.size, revisiones, horas, sinRonda };
};

/**
 * Genera y exporta el PDF del histórico por inspector.
 * @param from día ISO "AAAA-MM-DD" inicial del rango (inclusive).
 * @param to   día ISO "AAAA-MM-DD" final del rango (inclusive).
 * @param inspectors nombres de inspectores a incluir (opcional; vacío = todos).
 * @returns true si el usuario confirmó (imprimió/guardó), false si canceló.
 */
export async function generateHistoricoInspectorReport(opts: { from: string; to: string; inspectors?: string[] }): Promise<boolean> {
  // Si vienen al revés, se enderezan: el usuario puede escoger "desde" después de "hasta".
  const from = opts.from <= opts.to ? opts.from : opts.to;
  const to = opts.from <= opts.to ? opts.to : opts.from;
  const { inspectors } = opts;
  // UN SOLO "ahora" para todo el documento: `horasTurnoDelDia` lo usa para el cálculo EN
  // VIVO de las jornadas abiertas (solo aplica al día de hoy). Si cada máquina tomara su
  // propio Date.now(), dos filas del mismo PDF podrían quedar desfasadas entre sí.
  const nowMs = Date.now();

  // ── 1. LA HISTORIA CONGELADA: los check-in del rango ───────────────────────
  // Se pagina con `selectAllRows` (PostgREST corta en ~1000 filas): un rango de varias
  // semanas pasa ese tope con facilidad y el reporte saldría truncado por lo bajo.
  const visitas = (await selectAllRows(
    'supervisor_visits',
    'supervisor_name, machinery_id, visit_date, visited_at, status, machine:machinery_id(code, serial, plate, tipo, marca, modelo)',
    (q) => {
      let qq = q.gte('visit_date', from).lte('visit_date', to);
      if (inspectors && inspectors.length) qq = qq.in('supervisor_name', inspectors);
      return qq;
    },
  )) as any[];

  // ── 2. HORAS: una entrada POR MÁQUINA Y DÍA (nunca por visita) ─────────────
  // Solo se consultan las máquinas que aparecen en el histórico. Las horas se calculan
  // con `horasTurnoDelDia` (fuente ÚNICA) y se guardan por `machinery_id|round_date`.
  const machineIds = Array.from(new Set(visitas.map((v) => String(v.machinery_id ?? '')).filter(Boolean)));
  const horasByMachineDia = new Map<string, HorasDia>();
  if (machineIds.length) {
    const rondas = (await selectAllRows(
      'machine_rounds',
      'machinery_id, round_date, day_hours, night_hours, hours_stopped, overtime_hours, jornada_start_at, jornada_shift',
      // ⏳ Cuando exista el SQL pendiente, acá se agregan `inspector_day, inspector_night`
      //    y pasan a mandar sobre `supervisor_visits` (ver cabecera del archivo).
      (q) => q.gte('round_date', from).lte('round_date', to).in('machinery_id', machineIds),
    )) as RondaDia[];
    rondas.forEach((r) => {
      const id = String(r.machinery_id ?? '');
      const fecha = String(r.round_date ?? '');
      if (!id || !fecha) return;
      const k = `${id}|${fecha}`;
      if (horasByMachineDia.has(k)) return; // una ronda por máquina y día
      const { dia, noche } = horasTurnoDelDia(r, fecha, nowMs);
      horasByMachineDia.set(k, { dia, noche });
    });
  }

  // ── 3. ¿QUIÉN SIGUE ACTIVO? ───────────────────────────────────────────────
  // La razón de ser del reporte: marcar a quien aparece en el histórico pero ya NO está
  // en `machine_inspectors` con `active = true` (se fue, o le reasignaron sus máquinas).
  // Se comparan los nombres NORMALIZADOS (sin tildes ni mayúsculas) y se aceptan tanto el
  // nombre GUARDADO en la asignación como el VIVO de `profiles`: `inspector_name` queda
  // congelado al asignar, así que un inspector renombrado en Usuarios seguiría activo y
  // no debe salir marcado por error.
  const activos = new Set<string>();
  try {
    const { data: asig } = await supabase.from('machine_inspectors').select('inspector_id, inspector_name').eq('active', true);
    const filas = (asig ?? []) as any[];
    filas.forEach((a) => { const n = norm(a.inspector_name); if (n) activos.add(n); });
    const ids = Array.from(new Set(filas.map((a) => a.inspector_id).filter(Boolean)));
    if (ids.length) {
      const { data: profs } = await supabase.from('profiles').select('id, full_name').in('id', ids);
      ((profs ?? []) as any[]).forEach((p) => { const n = norm(p.full_name); if (n) activos.add(n); });
    }
  } catch {
    // La tabla podría no existir todavía (falta correr el SQL de asignación). Sin ella no
    // se puede saber quién sigue activo: se deja el set vacío y NO se marca a nadie —
    // preferible no avisar que avisar en falso sobre todo el mundo.
  }
  const sinDatoDeActivos = activos.size === 0;
  const yaNoEstaActivo = (nombre: string) => !sinDatoDeActivos && !activos.has(norm(nombre));

  // ── 4. DEDUPLICACIÓN por (MÁQUINA, FECHA, TURNO) ──────────────────────────
  // Acá es donde se evita el doble conteo. El turno sale de la HORA del check-in, no de
  // la asignación: es lo que de verdad cubrió esa persona.
  const porInspector = new Map<string, Map<string, Entrada>>();
  visitas.forEach((v) => {
    const machineryId = String(v.machinery_id ?? '');
    const fecha = String(v.visit_date ?? '');
    const visitedAt = String(v.visited_at ?? '');
    if (!machineryId || !fecha || !visitedAt) return;
    const nombre = String(v.supervisor_name ?? '').trim() || 'Sin nombre';
    const turno = paradaShiftOf(visitedAt);
    const key = `${machineryId}|${fecha}|${turno}`;

    if (!porInspector.has(nombre)) porInspector.set(nombre, new Map());
    const mapa = porInspector.get(nombre)!;
    const previa = mapa.get(key);
    if (previa) {
      // Misma máquina, mismo día, mismo turno → NO es una entrada nueva: solo suma una
      // revisión más (y se conserva el check-in más temprano como "primera").
      previa.revisiones += 1;
      if (visitedAt < previa.primeraVisita) { previa.primeraVisita = visitedAt; previa.estado = v.status; }
      return;
    }
    const hm = horasByMachineDia.get(`${machineryId}|${fecha}`);
    mapa.set(key, {
      key, machineryId, fecha, turno,
      machine: v.machine || {},
      // LAS HORAS DE SU TURNO, no las del día completo (regla 2 de la cabecera).
      horas: hm ? (turno === 'night' ? hm.noche : hm.dia) : null,
      diaCompleto: hm ? hm.dia : null,
      nocheCompleta: hm ? hm.noche : null,
      primeraVisita: visitedAt,
      revisiones: 1,
      estado: v.status,
    });
  });

  const inspectores = Array.from(porInspector.entries())
    .map(([nombre, mapa]) => {
      // Orden de lectura del histórico: fecha ascendente y, dentro del día, día antes que
      // noche y luego por código de máquina.
      const entradas = Array.from(mapa.values()).sort((a, b) =>
        a.fecha !== b.fecha ? a.fecha.localeCompare(b.fecha)
          : a.turno !== b.turno ? (a.turno === 'day' ? -1 : 1)
            : cmpText(a.machine?.code, b.machine?.code));
      return { nombre, entradas, inactivo: yaNoEstaActivo(nombre) };
    })
    .sort((a, b) => cmpText(a.nombre, b.nombre));

  // ── 5. HTML ───────────────────────────────────────────────────────────────
  const celdaH = (val: number | null, cls: string) =>
    val == null ? '<td class="r nd">—</td>' : `<td class="r ${cls}">${h2(val)}</td>`;

  const filaEntrada = (e: Entrada, i: number): string => {
    const m = e.machine || {};
    return `<tr>
      <td>${i}</td>
      <td><b>${esc(m.code || '—')}</b></td>
      <td>${esc(marcaModeloTxt(m))}</td>
      <td>${esc(m.serial || m.plate || '—')}</td>
      <td class="tur">${turnoTxt(e.turno)}</td>
      <td>${esc(horaCaracas(e.primeraVisita))}</td>
      <td class="r">${e.revisiones}</td>
      <td>${esc(estadoTxt(e.estado))}</td>
      ${celdaH(e.horas, 'b')}
      ${celdaH(e.diaCompleto, 'ctx')}${celdaH(e.nocheCompleta, 'ctx')}
    </tr>`;
  };

  /** Tabla de UN inspector: separador + subtotal por fecha, y el total del inspector. */
  const tablaInspector = (entradas: Entrada[], t: Totales): string => {
    const porFecha = new Map<string, Entrada[]>();
    entradas.forEach((e) => {
      if (!porFecha.has(e.fecha)) porFecha.set(e.fecha, []);
      porFecha.get(e.fecha)!.push(e);
    });
    let n = 0;
    const cuerpo = Array.from(porFecha.entries()).map(([fecha, es]) => {
      // Subtotal del día: MISMA función de totales que el resto (nunca una suma aparte).
      const td = totalesDe(es);
      const filas = es.map((e) => filaEntrada(e, ++n)).join('');
      return `<tr class="sep"><td colspan="11">📅 ${esc(dmy(fecha))} · ${td.maquinas} máquina(s) · ${td.revisiones} revisión(es)</td></tr>`
        + filas
        + `<tr class="sub"><td colspan="8">Subtotal del ${esc(dmy(fecha))}</td><td class="r">${h2(td.horas)}</td><td colspan="2"></td></tr>`;
    }).join('');
    const tfoot = `<tfoot><tr>
      <td colspan="8">Total · ${t.maquinas} máquina(s) distinta(s) · ${t.dias} día(s) · ${t.entradas} máquina-turno(s) · ${t.revisiones} revisión(es)</td>
      <td class="r b">${h2(t.horas)}</td><td colspan="2"></td>
    </tr></tfoot>`;
    return `<table class="hi"><thead><tr>
      <th class="c-num">Nº</th><th class="c-maq">Máquina</th><th class="c-mm">Marca/Modelo</th><th class="c-ser">Serial/Placa</th>
      <th class="c-tur">Turno</th><th class="c-hora">1ª revisión</th><th class="r c-rev">Rev.</th><th class="c-est">Estado</th>
      <th class="r c-hh">Horas del<br>turno</th><th class="r c-ctx">Día<br>(contexto)</th><th class="r c-ctx">Noche<br>(contexto)</th>
    </tr></thead><tbody>${cuerpo}</tbody>${tfoot}</table>`;
  };

  const secciones = inspectores.map(({ nombre, entradas, inactivo }) => {
    const t = totalesDe(entradas);
    const aviso = inactivo
      ? `<div class="baja">⚠️ Ya no figura en la lista de inspectores activos. Sus máquinas fueron reasignadas o dejó la empresa; este registro se conserva tal como quedó en su momento.</div>`
      : '';
    const resumen = `<div class="tot-insp">`
      + `📅 <b>${t.dias}</b> día(s) trabajado(s) · 🚜 <b>${t.maquinas}</b> máquina(s) distinta(s) · 🕒 <b>${h2(t.horas)} h</b> de sus turnos`
      + `<div class="nota">Solo las horas del TURNO que cubrió (día o noche, según la hora del check-in). Cada máquina cuenta UNA vez por día y turno`
      + `${t.sinRonda > 0 ? ` · ${t.sinRonda} máquina-turno(s) sin ronda registrada (—)` : ''}.</div>`
      + `</div>`;
    return `<h3>👮 ${esc(nombre)}${inactivo ? ' <span class="tag-baja">Ya no activo</span>' : ''}</h3>${aviso}${resumen}${tablaInspector(entradas, t)}`;
  }).join('');

  // RESUMEN GENERAL: deduplicado sobre TODAS las entradas del documento. Ojo: si dos
  // inspectores cubrieron la misma máquina el mismo día y turno (dos check-in distintos),
  // la suma de los totales por inspector es MAYOR que este general — acá cada terna
  // (máquina, fecha, turno) cuenta una sola vez en todo el reporte.
  const todas = inspectores.flatMap((x) => x.entradas);
  const tg = totalesDe(todas);
  const inactivos = inspectores.filter((x) => x.inactivo).length;

  const kpis = `
    <div class="kpis">
      <div class="kpi"><div class="k">Inspectores</div><div class="v">${inspectores.length}</div></div>
      <div class="kpi${inactivos > 0 ? ' baja-kpi' : ''}"><div class="k">Ya no activos</div><div class="v">${inactivos}</div></div>
      <div class="kpi"><div class="k">Días con registro</div><div class="v">${tg.dias}</div></div>
      <div class="kpi"><div class="k">Máquinas distintas</div><div class="v">${tg.maquinas}</div></div>
      <div class="kpi"><div class="k">Revisiones</div><div class="v">${tg.revisiones}</div></div>
      <div class="kpi ok"><div class="k">Horas de turno</div><div class="v">${h2(tg.horas)}</div></div>
    </div>
    <div class="nota-gen">Este documento sale de los CHECK-IN (<b>supervisor_visits</b>): el nombre que ves es el de quien marcó la
    máquina de verdad, congelado en ese momento — por eso no cambia aunque después se reasignen las máquinas. Las horas se calculan
    con la misma fórmula que el Reporte del día por empresa y el Control de maquinaria, pero <b>solo se cuenta el turno que cubrió</b>
    cada quien: si la máquina también trabajó el otro turno, esas horas son del inspector de ese otro turno (las columnas
    &laquo;contexto&raquo; muestran el día completo para poder comprobarlo). Cada máquina cuenta UNA sola vez por día y turno aunque
    se haya revisado varias veces.${sinDatoDeActivos ? ' <b>Aviso:</b> no se pudo leer la lista de inspectores activos, así que en esta emisión no se marcó a nadie como dado de baja.' : ''}</div>`;

  const extraCss = `
    /* Orientación HORIZONTAL: con turno + horas del turno + las dos columnas de contexto
       la tabla no cabe en vertical (mismo criterio que el Recorrido del inspector). */
    @page{size:A4 landscape}
    h3{margin:14px 0 3px;font-size:13px;color:#1E3A5F;padding-bottom:3px;border-bottom:2px solid #1E3A5F}
    .tag-baja{background:#FEF3C7;color:#B45309;border:1px solid #FCD34D;border-radius:8px;padding:1px 6px;font-size:9px;font-weight:800;vertical-align:middle}
    .baja{font-size:9.5px;color:#92400E;background:#FFFBEB;border:1px solid #FCD34D;border-radius:8px;padding:5px 9px;margin:4px 0 2px;text-transform:none}
    /* table-layout:fixed + anchos en % = la tabla NUNCA se desborda del ancho útil
       (A4 horizontal − 2 cm de margen); los textos largos parten de línea. */
    table.hi{width:100%;table-layout:fixed;border-collapse:collapse;margin:4px 0 12px;font-size:9.5px}
    table.hi th,table.hi td{border:1px solid #ccc;padding:3px 4px;text-align:left;vertical-align:top;overflow-wrap:anywhere}
    table.hi th{background:#1E3A5F;color:#fff;font-size:9px;line-height:1.15}
    /* Las columnas de horas van en nowrap (para no partir "0.00"), así que su encabezado
       TIENE que caber en su ancho: 8px deja "CONTEXTO" dentro sin pisar la de al lado. */
    table.hi th.c-hh,table.hi th.c-ctx{font-size:8px}
    table.hi td.r,table.hi th.r{text-align:right;white-space:nowrap}
    table.hi td.b{font-weight:800;color:#067647}
    table.hi td.nd{color:#9CA3AF}
    table.hi td.ctx{color:#6B7280;font-size:9px}
    table.hi td.tur{white-space:nowrap;font-size:9px}
    table.hi tr.sep td{background:#E8EEF6;font-weight:800;color:#1E3A5F;font-size:10px;border-top:2px solid #1E3A5F}
    table.hi tr.sub td{background:#F8FAFC;font-weight:700;color:#475569;font-size:9px}
    table.hi tfoot td{background:#F1F5F9;font-weight:800;border-top:2px solid #1E3A5F}
    /* Anchos EXPLÍCITOS que suman 100% (c-ctx se repite 2 veces: 9.5 × 2 = 19). */
    .c-num{width:3.5%} .c-maq{width:10%} .c-mm{width:15%} .c-ser{width:12%} .c-tur{width:8%}
    .c-hora{width:8%} .c-rev{width:5%} .c-est{width:10%} .c-hh{width:9.5%} .c-ctx{width:9.5%}
    .tot-insp{font-size:10.5px;color:#1E3A5F;background:#F1F5F9;border:1px solid #CBD5E1;border-radius:8px;padding:5px 9px;margin:4px 0 2px}
    .tot-insp .nota{font-size:8.5px;color:#6B7280;font-weight:400;margin-top:2px;text-transform:none}
    .nota-gen{font-size:8.5px;color:#6B7280;margin:-6px 0 10px;text-transform:none}
    .kpis{display:flex;flex-wrap:wrap;gap:8px;margin:6px 0 10px}
    .kpi{flex:1;min-width:110px;border:1px solid #E5E7EB;border-radius:10px;padding:8px 11px;background:#F8FAFC}
    .kpi .k{font-size:8.5px;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:0.4px}
    .kpi .v{font-size:19px;font-weight:800;color:#1E3A5F;margin-top:2px}
    .kpi.ok{background:#ECFDF3;border-color:#ABEFC6} .kpi.ok .v{color:#067647}
    .kpi.baja-kpi{background:#FFFBEB;border-color:#FCD34D} .kpi.baja-kpi .v{color:#B45309}
  `;

  const rango = from === to ? dmy(from) : `${dmy(from)} → ${dmy(to)}`;
  const subtitle = `${rango} · ${inspectores.length} inspector(es)${inactivos > 0 ? ` (${inactivos} ya no activo(s))` : ''} · ${tg.maquinas} máquina(s) · ${tg.revisiones} revisión(es) · 🕒 ${h2(tg.horas)} h de turno`;

  const html = pdfDocument({
    title: 'HISTÓRICO POR INSPECTOR',
    subtitle,
    body: inspectores.length ? (kpis + secciones) : '<p>Sin revisiones registradas en ese rango de fechas.</p>',
    extraCss,
  });
  return await exportPdf(html, `Historico por inspector ${rango.replace(/\s*→\s*/, ' al ')}`);
}
