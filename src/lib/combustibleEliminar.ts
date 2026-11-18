// ⛽ Eliminación de consumos de combustible (18-nov-2026)
//
// Permite al usuario dos modalidades claras y seguras:
// 1. 'revertir': Se elimina físicamente de `dispatches`.
//    El trigger de PostgreSQL / vista `tank_levels` repone automáticamente los litros en el tanque.
// 2. 'sin_revertir': Se elimina y oculta de la lista de consumos, historiales y reportes,
//    pero mantiene `liters` y `tank_id` intactos con marcador [AJUSTE_TANQUE_OCULTO] para
//    que el tanque NO reponga los litros (el combustible permanece descontado del tanque).

import { supabase } from './supabase';
import { MARCADOR_AJUSTE_TANQUE, etiquetaEquipoCombustible } from './fuelRules';

export type ModoEliminarConsumo = 'revertir' | 'sin_revertir';

export interface ParametrosEliminarConsumo {
  despachoId: string;
  modo: ModoEliminarConsumo;
  despacho?: any;
}

export async function eliminarConsumoCombustible({
  despachoId,
  modo,
  despacho,
}: ParametrosEliminarConsumo): Promise<{ ok: boolean; error?: string }> {
  if (!despachoId) {
    return { ok: false, error: 'No se indicó el identificador del consumo a eliminar.' };
  }

  if (modo === 'revertir') {
    // 🔄 MODO 1: Físicamente borrado de la base de datos.
    // El trigger mv_dispatch / vista tank_levels repone automáticamente los litros al tanque.
    const { data, error } = await supabase
      .from('dispatches')
      .delete()
      .eq('id', despachoId)
      .select('id');

    if (error) {
      const fk = error.code === '23503' || String(error.message).toLowerCase().includes('foreign key');
      return {
        ok: false,
        error: fk
          ? 'No se puede eliminar físicamente: tiene registros o comprobantes vinculados.'
          : error.message,
      };
    }
    if (!data || data.length === 0) {
      return {
        ok: false,
        error: 'No se pudo eliminar el consumo: no tienes permisos de escritura o el registro ya no existe.',
      };
    }
    return { ok: true };
  } else {
    // 🔒 MODO 2: Eliminar/ocultar de la lista de consumos y reportes SIN revertir el tanque.
    // Mantiene liters y tank_id intactos para que el tanque no reponga los litros, pero
    // limpia machinery_id, vehicle_id y apoyo_nombre, y marca driver_operator y notes
    // con MARCADOR_AJUSTE_TANQUE ([AJUSTE_TANQUE_OCULTO]).
    const infoEq = despacho ? etiquetaEquipoCombustible(despacho) : null;
    const descEquipo = infoEq?.etiquetaCompleta || (despacho as any)?.apoyo_nombre || 'Equipo';
    const lts = despacho?.liters != null ? `${despacho.liters} L` : '';
    const fecha = despacho?.dispatch_date ? ` · ${despacho.dispatch_date}` : '';
    const detalleAuditoria = `Eliminado sin reponer tanque (${descEquipo} · ${lts}${fecha})`.trim();

    const prevDriver = String(despacho?.driver_operator ?? '')
      .replace(/\[AJUSTE_TANQUE_OCULTO\]\s*/g, '')
      .trim();
    const prevNotes = String((despacho as any)?.notes ?? '')
      .replace(/\[AJUSTE_TANQUE_OCULTO\]\s*/g, '')
      .trim();

    const { data, error } = await supabase
      .from('dispatches')
      .update({
        driver_operator: `${MARCADOR_AJUSTE_TANQUE} ${prevDriver || detalleAuditoria}`,
        notes: prevNotes ? `${MARCADOR_AJUSTE_TANQUE} ${prevNotes}` : `${MARCADOR_AJUSTE_TANQUE} ${detalleAuditoria}`,
        machinery_id: null,
        vehicle_id: null,
        apoyo_nombre: null,
        apoyo_placa: null,
        apoyo_serial: null,
        apoyo_empresa: null,
      })
      .eq('id', despachoId)
      .select('id');

    if (error) {
      return { ok: false, error: error.message };
    }
    if (!data || data.length === 0) {
      return {
        ok: false,
        error: 'No se pudo actualizar el registro: no tienes permisos de escritura o ya fue eliminado.',
      };
    }
    return { ok: true };
  }
}
