import { supabase, selectAllRows } from './supabase';
import { AlcanceTarifa, INICIO_PAGO_VIAJES, MarcaViaje, ModoPago, ModoPagoFila, TarifaViaje, ViajePago } from './pagoViajes';

// Lecturas y escrituras del pago de viajes. Las reglas de dinero viven en
// `pagoViajes.ts`; acá solo se habla con la base.
//
// ⭐ Las lecturas LANZAN si fallan: calcular un pago con los datos a medias diría
//    montos equivocados sin avisar.
// ⭐ Las escrituras piden `.select('id')`: un rechazo por permisos vuelve sin error y
//    con 0 filas, y hay que decirlo en vez de dar por guardado lo que no se guardó.

const COLS_VIAJE =
  'id, machinery_id, machine_code, company_id, zona_pago, registered_at, estado_maquina, folio, origen, fuera_catalogo, placa_snap, ubicacion_nombre, listero_name';

export const SIN_PERMISO_PAGO = 'No se guardó: hace falta permiso completo en Viajes de camiones.';

export type DatosPagoViajes = {
  viajes: ViajePago[];
  modos: ModoPagoFila[];
  tarifas: TarifaViaje[];
  marcas: MarcaViaje[];
  /** id → nombre de la empresa, para mostrar la empresa GUARDADA en cada viaje. */
  empresas: Map<string, string>;
};

/** Viajes desde el inicio del pago (jornada del 15-sep a las 7am), modos, tarifas, marcas y empresas. */
export async function cargarDatosPagoViajes(desdeJornada: string = INICIO_PAGO_VIAJES): Promise<DatosPagoViajes> {
  const [viajes, modos, tarifas, marcas, empresas] = await Promise.all([
    selectAllRows('camion_viajes', COLS_VIAJE, (q: any) => q.gte('registered_at', `${desdeJornada}T07:00:00-04:00`)),
    cargarModosPago(),
    cargarTarifasViaje(),
    selectAllRows('viaje_pago_marcas', 'id, viaje_id, facturable, motivo, created_at, created_by_nombre'),
    selectAllRows('companies', 'id, name'),
  ]);
  return {
    viajes: viajes as ViajePago[],
    modos,
    tarifas,
    marcas: marcas as MarcaViaje[],
    empresas: new Map((empresas as any[]).map((c) => [c.id as string, String(c.name ?? '')])),
  };
}

/** Historial completo de modos de pago (tabla chica). */
export async function cargarModosPago(): Promise<ModoPagoFila[]> {
  return (await selectAllRows('machinery_modo_pago', 'id, machinery_id, modo, desde, nota, created_at, created_by_nombre')) as ModoPagoFila[];
}

/** Tarifas con sus camiones (los de grupo o de camión). */
export async function cargarTarifasViaje(): Promise<TarifaViaje[]> {
  const rows = await selectAllRows(
    'viaje_tarifas',
    'id, zona, precio, desde, hasta, nota, created_at, created_by_nombre, anulada_at, anulada_motivo, alcance, company_id, grupo_nombre, camiones:viaje_tarifa_camiones(machinery_id)',
  );
  return (rows as any[]).map(({ camiones, ...t }) => ({
    ...t,
    machinery_ids: ((camiones ?? []) as { machinery_id: string }[]).map((c) => c.machinery_id),
  })) as TarifaViaje[];
}

export type CamionCatalogo = { id: string; code: string; plate: string | null; serial: string | null; companyId: string | null; company: string };

/** Máquinas activas del catálogo (la pantalla filtra cuáles son camiones). */
export async function cargarMaquinasActivas(): Promise<CamionCatalogo[]> {
  const rows = await selectAllRows('machinery', 'id, code, plate, serial, company_id, company:company_id(name)', (q: any) => q.eq('active', true));
  return (rows as any[]).map((m) => ({
    id: m.id,
    code: m.code ?? '—',
    plate: m.plate ?? null,
    serial: m.serial ?? null,
    companyId: m.company_id ?? null,
    company: m.company?.name ?? 'Sin empresa',
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

export async function anularTarifaViaje(id: string, motivo: string, usuarioId: string | null): Promise<{ error?: string }> {
  const { data, error } = await supabase
    .from('viaje_tarifas')
    .update({ anulada_at: new Date().toISOString(), anulada_por: usuarioId, anulada_motivo: motivo.trim() || null })
    .eq('id', id)
    .is('anulada_at', null)
    .select('id');
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
