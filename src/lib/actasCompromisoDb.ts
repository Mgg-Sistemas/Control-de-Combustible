// EXPEDIENTE DE ACTAS DE COMPROMISO Y ENTREGA DE HERRAMIENTAS (04-nov-2026)
//
// Reglas:
// - Guarda y consulta las actas asociadas a cada trabajador (`employee_commitment_acts`).
// - NUNCA hace DELETE físico: anular un acta la marca con `anulado = true`,
//   guardando quién y cuándo la anuló.
// - Toda escritura usa `.select('id')` para verificar que la RLS no rechazó en silencio.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { CommitmentToolItem, EmployeeCommitmentAct } from '../types/database';
import { limpiarItemsActa } from './actaCompromiso';

const STORAGE_KEY_PREFIX = '@actas_compromiso_emp_v1:';

function mapRow(r: any): EmployeeCommitmentAct {
  let rawItems = r.items;
  if (typeof rawItems === 'string') {
    try { rawItems = JSON.parse(rawItems); } catch { rawItems = []; }
  }
  return {
    id: String(r.id),
    employee_id: String(r.employee_id),
    codigo: String(r.codigo ?? ''),
    fecha_entrega: String(r.fecha_entrega ?? '').slice(0, 10),
    cargo: r.cargo ?? null,
    departamento: r.departamento ?? null,
    items: limpiarItemsActa(Array.isArray(rawItems) ? rawItems : []),
    observaciones: r.observaciones ?? null,
    entregado_por: r.entregado_por ?? null,
    testigo_nombre: r.testigo_nombre ?? null,
    testigo_cedula: r.testigo_cedula ?? null,
    firma_trabajador_url: r.firma_trabajador_url ?? null,
    firma_entrega_url: r.firma_entrega_url ?? null,
    soporte_url: r.soporte_url ?? null,
    acepta_clausulas: r.acepta_clausulas !== false,
    autoriza_deduccion: r.autoriza_deduccion !== false,
    anulado: Boolean(r.anulado),
    anulado_at: r.anulado_at ?? null,
    anulado_por: r.anulado_por ?? null,
    anulado_por_nombre: r.anulado_por_nombre ?? null,
    created_by: r.created_by ?? null,
    created_by_nombre: r.created_by_nombre ?? null,
    created_at: r.created_at ?? new Date().toISOString(),
    updated_at: r.updated_at ?? null,
  };
}

/** Lista las actas de compromiso activas (no anuladas) de un empleado, más recientes primero. */
export async function listarActasCompromisoEmpleado(
  employeeId: string
): Promise<{ actas: EmployeeCommitmentAct[]; error?: string }> {
  if (!employeeId) return { actas: [] };
  try {
    const { data, error } = await supabase
      .from('employee_commitment_acts')
      .select('*')
      .eq('employee_id', employeeId)
      .eq('anulado', false)
      .order('created_at', { ascending: false });

    if (!error && Array.isArray(data)) {
      const actas = data.map(mapRow);
      try {
        await AsyncStorage.setItem(STORAGE_KEY_PREFIX + employeeId, JSON.stringify(actas));
      } catch {}
      return { actas };
    }
    if (error) {
      // Intentar espejo local si no hay red
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY_PREFIX + employeeId);
        if (raw) return { actas: JSON.parse(raw), error: error.message };
      } catch {}
      return { actas: [], error: error.message };
    }
  } catch (e: any) {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY_PREFIX + employeeId);
      if (raw) return { actas: JSON.parse(raw) };
    } catch {}
    return { actas: [], error: e?.message || 'Error de conexión al consultar las actas.' };
  }
  return { actas: [] };
}

/** Cuenta cuántas actas activas tiene cada empleado (mapa `employee_id -> cantidad`). */
export async function contarActasPorEmpleado(): Promise<Record<string, number>> {
  const m: Record<string, number> = {};
  try {
    const { data, error } = await supabase
      .from('employee_commitment_acts')
      .select('employee_id')
      .eq('anulado', false);
    if (!error && Array.isArray(data)) {
      for (const r of data) {
        const id = String((r as any).employee_id ?? '');
        if (id) m[id] = (m[id] ?? 0) + 1;
      }
    }
  } catch {}
  return m;
}

export type GuardarActaCompromisoInput = {
  id?: string | null;
  employee_id: string;
  codigo: string;
  fecha_entrega: string;
  cargo?: string | null;
  departamento?: string | null;
  items: CommitmentToolItem[];
  observaciones?: string | null;
  entregado_por?: string | null;
  testigo_nombre?: string | null;
  testigo_cedula?: string | null;
  firma_trabajador_url?: string | null;
  firma_entrega_url?: string | null;
  soporte_url?: string | null;
  acepta_clausulas?: boolean;
  autoriza_deduccion?: boolean;
  uid?: string | null;
  userName?: string | null;
};

/**
 * Guarda (inserta o actualiza) un Acta de Compromiso en el expediente del trabajador.
 * Verifica siempre con `.select('id')` que la fila realmente se guardó.
 */
export async function guardarActaCompromiso(
  input: GuardarActaCompromisoInput
): Promise<{ acta?: EmployeeCommitmentAct; error?: string }> {
  const itemsLimpios = limpiarItemsActa(input.items);
  const payload = {
    employee_id: input.employee_id,
    codigo: String(input.codigo || '').trim() || 'AC-HER-001',
    fecha_entrega: input.fecha_entrega || new Date().toISOString().slice(0, 10),
    cargo: input.cargo?.trim() || null,
    departamento: input.departamento?.trim() || null,
    items: itemsLimpios,
    observaciones: input.observaciones?.trim() || null,
    entregado_por: input.entregado_por?.trim() || null,
    testigo_nombre: input.testigo_nombre?.trim() || null,
    testigo_cedula: input.testigo_cedula?.trim() || null,
    firma_trabajador_url: input.firma_trabajador_url || null,
    firma_entrega_url: input.firma_entrega_url || null,
    soporte_url: input.soporte_url || null,
    acepta_clausulas: input.acepta_clausulas !== false,
    autoriza_deduccion: input.autoriza_deduccion !== false,
  };

  if (input.id) {
    const { data, error } = await supabase
      .from('employee_commitment_acts')
      .update({
        ...payload,
        updated_at: new Date().toISOString(),
      })
      .eq('id', input.id)
      .select('*');

    if (error) return { error: `No se pudo actualizar el acta: ${error.message}` };
    if (!data || data.length === 0) {
      return { error: 'No se pudo actualizar el acta (verifica tus permisos de sesión).' };
    }
    return { acta: mapRow(data[0]) };
  }

  const { data, error } = await supabase
    .from('employee_commitment_acts')
    .insert({
      ...payload,
      created_by: input.uid ?? null,
      created_by_nombre: input.userName ?? null,
    })
    .select('*');

  if (error) return { error: `No se pudo guardar el acta: ${error.message}` };
  if (!data || data.length === 0) {
    return { error: 'No se pudo guardar el acta en el expediente (verifica tus permisos).' };
  }
  return { acta: mapRow(data[0]) };
}

/**
 * Anula un acta del expediente (soft-delete con `anulado = true`, NUNCA un DELETE).
 */
export async function anularActaCompromiso(
  id: string,
  uid?: string | null,
  userName?: string | null
): Promise<{ error?: string }> {
  const { data, error } = await supabase
    .from('employee_commitment_acts')
    .update({
      anulado: true,
      anulado_at: new Date().toISOString(),
      anulado_por: uid ?? null,
      anulado_por_nombre: userName ?? null,
    })
    .eq('id', id)
    .select('id');

  if (error) return { error: `No se pudo anular el acta: ${error.message}` };
  if (!data || data.length === 0) {
    return { error: 'No se pudo anular el acta (no existe o te falta permiso).' };
  }
  return {};
}

