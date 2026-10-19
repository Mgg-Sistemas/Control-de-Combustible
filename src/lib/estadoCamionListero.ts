// 🚦 ESTADO DEL CAMIÓN DESDE EL TELÉFONO DEL LISTERO (19-oct-2026).
//
// Pedido del cliente: «que un admin o con full control pueda darle el permiso a
// un listero o a listeros en específico de colocar el estado en que se
// encuentra el camión… y que cuando busca un camión por placa pueda cambiar el
// estado de la maquinaria si lo necesita» — «solo los 3 estados básicos».
//
// ⭐ SOLO LOS 3 ESTADOS BÁSICOS: 🟢 Operativo · 🔧 Averiado · 🟡 Parado.
//    Lo grande (en espera, retirada, transferida) sigue siendo de la oficina:
//    esta librería NI MIRA machinery para escribir — y no podría: la RLS de
//    `machinery` solo deja escribir a staff o con permiso de equipos.
//
// CÓMO FUNCIONA EL ESTADO (el modelo de toda la casa, ver controlEstado.ts y
// machineLiveStatus.ts): averiada/parada NO es un campo — son filas PENDIENTES
// de `maintenance_requests`. Avería real = material ≠ 'MÁQUINA PARADA' (más su
// marcador de parada con el mismo motivo, como el teléfono del inspector);
// parada = solo el marcador; operativa = resolver los pendientes.
//
// ⚠️ ESTE ARCHIVO ES ADREDE UNO APARTE: `scripts/test-viajes-estado-no-bloquea.mjs`
//    prohíbe que camionViajes.ts escriba en maintenance_requests y que la
//    pantalla de viajes toque machinery.operational/en_espera. Acá se cumplen
//    las dos: solo tickets, nunca la ficha.
//
// EL PERMISO vive en `viajes_estado_permisos` (una fila por usuario). La BASE
// exige para otorgar/quitar `module_level('viajes_camiones') = 'full'` — el
// mismo candado de asignar_obra_a_listero — así que esconder el botón no es
// la única defensa. Todos los escritos piden las filas de vuelta: la RLS
// rechaza SIN error y con 0 filas (lección de la casa).
import { supabase } from './supabase';

export type EstadoBasico = 'operativo' | 'averiado' | 'parado';

export const MARCADOR_PARADA = 'MÁQUINA PARADA';

export const ESTADO_BASICO_META: Record<EstadoBasico, { icon: string; label: string; necesitaMotivo: boolean }> = {
  operativo: { icon: '🟢', label: 'Operativo', necesitaMotivo: false },
  averiado: { icon: '🔧', label: 'Averiado', necesitaMotivo: true },
  parado: { icon: '🟡', label: 'Parado', necesitaMotivo: true },
};

/** ¿Este usuario tiene el permiso otorgado? (la fila propia; el full no la necesita). */
export async function leerPermisoEstado(uid: string | null): Promise<boolean> {
  if (!uid) return false;
  const { data, error } = await supabase.from('viajes_estado_permisos').select('user_id').eq('user_id', uid).maybeSingle();
  if (error) return false;
  return !!data;
}

/** Todos los usuarios con el permiso (para la pantalla del full). */
export async function listarPermisosEstado(): Promise<{ ids: Set<string>; missing: boolean; error?: string }> {
  const { data, error } = await supabase.from('viajes_estado_permisos').select('user_id');
  if (error) {
    const missing = /does not exist|schema cache/i.test(error.message);
    return { ids: new Set(), missing, error: error.message };
  }
  return { ids: new Set(((data ?? []) as any[]).map((r) => String(r.user_id))), missing: false };
}

/** Otorga el permiso a un listero. La base exige full en viajes (0 filas = no eres full). */
export async function otorgarPermisoEstado(userId: string, quien: { id?: string | null; nombre?: string | null }): Promise<{ error?: string }> {
  const { data, error } = await supabase.from('viajes_estado_permisos')
    .upsert({ user_id: userId, otorgado_por: quien.id ?? null, otorgado_por_nombre: (quien.nombre ?? '').trim() || null }, { onConflict: 'user_id' })
    .select('user_id');
  if (error) return { error: error.message };
  if (!data?.length) return { error: 'No se otorgó: solo quien tiene control total en Viajes puede dar este permiso.' };
  return {};
}

/** Quita el permiso. */
export async function quitarPermisoEstado(userId: string): Promise<{ error?: string }> {
  const { data, error } = await supabase.from('viajes_estado_permisos').delete().eq('user_id', userId).select('user_id');
  if (error) return { error: error.message };
  if (!data?.length) return { error: 'No se quitó: solo quien tiene control total en Viajes puede tocar este permiso.' };
  return {};
}

/**
 * Cambia el estado del camión con el modelo de tickets de la casa.
 *
 * · 🟢 operativo — resuelve los pendientes (marcador y averías) con
 *   resolved_by/resolved_at, igual que «volver operativa» del inspector. OJO:
 *   si el camión no registra trabajo después, el cron del turno puede volver a
 *   marcar la parada hasta el cambio de turno (regla vieja de la casa).
 * · 🔧 averiado — motivo OBLIGATORIO. Como Control: si ya hay una avería
 *   pendiente se le actualiza el motivo (no se duplica); si no, se inserta
 *   (material 'otro'), y lo mismo con su marcador de parada.
 * · 🟡 parado — motivo OBLIGATORIO. Solo el marcador (actualiza o inserta).
 *
 * ⭐ No banca horas de la jornada abierta (eso lo hace el teléfono del
 *    inspector con su visita): si la jornada está abierta, se cierra sola a
 *    las 7 con sus horas reales. Tampoco toca machinery: en espera / retirada
 *    se rechazan ANTES, leyendo la ficha.
 */
export async function cambiarEstadoCamion(
  machineryId: string,
  estado: EstadoBasico,
  motivo: string,
  quien: { id?: string | null; nombre?: string | null },
): Promise<{ error?: string; detalle?: string }> {
  const quienTxt = (quien.nombre ?? '').trim();
  const motivoTxt = String(motivo ?? '').trim();
  if (estado !== 'operativo' && !motivoTxt) return { error: 'Escribe el motivo.' };

  // La ficha manda: los estados grandes son de la oficina.
  const { data: m, error: eM } = await supabase.from('machinery').select('id, operational, en_espera').eq('id', machineryId).maybeSingle();
  if (eM) return { error: eM.message };
  if (!m) return { error: 'Ese camión no está en el catálogo.' };
  if ((m as any).en_espera) return { error: 'Ese camión está EN ESPERA DE INSTRUCCIONES: su estado lo maneja la oficina.' };
  if ((m as any).operational === false) return { error: 'Ese camión está RETIRADO o TRANSFERIDO: su estado lo maneja la oficina.' };

  const nota = quienTxt ? `${motivoTxt} · por ${quienTxt} (listero)` : motivoTxt;

  if (estado === 'operativo') {
    const patch = { status: 'realizado', resolved_by: quien.id ?? null, resolved_at: new Date().toISOString() };
    const r1 = await supabase.from('maintenance_requests').update(patch)
      .eq('machinery_id', machineryId).eq('status', 'pendiente').eq('material', MARCADOR_PARADA).select('id');
    if (r1.error) return { error: r1.error.message };
    const r2 = await supabase.from('maintenance_requests').update(patch)
      .eq('machinery_id', machineryId).eq('status', 'pendiente').neq('material', MARCADOR_PARADA).select('id');
    if (r2.error) return { error: r2.error.message };
    const n = (r1.data?.length ?? 0) + (r2.data?.length ?? 0);
    if (n === 0) return { detalle: 'Ya estaba operativo: no tenía reportes pendientes.' };
    return { detalle: `${n} reporte(s) pendiente(s) resueltos.` };
  }

  // Actualiza-o-inserta, para NUNCA duplicar (un marcador doble cuenta doble
  // las horas paradas en el reporte por empresa).
  const pon = async (material: string, esMarcador: boolean): Promise<string | null> => {
    let q = supabase.from('maintenance_requests').select('id')
      .eq('machinery_id', machineryId).eq('status', 'pendiente')
      .order('created_at', { ascending: false }).limit(1);
    q = esMarcador ? q.eq('material', MARCADOR_PARADA) : q.neq('material', MARCADOR_PARADA);
    const { data: previas, error: eP } = await q;
    if (eP) return eP.message;
    if (previas?.length) {
      const { data: upd, error: eU } = await supabase.from('maintenance_requests')
        .update({ notes: nota }).eq('id', (previas[0] as any).id).select('id');
      if (eU) return eU.message;
      if (!upd?.length) return 'No se pudo actualizar el reporte pendiente.';
      return null;
    }
    const { data: ins, error: eI } = await supabase.from('maintenance_requests')
      .insert({ machinery_id: machineryId, material, quantity: null, notes: nota, status: 'pendiente', requested_by: quien.id ?? null })
      .select('id');
    if (eI) return eI.message;
    if (!ins?.length) return 'No se pudo crear el reporte.';
    return null;
  };

  if (estado === 'averiado') {
    // Igual que el inspector: la avería real Y su marcador, con el mismo motivo.
    const e1 = await pon('otro', false);
    if (e1) return { error: e1 };
    const e2 = await pon(MARCADOR_PARADA, true);
    if (e2) return { error: e2 };
    return { detalle: 'Avería reportada: queda en Servicio de Maquinaria.' };
  }

  // parado
  const e = await pon(MARCADOR_PARADA, true);
  if (e) return { error: e };
  return { detalle: 'Marcado parado hasta que vuelva a trabajar o lo pongan operativo.' };
}
