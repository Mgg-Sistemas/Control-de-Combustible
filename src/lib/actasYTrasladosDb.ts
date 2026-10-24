// HISTÓRICO COMPARTIDO Y AUDITORÍA DE ACTAS DE RECEPCIÓN Y TRASLADOS
//
// Permite guardar, consultar, editar y eliminar tanto Actas de Recepción
// de Maquinaria como Traslados y Salidas, compartidos entre toda la organización
// (administradores y usuarios con permiso explícito).
//
// Mantiene trazabilidad total:
// - Creado por (ID + Nombre) y fecha de creación
// - Última edición por (ID + Nombre) y fecha de edición
// - Eliminado por (ID + Nombre) y fecha de eliminación (soft-delete seguro)
// - Fallback automático y sincronía offline con AsyncStorage

import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { ActaRecepcionData } from './actaRecepcionEquipo';
import { AutorizacionTrasladoData } from './autorizacionTraslado';

export const STORAGE_ACTAS_COMPARTIDAS = '@actas_recepcion_compartidas_v2';
export const STORAGE_TRASLADOS_COMPARTIDOS = '@traslados_maquinaria_compartidos_v2';
const LEGACY_ACTAS_KEY = '@actas_recepcion_equipo_v1';
const LEGACY_TRASLADOS_KEY = '@traslados_maquinaria_historico_v1';

export interface AuditUser {
  id?: string | null;
  name?: string | null;
}

export interface ActaCompartida {
  id: string;
  codigo: string;
  machineryId?: string | null;
  machineCode?: string | null;
  machinePlate?: string | null;
  datos: ActaRecepcionData;
  createdAt: string;
  createdBy?: string | null;
  createdByName?: string | null;
  updatedAt?: string | null;
  updatedBy?: string | null;
  updatedByName?: string | null;
  deletedAt?: string | null;
  deletedBy?: string | null;
  deletedByName?: string | null;
  isDeleted?: boolean;
}

export interface TrasladoCompartido {
  id: string;
  numeroControl: string;
  machineryId?: string | null;
  machineCode?: string | null;
  machinePlate?: string | null;
  tipoOperacion: 'salida_simple' | 'servicio_flete';
  datos: AutorizacionTrasladoData;
  createdAt: string;
  createdBy?: string | null;
  createdByName?: string | null;
  updatedAt?: string | null;
  updatedBy?: string | null;
  updatedByName?: string | null;
  deletedAt?: string | null;
  deletedBy?: string | null;
  deletedByName?: string | null;
  isDeleted?: boolean;
}

function parseSafe<T>(raw: string | null): T[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ACTAS DE RECEPCIÓN (INGRESO DE MAQUINARIA)
// ─────────────────────────────────────────────────────────────────────────────

function mapRowToActa(row: any): ActaCompartida {
  const datos = typeof row.datos === 'string' ? JSON.parse(row.datos) : (row.datos || {});
  return {
    id: String(row.id),
    codigo: row.codigo || datos.codigo || '',
    machineryId: row.machinery_id || null,
    machineCode: row.machine_code || datos.datosGenerales?.equipo || '',
    machinePlate: row.machine_plate || datos.placaHeader || datos.datosGenerales?.placa || '',
    datos,
    createdAt: row.created_at || new Date().toISOString(),
    createdBy: row.created_by || null,
    createdByName: row.created_by_name || null,
    updatedAt: row.updated_at || null,
    updatedBy: row.updated_by || null,
    updatedByName: row.updated_by_name || null,
    deletedAt: row.deleted_at || null,
    deletedBy: row.deleted_by || null,
    deletedByName: row.deleted_by_name || null,
    isDeleted: Boolean(row.is_deleted),
  };
}

export async function cargarActasCompartidas(machineryId?: string | null): Promise<ActaCompartida[]> {
  let remotos: ActaCompartida[] = [];
  let remotoOk = false;

  try {
    let q = supabase
      .from('actas_recepcion')
      .select('*')
      .neq('is_deleted', true)
      .order('created_at', { ascending: false });

    if (machineryId) {
      q = q.eq('machinery_id', machineryId);
    }

    const { data, error } = await q;
    if (!error && Array.isArray(data)) {
      remotos = data.map(mapRowToActa);
      remotoOk = true;
    }
  } catch {
    // Red no disponible o tabla aún no creada en Supabase
  }

  // Cargar espejo local
  let locales: ActaCompartida[] = [];
  try {
    const raw = await AsyncStorage.getItem(STORAGE_ACTAS_COMPARTIDAS);
    locales = parseSafe<ActaCompartida>(raw);

    // Migración perezosa de versión individual 1 si el espejo está vacío
    if (locales.length === 0) {
      const legacyRaw = await AsyncStorage.getItem(LEGACY_ACTAS_KEY);
      const legacy = parseSafe<any>(legacyRaw);
      if (legacy.length > 0) {
        locales = legacy.map((it: any) => ({
          id: it.id || `acta_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          codigo: it.codigo,
          machineryId: it.machineryId || null,
          machineCode: it.datosGenerales?.equipo || '',
          machinePlate: it.datosGenerales?.placa || it.placaHeader || '',
          datos: it,
          createdAt: it.createdAt || new Date().toISOString(),
          createdByName: it.datosGenerales?.recibidoPor || 'Personal de Recepción',
          isDeleted: false,
        }));
        await AsyncStorage.setItem(STORAGE_ACTAS_COMPARTIDAS, JSON.stringify(locales));
      }
    }
  } catch {}

  if (remotoOk) {
    // Guardar copia local del servidor para uso offline
    try {
      if (!machineryId) {
        await AsyncStorage.setItem(STORAGE_ACTAS_COMPARTIDAS, JSON.stringify(remotos));
      }
    } catch {}
    return remotos.filter((a) => !a.isDeleted);
  }

  // Si falló el remoto, devolver los locales no eliminados
  let filtrados = locales.filter((a) => !a.isDeleted);
  if (machineryId) {
    filtrados = filtrados.filter((a) => a.machineryId === machineryId);
  }
  return filtrados;
}

export async function guardarActaCompartida(params: {
  id?: string | null;
  codigo: string;
  machineryId?: string | null;
  machineCode?: string | null;
  machinePlate?: string | null;
  datos: ActaRecepcionData;
  user?: AuditUser | null;
}): Promise<ActaCompartida> {
  const ahora = new Date().toISOString();
  const esEdicion = Boolean(params.id);

  // Leer existentes de caché local
  const rawLocales = await AsyncStorage.getItem(STORAGE_ACTAS_COMPARTIDAS);
  const locales = parseSafe<ActaCompartida>(rawLocales);
  const existente = esEdicion ? locales.find((a) => a.id === params.id) : null;

  const acta: ActaCompartida = {
    id: params.id || existente?.id || `acta_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    codigo: params.codigo,
    machineryId: params.machineryId || existente?.machineryId || null,
    machineCode: params.machineCode || existente?.machineCode || params.datos.datosGenerales?.equipo || null,
    machinePlate: params.machinePlate || existente?.machinePlate || params.datos.placaHeader || params.datos.datosGenerales?.placa || null,
    datos: params.datos,
    createdAt: existente?.createdAt || ahora,
    createdBy: existente?.createdBy || params.user?.id || null,
    createdByName: existente?.createdByName || params.user?.name || 'Administrador',
    updatedAt: esEdicion ? ahora : null,
    updatedBy: esEdicion ? (params.user?.id || null) : null,
    updatedByName: esEdicion ? (params.user?.name || 'Administrador') : null,
    isDeleted: false,
  };

  // 1. Guardar en Supabase si está disponible
  try {
    const payload = {
      id: acta.id,
      codigo: acta.codigo,
      machinery_id: acta.machineryId,
      machine_code: acta.machineCode,
      machine_plate: acta.machinePlate,
      datos: acta.datos,
      created_at: acta.createdAt,
      created_by: acta.createdBy,
      created_by_name: acta.createdByName,
      updated_at: acta.updatedAt,
      updated_by: acta.updatedBy,
      updated_by_name: acta.updatedByName,
      is_deleted: false,
    };

    const { error } = await supabase
      .from('actas_recepcion')
      .upsert(payload, { onConflict: 'id' });

    if (error) {
      console.warn('[actas_recepcion] Fallo upsert en Supabase, guardando local:', error.message);
    }
  } catch (err: any) {
    console.warn('[actas_recepcion] Excepción Supabase:', err?.message);
  }

  // 2. Guardar en almacenamiento local
  const index = locales.findIndex((a) => a.id === acta.id);
  let updatedList: ActaCompartida[];
  if (index >= 0) {
    updatedList = [...locales];
    updatedList[index] = acta;
  } else {
    updatedList = [acta, ...locales];
  }

  await AsyncStorage.setItem(STORAGE_ACTAS_COMPARTIDAS, JSON.stringify(updatedList));
  return acta;
}

export async function eliminarActaCompartida(
  id: string,
  user?: AuditUser | null
): Promise<boolean> {
  const ahora = new Date().toISOString();

  // 1. Actualizar en Supabase
  try {
    await supabase
      .from('actas_recepcion')
      .update({
        is_deleted: true,
        deleted_at: ahora,
        deleted_by: user?.id || null,
        deleted_by_name: user?.name || 'Administrador',
      })
      .eq('id', id);
  } catch (e: any) {
    console.warn('[actas_recepcion] Fallo eliminar remoto:', e?.message);
  }

  // 2. Actualizar en almacenamiento local (marcar soft delete)
  try {
    const raw = await AsyncStorage.getItem(STORAGE_ACTAS_COMPARTIDAS);
    const list = parseSafe<ActaCompartida>(raw);
    const updated = list.map((a) => {
      if (a.id === id) {
        return {
          ...a,
          isDeleted: true,
          deletedAt: ahora,
          deletedBy: user?.id || null,
          deletedByName: user?.name || 'Administrador',
        };
      }
      return a;
    });
    await AsyncStorage.setItem(STORAGE_ACTAS_COMPARTIDAS, JSON.stringify(updated));
    return true;
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// TRASLADOS Y SALIDAS DE MAQUINARIA
// ─────────────────────────────────────────────────────────────────────────────

function mapRowToTraslado(row: any): TrasladoCompartido {
  const datos = typeof row.datos === 'string' ? JSON.parse(row.datos) : (row.datos || {});
  return {
    id: String(row.id),
    numeroControl: row.numero_control || datos.numeroControl || '',
    machineryId: row.machinery_id || null,
    machineCode: row.machine_code || datos.maquinaria?.codigo || '',
    machinePlate: row.machine_plate || datos.maquinaria?.placa || '',
    tipoOperacion: (row.tipo_operacion || (datos.servicio ? 'servicio_flete' : 'salida_simple')) as any,
    datos,
    createdAt: row.created_at || new Date().toISOString(),
    createdBy: row.created_by || null,
    createdByName: row.created_by_name || null,
    updatedAt: row.updated_at || null,
    updatedBy: row.updated_by || null,
    updatedByName: row.updated_by_name || null,
    deletedAt: row.deleted_at || null,
    deletedBy: row.deleted_by || null,
    deletedByName: row.deleted_by_name || null,
    isDeleted: Boolean(row.is_deleted),
  };
}

export async function cargarTrasladosCompartidos(machineryId?: string | null): Promise<TrasladoCompartido[]> {
  let remotos: TrasladoCompartido[] = [];
  let remotoOk = false;

  try {
    let q = supabase
      .from('traslados_maquinaria')
      .select('*')
      .neq('is_deleted', true)
      .order('created_at', { ascending: false });

    if (machineryId) {
      q = q.eq('machinery_id', machineryId);
    }

    const { data, error } = await q;
    if (!error && Array.isArray(data)) {
      remotos = data.map(mapRowToTraslado);
      remotoOk = true;
    }
  } catch {
    // Red no disponible o tabla aún no creada en Supabase
  }

  // Cargar espejo local
  let locales: TrasladoCompartido[] = [];
  try {
    const raw = await AsyncStorage.getItem(STORAGE_TRASLADOS_COMPARTIDOS);
    locales = parseSafe<TrasladoCompartido>(raw);

    // Migración perezosa de versión individual 1 si el espejo está vacío
    if (locales.length === 0) {
      const legacyRaw = await AsyncStorage.getItem(LEGACY_TRASLADOS_KEY);
      const legacy = parseSafe<any>(legacyRaw);
      if (legacy.length > 0) {
        locales = legacy.map((it: any) => ({
          id: it.id || `traslado_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          numeroControl: it.numeroControl,
          machineryId: it.machineryId || null,
          machineCode: it.maquinaria?.codigo || '',
          machinePlate: it.maquinaria?.placa || '',
          tipoOperacion: it.tipoOperacion || (it.servicio ? 'servicio_flete' : 'salida_simple'),
          datos: it,
          createdAt: it.createdAt || new Date().toISOString(),
          createdByName: it.firmas?.autorizadoPorNombre || 'Administrador',
          isDeleted: false,
        }));
        await AsyncStorage.setItem(STORAGE_TRASLADOS_COMPARTIDOS, JSON.stringify(locales));
      }
    }
  } catch {}

  if (remotoOk) {
    try {
      if (!machineryId) {
        await AsyncStorage.setItem(STORAGE_TRASLADOS_COMPARTIDOS, JSON.stringify(remotos));
      }
    } catch {}
    return remotos.filter((t) => !t.isDeleted);
  }

  let filtrados = locales.filter((t) => !t.isDeleted);
  if (machineryId) {
    filtrados = filtrados.filter((t) => t.machineryId === machineryId);
  }
  return filtrados;
}

export async function guardarTrasladoCompartido(params: {
  id?: string | null;
  numeroControl: string;
  machineryId?: string | null;
  machineCode?: string | null;
  machinePlate?: string | null;
  tipoOperacion: 'salida_simple' | 'servicio_flete';
  datos: AutorizacionTrasladoData;
  user?: AuditUser | null;
}): Promise<TrasladoCompartido> {
  const ahora = new Date().toISOString();
  const esEdicion = Boolean(params.id);

  const rawLocales = await AsyncStorage.getItem(STORAGE_TRASLADOS_COMPARTIDOS);
  const locales = parseSafe<TrasladoCompartido>(rawLocales);
  const existente = esEdicion ? locales.find((t) => t.id === params.id) : null;

  const traslado: TrasladoCompartido = {
    id: params.id || existente?.id || `traslado_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    numeroControl: params.numeroControl,
    machineryId: params.machineryId || existente?.machineryId || null,
    machineCode: params.machineCode || existente?.machineCode || params.datos.maquinaria?.codigo || null,
    machinePlate: params.machinePlate || existente?.machinePlate || params.datos.maquinaria?.placa || null,
    tipoOperacion: params.tipoOperacion,
    datos: params.datos,
    createdAt: existente?.createdAt || ahora,
    createdBy: existente?.createdBy || params.user?.id || null,
    createdByName: existente?.createdByName || params.user?.name || 'Administrador',
    updatedAt: esEdicion ? ahora : null,
    updatedBy: esEdicion ? (params.user?.id || null) : null,
    updatedByName: esEdicion ? (params.user?.name || 'Administrador') : null,
    isDeleted: false,
  };

  // 1. Guardar en Supabase si está disponible
  try {
    const payload = {
      id: traslado.id,
      numero_control: traslado.numeroControl,
      machinery_id: traslado.machineryId,
      machine_code: traslado.machineCode,
      machine_plate: traslado.machinePlate,
      tipo_operacion: traslado.tipoOperacion,
      datos: traslado.datos,
      created_at: traslado.createdAt,
      created_by: traslado.createdBy,
      created_by_name: traslado.createdByName,
      updated_at: traslado.updatedAt,
      updated_by: traslado.updatedBy,
      updated_by_name: traslado.updatedByName,
      is_deleted: false,
    };

    const { error } = await supabase
      .from('traslados_maquinaria')
      .upsert(payload, { onConflict: 'id' });

    if (error) {
      console.warn('[traslados_maquinaria] Fallo upsert en Supabase, guardando local:', error.message);
    }
  } catch (err: any) {
    console.warn('[traslados_maquinaria] Excepción Supabase:', err?.message);
  }

  // 2. Guardar en almacenamiento local
  const index = locales.findIndex((t) => t.id === traslado.id);
  let updatedList: TrasladoCompartido[];
  if (index >= 0) {
    updatedList = [...locales];
    updatedList[index] = traslado;
  } else {
    updatedList = [traslado, ...locales];
  }

  await AsyncStorage.setItem(STORAGE_TRASLADOS_COMPARTIDOS, JSON.stringify(updatedList));
  return traslado;
}

export async function eliminarTrasladoCompartido(
  id: string,
  user?: AuditUser | null
): Promise<boolean> {
  const ahora = new Date().toISOString();

  // 1. Supabase
  try {
    await supabase
      .from('traslados_maquinaria')
      .update({
        is_deleted: true,
        deleted_at: ahora,
        deleted_by: user?.id || null,
        deleted_by_name: user?.name || 'Administrador',
      })
      .eq('id', id);
  } catch (e: any) {
    console.warn('[traslados_maquinaria] Fallo eliminar remoto:', e?.message);
  }

  // 2. Local
  try {
    const raw = await AsyncStorage.getItem(STORAGE_TRASLADOS_COMPARTIDOS);
    const list = parseSafe<TrasladoCompartido>(raw);
    const updated = list.map((t) => {
      if (t.id === id) {
        return {
          ...t,
          isDeleted: true,
          deletedAt: ahora,
          deletedBy: user?.id || null,
          deletedByName: user?.name || 'Administrador',
        };
      }
      return t;
    });
    await AsyncStorage.setItem(STORAGE_TRASLADOS_COMPARTIDOS, JSON.stringify(updated));
    return true;
  } catch {
    return false;
  }
}
