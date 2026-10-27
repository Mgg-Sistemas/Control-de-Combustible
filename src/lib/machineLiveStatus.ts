import { supabase, selectAllRows } from './supabase';
import { caracasParts } from './jornada';
import { listInspectorAssignments, inspectorSiempreActivo } from './machineInspectors';
import { paradaShiftOf } from './inspectorDaySets';
import { horasVivasTurno } from './hours';

/**
 * Datos crudos de estatus EN VIVO de una máquina (jornada/avería/inspector por
 * turno), extraídos de `EquiposScreen.tsx` (`loadJornadaCat`/`loadAveriaCat`/
 * `loadInspByShift`) para que cualquier pantalla los reutilice sin duplicar el
 * dedupe/orden/ventanas de fecha de esas queries. La CLASIFICACIÓN en sí
 * (avería/parada/trabajando, reactivación, por-turno) vive en cada pantalla
 * (`EquiposScreen.liveStatusOf`, `DashboardScreen.loadCounts` vía `buildDaySets`)
 * porque cada una tiene requisitos distintos — ver el "MAPA DE CLASIFICADORES"
 * en `inspectorDaySets.ts` antes de intentar unificarlas.
 */

export type JornadaEntry = {
  dayH: number; nightH: number;
  openStartDay: number | null; openStartNight: number | null;
  // Hora REAL en que se tocó "iniciar" (jornada_marked_at ?? jornada_start_at), SOLO
  // para la reactivación: si la jornada se re-inició a las 9:30 pero `jornada_start_at`
  // quedó anclado a las 7am, la reactivación debe compararse contra las 9:30, no las 7am.
  reactStartDay: number | null; reactStartNight: number | null;
};
export type AveriaEntry = { tipo: 'averia' | 'parada'; motivo: string | null; createdMs: number };
export type InspByShiftEntry = { day: string | null; night: string | null };
export type MachineEstado = 'averiada' | 'parada' | 'trabajando' | 'trabajo_hoy' | 'ninguno';
export type LiveStatus = { estado: MachineEstado; total: number; enCurso: number; trabajadas: number; motivo: string | null; desdeMs: number | null };

// ── Fetchers: mismas queries que EquiposScreen (loadAveriaCat/loadJornadaCat/
// loadInspByShift), extraídas para que cualquier pantalla lea EXACTAMENTE los
// mismos datos crudos, sin reimplementar el dedupe/orden/ventanas de fecha. ──

/**
 * Opciones de lectura (25-oct-2026, aditivas, para el Centro de Operaciones; mesa de
 * maquinaria §6.1). SIN opciones, cada consulta y el resultado son EXACTAMENTE los de
 * siempre: las seis pantallas que usan la lib (Catálogo, Inicio, Conteo, Frentes,
 * Usuarios, Viajes) llaman sin argumentos, y `scripts/test-live-status-lectura.mjs`
 * lo fija con la foto de las consultas y de los resultados.
 *  · `ids`: lee SOLO esas máquinas (`.in('machinery_id', ids)`). `[]` → `{}` sin
 *    consultar. El resultado es el mismo que leer todo y recortar a esos ids (el
 *    dedupe es por máquina), pero sin acercarse al tope de 1000 filas de PostgREST,
 *    que en la lectura completa corta EN SILENCIO los pendientes más viejos.
 *  · `estricto`: si alguna consulta trae error, LANZA (en español) en vez de devolver
 *    lo parcial o `{}` — el «ciego» del que dependen las seis pantallas se conserva
 *    cuando no se pide.
 */
export type OpcionesLectura = { ids?: string[]; estricto?: boolean };

/** El marcador genérico «no trabajó este turno» (NO es una avería real). UNA sola
 *  constante para `fetchAveriaCat` y `fetchNovedadesInspeccion`: si mañana cambia,
 *  cambia para las dos (la historia de la casa: copias que se desincronizan). */
const MARCADOR_PARADA = 'MÁQUINA PARADA';
const NO_SE_PUDO_LEER = 'No se pudo leer el estado de inspección';

/** Margen para una hora «futura» (reloj adelantado de quien registró el hecho, o una fila
 *  fantasma): un hecho más allá de ahora + este margen NO cuenta todavía (se APLAZA, no se
 *  pierde: en la siguiente lectura, cuando llegue su hora, entra). Sin esto, un hecho «de
 *  mañana» trabaría la guardia del Centro de Operaciones hasta mañana (lote 6, A1). */
export const MARGEN_HORA_FUTURA_MS = 10 * 60 * 1000;

/** Agrega el filtro por máquinas SOLO si lo pidieron; sin `ids` la consulta queda intacta. */
function conIds<Q>(q: Q, ids: string[] | undefined): Q {
  return ids ? (q as any).in('machinery_id', ids) : q;
}

/** El error de lectura, en español, con el detalle original (y el error en `cause`). */
function errorDeLectura(e: unknown): Error {
  const msg = typeof e === 'string' ? e : (e as { message?: unknown } | null)?.message;
  const detalle = typeof msg === 'string' ? msg.trim() : '';
  return Object.assign(new Error(detalle ? `${NO_SE_PUDO_LEER}: ${detalle}` : `${NO_SE_PUDO_LEER}.`), { cause: e });
}

/** En modo estricto, el primer `error` de las respuestas se convierte en excepción. */
function exigirSinError(estricto: boolean | undefined, ...respuestas: { error: unknown }[]) {
  if (!estricto) return;
  const conError = respuestas.find((r) => r.error);
  if (conError) throw errorDeLectura(conError.error);
}

/** Avería/parada PENDIENTE más reciente por máquina (avería real tiene prioridad
 *  sobre el marcador genérico "MÁQUINA PARADA"). Copia exacta de `loadAveriaCat`.
 *  Opciones: ver `OpcionesLectura` (sin opciones, idéntica a siempre). */
export async function fetchAveriaCat(op: OpcionesLectura = {}): Promise<Record<string, AveriaEntry>> {
  if (op.ids && op.ids.length === 0) return {};
  const [averias, paradas] = await Promise.all([
    conIds(supabase.from('maintenance_requests').select('machinery_id, material, notes, created_at').neq('material', MARCADOR_PARADA).eq('status', 'pendiente'), op.ids).order('created_at', { ascending: false }),
    conIds(supabase.from('maintenance_requests').select('machinery_id, notes, created_at').eq('material', MARCADOR_PARADA).eq('status', 'pendiente'), op.ids).order('created_at', { ascending: false }),
  ]);
  exigirSinError(op.estricto, averias, paradas);
  const m: Record<string, AveriaEntry> = {};
  const ms = (iso: any) => (iso ? new Date(iso).getTime() : 0);
  (paradas.data ?? []).forEach((r: any) => { if (m[r.machinery_id]) return; m[r.machinery_id] = { tipo: 'parada', motivo: r.notes, createdMs: ms(r.created_at) }; });
  const averiaSeen = new Set<string>();
  (averias.data ?? []).forEach((r: any) => {
    if (averiaSeen.has(r.machinery_id)) return;
    averiaSeen.add(r.machinery_id);
    m[r.machinery_id] = { tipo: 'averia', motivo: r.notes || r.material, createdMs: ms(r.created_at) };
  });
  return m;
}

/** Horas trabajadas hoy (día/noche) + instante de inicio de la jornada abierta de
 *  cada turno, con arrastre de la jornada de NOCHE de anoche si sigue abierta.
 *  Copia exacta de `loadJornadaCat`. Opciones: ver `OpcionesLectura` (van de SEGUNDO
 *  parámetro porque el primero ya es `now`; sin opciones, idéntica a siempre). */
export async function fetchJornadaCat(now: Date = new Date(), op: OpcionesLectura = {}): Promise<Record<string, JornadaEntry>> {
  if (op.ids && op.ids.length === 0) return {};
  const today = caracasParts(now).iso;
  const yesterday = caracasParts(new Date(now.getTime() - 86400000)).iso;
  const [todayRes, nightRes] = await Promise.all([
    conIds(supabase.from('machine_rounds').select('machinery_id, day_hours, night_hours, jornada_start_at, jornada_marked_at, jornada_shift').eq('round_date', today), op.ids),
    conIds(supabase.from('machine_rounds').select('machinery_id, night_hours, jornada_start_at, jornada_marked_at, jornada_shift').eq('round_date', yesterday).eq('jornada_shift', 'night').not('jornada_start_at', 'is', null), op.ids),
  ]);
  exigirSinError(op.estricto, todayRes, nightRes);
  const m: Record<string, JornadaEntry> = {};
  const ensure = (id: string) => (m[id] ??= { dayH: 0, nightH: 0, openStartDay: null, openStartNight: null, reactStartDay: null, reactStartNight: null });
  // Turno del inicio: el declarado; si falta, se infiere por la hora Caracas (07–18:59 = día).
  const inferShift = (iso: string, shift: 'day' | 'night' | null): 'day' | 'night' => {
    if (shift) return shift;
    const h = caracasParts(new Date(iso)).hour;
    return h >= 7 && h < 19 ? 'day' : 'night';
  };
  (todayRes.data ?? []).forEach((r: any) => {
    const e = ensure(r.machinery_id);
    e.dayH = Math.max(e.dayH, Number(r.day_hours) || 0);
    e.nightH = Math.max(e.nightH, Number(r.night_hours) || 0);
    if (r.jornada_start_at) {
      const t = new Date(r.jornada_start_at).getTime();
      const rt = new Date(r.jornada_marked_at || r.jornada_start_at).getTime(); // hora real (para reactivación)
      if (inferShift(r.jornada_start_at, r.jornada_shift) === 'day') {
        e.openStartDay = e.openStartDay == null ? t : Math.min(e.openStartDay, t);
        e.reactStartDay = e.reactStartDay == null ? rt : Math.max(e.reactStartDay, rt);
      } else {
        e.openStartNight = e.openStartNight == null ? t : Math.min(e.openStartNight, t);
        e.reactStartNight = e.reactStartNight == null ? rt : Math.max(e.reactStartNight, rt);
      }
    }
  });
  // Jornada de NOCHE de anoche aún abierta → cuenta como noche de hoy.
  (nightRes.data ?? []).forEach((r: any) => {
    const e = ensure(r.machinery_id);
    e.nightH = Math.max(e.nightH, Number(r.night_hours) || 0);
    if (r.jornada_start_at) {
      const t = new Date(r.jornada_start_at).getTime();
      const rt = new Date(r.jornada_marked_at || r.jornada_start_at).getTime();
      e.openStartNight = e.openStartNight == null ? t : Math.min(e.openStartNight, t);
      e.reactStartNight = e.reactStartNight == null ? rt : Math.max(e.reactStartNight, rt);
    }
  });
  return m;
}

/** Un «hecho nuevo de inspección» (mesa de maquinaria, D1): lo que hace que vuelva a
 *  mandar inspección sobre la marca que el sitio le puso a una máquina vinculada. */
export type NovedadInspeccion = { ms: number; que: 'averia_creada' | 'averia_resuelta' | 'jornada'; motivo: string | null };

/**
 * ⭐ HECHOS NUEVOS DE INSPECCIÓN posteriores a `desde`: por máquina, el MÁS
 * RECIENTE (25-oct-2026, para el Centro de Operaciones; ninguna otra pantalla la
 * llama). Para decidir basta «¿hubo algún hecho después de la marca?», y el más
 * reciente es el que se le muestra a quien marcó. Un hecho es (D1):
 *  · una avería REAL creada (`created_at`) o resuelta (`resolved_at`) — NUNCA el
 *    marcador MÁQUINA PARADA (ni crearlo, ni resolverlo, ni reabrirlo): el inspector y
 *    el listero crean SIEMPRE dos filas (marcador + avería real), así que dejarlo
 *    fuera no pierde ninguna avería, y contarlo vencería la marca en cada turno por
 *    un «no trabajó»;
 *  · una jornada iniciada por una PERSONA (`jornada_marked_at`) — NUNCA
 *    `jornada_start_at`, que queda anclado a 7 a. m. / 7 p. m. y que también ponían
 *    los crons de arranque.
 * `desde` puede ser UNA fecha ISO para todas (`.gt(col, desde)`, la consulta de siempre) o
 * una fecha POR MÁQUINA (`{ [id]: iso }`, lote 6 A2): entonces cada máquina trae solo lo
 * posterior a SU marca, en las mismas tres consultas, con un `.or(and(machinery_id.eq.X,
 * col.gt."T"),…)` (la lista viaja en la dirección: quien llama manda lotes chicos).
 * Un hecho con hora FUTURA (más de `MARGEN_HORA_FUTURA_MS` por delante del reloj) se aplaza (A1).
 * SIEMPRE estricta: si falla cualquiera de las tres lecturas, lanza en español.
 * Paginada con `selectAllRows` (sin tope de filas). `ids: []` → `{}` sin consultar.
 * Solo lee.
 */
export async function fetchNovedadesInspeccion(ids: string[], desde: string | Record<string, string>): Promise<Record<string, NovedadInspeccion>> {
  if (ids.length === 0) return {};
  const fechaMala = () => new Error(`${NO_SE_PUDO_LEER}: la fecha «desde» no es válida.`);
  const porMaquina = typeof desde !== 'string';
  const desdeDe: Record<string, number> = {};
  let desdeComun = NaN;
  if (porMaquina) {
    for (const id of ids) {
      // El id va DENTRO del texto del filtro: con una coma o un paréntesis cambiaría el filtro.
      if (/[,()"\s]/.test(id)) throw new Error(`${NO_SE_PUDO_LEER}: el id de una máquina no es válido.`);
      const t = Date.parse(String(desde[id] ?? ''));
      if (!Number.isFinite(t)) throw fechaMala();
      desdeDe[id] = t;
    }
  } else {
    desdeComun = Date.parse(desde);
    if (!Number.isFinite(desdeComun)) throw fechaMala();
  }
  /** La ventana: la misma `.gt` de siempre, o una por máquina (los valores con «:» y «.» van
   *  entre comillas, como pide PostgREST para sus caracteres reservados). */
  const ventana = (q: any, col: string) => (porMaquina
    ? q.or(ids.map((id) => `and(machinery_id.eq.${id},${col}.gt."${new Date(desdeDe[id]).toISOString()}")`).join(','))
    : q.gt(col, desde));
  const topeFuturo = Date.now() + MARGEN_HORA_FUTURA_MS;
  let creadas: any[], resueltas: any[], jornadas: any[];
  try {
    [creadas, resueltas, jornadas] = await Promise.all([
      selectAllRows('maintenance_requests', 'machinery_id, material, notes, created_at', (q: any) => ventana(q.in('machinery_id', ids).neq('material', MARCADOR_PARADA), 'created_at')),
      selectAllRows('maintenance_requests', 'machinery_id, material, notes, resolved_at', (q: any) => ventana(q.in('machinery_id', ids).neq('material', MARCADOR_PARADA), 'resolved_at')),
      selectAllRows('machine_rounds', 'machinery_id, jornada_marked_at', (q: any) => ventana(q.in('machinery_id', ids), 'jornada_marked_at')),
    ]);
  } catch (e) {
    throw errorDeLectura(e);
  }
  const m: Record<string, NovedadInspeccion> = {};
  const anotar = (id: string | null, iso: string | null, que: NovedadInspeccion['que'], motivo: string | null) => {
    const ms = iso ? new Date(iso).getTime() : NaN;
    const desdeMs = porMaquina ? desdeDe[id ?? ''] : desdeComun;
    // La base ya filtró «posterior a desde»; se vuelve a mirar acá por si la hora
    // llega en otro formato. Un hecho con hora futura se aplaza (A1). A igual hora gana el
    // primero (creada, resuelta, jornada).
    if (!id || !Number.isFinite(ms) || !Number.isFinite(desdeMs) || ms <= desdeMs || ms > topeFuturo) return;
    if (!m[id] || ms > m[id].ms) m[id] = { ms, que, motivo };
  };
  creadas.forEach((r) => anotar(r.machinery_id, r.created_at, 'averia_creada', r.notes || r.material || null));
  resueltas.forEach((r) => anotar(r.machinery_id, r.resolved_at, 'averia_resuelta', r.notes || r.material || null));
  jornadas.forEach((r) => anotar(r.machinery_id, r.jornada_marked_at, 'jornada', null));
  return m;
}

/** Inspector ASIGNADO (CHECK MÁQUINA) por turno, día y noche por separado.
 *  Copia exacta de `loadInspByShift`. */
export async function fetchInspByShift(): Promise<Record<string, InspByShiftEntry>> {
  const { rows } = await listInspectorAssignments();
  const m: Record<string, InspByShiftEntry> = {};
  rows.forEach((r) => {
    const e = m[r.machinery_id] ?? { day: null, night: null };
    if (r.shift === 'night') e.night = r.inspector_name; else e.day = r.inspector_name;
    m[r.machinery_id] = e;
  });
  return m;
}

/**
 * Estatus EN VIVO de una máquina (avería/parada/trabajando + horas), copia EXACTA
 * de `liveStatusOf` en `EquiposScreen.tsx` (Catálogo) — extraída acá para que
 * cualquier pantalla que necesite el mismo widget "4 cubos" (Operativas/Averiadas/
 * Retiradas/Esperando) del Catálogo la use TAL CUAL, en vez de reimplementarla.
 * Antes `DashboardScreen.loadCounts` tenía su PROPIA reconstrucción de esta lógica
 * sobre `buildDaySets` (pensada para el panel de Inspecciones, no para este widget) +
 * un parche manual de reactivación cruzada — se desincronizaba del Catálogo en casos
 * reales (ej.: avería arrastrada + la máquina ya trabajó en el OTRO turno hoy: el
 * Catálogo la excluye por horas totales del día, `buildDaySets` es por-turno y no lo
 * veía) — queja del cliente 11-ago-2026 (Catálogo 203/23 vs Inicio 200/26).
 */
export function makeLiveStatusOf(params: {
  jornadaCat: Record<string, JornadaEntry>;
  averiaCat: Record<string, AveriaEntry>;
  inspByShift: Record<string, InspByShiftEntry>;
  retiredIds: Set<string>;
  nowTick: number;
}): (id: string) => LiveStatus {
  const { jornadaCat, averiaCat, inspByShift, retiredIds, nowTick } = params;
  const round2 = (n: number) => Math.round(n * 100) / 100;
  return (id: string) => {
    if (retiredIds.has(id)) return { estado: 'ninguno' as const, total: 0, enCurso: 0, trabajadas: 0, motivo: null as string | null, desdeMs: null as number | null };
    const j = jornadaCat[id];
    const a = averiaCat[id];
    const dayH = j?.dayH ?? 0;
    const nightH = j?.nightH ?? 0;
    const openStartDay = j?.openStartDay ?? null;
    const openStartNight = j?.openStartNight ?? null;
    // EN VIVO = bancado + lo transcurrido desde el inicio REAL (horasVivasTurno, fuente
    // única 08-oct-2026). Hasta el 02-oct el día sumaba desde el nominal 7am porque el
    // re-inicio se re-anclaba; con inicio = hora real eso contaba DOS VECES el tramo
    // bancado tras una parada→reactivación y además la parada como trabajo.
    const workedDia = openStartDay ? horasVivasTurno({ bancado: dayH, startMs: openStartDay, shift: 'day', nowMs: nowTick }) : Math.min(12, dayH);
    const workedNoche = openStartNight ? horasVivasTurno({ bancado: nightH, startMs: openStartNight, shift: 'night', nowMs: nowTick }) : Math.min(12, nightH);
    const total = workedDia + workedNoche;
    const enCurso = Math.max(0, workedDia - Math.min(12, dayH)) + Math.max(0, workedNoche - Math.min(12, nightH));
    const trabajadas = Math.max(0, total - enCurso);
    const hasOpen = openStartDay != null || openStartNight != null;
    // Para la REACTIVACIÓN se usa la hora REAL de arranque (jornada_marked_at), no el
    // inicio anclado al nominal 7am: una jornada re-iniciada a las 9:30 (anclada a 7am)
    // debe reactivarse contra las 9:30 — si no, una parada de la mañana la deja averiada/
    // parada con la jornada abierta (bug 23-ago-2026). Las horas de arriba NO cambian.
    const openStart = Math.max(j?.reactStartDay ?? 0, j?.reactStartNight ?? 0);
    const insp = inspByShift[id];
    const siempreActivo = inspectorSiempreActivo(insp?.day) || inspectorSiempreActivo(insp?.night);
    const todayStartMs = new Date(`${caracasParts(new Date(nowTick)).iso}T00:00:00-04:00`).getTime();
    const esHoy = !!a && a.createdMs >= todayStartMs;
    const reactivada = !!a && hasOpen && openStart >= a.createdMs;
    const nowShift = paradaShiftOf(new Date(nowTick).toISOString());
    const mismoTurno = !!a && paradaShiftOf(new Date(a.createdMs).toISOString()) === nowShift;
    // ⭐ VIGENCIA DE LA AVERÍA/PARADA (14-oct-2026, a pedido: «necesito que el
    //    catálogo me refleje lo que marcaron los inspectores desde su teléfono»).
    //    Antes `mismoTurno` tapaba TODO: una avería PENDIENTE del 08/10 a las
    //    8:38am (turno día) se veía «Operativa» en el Catálogo cada noche, aunque
    //    la máquina no hubiera vuelto a trabajar y el teléfono del inspector la
    //    siguiera mostrando averiada. Ahora:
    //    · SIN trabajo posterior (sin jornada abierta y 0 h hoy) la avería rige
    //      SIEMPRE, a cualquier hora, hasta resolverse o reactivarse — igual que
    //      lo que marcó el inspector.
    //    · La foto POR TURNO del 11-ago («marcarla de día no afecta la noche»)
    //      queda SOLO para el caso que la motivó: la máquina trabajó HOY y
    //      después cayó — en el otro turno sale «trabajó X h», no averiada.
    const averiaVigente = !siempreActivo && !!a && !reactivada && ((esHoy && mismoTurno) || (!hasOpen && total <= 0));
    let estado: MachineEstado;
    if (averiaVigente && a!.tipo === 'averia') estado = 'averiada';
    else if (averiaVigente && a!.tipo === 'parada') estado = 'parada';
    else if (hasOpen) estado = 'trabajando';
    else if (total > 0) estado = 'trabajo_hoy';
    else estado = 'ninguno';
    // desdeMs = instante en que se marcó la avería/parada vigente (para el rótulo
    // "trabajó X h · averiada/parada desde HH:MM" en el Catálogo cuando trabajó y luego cayó).
    return { estado, total: round2(total), enCurso: round2(enCurso), trabajadas: round2(trabajadas), motivo: a?.motivo ?? null, desdeMs: (estado === 'averiada' || estado === 'parada') ? (a?.createdMs ?? null) : null };
  };
}

/** Máquina mínima que necesita el conteo de los cubos de estado. */
export type MachineForStatus = { id: string; operational?: boolean | null; en_espera?: boolean | null; transferida?: boolean | null };

/**
 * Conteo de maquinaria por estado (cubos EXCLUYENTES que suman el total),
 * copia exacta de las líneas 531-534 de EquiposScreen.tsx:
 *  · OPERATIVAS: operativas, SIN avería (en vivo, con reactivación) y SIN estar esperando instrucciones.
 *  · AVERIADAS: operativas con avería vigente (liveStatusOf, respeta reactivación por jornada nueva).
 *  · RETIRADAS: operational=false (sacadas de servicio) y NO transferidas.
 *  · 🔁 TRANSFERIDAS A OTROS (14-oct-2026, a pedido): hermanas de Retirada —
 *    también llevan operational=false, a propósito: así TODO lo que ya excluye
 *    a las retiradas (inspectores, jornadas, crons, QR, flota disponible, mapa)
 *    las excluye igual SIN tocar nada — pero se cuentan y listan aparte, porque
 *    no están dañadas ni de baja: se transfirieron a otros.
 *  · ESPERANDO INSTRUCCIONES: en_espera=true.
 */
/**
 * ⭐ EL ESTADO DE UNA MÁQUINA PARA CONTAR Y FILTRAR — los 6 cubos EXCLUYENTES del
 * Catálogo. Extraída de `EquiposScreen.estadoConteoOf` el 20-oct-2026, cuando el
 * reporte de Conteo de maquinaria pidió filtrar por estos mismos estados («no
 * solo activas e inactivas, sino averiadas, operativas, esperando instrucciones»):
 * en vez de escribir una SÉPTIMA copia de la regla, vive acá y la usan las dos.
 *
 * PRIORIDAD (la misma de las tarjetas del Catálogo, y el orden importa):
 *   retirada/transferida (operational=false) > esperando (en_espera)
 *   > averiada/parada (avería VIGENTE en vivo, respeta la reactivación)
 *   > operativa.
 *
 * `liveEstado` es lo que devuelve `makeLiveStatusOf(...)(id).estado`: se pasa ya
 * resuelto para que esta función sea PURA y se pueda probar sin base de datos.
 */
export type EstadoConteo = 'operativa' | 'averiada' | 'parada' | 'retirada' | 'espera' | 'transferida';
export const ESTADO_CONTEO_ORDER: EstadoConteo[] = ['operativa', 'averiada', 'parada', 'espera', 'retirada', 'transferida'];
/** Etiqueta e ícono de cada estado, SIN colores de tema (cada pantalla pone los suyos). */
export const ESTADO_CONTEO_INFO: Record<EstadoConteo, { label: string; icon: string; hex: string }> = {
  operativa: { label: 'Operativa', icon: '✅', hex: '#15803D' },
  averiada: { label: 'Averiada', icon: '🔴', hex: '#B91C1C' },
  parada: { label: 'Parada', icon: '🟡', hex: '#B45309' },
  espera: { label: 'Esperando instrucciones', icon: '⏳', hex: '#B45309' },
  retirada: { label: 'Retirada', icon: '⬛', hex: '#4B5563' },
  transferida: { label: 'Transferida a otros', icon: '🔁', hex: '#0D9488' },
};
export function estadoConteoDe(
  m: { operational?: boolean | null; en_espera?: boolean | null; transferida?: boolean | null },
  liveEstado: MachineEstado,
): EstadoConteo {
  if (!m.operational) return m.transferida ? 'transferida' : 'retirada';
  if (m.en_espera) return 'espera';
  if (liveEstado === 'averiada') return 'averiada';
  if (liveEstado === 'parada') return 'parada';
  return 'operativa';
}

export function bucketMachineStatus<M extends MachineForStatus>(machines: M[], statusOf: (id: string) => LiveStatus) {
  const averiadaMachines = machines.filter((m) => m.operational !== false && !m.en_espera && statusOf(m.id).estado === 'averiada');
  const activeMachines = machines.filter((m) => m.operational && !m.en_espera && statusOf(m.id).estado !== 'averiada');
  const transferidaMachines = machines.filter((m) => !m.operational && m.transferida === true);
  const retiradaMachines = machines.filter((m) => !m.operational && m.transferida !== true);
  const esperaMachines = machines.filter((m) => m.operational && m.en_espera);
  return { averiadaMachines, activeMachines, retiradaMachines, esperaMachines, transferidaMachines };
}
