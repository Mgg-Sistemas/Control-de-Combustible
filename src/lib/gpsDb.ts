// 📡 GPS (Detektor) — lo que va a la BASE y al PUENTE (12-nov-2026).
//   · Tabla gps_vehiculos: qué placa/alias de Detektor es qué máquina del Catálogo (una fila por
//     vehículo; una máquina, un GPS). La ven quienes tienen el permiso «GPS»; vincular o quitar pide
//     escritura. NO se guarda ninguna posición.
//   · Las consultas a Detektor van por el puente `gps-detektor` (Edge Function): el usuario y la
//     clave de Detektor viven solo allá. Cada consulta es UNA llamada, solo cuando alguien la pide.
import { supabase, selectAllRows } from './supabase';
import type { EquipoCatalogo } from './gps';

export type VehiculoGps = {
  id: string;
  placaAlias: string;
  machineryId: string;
  equipo: { code: string | null; plate: string | null; clasificacion: string | null; empresa: string | null } | null;
};

/** «Esa tabla no existe todavía»: falta correr el SQL del GPS. */
export function esFaltaTablaGps(e: any): boolean {
  const code = String(e?.code ?? '');
  const msg = String(e?.message ?? e ?? '');
  return code === '42P01' || code === 'PGRST205' || (/gps_vehiculos/.test(msg) && /does not exist|could not find|schema cache/i.test(msg));
}

/** Los vehículos vinculados: UNA lectura al abrir (unos pocos KB para 30 vehículos). */
export async function listarVehiculosGps(): Promise<{ vehiculos: VehiculoGps[]; faltaSql: boolean; error: string | null }> {
  const { data, error } = await supabase
    .from('gps_vehiculos')
    .select('id, placa_alias, machinery_id, machinery:machinery_id(code, plate, clasificacion, company:company_id(name))')
    .order('placa_alias', { ascending: true });
  if (error) return { vehiculos: [], faltaSql: esFaltaTablaGps(error), error: esFaltaTablaGps(error) ? null : error.message };
  return {
    vehiculos: (data ?? []).map((r: any) => {
      const m = Array.isArray(r.machinery) ? r.machinery[0] : r.machinery;
      const emp = m ? (Array.isArray(m.company) ? m.company[0] : m.company) : null;
      return {
        id: String(r.id), placaAlias: String(r.placa_alias), machineryId: String(r.machinery_id),
        equipo: m ? { code: m.code ?? null, plate: m.plate ?? null, clasificacion: m.clasificacion ?? null, empresa: emp?.name ?? null } : null,
      };
    }),
    faltaSql: false,
    error: null,
  };
}

/** El catálogo para vincular (solo se lee al abrir «Vincular»). */
export async function catalogoParaGps(): Promise<EquipoCatalogo[]> {
  const rows = await selectAllRows('machinery', 'id, code, plate, marca, modelo, clasificacion, active, company:company_id(name)');
  return (rows as any[])
    .filter((m) => m.active !== false)
    .map((m) => ({ id: String(m.id), code: m.code ?? null, plate: m.plate ?? null, marca: m.marca ?? null, modelo: m.modelo ?? null, clasificacion: m.clasificacion ?? null, empresa: (Array.isArray(m.company) ? m.company[0]?.name : m.company?.name) ?? null }));
}

/** Vincula una placa/alias de Detektor con una máquina del Catálogo (o le cambia la máquina). */
export async function vincularVehiculoGps(placaAlias: string, machineryId: string, uid: string | null): Promise<{ error: string | null }> {
  const placa = String(placaAlias ?? '').trim();
  if (!placa || !machineryId) return { error: 'Falta la placa o la máquina.' };
  const { data, error } = await supabase.from('gps_vehiculos')
    .upsert({ placa_alias: placa, machinery_id: machineryId, actualizado_por: uid, actualizado_en: new Date().toISOString() }, { onConflict: 'placa_alias' })
    .select('id');
  if (error) {
    if (/gps_vehiculos_machinery_id_key|duplicate key/.test(error.message)) return { error: 'Esa máquina ya tiene otro GPS vinculado: quítalo primero.' };
    return { error: error.message };
  }
  // La RLS rechaza sin error y con 0 filas: no se dice «listo» si no se guardó.
  if (!(data ?? []).length) return { error: 'La base no dejó guardar (¿tienes el permiso GPS con escritura?).' };
  return { error: null };
}

/** Quita el vínculo (no toca nada en Detektor). */
export async function quitarVehiculoGps(id: string): Promise<{ error: string | null }> {
  const { data, error } = await supabase.from('gps_vehiculos').delete().eq('id', id).select('id');
  if (error) return { error: error.message };
  if (!(data ?? []).length) return { error: 'La base no dejó quitarlo (¿tienes el permiso GPS con escritura?).' };
  return { error: null };
}

export type AccionDetektor =
  | { accion: 'vehiculos' }
  | { accion: 'ubicacion'; placas: string[] }
  | { accion: 'resumen'; placas: string[]; desde: string; hasta: string; tiempodetencion?: number }
  | { accion: 'detenciones'; placa: string; desde: string; hasta: string }
  | { accion: 'estadistico'; placas: string[]; motivo: string; desde: string; hasta: string };

/** ⭐ La ÚNICA puerta a Detektor: el puente de Supabase. Devuelve las filas o el error en palabras. */
export async function consultarDetektor(pedido: AccionDetektor): Promise<{ filas: any[]; error: string | null }> {
  try {
    const { data, error } = await supabase.functions.invoke('gps-detektor', { body: pedido });
    if (error) {
      // El mensaje del puente viene en el cuerpo de la respuesta.
      let msg = error.message || 'No se pudo consultar el GPS.';
      try { const ctx: any = (error as any).context; const b = ctx?.json ? await ctx.json() : null; if (b?.error) msg = b.error; } catch { /* queda el mensaje genérico */ }
      if (/not found|404|Failed to send/i.test(msg)) msg = 'El puente del GPS (gps-detektor) todavía no está instalado en Supabase.';
      return { filas: [], error: msg };
    }
    if ((data as any)?.error) return { filas: [], error: String((data as any).error) };
    return { filas: Array.isArray((data as any)?.filas) ? (data as any).filas : [], error: null };
  } catch (e: any) {
    return { filas: [], error: e?.message || 'No se pudo consultar el GPS (¿sin internet?).' };
  }
}
