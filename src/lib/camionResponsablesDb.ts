// ACCESO A DATOS de RESPONSABLES DE CAMIONES (módulo Viajes de camiones).
// La lógica pura vive en `camionResponsables.ts`; aquí solo hay Supabase.
//
// Escritura: las dos operaciones que cambian vigencias (asignar N camiones y
// quitar uno) van por RPC para que CIERRE + APERTURA sean atómicas. El SQL es
// aditivo y NO se guarda en el git (regla del repo). Si no se corrió todavía,
// `missing: true` enciende el aviso de configuración y la app sigue funcionando
// exactamente igual que antes.
import { supabase } from './supabase';
import { logAudit } from './audit';
import {
  type AsignacionResponsable,
  type ResponsableCamion,
  responsableCongeladoParaViaje,
} from './camionResponsables';

export { responsableCongeladoParaViaje } from './camionResponsables';

export type { AsignacionResponsable, ResponsableCamion } from './camionResponsables';

const AUDIT_TABLA = 'camion_responsables';

/** Detecta "falta correr el SQL" por código de error / mensaje de PostgREST. */
function isMissing(msg: unknown): boolean {
  const s = String(msg ?? '');
  return /42P01|42703|42883|camion_responsable|does not exist|relation|schema cache|could not find/i.test(s);
}

const err = (e: unknown) => ({ error: String((e as any)?.message ?? e), missing: isMissing(e) });

export async function listarResponsablesCamiones(): Promise<{
  rows: ResponsableCamion[]; missing: boolean;
}> {
  try {
    const { data, error } = await supabase
      .from('camion_responsables')
      .select('id, name, phone, cedula, note, active, created_at, updated_at')
      .order('name', { ascending: true });
    if (error) return { rows: [], missing: isMissing(error.message) };
    return { rows: (data ?? []) as ResponsableCamion[], missing: false };
  } catch (e) {
    return { rows: [], missing: isMissing(e) };
  }
}

export async function listarAsignacionesResponsables(): Promise<{
  rows: AsignacionResponsable[]; missing: boolean;
}> {
  try {
    const { data, error } = await supabase
      .from('camion_responsable_asignaciones')
      .select('id, responsable_id, machinery_id, desde, hasta, assigned_by, created_at')
      .order('desde', { ascending: false });
    if (error) return { rows: [], missing: isMissing(error.message) };
    return { rows: (data ?? []) as AsignacionResponsable[], missing: false };
  } catch (e) {
    return { rows: [], missing: isMissing(e) };
  }
}

export async function crearResponsableCamion(
  datos: { name: string; phone?: string | null; cedula?: string | null; note?: string | null },
  userId: string | null
): Promise<{ id?: string; error?: string; missing?: boolean }> {
  try {
    const { data, error } = await supabase
      .from('camion_responsables')
      .insert({
        name: datos.name.trim(),
        phone: datos.phone?.trim() || null,
        cedula: datos.cedula?.trim() || null,
        note: datos.note?.trim() || null,
        active: true,
        created_by: userId,
        updated_by: userId,
      })
      .select('id')
      .maybeSingle();
    if (error) return err(error);
    await logAudit('CHECK', AUDIT_TABLA, (data as any)?.id ?? null, `creó responsable de camiones: ${datos.name.trim()}`);
    return { id: (data as any)?.id };
  } catch (e) {
    return err(e);
  }
}

export async function editarResponsableCamion(
  id: string,
  datos: { name: string; phone?: string | null; cedula?: string | null; note?: string | null },
  userId: string | null
): Promise<{ error?: string; missing?: boolean }> {
  try {
    const { error } = await supabase
      .from('camion_responsables')
      .update({
        name: datos.name.trim(),
        phone: datos.phone?.trim() || null,
        cedula: datos.cedula?.trim() || null,
        note: datos.note?.trim() || null,
        updated_by: userId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select('id');
    if (error) return err(error);
    await logAudit('CHECK', AUDIT_TABLA, id, `editó responsable de camiones: ${datos.name.trim()}`);
    return {};
  } catch (e) {
    return err(e);
  }
}

/** Desactivar NO borra: el responsable sigue en el historial de viajes. */
export async function activarResponsableCamion(
  id: string,
  active: boolean,
  userId: string | null
): Promise<{ error?: string; missing?: boolean }> {
  try {
    const { error } = await supabase
      .from('camion_responsables')
      .update({ active, updated_by: userId, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('id');
    if (error) return err(error);
    await logAudit('CHECK', AUDIT_TABLA, id, `${active ? 'reactivó' : 'desactivó'} responsable de camiones`);
    return {};
  } catch (e) {
    return err(e);
  }
}

/**
 * Asigna uno o N camiones a un responsable. Cierra TODAS las vigencias previas
 * de esos camiones y abre una nueva, en una sola transacción del lado de la BD.
 * Devuelve cuántos tenían otro responsable (para el aviso de la UI).
 */
export async function asignarCamionesAResponsable(
  responsableId: string,
  machineryIds: string[],
  fechaISO: string,
  userId: string | null
): Promise<{ cerrados?: number; abiertos?: number; conflictos?: number; error?: string; missing?: boolean }> {
  try {
    const { data, error } = await supabase.rpc('camion_responsable_asignar', {
      p_responsable: responsableId,
      p_camiones: Array.from(new Set(machineryIds.filter(Boolean))),
      p_fecha: fechaISO,
      p_user: userId,
    });
    if (error) return err(error);
    const r = (data ?? {}) as Record<string, number>;
    await logAudit('CHECK', AUDIT_TABLA, responsableId,
      `asignó ${r.abiertos ?? 0} camión(es) a responsable; ${r.conflictos ?? 0} cambiaban de responsable`);
    return { cerrados: r.cerrados ?? 0, abiertos: r.abiertos ?? 0, conflictos: r.conflictos ?? 0 };
  } catch (e) {
    return err(e);
  }
}

/** Quitar = cerrar la vigencia. Nunca DELETE: el historial se conserva. */
export async function quitarCamionAResponsable(
  responsableId: string,
  machineryId: string,
  fechaISO: string,
  userId: string | null
): Promise<{ cerrados?: number; error?: string; missing?: boolean }> {
  try {
    const { data, error } = await supabase.rpc('camion_responsable_quitar', {
      p_responsable: responsableId,
      p_camion: machineryId,
      p_fecha: fechaISO,
      p_user: userId,
    });
    if (error) return err(error);
    await logAudit('CHECK', AUDIT_TABLA, responsableId, `quitó camión ${machineryId} a responsable`);
    return { cerrados: ((data ?? {}) as Record<string, number>).cerrados ?? 0 };
  } catch (e) {
    return err(e);
  }
}
