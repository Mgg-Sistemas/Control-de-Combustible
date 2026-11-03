// 🧾💵 Lectura y escritura de facturas y pagos de comida (03-nov-2026).
// La regla vive en comidaFacturas.ts. Todo escribe con `.select` para descubrir el
// rechazo silencioso de la RLS (0 filas sin error). No hay borrar: solo anular.
import { supabase } from './supabase';
import { esTablaFaltante } from './comidaEmpresasOcultas';
import { FacturaComida, PagoComida } from './comidaFacturas';

const COLS_F = 'id, numero, cuenta_clave, cuenta_nombre, cuenta_clase, company_id, contacto_id, desde, hasta, comidas, monto_usd, detalle, nota, created_at, created_by_nombre, anulada_at, anulada_por_nombre, anulada_motivo';
const COLS_P = 'id, factura_id, monto_usd, metodo, monto_bs, tasa, referencia, nota, comprobante_url, fecha_pago, created_at, created_by_nombre, anulado_at, anulado_por_nombre, anulado_motivo';

export const MSG_SIN_TABLA = 'Falta crear las tablas de facturas y pagos de comida (SQL pendiente). Avísale a quien administra el sistema.';

export async function cargarFacturasYPagos(): Promise<{ facturas: FacturaComida[]; pagos: PagoComida[]; sinTabla: boolean }> {
  const [f, p] = await Promise.all([
    supabase.from('comida_facturas').select(COLS_F).order('numero', { ascending: false }).limit(5000),
    supabase.from('comida_pagos').select(COLS_P).order('created_at', { ascending: true }).limit(10000),
  ]);
  if (f.error || p.error) {
    if (esTablaFaltante(f.error) || esTablaFaltante(p.error)) return { facturas: [], pagos: [], sinTabla: true };
    throw new Error((f.error ?? p.error)!.message);
  }
  const numF = (x: any): FacturaComida => ({ ...x, numero: Number(x.numero), comidas: Number(x.comidas) || 0, monto_usd: Number(x.monto_usd) || 0, detalle: Array.isArray(x.detalle) ? x.detalle : [] });
  const numP = (x: any): PagoComida => ({ ...x, monto_usd: Number(x.monto_usd) || 0, monto_bs: x.monto_bs == null ? null : Number(x.monto_bs), tasa: x.tasa == null ? null : Number(x.tasa) });
  return { facturas: (f.data ?? []).map(numF), pagos: (p.data ?? []).map(numP), sinTabla: false };
}

type R<T> = { ok: true; data: T } | { ok: false; error: string };
const fallo = (error: any, sinPermiso: string): { ok: false; error: string } => {
  if (esTablaFaltante(error)) return { ok: false, error: MSG_SIN_TABLA };
  return { ok: false, error: error?.message ? String(error.message) : sinPermiso };
};

export async function emitirFactura(fila: Record<string, unknown>): Promise<R<{ id: string; numero: number }>> {
  const { data, error } = await supabase.from('comida_facturas').insert(fila as any).select('id, numero');
  if (error) return fallo(error, '');
  if (!data || data.length === 0) return { ok: false, error: 'No se guardó la factura: hace falta permiso completo de Distribución de comida.' };
  return { ok: true, data: { id: String((data[0] as any).id), numero: Number((data[0] as any).numero) } };
}

export async function registrarPagoComida(fila: Record<string, unknown>): Promise<R<{ id: string }>> {
  const { data, error } = await supabase.from('comida_pagos').insert(fila as any).select('id');
  if (error) return fallo(error, '');
  if (!data || data.length === 0) return { ok: false, error: 'No se guardó el pago: no tienes permiso para registrar pagos de comida.' };
  return { ok: true, data: { id: String((data[0] as any).id) } };
}

export async function anularFacturaComida(id: string, motivo: string): Promise<R<null>> {
  const { data, error } = await supabase.from('comida_facturas')
    .update({ anulada_at: new Date().toISOString(), anulada_motivo: motivo.trim() } as any).eq('id', id).select('id');
  if (error) return fallo(error, '');
  if (!data || data.length === 0) return { ok: false, error: 'No se anuló: hace falta permiso completo de Distribución de comida.' };
  return { ok: true, data: null };
}

export async function anularPagoComida(id: string, motivo: string): Promise<R<null>> {
  const { data, error } = await supabase.from('comida_pagos')
    .update({ anulado_at: new Date().toISOString(), anulado_motivo: motivo.trim() } as any).eq('id', id).select('id');
  if (error) return fallo(error, '');
  if (!data || data.length === 0) return { ok: false, error: 'No se anuló: hace falta permiso completo de Distribución de comida.' };
  return { ok: true, data: null };
}
