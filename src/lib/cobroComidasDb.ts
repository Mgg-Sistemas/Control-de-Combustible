import { supabase, selectAllRows } from './supabase';
import { EmpresaDePersona, PrecioComida } from './cobroComidas';

// Lecturas y escrituras del cobro de comidas. Las reglas de dinero viven en
// `cobroComidas.ts`; acá solo se habla con la base.
//
// ⭐ Las lecturas LANZAN si fallan: cobrar con datos a medias diría montos equivocados.
// ⭐ Las escrituras piden `.select('id')`: un rechazo por permisos vuelve sin error y con
//    0 filas, y hay que decirlo en vez de dar por guardado lo que no se guardó.

export const SIN_PERMISO_COMIDA = 'No se guardó: hace falta permiso completo en Distribución de comida.';

export async function cargarPreciosComida(): Promise<PrecioComida[]> {
  return (await selectAllRows(
    'comida_precios',
    'id, categoria, precio, desde, hasta, nota, created_at, created_by_nombre, anulada_at, anulada_motivo',
  )) as PrecioComida[];
}

/**
 * Empresa de la ficha de cada persona. Quien no vuelve (ficha borrada o sin permiso para
 * leerla) NO entra al mapa: el cálculo lo pone aparte en vez de cobrárselo a la nómina.
 */
export async function cargarEmpresaDePersonas(employeeIds: string[]): Promise<Map<string, EmpresaDePersona>> {
  const ids = Array.from(new Set(employeeIds.filter(Boolean)));
  const mapa = new Map<string, EmpresaDePersona>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase
      .from('employees')
      .select('id, company_id, company:company_id(name)')
      .in('id', ids.slice(i, i + 200));
    if (error) throw new Error(error.message);
    (data as any[] | null)?.forEach((e) => mapa.set(e.id, { companyId: e.company_id ?? null, companyName: e.company?.name ?? null }));
  }
  return mapa;
}

export async function crearPrecioComida(p: { categoria: string; precio: number; desde: string; hasta?: string | null; nota?: string | null }): Promise<{ error?: string }> {
  const { data, error } = await supabase
    .from('comida_precios')
    .insert({ categoria: p.categoria, precio: p.precio, desde: p.desde, hasta: p.hasta || null, nota: p.nota?.trim() || null })
    .select('id');
  if (error) return { error: error.message };
  if (!data?.length) return { error: SIN_PERMISO_COMIDA };
  return {};
}

export async function anularPrecioComida(id: string, motivo: string, usuarioId: string | null): Promise<{ error?: string }> {
  const { data, error } = await supabase
    .from('comida_precios')
    .update({ anulada_at: new Date().toISOString(), anulada_por: usuarioId, anulada_motivo: motivo.trim() || null })
    .eq('id', id)
    .is('anulada_at', null)
    .select('id');
  if (error) return { error: error.message };
  if (!data?.length) return { error: `${SIN_PERMISO_COMIDA} (o ese precio ya estaba anulado)` };
  return {};
}
