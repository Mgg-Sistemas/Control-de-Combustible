import { supabase, selectAllRows } from './supabase';
import { ConfigCuenta, EmpresaDePersona, normalizarDepartamento, PrecioComida, TipoCuenta } from './cobroComidas';

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
 * Empresa y departamento de la ficha de cada persona. Quien no vuelve (ficha borrada o sin
 * permiso para leerla) NO entra al mapa: el cálculo lo pone aparte en vez de cobrárselo a la nómina.
 */
export async function cargarEmpresaDePersonas(employeeIds: string[]): Promise<Map<string, EmpresaDePersona>> {
  const ids = Array.from(new Set(employeeIds.filter(Boolean)));
  const mapa = new Map<string, EmpresaDePersona>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase
      .from('employees')
      .select('id, company_id, department, company:company_id(name)')
      .in('id', ids.slice(i, i + 200));
    if (error) throw new Error(error.message);
    (data as any[] | null)?.forEach((e) => mapa.set(e.id, {
      companyId: e.company_id ?? null,
      companyName: e.company?.name ?? null,
      departamento: e.department ?? null,
    }));
  }
  return mapa;
}

/** Historial de «se cobra / encargado» de todas las cuentas (tabla chica). */
export async function cargarConfigCuentas(): Promise<ConfigCuenta[]> {
  return (await selectAllRows(
    'comida_cuentas_config',
    'id, tipo, clave, desde, encargado_id, se_cobra, nota, created_at, created_by_nombre',
  )) as ConfigCuenta[];
}

export type EncargadoCatalogo = { id: string; name: string; active: boolean };

/** El catálogo de encargados (el mismo de Mangueras). */
export async function cargarEncargados(): Promise<EncargadoCatalogo[]> {
  const rows = await selectAllRows('encargados', 'id, name, active');
  return (rows as any[]).map((e) => ({ id: e.id, name: String(e.name ?? ''), active: e.active !== false }));
}

export type CuentasCatalogo = {
  empresas: { id: string; name: string; foodOnly: boolean }[];
  /** Departamentos de la nómina propia (fichas sin empresa), normalizados. */
  departamentos: string[];
};

/** Las cuentas que se pueden configurar: empresas visibles y departamentos de la nómina propia. */
export async function cargarCuentasCatalogo(): Promise<CuentasCatalogo> {
  const [empresas, fichas] = await Promise.all([
    selectAllRows('companies', 'id, name, hidden, food_only'),
    selectAllRows('employees', 'id, department', (q: any) => q.is('company_id', null)),
  ]);
  return {
    empresas: (empresas as any[])
      .filter((c) => !c.hidden)
      .map((c) => ({ id: c.id as string, name: String(c.name ?? ''), foodOnly: !!c.food_only })),
    departamentos: Array.from(new Set((fichas as any[]).map((f) => normalizarDepartamento(f.department)))).sort((a, b) => a.localeCompare(b, 'es')),
  };
}

/** Guarda «se cobra / encargado» de una o varias cuentas desde una fecha. Nunca pisa: agrega filas. */
export async function guardarConfigCuentas(filas: { tipo: TipoCuenta; clave: string; desde: string; encargadoId: string | null; seCobra: boolean; nota?: string | null }[]): Promise<{ error?: string }> {
  if (!filas.length) return {};
  const { data, error } = await supabase
    .from('comida_cuentas_config')
    .insert(filas.map((f) => ({ tipo: f.tipo, clave: f.clave, desde: f.desde, encargado_id: f.encargadoId || null, se_cobra: f.seCobra, nota: f.nota?.trim() || null })))
    .select('id');
  if (error) return { error: error.message };
  if (!data?.length) return { error: SIN_PERMISO_COMIDA };
  return {};
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
