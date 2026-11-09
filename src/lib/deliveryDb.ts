// 🛵 DELIVERY · las llamadas a la base (todo por funciones: la tabla no se escribe directo).
// Los rechazos de la base ya vienen en español («Otro motorizado ya lo tomó.»…) y se pasan tal cual.
import { supabase } from './supabase';
import { normalizarListado } from './delivery';
import type { ListadoDelivery } from './delivery';

const sinConexion = (m: string) => /failed to fetch|network|timeout/i.test(m);
function errorDe(e: any, prefijo: string): Error {
  const m = String(e?.message ?? e ?? '');
  if (/does not exist|could not find the function/i.test(m)) return new Error('El Delivery todavía no está activado en la base de datos.');
  if (sinConexion(m)) return new Error(`${prefijo}: se perdió la conexión. Intenta de nuevo.`);
  return new Error(m || prefijo);
}

export async function cargarDelivery(dias = 7): Promise<ListadoDelivery> {
  const { data, error } = await supabase.rpc('delivery_listado', { p_dias: dias });
  if (error) throw errorDe(error, 'No se pudieron cargar los pedidos');
  return normalizarListado(data);
}

export async function tomarPedido(requerimientoId: string): Promise<string> {
  const { data, error } = await supabase.rpc('delivery_tomar', { p_req: requerimientoId });
  if (error) throw errorDe(error, 'No se pudo tomar el pedido');
  if (!data) throw new Error('No se pudo tomar el pedido: la base no respondió.');
  return String(data);
}

export async function moverPedido(pedidoId: string, accion: 'recogido' | 'entregado' | 'cancelar', datos: {
  fotos?: string[]; almacen?: string; nota?: string; motivo?: string; detalle?: string;
} = {}): Promise<void> {
  const { error } = await supabase.rpc('delivery_mover', {
    p_id: pedidoId, p_accion: accion, p_fotos: datos.fotos ?? null, p_almacen: datos.almacen ?? null,
    p_nota: datos.nota ?? null, p_motivo: datos.motivo ?? null, p_detalle: datos.detalle ?? null,
  });
  if (error) throw errorDe(error, 'No se guardó el paso');
}

export async function guardarConfigDelivery(activo: boolean, verMonto: boolean): Promise<void> {
  const { error } = await supabase.rpc('delivery_config_guardar', { p_activo: activo, p_ver_monto: verMonto });
  if (error) throw errorDe(error, 'No se guardó la configuración');
}

/** El último estado del delivery de unos requerimientos (para la tarjeta de Compras). */
export async function estadoDeliveryDe(reqIds: string[]): Promise<Record<string, { estado: string; repartidor: string | null; cuando: string | null }>> {
  const ids = [...new Set(reqIds.filter(Boolean))];
  if (!ids.length) return {};
  const { data, error } = await supabase.rpc('delivery_estado_de', { p_reqs: ids });
  if (error) return {}; // informativo: si falla, la tarjeta de Compras no lo muestra (no bloquea nada)
  const out: Record<string, { estado: string; repartidor: string | null; cuando: string | null }> = {};
  for (const r of (data ?? []) as any[]) out[String(r.requerimiento_id)] = { estado: String(r.estado), repartidor: r.repartidor_nombre ?? null, cuando: r.cuando ?? null };
  return out;
}
