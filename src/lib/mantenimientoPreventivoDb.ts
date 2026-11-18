import { supabase } from './supabase';
import {
  CICLO_MANTENIMIENTO_HORAS,
  resolverBaseTrasAnulacion,
  type ServicioPreventivoRow,
} from './mantenimientoPreventivo';

function isMissingTable(msg: string, code?: string): boolean {
  if (code === '42P01' || code === 'PGRST205') return true;
  return /does not exist|schema cache|could not find the table/i.test(String(msg || ''));
}

export async function cargarUltimosServiciosPorMaquina(): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  const { data, error } = await supabase
    .from('machinery_preventive_services')
    .select('machinery_id, horometro_servicio, fecha_servicio, created_at')
    .eq('anulado', false)
    .order('fecha_servicio', { ascending: false })
    .order('created_at', { ascending: false });
  if (error || !data) return map;
  for (const r of data as any[]) {
    const mid = String(r.machinery_id ?? '');
    if (!mid || map.has(mid)) continue;
    const val = Number(r.horometro_servicio);
    if (Number.isFinite(val)) map.set(mid, val);
  }
  return map;
}

export async function cargarTodosServiciosPreventivos(): Promise<ServicioPreventivoRow[]> {
  const { data, error } = await supabase
    .from('machinery_preventive_services')
    .select('*')
    .order('fecha_servicio', { ascending: false })
    .order('created_at', { ascending: false });
  if (error || !data) return [];
  return (data as any[]).map((r) => ({
    id: r.id as string,
    machinery_id: r.machinery_id as string,
    horometro_servicio: Number(r.horometro_servicio),
    horometro_anterior: r.horometro_anterior != null ? Number(r.horometro_anterior) : null,
    fecha_servicio: r.fecha_servicio as string,
    notas: (r.notas ?? null) as string | null,
    realizado_por: (r.realizado_por ?? null) as string | null,
    realizado_por_nombre: (r.realizado_por_nombre ?? null) as string | null,
    created_at: r.created_at as string,
    anulado: r.anulado === true,
    anulado_el: (r.anulado_el ?? null) as string | null,
    anulado_por: (r.anulado_por ?? null) as string | null,
    anulado_por_nombre: (r.anulado_por_nombre ?? null) as string | null,
    motivo_anulacion: (r.motivo_anulacion ?? null) as string | null,
  }));
}

/**
 * Sincroniza únicamente `horometro_base` y `horometro_maint_pending` en `machinery`
 * (NUNCA toca `last_horometro` ni lecturas de inspectores). Si el usuario de
 * Mantenimiento no tiene permiso directo de escritura en `machinery` y aún no
 * existe la RPC, no falla mientras `machinery_preventive_services` sí haya guardado.
 */
async function syncMachineryBasePreventivo(
  machineryId: string,
  horometroBase: number | null,
  maintPending: boolean,
): Promise<{ synced: boolean; error?: string }> {
  const rpc = await supabase.rpc('sync_mantenimiento_preventivo_base', {
    p_machinery_id: machineryId,
    p_horometro_base: horometroBase,
    p_maint_pending: maintPending,
  });
  if (!rpc.error) return { synced: true };

  const { data: macData, error: macErr } = await supabase
    .from('machinery')
    .update({ horometro_base: horometroBase, horometro_maint_pending: maintPending })
    .eq('id', machineryId)
    .select('id');
  if (macErr) return { synced: false, error: macErr.message };
  if (!macData?.length) return { synced: false };
  return { synced: true };
}

export async function cargarServiciosPreventivos(machineryId: string): Promise<{
  rows: ServicioPreventivoRow[];
  faltaSql: boolean;
  error?: string;
}> {
  const { data, error } = await supabase
    .from('machinery_preventive_services')
    .select('*')
    .eq('machinery_id', machineryId)
    .order('fecha_servicio', { ascending: false })
    .order('created_at', { ascending: false });

  if (error) {
    if (isMissingTable(error.message, (error as any).code)) {
      return { rows: [], faltaSql: true };
    }
    return { rows: [], faltaSql: false, error: error.message };
  }

  const rows: ServicioPreventivoRow[] = (data ?? []).map((r: any) => ({
    id: r.id as string,
    machinery_id: r.machinery_id as string,
    horometro_servicio: Number(r.horometro_servicio),
    horometro_anterior: r.horometro_anterior != null ? Number(r.horometro_anterior) : null,
    fecha_servicio: r.fecha_servicio as string,
    notas: (r.notas ?? null) as string | null,
    realizado_por: (r.realizado_por ?? null) as string | null,
    realizado_por_nombre: (r.realizado_por_nombre ?? null) as string | null,
    created_at: r.created_at as string,
    anulado: r.anulado === true,
    anulado_el: (r.anulado_el ?? null) as string | null,
    anulado_por: (r.anulado_por ?? null) as string | null,
    anulado_por_nombre: (r.anulado_por_nombre ?? null) as string | null,
    motivo_anulacion: (r.motivo_anulacion ?? null) as string | null,
  }));

  return { rows, faltaSql: false };
}

export async function registrarServicioPreventivo(params: {
  machineryId: string;
  horometroServicio: number;
  horometroAnterior: number | null;
  lastHorometro: number | null;
  fechaServicioISO: string;
  notas: string | null;
  uid: string | null;
  nombreUsuario: string | null;
}): Promise<{ ok: boolean; faltaSql?: boolean; maintPending: boolean; error?: string }> {
  const {
    machineryId,
    horometroServicio,
    horometroAnterior,
    lastHorometro,
    fechaServicioISO,
    notas,
    uid,
    nombreUsuario,
  } = params;

  let faltaSql = false;
  const { data: insData, error: insErr } = await supabase
    .from('machinery_preventive_services')
    .insert({
      machinery_id: machineryId,
      horometro_servicio: horometroServicio,
      horometro_anterior: horometroAnterior,
      fecha_servicio: fechaServicioISO,
      notas: notas?.trim() || null,
      realizado_por: uid,
      realizado_por_nombre: nombreUsuario || 'Usuario',
    })
    .select('id');

  if (insErr) {
    if (isMissingTable(insErr.message, (insErr as any).code)) {
      faltaSql = true;
    } else {
      return { ok: false, maintPending: false, error: `No se pudo guardar en el historial: ${insErr.message}` };
    }
  } else if (!insData?.length) {
    return { ok: false, maintPending: false, error: 'No tienes permiso para registrar servicios preventivos en esta máquina.' };
  }

  const acum = lastHorometro != null ? Math.max(0, lastHorometro - horometroServicio) : 0;
  const maintPending = acum >= CICLO_MANTENIMIENTO_HORAS;

  const syncRes = await syncMachineryBasePreventivo(machineryId, horometroServicio, maintPending);
  if (faltaSql && !syncRes.synced) {
    return {
      ok: false,
      faltaSql,
      maintPending,
      error: syncRes.error || 'No se pudo actualizar el horómetro base de mantenimiento.',
    };
  }

  return { ok: true, faltaSql, maintPending };
}

export async function anularServicioPreventivo(params: {
  servicioId: string;
  machineryId: string;
  lastHorometro: number | null;
  motivo: string;
  uid: string | null;
  nombreUsuario: string | null;
}): Promise<{ ok: boolean; nuevaBase: number | null; maintPending: boolean; error?: string }> {
  const motivoClean = params.motivo.trim();
  if (!motivoClean) {
    return { ok: false, nuevaBase: null, maintPending: false, error: 'Debes escribir un motivo para anular el servicio.' };
  }

  const nowIso = new Date().toISOString();
  const { data: updData, error: updErr } = await supabase
    .from('machinery_preventive_services')
    .update({
      anulado: true,
      anulado_el: nowIso,
      anulado_por: params.uid,
      anulado_por_nombre: params.nombreUsuario || 'Usuario',
      motivo_anulacion: motivoClean,
    })
    .eq('id', params.servicioId)
    .select('id');

  if (updErr) {
    return { ok: false, nuevaBase: null, maintPending: false, error: updErr.message };
  }
  if (!updData?.length) {
    return { ok: false, nuevaBase: null, maintPending: false, error: 'No se pudo anular el servicio (sin permiso o ya no existe).' };
  }

  const hist = await cargarServiciosPreventivos(params.machineryId);
  if (hist.error) {
    return { ok: false, nuevaBase: null, maintPending: false, error: hist.error };
  }

  const nuevaBase = resolverBaseTrasAnulacion(hist.rows, params.lastHorometro);
  const acum = params.lastHorometro != null && nuevaBase != null
    ? Math.max(0, params.lastHorometro - nuevaBase)
    : 0;
  const maintPending = acum >= CICLO_MANTENIMIENTO_HORAS;

  await syncMachineryBasePreventivo(params.machineryId, nuevaBase, maintPending);

  return { ok: true, nuevaBase, maintPending };
}
