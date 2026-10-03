import { supabase, selectAllRows } from './supabase';
import { AlcancePeso, MarcaPeso, TarifaPeso, UnidadTarifaPeso, ViajePeso } from './pagoPeso';
import { listAsignacionesFrenteRango } from './camionViajes';
import { jornadaDeFecha } from './caracasDay';
import { CAMPOS_VIAJE_PAGO, completarFrentes, mapaAsignaciones, rangoJornadas } from './frentesAuto';

// Lecturas y escrituras del PAGO POR PESO (03-oct-2026). Las reglas de dinero viven
// en `pagoPeso.ts`; acá solo se habla con la base.
//
// ⭐ Tabla PROPIA: `viaje_tarifas_peso`. No toca `viaje_tarifas` ni `machinery_modo_pago`
//    (eso es del pago por viaje). Lee `viaje_pago_marcas` SOLO para respetar el
//    «no facturó», que es un hecho del viaje.
// ⭐ Las lecturas LANZAN si fallan; las escrituras piden `.select('id')`.

const COLS_VIAJE =
  'id, machinery_id, machine_code, company_id, zona_pago, registered_at, folio, fuera_catalogo, placa_snap, ubicacion_nombre, listero_name, frente_nombre, peso_bruto_kg, peso_tara_kg, peso_neto_kg';

export const SIN_PERMISO_PESO = 'No se guardó: hace falta permiso completo en Viajes de camiones.';

/** Desde cuándo hay pesos de romana en los viajes (antes no existía la columna). */
export const INICIO_PAGO_PESO = '2026-09-14';

export type DatosPagoPeso = {
  viajes: ViajePeso[];
  tarifas: TarifaPeso[];
  marcas: MarcaPeso[];
  empresas: Map<string, string>;
  fichas: Map<string, { marca: string | null; modelo: string | null; placa: string | null; serial: string | null; encargado: string | null }>;
  /** true = la tabla de tarifas por peso todavía no existe en la base (falta el SQL). */
  faltaSql: boolean;
};

export async function cargarDatosPagoPeso(desdeJornada: string = INICIO_PAGO_PESO): Promise<DatosPagoPeso> {
  const [viajes, tarifasR, marcas, empresas, maquinas] = await Promise.all([
    selectAllRows('camion_viajes', COLS_VIAJE, (q: any) => q.gte('registered_at', `${desdeJornada}T07:00:00-04:00`)),
    cargarTarifasPeso(),
    selectAllRows('viaje_pago_marcas', 'id, viaje_id, facturable, created_at'),
    selectAllRows('companies', 'id, name'),
    selectAllRows('machinery', 'id, marca, modelo, plate, serial, encargado'),
  ]);
  return {
    viajes: await conFrenteDelDia(viajes as ViajePeso[]),
    tarifas: tarifasR.tarifas,
    marcas: marcas as MarcaPeso[],
    empresas: new Map((empresas as any[]).map((c) => [c.id as string, String(c.name ?? '')])),
    fichas: new Map((maquinas as any[]).map((m) => [m.id as string, {
      marca: m.marca ?? null, modelo: m.modelo ?? null, placa: m.plate ?? null, serial: m.serial ?? null, encargado: m.encargado ?? null,
    }])),
    faltaSql: tarifasR.faltaSql,
  };
}

/** El frente del día también acá: solo agrupa y rotula, no mueve un centavo. */
async function conFrenteDelDia(viajes: ViajePeso[]): Promise<ViajePeso[]> {
  const sinFrente = viajes.filter((v: any) => v.machinery_id && !CAMPOS_VIAJE_PAGO.tieneFrente(v));
  const rango = rangoJornadas(sinFrente.map((v: any) => jornadaDeFecha(new Date(v.registered_at))));
  if (!rango) return viajes;
  const { asignaciones } = await listAsignacionesFrenteRango(rango.desde, rango.hasta);
  if (asignaciones.length === 0) return viajes;
  const { filas } = completarFrentes(viajes, mapaAsignaciones(asignaciones), (iso) => jornadaDeFecha(new Date(iso)), CAMPOS_VIAJE_PAGO);
  return filas as ViajePeso[];
}

/**
 * Tarifas por peso. Si la tabla no existe (42P01: falta correr el SQL), vuelve vacía
 * con `faltaSql: true` para que la pantalla lo diga en vez de reventar.
 */
export async function cargarTarifasPeso(): Promise<{ tarifas: TarifaPeso[]; faltaSql: boolean }> {
  try {
    const rows = await selectAllRows(
      'viaje_tarifas_peso',
      'id, unidad, precio, zona, alcance, company_id, grupo_nombre, machinery_ids, desde, hasta, nota, created_at, created_by_nombre, anulada_at, anulada_motivo',
    );
    return { tarifas: rows as TarifaPeso[], faltaSql: false };
  } catch (e: any) {
    const msg = String(e?.message ?? e ?? '');
    if (e?.code === '42P01' || /viaje_tarifas_peso/.test(msg) && /does not exist|not find|schema cache/i.test(msg)) return { tarifas: [], faltaSql: true };
    throw e;
  }
}

export async function crearTarifaPeso(t: {
  unidad: UnidadTarifaPeso; zona: string | null; precio: number; desde: string; hasta?: string | null; nota?: string | null;
  alcance?: AlcancePeso; companyId?: string | null; grupoNombre?: string | null; camiones?: string[];
}): Promise<{ error?: string }> {
  const alcance = t.alcance ?? 'general';
  const { data, error } = await supabase
    .from('viaje_tarifas_peso')
    .insert({
      unidad: t.unidad,
      precio: t.precio,
      zona: t.zona || null,
      desde: t.desde,
      hasta: t.hasta || null,
      nota: t.nota?.trim() || null,
      alcance,
      company_id: alcance === 'empresa' ? t.companyId || null : null,
      grupo_nombre: alcance === 'grupo' ? t.grupoNombre?.trim() || null : null,
      machinery_ids: alcance === 'grupo' || alcance === 'camion' ? Array.from(new Set(t.camiones ?? [])) : [],
    })
    .select('id');
  if (error) return { error: error.code === '42501' ? SIN_PERMISO_PESO : error.message };
  if (!data?.length) return { error: SIN_PERMISO_PESO };
  return {};
}

export async function anularTarifaPeso(id: string, motivo: string, usuarioId: string | null): Promise<{ error?: string }> {
  const { data, error } = await supabase
    .from('viaje_tarifas_peso')
    .update({ anulada_at: new Date().toISOString(), anulada_por: usuarioId, anulada_motivo: motivo.trim() || null })
    .eq('id', id)
    .is('anulada_at', null)
    .select('id');
  if (error) return { error: error.message };
  if (!data?.length) return { error: `${SIN_PERMISO_PESO} (o esa tarifa ya estaba anulada)` };
  return {};
}
