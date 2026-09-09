// CUBICAJE GUARDADO EN LA BASE (09-sep-2026).
//
// Pedido del cliente: «necesito poder buscar por día, por fecha en específico, o
// mes, día, cualquier opción de filtrado que necesite, o buscar un camión en
// específico». Con las medidas viviendo en el navegador de cada quien eso no se
// podía: no había histórico que consultar y su compañera no veía nada.
//
// Dos tablas, creadas por `03_cubicaje_camiones.sql` (fuera del repositorio,
// porque es público):
//   · camion_cubicaje        → la MEDIDA de la tolva. Una fila por camión.
//   · camion_cubicaje_carga  → los m³ CARGADOS. Una fila por camión y JORNADA.
//
// ⚠️ EL CATÁLOGO SE SIGUE SOLO LEYENDO. Estas dos tablas son nuevas y apuntan a
//    `machinery` con una clave foránea; no se le agrega ni se le cambia nada.
//
// ⚠️ TODO ESTO TIENE QUE FUNCIONAR ANTES DE QUE EL SQL SE CORRA. Si las tablas
//    no existen, cada función devuelve `missing: true` y la pantalla sigue
//    trabajando con las medidas del navegador, exactamente como antes, avisando
//    de que falta correrlo. Nunca se queda en blanco ni revienta.
import { supabase, selectAllRows } from './supabase';
import { redondear } from './cubicaje';

export const TABLA_MEDIDAS = 'camion_cubicaje';
export const TABLA_CARGAS = 'camion_cubicaje_carga';

export const AVISO_SIN_SQL =
  'Falta correr en Supabase el SQL «03_cubicaje_camiones.sql». Hasta que se corra, las medidas se guardan solo en este dispositivo y no hay histórico que buscar.';

/** ¿El error es «esa tabla no existe»? Postgres da 42P01; PostgREST además lo
 *  dice en el texto y, cuando no conoce el recurso, contesta PGRST205. Se miran
 *  los tres: un aviso equivocado acá manda a correr un SQL que ya está corrido. */
export function faltaLaTabla(mensaje: string | null | undefined): boolean {
  const t = String(mensaje ?? '').toLowerCase();
  return t.includes('42p01') || t.includes('pgrst205')
    || (t.includes('does not exist') && (t.includes('relation') || t.includes('table')))
    || t.includes('could not find the table');
}

// ── LAS MEDIDAS ─────────────────────────────────────────────────────────────

export type MedidaGuardada = {
  machinery_id: string;
  ident: string;
  marca: string | null;
  modelo: string | null;
  alto: number;
  largo: number;
  ancho: number;
  /** La calcula la BASE (columna generada). La app no la puede contradecir. */
  m3: number;
  updated_at?: string | null;
  updated_by?: string | null;
};

export async function listarMedidas(): Promise<{ rows: MedidaGuardada[]; missing: boolean; error: string | null }> {
  try {
    const data = await selectAllRows(TABLA_MEDIDAS, 'machinery_id, ident, marca, modelo, alto, largo, ancho, m3, updated_at, updated_by');
    return { rows: (data ?? []) as MedidaGuardada[], missing: false, error: null };
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    if (faltaLaTabla(msg)) return { rows: [], missing: true, error: null };
    return { rows: [], missing: false, error: msg };
  }
}

export type MedidaNueva = {
  machinery_id: string;
  ident: string;
  marca?: string | null;
  modelo?: string | null;
  alto: number;
  largo: number;
  ancho: number;
};

/** Un camión, una tolva: se sobrescribe la que hubiera. El `m3` NO se manda —
 *  lo calcula la base a partir de las tres medidas. */
export async function guardarMedida(m: MedidaNueva, userId: string | null): Promise<{ error?: string; missing?: boolean }> {
  const { error } = await supabase.from(TABLA_MEDIDAS).upsert({
    machinery_id: m.machinery_id,
    ident: m.ident,
    marca: m.marca ?? null,
    modelo: m.modelo ?? null,
    alto: m.alto,
    largo: m.largo,
    ancho: m.ancho,
    updated_by: userId,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'machinery_id' });
  if (error) return faltaLaTabla(error.message) ? { missing: true, error: AVISO_SIN_SQL } : { error: error.message };
  return {};
}

export async function borrarMedida(machineryId: string): Promise<{ error?: string; missing?: boolean }> {
  const { error } = await supabase.from(TABLA_MEDIDAS).delete().eq('machinery_id', machineryId);
  if (error) return faltaLaTabla(error.message) ? { missing: true, error: AVISO_SIN_SQL } : { error: error.message };
  return {};
}

// ── LOS METROS CÚBICOS CARGADOS, DÍA POR DÍA ────────────────────────────────

export type CargaGuardada = {
  id: string;
  machinery_id: string;
  machine_code: string;
  /** Jornada (7am a 7am), en `YYYY-MM-DD`. NO es el día de calendario. */
  jornada: string;
  m3: number;
  /** Viajes que cubría ese m³ al guardarlo. Si hoy hay otros, se avisa. */
  viajes: number;
  modo: 'tolva' | 'proporcional' | 'manual';
  nota: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  updated_by?: string | null;
};

/**
 * Las cargas de un rango de jornadas, opcionalmente de unos camiones.
 *
 * `hasta` es INCLUSIVO: es una fecha de jornada, no un instante. Acá no aplica
 * el semiabierto de los viajes (que sí corta por hora), y usar `lt` dejaría
 * fuera el último día del rango sin que nada lo dijera.
 */
export async function listarCargas(opts: {
  desde: string;
  hasta: string;
  machineryIds?: string[];
}): Promise<{ rows: CargaGuardada[]; missing: boolean; error: string | null }> {
  try {
    const data = await selectAllRows(
      TABLA_CARGAS,
      'id, machinery_id, machine_code, jornada, m3, viajes, modo, nota, created_at, updated_at, updated_by',
      (q: any) => {
        let s = q.gte('jornada', opts.desde).lte('jornada', opts.hasta);
        if (opts.machineryIds && opts.machineryIds.length) s = s.in('machinery_id', opts.machineryIds);
        return s.order('jornada', { ascending: false });
      }
    );
    return { rows: (data ?? []) as CargaGuardada[], missing: false, error: null };
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    if (faltaLaTabla(msg)) return { rows: [], missing: true, error: null };
    return { rows: [], missing: false, error: msg };
  }
}

export type CargaNueva = {
  machinery_id: string;
  machine_code: string;
  jornada: string;
  m3: number;
  viajes: number;
  modo: 'tolva' | 'proporcional' | 'manual';
  nota?: string | null;
};

/**
 * Guarda (o corrige) los m³ de varios camiones y varias jornadas de una vez.
 *
 * ⚠️ Es un UPSERT por (camión, jornada). Volver a guardar el mismo rango
 *    ACTUALIZA las filas, no las duplica: sin eso, guardar dos veces dejaba el
 *    doble de volumen en el histórico y el reporte cobraba de más.
 *
 * ⚠️ Se manda en tandas. Un rango de un mes con 30 camiones son 900 filas, y un
 *    solo `upsert` de ese tamaño con la señal del patio se queda colgado.
 */
export async function guardarCargas(
  filas: CargaNueva[],
  userId: string | null,
): Promise<{ error?: string; missing?: boolean; guardadas: number }> {
  if (!filas.length) return { guardadas: 0 };
  const ahora = new Date().toISOString();
  const payload = filas.map((f) => ({
    machinery_id: f.machinery_id,
    machine_code: f.machine_code,
    jornada: f.jornada,
    m3: redondear(f.m3),
    viajes: f.viajes,
    modo: f.modo,
    nota: f.nota ?? null,
    created_by: userId,
    updated_by: userId,
    updated_at: ahora,
  }));

  const TANDA = 200;
  let guardadas = 0;
  for (let i = 0; i < payload.length; i += TANDA) {
    const trozo = payload.slice(i, i + TANDA);
    const { error } = await supabase.from(TABLA_CARGAS).upsert(trozo, { onConflict: 'machinery_id,jornada' });
    if (error) {
      // ⚠️ Se devuelve CUÁNTAS entraron antes de fallar. Decir solo «falló»
      //    cuando ya se guardaron 400 filas hace que se vuelva a intentar todo
      //    a ciegas sin saber qué quedó — y el upsert lo permite, pero el
      //    usuario merece saber en qué estado quedó.
      if (faltaLaTabla(error.message)) return { missing: true, error: AVISO_SIN_SQL, guardadas };
      return { error: error.message, guardadas };
    }
    guardadas += trozo.length;
  }
  return { guardadas };
}

export async function borrarCargas(ids: string[]): Promise<{ error?: string; missing?: boolean }> {
  if (!ids.length) return {};
  const { error } = await supabase.from(TABLA_CARGAS).delete().in('id', ids);
  if (error) return faltaLaTabla(error.message) ? { missing: true, error: AVISO_SIN_SQL } : { error: error.message };
  return {};
}
