import { supabase, selectAllRows } from './supabase';

/**
 * VIAJES DE CAMIONES: bitácora de viajes (regreso/entrada = un viaje) registrada
 * por listeros en campo, sobre camiones de volteo (filas de `machinery`). Ver
 * `supabase/viajes_camiones.sql`.
 *
 * El chofer/responsable NO se duplica a mano en cada viaje: se resuelve desde
 * `machine_operators` (la asignación planeada por turno que ya administra el
 * Coordinador de Operadores, ver `src/lib/machineOperators.ts`) y se copia como
 * snapshot (`chofer_name`) al momento del viaje — si luego cambia el chofer
 * asignado, los viajes ya registrados conservan el nombre de quién iba en ese
 * momento.
 *
 * RLS de `camion_viajes`/`camion_viajes_config` está abierta a 'authenticated'
 * (using(true)): el control de quién puede registrar/editar/borrar se hace en
 * la UI/módulo (mismo criterio que `machine_operators`/`coordinator_*_scope`),
 * no aquí. Las funciones que dicen "se valida en la pantalla" NO repiten ese
 * chequeo — confían en que quien las llama ya lo hizo.
 */

/**
 * ¿El error es «todavía no se corrió el .sql», o es un error de verdad?
 *
 * ⚠️ La versión anterior hacía match con **el nombre de la tabla**
 * (`/camion_viajes|relation|.../`), y como CASI TODO error de PostgREST sobre
 * esta tabla lleva su nombre en el mensaje, clasificaba como «falta la tabla»
 * una violación de clave foránea, del CHECK `cv_fuera_catalogo_coherente` o de
 * RLS. Al listero le salía «Falta configurar la tabla en la base de datos.
 * Avisa al administrador» cuando el problema era otro y él podía resolverlo.
 *
 * Ahora se clasifica por CÓDIGO, que es un dato, no una adivinanza sobre texto.
 */
function isMissingTable(msg: string, code?: string): boolean {
  // 42P01 tabla inexistente · 42703 columna inexistente · PGRST205 fuera del schema cache
  if (code === '42P01' || code === '42703' || code === 'PGRST205') return true;
  return /does not exist|schema cache|could not find the (table|column)/i.test(String(msg || ''));
}

export type CamionViajeRow = {
  id: string;
  /** null SOLO cuando `fueraCatalogo` es true: ese camión no existe en `machinery`. */
  machineryId: string | null;
  machineCode: string;
  /** El listero anotó un camión que NO está en el catálogo. Vive solo en esta fila:
   *  no se crea nada en `machinery` ni en ningún otro módulo. Ver
   *  `supabase/viajes_camion_fuera_catalogo.sql`. */
  fueraCatalogo: boolean;
  /** Referencia libre del camión de fuera (placa, empresa, seña). Nota de campo. */
  camionRef: string | null;
  listeroId: string;
  listeroName: string;
  choferName: string | null;
  shift: 'day' | 'night' | null;
  estadoMaquina: string | null;
  note: string | null;
  registeredAt: string; // ISO
  /** Clave de idempotencia del registro. Sirve para saber si una fila que está
   *  en la cola local YA llegó al servidor, y no pintarla dos veces. */
  clientActionId: string | null;
};

function mapRow(r: any): CamionViajeRow {
  return {
    id: r.id as string,
    machineryId: (r.machinery_id ?? null) as string | null,
    machineCode: (r.machine_code ?? '—') as string,
    // `?? false` y no `as boolean`: si todavía no se corrió
    // supabase/viajes_camion_fuera_catalogo.sql la columna no existe y llega
    // `undefined`. Todo lo viejo es del catálogo, así que false es lo correcto.
    fueraCatalogo: r.fuera_catalogo === true,
    camionRef: (r.camion_ref ?? null) as string | null,
    listeroId: r.listero_id as string,
    listeroName: (r.listero_name ?? '—') as string,
    choferName: (r.chofer_name ?? null) as string | null,
    shift: (r.shift === 'night' ? 'night' : r.shift === 'day' ? 'day' : null) as 'day' | 'night' | null,
    estadoMaquina: (r.estado_maquina ?? null) as string | null,
    note: (r.note ?? null) as string | null,
    registeredAt: r.registered_at as string,
    clientActionId: (r.client_action_id ?? null) as string | null,
  };
}

const SELECT_COLS = 'id, machinery_id, machine_code, fuera_catalogo, camion_ref, listero_id, listero_name, chofer_name, shift, estado_maquina, note, registered_at, client_action_id';

/** Registra un viaje. `registeredAt` ya viene calculado por quien llama (la hora
 *  REAL del toque en el teléfono) — se inserta TAL CUAL, nunca `now()` del
 *  servidor (necesario para que un viaje registrado sin señal conserve su hora
 *  exacta al sincronizarse después, ver `src/lib/viajesOfflineQueue.ts`). */
export async function registrarViaje(params: {
  /** null SOLO si `fueraCatalogo` es true. */
  machineryId: string | null;
  machineCode: string;
  /** Camión anotado a mano por el listero, que NO está en el catálogo. */
  fueraCatalogo?: boolean;
  camionRef?: string | null;
  listeroId: string;
  listeroName: string;
  choferName: string | null;
  shift: 'day' | 'night' | null;
  estadoMaquina: string | null;
  note?: string | null;
  registeredAt: string; // ISO
  clientActionId?: string;
}): Promise<{ error?: string; missing?: boolean }> {
  // Las dos clases de viaje son EXCLUYENTES y la BD lo exige con un CHECK
  // (`cv_fuera_catalogo_coherente`). Se normaliza acá para que un error de quien
  // llama no llegue a la base como una violación de constraint sin explicación.
  const fuera = params.fueraCatalogo === true;
  const { error } = await supabase.from('camion_viajes').insert({
    machinery_id: fuera ? null : params.machineryId,
    machine_code: params.machineCode,
    fuera_catalogo: fuera,
    camion_ref: fuera ? (params.camionRef ?? null) : null,
    listero_id: params.listeroId,
    listero_name: params.listeroName,
    chofer_name: params.choferName,
    shift: params.shift,
    estado_maquina: params.estadoMaquina,
    note: params.note ?? null,
    registered_at: params.registeredAt,
    ...(params.clientActionId ? { client_action_id: params.clientActionId } : {}),
  });
  if (error) return { error: error.message, missing: isMissingTable(error.message, (error as any).code) };
  return {};
}

/**
 * `selectAllRows` pagina ordenando por `id` (orden estable, obligatorio para que
 * el `.range()` no salte ni repita filas), así que el orden cronológico se
 * pierde y hay que rehacerlo acá. Mismo criterio que MantenimientoMaquinaria.
 */
function porFechaDesc(a: CamionViajeRow, b: CamionViajeRow): number {
  return new Date(b.registeredAt).getTime() - new Date(a.registeredAt).getTime();
}

/**
 * Traduce lo que lanza `selectAllRows` al contrato de estas funciones.
 *
 * ⚠️ `error` se DEVUELVE, no se tira. Antes las dos listas hacían
 * `if (error) return { rows: [] }` y se comían el mensaje: una consulta que
 * reventaba se veía EXACTAMENTE igual que «no hay viajes». El listero leía
 * «Todavía no registras viajes hoy» con sus viajes intactos en la base.
 */
function fallo(e: any): { rows: CamionViajeRow[]; missing: boolean; error: string } {
  const msg = String(e?.message ?? e);
  return { rows: [], missing: isMissingTable(msg, e?.code), error: msg };
}

/** Viajes del listero indicado dentro de un rango (normalmente "hoy", según su
 *  jornada) — para su propia pantalla de registro. Más reciente primero. */
export async function listMisViajesHoy(
  listeroId: string,
  desdeISO: string,
  /** ⚠️ EXCLUSIVO: se compara con `<`, no con `<=`. Es el inicio del día
   *  siguiente, no las 23:59:59 — con `23:59:59` un viaje entre .001 y .999
   *  no caía en NINGÚN día. */
  hastaExclusivoISO: string,
): Promise<{ rows: CamionViajeRow[]; missing: boolean; error?: string }> {
  if (!listeroId) return { rows: [], missing: false };
  try {
    // PAGINADO: un `.select()` pelado corta en ~1000 filas y, como el orden era
    // descendente, se comía los viajes MÁS VIEJOS del rango sin avisar.
    const data = await selectAllRows('camion_viajes', SELECT_COLS, (q: any) =>
      q.eq('listero_id', listeroId)
        .gte('registered_at', desdeISO)
        .lt('registered_at', hastaExclusivoISO));
    return { rows: (data as any[]).map(mapRow).sort(porFechaDesc), missing: false };
  } catch (e: any) {
    return fallo(e);
  }
}

/** TODOS los viajes en un rango, con filtros opcionales por listero y/o
 *  máquina — para la pantalla de la jefa/admin (reporte general). */
export async function listTodosLosViajes(filtro: {
  desdeISO: string;
  /** ⚠️ EXCLUSIVO (`<`). Omitirlo = sin tope superior, que es lo correcto para
   *  la alerta de «camión sin viajes»: acotar con "ahora" dejaba fuera el viaje
   *  de un teléfono con el reloj adelantado. */
  hastaExclusivoISO?: string;
  listeroIds?: string[];
  machineryIds?: string[];
}): Promise<{ rows: CamionViajeRow[]; missing: boolean; error?: string }> {
  try {
    const data = await selectAllRows('camion_viajes', SELECT_COLS, (q: any) => {
      let qq = q.gte('registered_at', filtro.desdeISO);
      if (filtro.hastaExclusivoISO) qq = qq.lt('registered_at', filtro.hastaExclusivoISO);
      if (filtro.listeroIds && filtro.listeroIds.length > 0) qq = qq.in('listero_id', filtro.listeroIds);
      if (filtro.machineryIds && filtro.machineryIds.length > 0) qq = qq.in('machinery_id', filtro.machineryIds);
      return qq;
    });
    return { rows: (data as any[]).map(mapRow).sort(porFechaDesc), missing: false };
  } catch (e: any) {
    return fallo(e);
  }
}

/** Corrige la hora de un viaje ya registrado. El listero solo debe poder
 *  llamar esto sobre sus PROPIOS viajes — se valida en la pantalla, no aquí. */
export async function editarHoraViaje(id: string, registeredAtISO: string): Promise<{ error?: string }> {
  // `.select('id')` para distinguir «actualizado» de «no había fila que actualizar»:
  // sin él, corregir la hora de un viaje que otro usuario ya borró devolvía
  // ÉXITO y la corrección se perdía sin que nadie lo notara.
  const { data, error } = await supabase.from('camion_viajes').update({ registered_at: registeredAtISO }).eq('id', id).select('id');
  if (error) return { error: error.message };
  if (!data || data.length === 0) return { error: 'Ese viaje ya no existe (puede haberlo borrado otro usuario). Refresca la lista.' };
  return {};
}

/** Borrado real (hard delete) — la auditoría automática (`trg_audit`) conserva
 *  el registro completo igual. Solo debe quedar accesible desde la UI para
 *  nivel "full" del módulo (jefa/admin) — se valida en la pantalla, no aquí. */
export async function borrarViaje(id: string): Promise<{ error?: string }> {
  const { data, error } = await supabase.from('camion_viajes').delete().eq('id', id).select('id');
  if (error) return { error: error.message };
  if (!data || data.length === 0) return { error: 'Ese viaje ya no existe (puede haberlo borrado otro usuario). Refresca la lista.' };
  return {};
}

/** Meta de viajes/día por camión (columna `machinery.meta_viajes_diarios`,
 *  NULL = sin meta definida). Batch por lista de IDs. */
export async function getMetasPorCamion(machineryIds: string[]): Promise<Record<string, number | null>> {
  const out: Record<string, number | null> = {};
  if (!machineryIds || machineryIds.length === 0) return out;
  try {
    const data = await selectAllRows('machinery', 'id, meta_viajes_diarios', (q: any) => q.in('id', machineryIds));
    (data as any[]).forEach((r) => { out[r.id as string] = (r.meta_viajes_diarios ?? null) as number | null; });
  } catch (e: any) {
    // Antes era `if (error) return out;`: las metas desaparecían de la pantalla
    // sin ninguna señal, indistinguible de «ningún camión tiene meta puesta».
    console.warn('[camionViajes] getMetasPorCamion falló:', String(e?.message ?? e));
  }
  return out;
}

export async function setMetaCamion(machineryId: string, meta: number | null): Promise<{ error?: string }> {
  const { error } = await supabase.from('machinery').update({ meta_viajes_diarios: meta }).eq('id', machineryId);
  if (error) return { error: error.message };
  return {};
}

const DEFAULT_ALERTA_HORAS = 6;

/** Umbral configurable de "camión sin viajes hace X horas" (singleton
 *  `camion_viajes_config`). Si falla o falta la tabla, usa el default (6h)
 *  para no bloquear la alerta por un problema de configuración. */
export async function getAlertaHoras(): Promise<number> {
  const { data, error } = await supabase.from('camion_viajes_config').select('alerta_horas_sin_viaje').eq('id', true).maybeSingle();
  if (error || !data) return DEFAULT_ALERTA_HORAS;
  const n = Number((data as any).alerta_horas_sin_viaje);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_ALERTA_HORAS;
}

export async function setAlertaHoras(horas: number, userId: string): Promise<{ error?: string }> {
  const { error } = await supabase
    .from('camion_viajes_config')
    .update({ alerta_horas_sin_viaje: horas, updated_by: userId, updated_at: new Date().toISOString() })
    .eq('id', true);
  if (error) return { error: error.message };
  return {};
}

/** Chofer PLANEADO del turno (tabla `machine_operators`, ya administrada por el
 *  Coordinador de Operadores — NO se modifica aquí, solo se lee, mismo patrón
 *  de `listOperatorAssignments` en `src/lib/machineOperators.ts`: nombre VIVO
 *  desde `employees` si hay `employee_id`, si no el `operator_name` congelado).
 *  `null` si no hay nadie asignado a esa máquina en ese turno (o si falla). */
export async function resolveChoferActual(machineryId: string, shift: 'day' | 'night'): Promise<string | null> {
  if (!machineryId) return null;
  const { data, error } = await supabase
    .from('machine_operators')
    .select('employee_id, operator_name')
    .eq('machinery_id', machineryId)
    .eq('shift', shift)
    .eq('active', true)
    .maybeSingle();
  // Se devuelve `null` en los dos casos —falla la consulta o no hay nadie
  // asignado— porque el viaje NO se puede bloquear por esto. Pero el fallo se
  // deja anotado: sin el aviso, un viaje guardado sin chofer por un problema de
  // red se ve idéntico a uno de un camión que de verdad no tiene chofer
  // asignado, y ese dato ya no se recupera (queda congelado en la fila).
  if (error) { console.warn('[camionViajes] no se pudo leer el chofer del turno:', error.message); return null; }
  if (!data) return null;
  const employeeId = (data as any).employee_id as string | null;
  const operatorName = (data as any).operator_name as string | null;
  if (employeeId) {
    const { data: emp } = await supabase.from('employees').select('first_name, last_name').eq('id', employeeId).maybeSingle();
    const nm = emp ? `${(emp as any).first_name ?? ''} ${(emp as any).last_name ?? ''}`.trim() : '';
    if (nm) return nm;
  }
  return operatorName ?? null;
}
