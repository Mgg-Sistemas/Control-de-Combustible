// PERSISTENCIA E HISTORIAL DE AMONESTACIONES ESCRITAS (17-nov-2026)
// - Guarda y consulta las amonestaciones en `employee_amonestaciones`.
// - Cero DELETE: anular marca `anulado = true` con motivo obligatorio.
// - Espejo local en AsyncStorage si falla la red y manejo amable si aún falta correr el SQL.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import type { GradoAmonestacion } from './amonestacion';

const STORAGE_KEY_PREFIX = 'amonestaciones_emp_v1:';

export type EmployeeAmonestacionRow = {
  id: string;
  employee_id: string;
  codigo: string;
  grado: GradoAmonestacion | null;
  tipo_falta: string | null;
  fecha_hecho: string | null;
  hora_hecho: string | null;
  descripcion: string | null;
  testigo_nombre: string | null;
  previas_count: number;
  emitido_por: string | null;
  emitido_por_nombre: string | null;
  anulado: boolean;
  anulado_el: string | null;
  anulado_por: string | null;
  anulado_por_nombre: string | null;
  motivo_anulacion: string | null;
  created_at: string;
};

function isMissingTable(msg: string, code?: string): boolean {
  if (code === '42P01' || code === 'PGRST205') return true;
  return /does not exist|schema cache|could not find the table/i.test(String(msg || ''));
}

export function generarCodigoAmonestacion(correlativo: number): string {
  return `AMON-${String(Math.max(1, correlativo)).padStart(4, '0')}`;
}

export function esAmonestacionConDatos(d: {
  grado?: GradoAmonestacion | null;
  tipoFalta?: string | null;
  fechaHecho?: string | null;
  horaHecho?: string | null;
  descripcion?: string | null;
  testigoNombre?: string | null;
}): boolean {
  return Boolean(
    d.grado ||
    String(d.tipoFalta || '').trim() ||
    String(d.fechaHecho || '').trim() ||
    String(d.horaHecho || '').trim() ||
    String(d.descripcion || '').trim() ||
    String(d.testigoNombre || '').trim()
  );
}

function mapRow(r: any): EmployeeAmonestacionRow {
  const g = r.grado === 'primera' || r.grado === 'segunda' || r.grado === 'tercera' ? r.grado : null;
  return {
    id: r.id as string,
    employee_id: r.employee_id as string,
    codigo: String(r.codigo || 'AMON-0001'),
    grado: g,
    tipo_falta: r.tipo_falta ?? null,
    fecha_hecho: r.fecha_hecho ?? null,
    hora_hecho: r.hora_hecho ?? null,
    descripcion: r.descripcion ?? null,
    testigo_nombre: r.testigo_nombre ?? null,
    previas_count: Number(r.previas_count ?? 0),
    emitido_por: r.emitido_por ?? null,
    emitido_por_nombre: r.emitido_por_nombre ?? null,
    anulado: r.anulado === true,
    anulado_el: r.anulado_el ?? null,
    anulado_por: r.anulado_por ?? null,
    anulado_por_nombre: r.anulado_por_nombre ?? null,
    motivo_anulacion: r.motivo_anulacion ?? null,
    created_at: r.created_at as string,
  };
}

export async function listarAmonestacionesEmpleado(employeeId: string): Promise<{
  amonestaciones: EmployeeAmonestacionRow[];
  faltaSql: boolean;
  error?: string;
}> {
  if (!employeeId) return { amonestaciones: [], faltaSql: false };
  try {
    const { data, error } = await supabase
      .from('employee_amonestaciones')
      .select('*')
      .eq('employee_id', employeeId)
      .order('created_at', { ascending: false });

    if (!error && Array.isArray(data)) {
      const rows = data.map(mapRow);
      try {
        await AsyncStorage.setItem(STORAGE_KEY_PREFIX + employeeId, JSON.stringify(rows));
      } catch {}
      return { amonestaciones: rows, faltaSql: false };
    }

    if (error) {
      if (isMissingTable(error.message, (error as any).code)) {
        return { amonestaciones: [], faltaSql: true };
      }
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY_PREFIX + employeeId);
        if (raw) return { amonestaciones: JSON.parse(raw), faltaSql: false, error: error.message };
      } catch {}
      return { amonestaciones: [], faltaSql: false, error: error.message };
    }
  } catch (e: any) {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY_PREFIX + employeeId);
      if (raw) return { amonestaciones: JSON.parse(raw), faltaSql: false };
    } catch {}
    return { amonestaciones: [], faltaSql: false, error: e?.message || 'Error al consultar amonestaciones.' };
  }
  return { amonestaciones: [], faltaSql: false };
}

export async function contarAmonestacionesPorEmpleado(): Promise<Record<string, number>> {
  const m: Record<string, number> = {};
  try {
    const { data, error } = await supabase
      .from('employee_amonestaciones')
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

export async function guardarAmonestacion(input: {
  employee_id: string;
  grado: GradoAmonestacion | null;
  tipo_falta: string | null;
  fecha_hecho: string | null;
  hora_hecho: string | null;
  descripcion: string | null;
  testigo_nombre: string | null;
  previas_count: number;
  codigo: string;
  emitido_por: string | null;
  emitido_por_nombre: string | null;
}): Promise<{ ok: boolean; id?: string; faltaSql?: boolean; error?: string }> {
  const { data, error } = await supabase
    .from('employee_amonestaciones')
    .insert({
      employee_id: input.employee_id,
      codigo: input.codigo,
      grado: input.grado,
      tipo_falta: input.tipo_falta?.trim() || null,
      fecha_hecho: input.fecha_hecho?.trim() || null,
      hora_hecho: input.hora_hecho?.trim() || null,
      descripcion: input.descripcion?.trim() || null,
      testigo_nombre: input.testigo_nombre?.trim() || null,
      previas_count: Math.max(0, Number(input.previas_count) || 0),
      emitido_por: input.emitido_por,
      emitido_por_nombre: input.emitido_por_nombre || 'Usuario',
    })
    .select('id');

  if (error) {
    if (isMissingTable(error.message, (error as any).code)) {
      return { ok: false, faltaSql: true };
    }
    return { ok: false, error: error.message };
  }
  if (!data?.length) {
    return { ok: false, error: 'No tienes permisos para guardar amonestaciones en el expediente.' };
  }
  return { ok: true, id: data[0].id as string };
}

export async function anularAmonestacion(params: {
  id: string;
  motivo: string;
  uid: string | null;
  nombreUsuario: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  const clean = params.motivo.trim();
  if (!clean) return { ok: false, error: 'Escribe el motivo de anulación.' };
  const { data, error } = await supabase
    .from('employee_amonestaciones')
    .update({
      anulado: true,
      anulado_el: new Date().toISOString(),
      anulado_por: params.uid,
      anulado_por_nombre: params.nombreUsuario || 'Usuario',
      motivo_anulacion: clean,
    })
    .eq('id', params.id)
    .select('id');

  if (error) return { ok: false, error: error.message };
  if (!data?.length) return { ok: false, error: 'No se pudo anular la amonestación (sin permiso o ya no existe).' };
  return { ok: true };
}
