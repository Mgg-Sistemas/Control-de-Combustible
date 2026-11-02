// ============================================================================
// 💾 PERSISTENCIA DEL HISTÓRICO DE REPORTES PERSONALIZADOS (02-nov-2026)
// ============================================================================
//
// Vive en un módulo aparte de `reporteMaquinariaPersonalizado.ts` y de
// `ReporteMaquinariaPersonalizadoCard.tsx` por dos razones de diseño:
// 1. `reporteMaquinariaPersonalizado.ts` es 100% puro (sin imports ni red) para
//    probar todas las reglas del histórico en memoria.
// 2. `ReporteMaquinariaPersonalizadoCard.tsx` tiene el candado estricto de solo
//    lectura del catálogo; aquí se encapsula el almacenamiento local
//    (`AsyncStorage`) y la sincronización opcional en nube (`tique_config.campos`)
//    sin tocar jamás `machinery`, `dispatches` ni ninguna tabla operativa.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import {
  ESTADO_HISTORIAL_VACIO,
  EstadoHistorialPersonalizado,
  RegistroHistorialPersonalizado,
  agregarAlHistorialPersonalizado,
  marcarReimpresoEnHistorialPersonalizado,
  mergeHistorialPersonalizado,
  normalizarEstadoHistorialPersonalizado,
  quitarDelHistorialPuro,
  renombrarEnHistorialPersonalizado,
  vaciarHistorialPuro,
} from './reporteMaquinariaPersonalizado';

export const CLAVE_HISTORIAL_PERSONALIZADO = '@reporte_personalizado_historial_v1';
const TABLA_CONFIG = 'tique_config';
const CAMPO_NUBE = 'reportesPersonalizadosHistorial';

async function leerEstadoLocal(): Promise<EstadoHistorialPersonalizado> {
  try {
    const raw = await AsyncStorage.getItem(CLAVE_HISTORIAL_PERSONALIZADO);
    if (!raw) return { ...ESTADO_HISTORIAL_VACIO, items: [], deletedIds: {} };
    return normalizarEstadoHistorialPersonalizado(JSON.parse(raw));
  } catch {
    return { ...ESTADO_HISTORIAL_VACIO, items: [], deletedIds: {} };
  }
}

async function escribirEstadoLocal(estado: EstadoHistorialPersonalizado): Promise<void> {
  try {
    await AsyncStorage.setItem(CLAVE_HISTORIAL_PERSONALIZADO, JSON.stringify(estado));
  } catch {
    // Nunca lanza hacia la pantalla
  }
}

async function sincronizarConNube(estadoLocal: EstadoHistorialPersonalizado): Promise<EstadoHistorialPersonalizado> {
  try {
    const { data, error } = await supabase
      .from(TABLA_CONFIG)
      .select('campos')
      .eq('id', true)
      .maybeSingle();
    if (error || !data) return estadoLocal;
    const dc = data.campos && typeof data.campos === 'object' ? { ...(data.campos as any) } : {};
    const remoto = dc[CAMPO_NUBE];
    const fusionado = mergeHistorialPersonalizado(estadoLocal, remoto);
    await escribirEstadoLocal(fusionado);
    dc[CAMPO_NUBE] = fusionado;
    await supabase
      .from(TABLA_CONFIG)
      .update({
        campos: dc,
        updated_at: new Date().toISOString(),
      })
      .eq('id', true);
    return fusionado;
  } catch {
    return estadoLocal;
  }
}

/**
 * Carga la lista del histórico combinando el almacenamiento local instantáneo
 * con la copia sincronizada en nube (si hay conexión). Nunca lanza error.
 */
export async function cargarHistorialReportePersonalizado(): Promise<RegistroHistorialPersonalizado[]> {
  const local = await leerEstadoLocal();
  try {
    const { data, error } = await supabase
      .from(TABLA_CONFIG)
      .select('campos')
      .eq('id', true)
      .maybeSingle();
    if (!error && data?.campos && typeof data.campos === 'object') {
      const remoto = (data.campos as any)[CAMPO_NUBE];
      if (remoto) {
        const fusionado = mergeHistorialPersonalizado(local, remoto);
        await escribirEstadoLocal(fusionado);
        return fusionado.items;
      }
    }
  } catch {
    // Si está sin internet o sin tabla, devuelve la copia local
  }
  return local.items;
}

/**
 * Guarda un nuevo registro en el histórico (deduplicando si es idéntico al último)
 * y devuelve la lista actualizada de registros.
 */
export async function guardarEnHistorialReportePersonalizado(
  nuevo: RegistroHistorialPersonalizado,
): Promise<RegistroHistorialPersonalizado[]> {
  const actual = await leerEstadoLocal();
  const siguiente = agregarAlHistorialPersonalizado(actual, nuevo);
  await escribirEstadoLocal(siguiente);
  void sincronizarConNube(siguiente);
  return siguiente.items;
}

/**
 * Cambia el nombre o etiqueta de un reporte en el histórico.
 */
export async function renombrarHistorialReportePersonalizado(
  id: string,
  nuevaEtiqueta: string,
): Promise<RegistroHistorialPersonalizado[]> {
  const actual = await leerEstadoLocal();
  const siguiente = renombrarEnHistorialPersonalizado(actual, id, nuevaEtiqueta);
  await escribirEstadoLocal(siguiente);
  void sincronizarConNube(siguiente);
  return siguiente.items;
}

/**
 * Registra que un reporte del histórico fue reimpreso (+1).
 */
export async function registrarReimpresionHistorialPersonalizado(
  id: string,
): Promise<RegistroHistorialPersonalizado[]> {
  const actual = await leerEstadoLocal();
  const siguiente = marcarReimpresoEnHistorialPersonalizado(actual, id);
  await escribirEstadoLocal(siguiente);
  void sincronizarConNube(siguiente);
  return siguiente.items;
}

/**
 * Quita un reporte individual del histórico y registra su tombstone para que no
 * reaparezca al sincronizar con otro dispositivo.
 */
export async function quitarRegistroHistorialPersonalizado(
  id: string,
): Promise<RegistroHistorialPersonalizado[]> {
  const actual = await leerEstadoLocal();
  const siguiente = quitarDelHistorialPuro(actual, id);
  await escribirEstadoLocal(siguiente);
  void sincronizarConNube(siguiente);
  return siguiente.items;
}

/**
 * Limpia todos los reportes del histórico.
 */
export async function limpiarTodoHistorialPersonalizado(): Promise<RegistroHistorialPersonalizado[]> {
  const actual = await leerEstadoLocal();
  const siguiente = vaciarHistorialPuro(actual);
  await escribirEstadoLocal(siguiente);
  void sincronizarConNube(siguiente);
  return siguiente.items;
}

