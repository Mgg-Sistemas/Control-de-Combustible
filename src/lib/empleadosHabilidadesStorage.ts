// Persistencia y sincronización multi-dispositivo de Habilidades por Empleado.
// Usa AsyncStorage para caché local inmediata y una fila oculta en `payroll_companies`
// con prefijo `__nomina_habilidades__:` (active=false) para sincronizar entre teléfonos y PCs
// sin depender de una migración obligatoria en `employees`.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import {
  PREFIX_CONFIG_HABILIDADES,
  MapaHabilidades,
  limpiarHabilidades,
  extraerMapaHabilidadesDeEmpresas,
} from './empleadosHabilidades';

const STORAGE_KEY = '@nomina_empleados_habilidades_v1';

async function leerLocal(): Promise<MapaHabilidades> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: MapaHabilidades = {};
    for (const [k, v] of Object.entries(parsed)) {
      const limpias = limpiarHabilidades(v);
      if (k && limpias.length > 0) out[k] = limpias;
    }
    return out;
  } catch {
    return {};
  }
}

async function guardarLocal(mapa: MapaHabilidades): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(mapa));
  } catch {}
}

/**
 * Carga el mapa de habilidades desde Supabase (`payroll_companies`) con respaldo en `AsyncStorage`.
 */
export async function leerMapaHabilidades(): Promise<MapaHabilidades> {
  const local = await leerLocal();
  try {
    const { data, error } = await supabase
      .from('payroll_companies')
      .select('id, name')
      .ilike('name', `${PREFIX_CONFIG_HABILIDADES}%`)
      .order('created_at', { ascending: false })
      .limit(1);

    if (!error && data && data.length > 0) {
      const remoto = extraerMapaHabilidadesDeEmpresas(data);
      // Combinar remoto con local dando prioridad a las entradas remotas actualizadas
      const combinado: MapaHabilidades = { ...local, ...remoto };
      await guardarLocal(combinado);
      return combinado;
    }

    if (!error && (!data || data.length === 0) && Object.keys(local).length > 0) {
      const payload = PREFIX_CONFIG_HABILIDADES + JSON.stringify(local);
      await supabase.from('payroll_companies').insert({ name: payload, active: false });
    }
  } catch {}
  return local;
}

/**
 * Guarda las habilidades de un empleado específico en `AsyncStorage` y sincroniza
 * el mapa completo en `payroll_companies` (`__nomina_habilidades__:`).
 */
export async function guardarHabilidadesEmpleado(
  employeeId: string,
  habilidades: unknown
): Promise<MapaHabilidades> {
  const id = String(employeeId ?? '').trim();
  const limpias = limpiarHabilidades(habilidades);
  const actual = await leerMapaHabilidades();
  const nuevo: MapaHabilidades = { ...actual };
  if (id) {
    if (limpias.length > 0) {
      nuevo[id] = limpias;
    } else {
      delete nuevo[id];
    }
  }
  await guardarLocal(nuevo);

  const payload = PREFIX_CONFIG_HABILIDADES + JSON.stringify(nuevo);
  try {
    const { data } = await supabase
      .from('payroll_companies')
      .select('id')
      .ilike('name', `${PREFIX_CONFIG_HABILIDADES}%`)
      .order('created_at', { ascending: false })
      .limit(1);

    if (data && data.length > 0) {
      await supabase
        .from('payroll_companies')
        .update({ name: payload, active: false })
        .eq('id', data[0].id);
    } else {
      await supabase
        .from('payroll_companies')
        .insert({ name: payload, active: false });
    }
  } catch {}

  // Intento opcional en `employees.habilidades` si la columna existe en BD; si no existe, se ignora.
  if (id) {
    try {
      await supabase.from('employees').update({ habilidades: limpias } as any).eq('id', id);
    } catch {}
  }

  return nuevo;
}

