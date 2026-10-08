import { supabase, selectAllRows } from './supabase';
import { AlcanceTarifa, AnuladaModo, INICIO_PAGO_VIAJES, MarcaViaje, ModoPago, ModoPagoFila, TarifaViaje, ViajePago } from './pagoViajes';
import { listAsignacionesFrenteRango } from './camionViajes';
import { jornadaDeFecha } from './caracasDay';
import { CAMPOS_VIAJE_PAGO, completarFrentes, mapaAsignaciones, rangoJornadas } from './frentesAuto';

// Lecturas y escrituras del pago de viajes. Las reglas de dinero viven en
// `pagoViajes.ts`; acá solo se habla con la base.
//
// ⭐ Las lecturas LANZAN si fallan: calcular un pago con los datos a medias diría
//    montos equivocados sin avisar.
// ⭐ Las escrituras piden `.select('id')`: un rechazo por permisos vuelve sin error y
//    con 0 filas, y hay que decirlo en vez de dar por guardado lo que no se guardó.

// ⚠️ `tipo_viaje_nombre` y `tipo_viaje_tarifa` TIENEN que viajar acá (28-sep-2026):
//    `calcularPagoViajes` decide con ellas que la tarifa del TIPO manda sobre la de
//    zona. Sin pedirlas, el cálculo nunca veía el tipo y TODOS los viajes se pagaban
//    con la tarifa de zona — 39 cruces «Este → Oeste» de $100 salían a $50.
const COLS_VIAJE =
  'id, machinery_id, machine_code, company_id, zona_pago, registered_at, estado_maquina, folio, origen, fuera_catalogo, placa_snap, ubicacion_nombre, listero_name, tipo_viaje_id, tipo_viaje_nombre, tipo_viaje_tarifa, tipo_viaje_unidad, peso_neto_kg, frente_nombre';

export const SIN_PERMISO_PAGO = 'No se guardó: hace falta permiso completo en Viajes de camiones.';

export type DatosPagoViajes = {
  viajes: ViajePago[];
  modos: ModoPagoFila[];
  tarifas: TarifaViaje[];
  marcas: MarcaViaje[];
  /** id → nombre de la empresa, para mostrar la empresa GUARDADA en cada viaje. */
  empresas: Map<string, string>;
  /**
   * id del camión → lo que el catálogo sabe y el viaje no guarda (marca, modelo, placa,
   * serial, encargado). Solo para las columnas opcionales del PDF (21-sep-2026): NO
   * entra en ningún cálculo de plata.
   */
  fichas: Map<string, { marca: string | null; modelo: string | null; placa: string | null; serial: string | null; encargado: string | null }>;
};

/** Viajes desde el inicio del pago (jornada del 14-sep a las 7am), modos, tarifas, marcas y empresas. */
export async function cargarDatosPagoViajes(desdeJornada: string = INICIO_PAGO_VIAJES): Promise<DatosPagoViajes> {
  const [viajes, modos, tarifas, marcas, empresas, maquinas] = await Promise.all([
    selectAllRows('camion_viajes', COLS_VIAJE, (q: any) => q.gte('registered_at', `${desdeJornada}T07:00:00-04:00`)),
    cargarModosPago(),
    cargarTarifasViaje(),
    selectAllRows('viaje_pago_marcas', 'id, viaje_id, facturable, motivo, created_at, created_by_nombre'),
    selectAllRows('companies', 'id, name'),
    selectAllRows('machinery', 'id, marca, modelo, plate, serial, encargado'),
  ]);
  return {
    // ⛏️ EL FRENTE DEL DÍA, TAMBIÉN ACÁ (29-sep-2026). El reporte de pago agrupa
    //    y rotula por frente; si la oficina asignó el frente después de que el
    //    listero registrara, ese viaje saldría en «sin frente» en un papel y con
    //    su frente en el otro. La regla es UNA sola (`frentesAuto.ts`) y no
    //    mueve un centavo: el frente solo agrupa.
    viajes: await conFrenteDelDia(viajes as ViajePago[]),
    modos,
    tarifas,
    marcas: marcas as MarcaViaje[],
    empresas: new Map((empresas as any[]).map((c) => [c.id as string, String(c.name ?? '')])),
    fichas: new Map((maquinas as any[]).map((m) => [m.id as string, {
      marca: m.marca ?? null, modelo: m.modelo ?? null, placa: m.plate ?? null, serial: m.serial ?? null, encargado: m.encargado ?? null,
    }])),
  };
}

/**
 * Completa el frente VACÍO de cada viaje con el asignado a su camión esa
 * jornada. Misma regla y mismo código que la pantalla de viajes; acá solo se
 * aplica a la fila cruda (snake_case). Si todos traen frente, no hay consulta.
 */
async function conFrenteDelDia(viajes: ViajePago[]): Promise<ViajePago[]> {
  const sinFrente = viajes.filter((v: any) => v.machinery_id && !CAMPOS_VIAJE_PAGO.tieneFrente(v));
  const rango = rangoJornadas(sinFrente.map((v: any) => jornadaDeFecha(new Date(v.registered_at))));
  if (!rango) return viajes;
  const { asignaciones } = await listAsignacionesFrenteRango(rango.desde, rango.hasta);
  if (asignaciones.length === 0) return viajes;
  const { filas } = completarFrentes(
    viajes, mapaAsignaciones(asignaciones),
    (iso) => jornadaDeFecha(new Date(iso)), CAMPOS_VIAJE_PAGO,
  );
  return filas;
}

/** Historial completo de modos de pago (tabla chica). */
export async function cargarModosPago(): Promise<ModoPagoFila[]> {
  return (await selectAllRows('machinery_modo_pago', 'id, machinery_id, modo, desde, nota, created_at, created_by_nombre')) as ModoPagoFila[];
}

/** Tarifas con sus camiones (los de grupo o de camión).
 *
 *  ⚠️ `anulada_modo` (08-oct-2026) puede no existir todavía en la base: si falta, se
 *     relee sin ella en vez de tumbar todo el pago. Sin la columna, `anuladaModo`
 *     devuelve 'siempre' y las anuladas se portan como siempre se portaron. */
const COLS_TARIFA = 'id, zona, precio, desde, hasta, nota, created_at, created_by_nombre, anulada_at, anulada_motivo, alcance, company_id, grupo_nombre, camiones:viaje_tarifa_camiones(machinery_id)';

export async function cargarTarifasViaje(): Promise<TarifaViaje[]> {
  let rows: unknown[];
  try {
    rows = await selectAllRows('viaje_tarifas', COLS_TARIFA.replace('anulada_motivo,', 'anulada_motivo, anulada_modo,'));
  } catch (e: any) {
    if (e?.code !== '42703') throw e;
    rows = await selectAllRows('viaje_tarifas', COLS_TARIFA);
  }
  return (rows as any[]).map(({ camiones, ...t }) => ({
    ...t,
    machinery_ids: ((camiones ?? []) as { machinery_id: string }[]).map((c) => c.machinery_id),
  })) as TarifaViaje[];
}

export type CamionCatalogo = { id: string; code: string; plate: string | null; serial: string | null; companyId: string | null; company: string; activa: boolean };

/**
 * Catálogo para el pago: la pantalla filtra cuáles son camiones (`esCamionDeViajes`).
 *
 * ⭐ Trae TAMBIÉN las inactivas, marcadas con `activa: false`. Antes se pedían solo las
 *    activas, y un camión que ya estaba en el pago y luego se dio de baja seguía cobrando
 *    sin que nadie pudiera quitarlo: no salía en la pestaña Camiones.
 */
export async function cargarMaquinasCatalogo(): Promise<CamionCatalogo[]> {
  const rows = await selectAllRows('machinery', 'id, code, plate, serial, active, company_id, company:company_id(name)');
  return (rows as any[]).map((m) => ({
    id: m.id,
    code: m.code ?? '—',
    plate: m.plate ?? null,
    serial: m.serial ?? null,
    companyId: m.company_id ?? null,
    company: m.company?.name ?? 'Sin empresa',
    activa: m.active !== false,
  }));
}

/**
 * Crea una tarifa y, si es de grupo o de camión, sus camiones, en UNA sola transacción
 * (función `crear_tarifa_viaje`): nunca queda una tarifa de grupo sin camiones.
 */
export async function crearTarifaViaje(t: {
  zona: string | null; precio: number; desde: string; hasta?: string | null; nota?: string | null;
  alcance?: AlcanceTarifa; companyId?: string | null; grupoNombre?: string | null; camiones?: string[];
}): Promise<{ error?: string }> {
  const { data, error } = await supabase.rpc('crear_tarifa_viaje', {
    p_zona: t.zona || null,
    p_precio: t.precio,
    p_desde: t.desde,
    p_hasta: t.hasta || null,
    p_nota: t.nota?.trim() || null,
    p_alcance: t.alcance ?? 'general',
    p_company_id: t.alcance === 'empresa' ? t.companyId || null : null,
    p_grupo_nombre: t.alcance === 'grupo' ? t.grupoNombre?.trim() || null : null,
    p_camiones: t.alcance === 'grupo' || t.alcance === 'camion' ? t.camiones ?? [] : [],
  });
  if (error) return { error: error.code === '42501' ? SIN_PERMISO_PAGO : error.message };
  if (!data) return { error: SIN_PERMISO_PAGO };
  return {};
}

/**
 * Cuántos viajes YA REGISTRADOS caen en ese tramo de jornadas (7am a 7am). Se usa solo
 * para AVISAR antes de guardar una tarifa con fecha pasada (08-oct-2026): es un conteo
 * de cabecera, no baja ni una fila.
 */
export async function contarViajesEnJornadas(desde: string, hasta: string): Promise<number> {
  const finDelDia = new Date(Date.parse(`${hasta}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);
  const { count, error } = await supabase
    .from('camion_viajes')
    .select('id', { count: 'exact', head: true })
    .gte('registered_at', `${desde}T07:00:00-04:00`)
    .lt('registered_at', `${finDelDia}T07:00:00-04:00`);
  if (error) throw error;
  return count ?? 0;
}

/**
 * Anula una tarifa. `modo` decide qué pasa con los días que YA rigió (08-oct-2026):
 *   · 'desde_ahora' → siguió rigiendo hasta hoy; el histórico NO se mueve. Es lo normal
 *     al cambiar un precio, y lo que la pantalla propone.
 *   · 'siempre'     → fue un error: se borra su efecto en TODAS las fechas (lo que hacía
 *     siempre, y lo que dejó 1.157 viajes de septiembre «sin tarifa»).
 *
 * ⚠️ Si la columna `anulada_modo` todavía no existe en la base, el update falla con
 *    42703 y se reintenta sin ella: así la pantalla nueva funciona contra la base vieja
 *    (se comporta como 'siempre', que es como se portó siempre).
 */
export async function anularTarifaViaje(id: string, motivo: string, usuarioId: string | null, modo: AnuladaModo = 'desde_ahora'): Promise<{ error?: string }> {
  const base = { anulada_at: new Date().toISOString(), anulada_por: usuarioId, anulada_motivo: motivo.trim() || null };
  const intentar = (patch: Record<string, unknown>) =>
    supabase.from('viaje_tarifas').update(patch).eq('id', id).is('anulada_at', null).select('id');
  let { data, error } = await intentar({ ...base, anulada_modo: modo });
  if (error?.code === '42703') ({ data, error } = await intentar(base));
  if (error) return { error: error.message };
  if (!data?.length) return { error: `${SIN_PERMISO_PAGO} (o esa tarifa ya estaba anulada)` };
  return {};
}

/** Pone el modo a varias máquinas desde una fecha. Nunca pisa el historial: agrega filas. */
export async function asignarModoPago(machineryIds: string[], modo: ModoPago, desde: string, nota?: string | null): Promise<{ error?: string; guardadas: number }> {
  const ids = Array.from(new Set(machineryIds.filter(Boolean)));
  let guardadas = 0;
  for (let i = 0; i < ids.length; i += 200) {
    const filas = ids.slice(i, i + 200).map((machinery_id) => ({ machinery_id, modo, desde, nota: nota?.trim() || null }));
    const { data, error } = await supabase.from('machinery_modo_pago').insert(filas).select('id');
    if (error) return { error: error.message, guardadas };
    if (!data?.length) return { error: SIN_PERMISO_PAGO, guardadas };
    guardadas += data.length;
  }
  return { guardadas };
}

export async function marcarViajePago(viajeId: string, facturable: boolean, motivo?: string | null): Promise<{ error?: string }> {
  const { data, error } = await supabase
    .from('viaje_pago_marcas')
    .insert({ viaje_id: viajeId, facturable, motivo: motivo?.trim() || null })
    .select('id');
  if (error) return { error: error.message };
  if (!data?.length) return { error: SIN_PERMISO_PAGO };
  return {};
}
