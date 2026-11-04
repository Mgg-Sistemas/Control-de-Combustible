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
//    (`AsyncStorage`) y la copia en el servidor, sin tocar jamás `machinery`,
//    `dispatches` ni ninguna tabla operativa.
//
// 👥 03-nov-2026 (a pedido: «que los admin puedan ver el histórico de cada reporte
//    personalizado que hizo cada persona, y poder reutilizarlo»): la copia en la
//    nube ya NO va en `tique_config.campos` (un solo JSON compartido de medio MB
//    dentro de la configuración de la tiquetera, que solo podía escribir quien
//    tuviera Viajes en control total: el resto se quedaba con su histórico solo
//    en su teléfono). Ahora cada reporte es UNA FILA de
//    `reportes_personalizados_historial`, con su autor. La base decide quién ve
//    qué: cada quien lo suyo, el administrador todo. Lo que había en
//    `tique_config` se copió a la tabla el 03-nov y ahí se quedó, sin tocar.
//    «Quitar» del histórico marca `quitado_at`: nunca se borra una fila.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import {
  ESTADO_HISTORIAL_VACIO,
  EstadoHistorialPersonalizado,
  RegistroHistorialPersonalizado,
  ResumenHistorialPersonalizado,
  agregarAlHistorialPersonalizado,
  marcarReimpresoEnHistorialPersonalizado,
  mergeHistorialPersonalizado,
  normalizarEstadoHistorialPersonalizado,
  normalizarRegistroHistorialPersonalizado,
  quitarDelHistorialPuro,
  renombrarEnHistorialPersonalizado,
  vaciarHistorialPuro,
} from './reporteMaquinariaPersonalizado';

export const CLAVE_HISTORIAL_PERSONALIZADO = '@reporte_personalizado_historial_v1';
export const TABLA_HISTORIAL_PERSONALIZADO = 'reportes_personalizados_historial';

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

async function miUsuarioId(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession();
    return data?.session?.user?.id ?? null;
  } catch {
    return null;
  }
}

/** Sube (o actualiza) UN reporte con su autor. La base rechaza lo ajeno; nunca lanza. */
async function subirRegistro(item: RegistroHistorialPersonalizado): Promise<void> {
  try {
    const uid = await miUsuarioId();
    if (!uid) return;
    await supabase
      .from(TABLA_HISTORIAL_PERSONALIZADO)
      .upsert({
        id: item.id,
        created_by: uid,
        creado_por_nombre: item.creadoPorNombre || null,
        registro: item,
        sacado_at: item.createdAt || new Date().toISOString(),
      }, { onConflict: 'id' });
  } catch {
    // Sin internet: queda en el teléfono y se sube la próxima vez que se abra.
  }
}

/** Marca como quitados (nunca borra). Solo los MÍOS: el admin también pasa la RLS. */
async function marcarQuitados(ids: string[] | 'todos'): Promise<void> {
  try {
    const uid = await miUsuarioId();
    if (!uid) return;
    let q = supabase
      .from(TABLA_HISTORIAL_PERSONALIZADO)
      .update({ quitado_at: new Date().toISOString() })
      .eq('created_by', uid)
      .is('quitado_at', null);
    if (ids !== 'todos') {
      if (!ids.length) return;
      q = q.in('id', ids);
    }
    await q;
  } catch {
    // Nunca lanza hacia la pantalla
  }
}

/**
 * Carga MI histórico: lo local al instante, fusionado con mis filas del
 * servidor (de otro teléfono o computadora). Lo que hice en este teléfono y
 * todavía no está arriba (sin internet, o de antes del 03-nov) se sube.
 * Nunca lanza error.
 */
export async function cargarHistorialReportePersonalizado(
  miNombre?: string | null,
): Promise<RegistroHistorialPersonalizado[]> {
  const local = await leerEstadoLocal();
  try {
    const uid = await miUsuarioId();
    if (!uid) return local.items;
    // 1) Lo liviano primero: qué hay arriba y cuándo cambió.
    const { data: lista, error } = await supabase
      .from(TABLA_HISTORIAL_PERSONALIZADO)
      .select('id, updated_at, quitado_at')
      .eq('created_by', uid)
      .order('sacado_at', { ascending: false })
      .limit(200);
    if (error || !lista) return local.items;

    const arriba = new Map((lista as any[]).map((r) => [String(r.id), r]));
    const localPorId = new Map(local.items.map((i) => [i.id, i]));
    const deletedIds: Record<string, string> = {};
    for (const r of lista as any[]) if (r.quitado_at) deletedIds[String(r.id)] = String(r.quitado_at);

    // 2) Bajar solo lo que no tengo (o que cambió en otro dispositivo).
    const faltan = (lista as any[])
      .filter((r) => !r.quitado_at)
      .filter((r) => {
        const l = localPorId.get(String(r.id));
        return !l || String(r.updated_at) > (l.updatedAt || l.createdAt);
      })
      .slice(0, 40)
      .map((r) => String(r.id));
    let remotos: RegistroHistorialPersonalizado[] = [];
    if (faltan.length) {
      const { data: full } = await supabase
        .from(TABLA_HISTORIAL_PERSONALIZADO)
        .select('registro')
        .in('id', faltan);
      remotos = ((full ?? []) as any[])
        .map((r) => normalizarRegistroHistorialPersonalizado(r.registro))
        .filter((x): x is RegistroHistorialPersonalizado => x !== null);
    }

    const fusionado = mergeHistorialPersonalizado(local, { items: remotos, deletedIds, clearedBefore: null });
    await escribirEstadoLocal(fusionado);

    // 3) Subir lo mío que está solo en este teléfono (la firma del autor es el
    //    nombre: un teléfono compartido puede tener reportes de otra persona).
    const nombre = String(miNombre ?? '').trim().toLowerCase();
    const pendientes = fusionado.items.filter((i) =>
      !arriba.has(i.id) && (!nombre || String(i.creadoPorNombre ?? '').trim().toLowerCase() === nombre));
    for (const i of pendientes.slice(0, 20)) void subirRegistro(i);

    return fusionado.items;
  } catch {
    return local.items;
  }
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
  // El que quedó en el tope es el nuevo (o el último, actualizado).
  const tope = siguiente.items[0];
  if (tope) void subirRegistro(tope);
  return siguiente.items;
}

async function actualizarUno(
  id: string,
  cambio: (e: EstadoHistorialPersonalizado) => EstadoHistorialPersonalizado,
): Promise<RegistroHistorialPersonalizado[]> {
  const actual = await leerEstadoLocal();
  const siguiente = cambio(actual);
  await escribirEstadoLocal(siguiente);
  const item = siguiente.items.find((i) => i.id === id);
  if (item) {
    // Solo actualiza (no inserta): un reporte ajeno en este teléfono no se adueña.
    void (async () => {
      try {
        await supabase.from(TABLA_HISTORIAL_PERSONALIZADO).update({ registro: item }).eq('id', id);
      } catch { /* nunca lanza */ }
    })();
  }
  return siguiente.items;
}

/** Cambia el nombre o etiqueta de un reporte en el histórico. */
export async function renombrarHistorialReportePersonalizado(
  id: string,
  nuevaEtiqueta: string,
): Promise<RegistroHistorialPersonalizado[]> {
  return actualizarUno(id, (e) => renombrarEnHistorialPersonalizado(e, id, nuevaEtiqueta));
}

/** Registra que un reporte del histórico fue reimpreso (+1). */
export async function registrarReimpresionHistorialPersonalizado(
  id: string,
): Promise<RegistroHistorialPersonalizado[]> {
  return actualizarUno(id, (e) => marcarReimpresoEnHistorialPersonalizado(e, id));
}

/**
 * Quita un reporte de MI histórico. En el servidor solo se marca (el
 * administrador lo sigue viendo, con la marca de quitado): nunca se borra.
 */
export async function quitarRegistroHistorialPersonalizado(
  id: string,
): Promise<RegistroHistorialPersonalizado[]> {
  const actual = await leerEstadoLocal();
  const siguiente = quitarDelHistorialPuro(actual, id);
  await escribirEstadoLocal(siguiente);
  void marcarQuitados([id]);
  return siguiente.items;
}

/** Limpia MI histórico (en el servidor se marcan, no se borran). */
export async function limpiarTodoHistorialPersonalizado(): Promise<RegistroHistorialPersonalizado[]> {
  const actual = await leerEstadoLocal();
  const siguiente = vaciarHistorialPuro(actual);
  await escribirEstadoLocal(siguiente);
  void marcarQuitados('todos');
  return siguiente.items;
}

// ── 👥 EL HISTÓRICO DE TODOS (solo administradores; la base lo exige) ─────────

/** Una fila liviana de la lista (sin las filas del papel: se bajan al usarla). */
export type ReporteDeTodos = {
  id: string;
  autorId: string;
  autorNombre: string;
  etiqueta: string;
  titulo: string;
  resumen: Partial<ResumenHistorialPersonalizado> | null;
  sacadoAt: string;
  quitadoAt: string | null;
  desde: string;
  hasta: string;
  conRango: boolean;
  vecesReimpreso: number;
};

/**
 * Los reportes de TODAS las personas, del más nuevo al más viejo. Solo trae lo
 * necesario para la lista; para reimprimir o reusar se pide el completo con
 * `cargarReporteCompleto`. Un no-administrador recibe solo lo suyo (RLS).
 */
export async function listarHistorialDeTodos(limite = 300): Promise<ReporteDeTodos[]> {
  const { data, error } = await supabase
    .from(TABLA_HISTORIAL_PERSONALIZADO)
    .select('id, created_by, creado_por_nombre, etiqueta, titulo, resumen, sacado_at, quitado_at, desde:registro->>desde, hasta:registro->>hasta, conRango:registro->>conRango, vecesReimpreso:registro->>vecesReimpreso')
    .order('sacado_at', { ascending: false })
    .limit(limite);
  if (error) throw new Error(error.message);
  return ((data ?? []) as any[]).map((r) => ({
    id: String(r.id),
    autorId: String(r.created_by ?? ''),
    autorNombre: String(r.creado_por_nombre ?? '').trim() || 'Sin nombre',
    etiqueta: String(r.etiqueta ?? '').trim(),
    titulo: String(r.titulo ?? '').trim(),
    resumen: r.resumen && typeof r.resumen === 'object' ? r.resumen : null,
    sacadoAt: String(r.sacado_at ?? ''),
    quitadoAt: r.quitado_at ? String(r.quitado_at) : null,
    desde: String(r.desde ?? ''),
    hasta: String(r.hasta ?? ''),
    conRango: String(r.conRango ?? '') === 'true',
    vecesReimpreso: Number(r.vecesReimpreso) || 0,
  }));
}

/** El reporte completo (con sus filas), listo para reimprimir o reusar. */
export async function cargarReporteCompleto(id: string): Promise<RegistroHistorialPersonalizado> {
  const { data, error } = await supabase
    .from(TABLA_HISTORIAL_PERSONALIZADO)
    .select('registro')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const reg = normalizarRegistroHistorialPersonalizado((data as any)?.registro);
  if (!reg) throw new Error('Ese reporte no se pudo leer (está vacío o dañado).');
  return reg;
}
