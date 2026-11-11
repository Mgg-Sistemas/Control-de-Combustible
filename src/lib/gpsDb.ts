// 📡 GPS — lo que va a la BASE: solo la lista de enlaces (public.gps_enlaces, una fila por
// vehículo). Las POSICIONES no pasan por aquí: el teléfono/PC se las pide directo a
// iTrackSafeX (ver lib/gps.ts). Así Supabase no recibe una escritura por cada consulta.
// La tabla la ve solo quien tiene el permiso «GPS» (la base lo exige con RLS); cargar,
// vincular o quitar enlaces, quien lo tiene con escritura o completo.
import { supabase, selectAllRows } from './supabase';
import type { EquipoCatalogo } from './gps';

export type EnlaceGps = {
  id: string;
  nombre: string | null;
  deviceId: string | null;
  authcode: string;
  serverid: string;
  url: string | null;
  vence: string | null;
  machineryId: string | null;
  equipo: { code: string | null; plate: string | null } | null;
};

/** «Esa tabla no existe todavía»: falta correr el SQL del GPS. */
export function esFaltaTablaGps(e: any): boolean {
  const code = String(e?.code ?? '');
  const msg = String(e?.message ?? e ?? '');
  return code === '42P01' || code === 'PGRST205' || /gps_enlaces/.test(msg) && /does not exist|could not find|schema cache/i.test(msg);
}

const fila = (r: any): EnlaceGps => ({
  id: String(r.id),
  nombre: r.nombre ?? null,
  deviceId: r.device_id ?? null,
  authcode: String(r.authcode),
  serverid: String(r.serverid ?? '0'),
  url: r.url ?? null,
  vence: r.vence ?? null,
  machineryId: r.machinery_id ?? null,
  equipo: r.machinery ? { code: r.machinery.code ?? null, plate: r.machinery.plate ?? null } : null,
});

/** La lista de enlaces: UNA lectura al abrir la pantalla (unos 6 KB para 30 vehículos). */
export async function listarEnlacesGps(): Promise<{ enlaces: EnlaceGps[]; faltaSql: boolean; error: string | null }> {
  const { data, error } = await supabase
    .from('gps_enlaces')
    .select('id, nombre, device_id, authcode, serverid, url, vence, machinery_id, machinery:machinery_id(code, plate)')
    .order('nombre', { ascending: true });
  if (error) return { enlaces: [], faltaSql: esFaltaTablaGps(error), error: esFaltaTablaGps(error) ? null : error.message };
  return { enlaces: (data ?? []).map(fila), faltaSql: false, error: null };
}

/** El catálogo para vincular (solo se lee al abrir «Agregar enlaces» o «Vincular»). */
export async function catalogoParaGps(): Promise<EquipoCatalogo[]> {
  const rows = await selectAllRows('machinery', 'id, code, plate, marca, modelo, clasificacion, active');
  return (rows as any[])
    .filter((m) => m.active !== false)
    .map((m) => ({ id: String(m.id), code: m.code ?? null, plate: m.plate ?? null, marca: m.marca ?? null, modelo: m.modelo ?? null, clasificacion: m.clasificacion ?? null }));
}

/** Un enlace ya COMPROBADO con iTrackSafeX (por eso siempre trae su deviceId). */
export type EnlaceNuevo = { nombre: string | null; deviceId: string; authcode: string; serverid: string; url: string; vence: string | null; machineryId: string | null };

/**
 * Guarda enlaces comprobados. UNA FILA POR EQUIPO GPS (device_id): si el equipo ya tenía
 * enlace, se REEMPLAZA el código en la misma fila (renovar = pegar el nuevo). No se borra
 * nada. Un solo viaje a la base.
 */
export async function guardarEnlacesGps(nuevos: EnlaceNuevo[], uid: string | null): Promise<{ error: string | null; guardados: number }> {
  if (!nuevos.length) return { error: null, guardados: 0 };
  const rows = nuevos.map((n) => ({
    nombre: n.nombre, device_id: n.deviceId, authcode: n.authcode, serverid: n.serverid, url: n.url,
    vence: n.vence, machinery_id: n.machineryId, actualizado_por: uid, actualizado_en: new Date().toISOString(),
  }));
  const { data, error } = await supabase.from('gps_enlaces').upsert(rows, { onConflict: 'device_id' }).select('id');
  if (error) return { error: error.message, guardados: 0 };
  // La RLS rechaza SIN error y con 0 filas: no se dice «listo» si no se guardó.
  if ((data ?? []).length !== rows.length) return { error: 'La base no dejó guardar (¿tienes el permiso GPS con escritura?).', guardados: (data ?? []).length };
  return { error: null, guardados: rows.length };
}

/** Vincula (o desvincula, con null) un enlace a un vehículo del catálogo. */
export async function vincularEnlaceGps(id: string, machineryId: string | null, uid: string | null): Promise<{ error: string | null }> {
  const { data, error } = await supabase.from('gps_enlaces').update({ machinery_id: machineryId, actualizado_por: uid, actualizado_en: new Date().toISOString() }).eq('id', id).select('id');
  if (error) return { error: error.message };
  if (!(data ?? []).length) return { error: 'La base no dejó cambiarlo (¿tienes el permiso GPS con escritura?).' };
  return { error: null };
}

/** Quita un enlace del sistema (no lo cancela en la app de iTrackSafeX). */
export async function borrarEnlaceGps(id: string): Promise<{ error: string | null }> {
  const { data, error } = await supabase.from('gps_enlaces').delete().eq('id', id).select('id');
  if (error) return { error: error.message };
  if (!(data ?? []).length) return { error: 'La base no dejó quitarlo (¿tienes el permiso GPS con escritura?).' };
  return { error: null };
}
