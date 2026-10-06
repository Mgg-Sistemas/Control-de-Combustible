import { supabase, selectAllRows } from './supabase';
import { CierrePagoViajes, FotoCierrePago } from './pagoViajesCierres';

// 🔒 CIERRES DEL PAGO DE VIAJES — la capa que toca la base (06-oct-2026).
// Las reglas viven en pagoViajesCierres.ts; acá solo se lee y se escribe.
//
// ⭐ TABLA PROPIA `viaje_pago_cierres`. No toca viajes, tarifas ni marcas; y si
//    la tabla todavía no existe (falta correr el SQL), leer devuelve
//    `missing: true` para que la pantalla lo diga en vez de reventar.
// ⭐ Las escrituras piden `.select('id')`: un rechazo por permisos vuelve sin
//    error y con 0 filas, y hay que decirlo.

export const SIN_PERMISO_CIERRE = 'No se guardó: hace falta permiso completo en Viajes de camiones.';

const COLS = 'id, desde, hasta, total_monto, viajes, pagados, detalle, nota, created_at, created_by_nombre, anulada_at, anulada_por, anulada_motivo';

export async function cargarCierresPago(): Promise<{ cierres: CierrePagoViajes[]; missing: boolean; error?: string }> {
  try {
    const rows = await selectAllRows('viaje_pago_cierres', COLS, undefined, 'desde');
    return { cierres: (rows as CierrePagoViajes[]).slice().reverse(), missing: false };
  } catch (e: any) {
    const msg = String(e?.message ?? e ?? '');
    if (e?.code === '42P01' || (/viaje_pago_cierres/.test(msg) && /does not exist|not find|schema cache/i.test(msg))) {
      return { cierres: [], missing: true };
    }
    return { cierres: [], missing: false, error: msg };
  }
}

/** Marca el rango como PAGADO guardando la foto. El trigger firma con el nombre. */
export async function crearCierrePago(c: {
  desde: string; hasta: string; foto: FotoCierrePago; nota?: string | null;
}): Promise<{ error?: string }> {
  const { data, error } = await supabase
    .from('viaje_pago_cierres')
    .insert({
      desde: c.desde,
      hasta: c.hasta,
      total_monto: c.foto.total.monto,
      viajes: c.foto.total.viajes,
      pagados: c.foto.total.pagados,
      detalle: c.foto,
      nota: c.nota?.trim() || null,
    })
    .select('id');
  if (error) {
    // El candado de la base contra dos cierres que se pisan, en criollo.
    if (/se pisa|solap/i.test(error.message)) return { error: 'Ese rango ya tiene días marcados como pagados. Reabre ese pago o ajusta las fechas.' };
    return { error: error.code === '42501' ? SIN_PERMISO_CIERRE : error.message };
  }
  if (!data?.length) return { error: SIN_PERMISO_CIERRE };
  return {};
}

/** Reabre (anula) una constancia, con motivo. No se borra: queda en el histórico. */
export async function reabrirCierrePago(id: string, motivo: string, usuarioId: string | null): Promise<{ error?: string }> {
  const { data, error } = await supabase
    .from('viaje_pago_cierres')
    .update({ anulada_at: new Date().toISOString(), anulada_por: usuarioId, anulada_motivo: motivo.trim() || null })
    .eq('id', id)
    .is('anulada_at', null)
    .select('id');
  if (error) return { error: error.message };
  if (!data?.length) return { error: `${SIN_PERMISO_CIERRE} (o ese pago ya estaba reabierto)` };
  return {};
}
