// 💱 26-nov-2026: al abrir un requerimiento se muestran los Bs con la tasa BCV
// de hoy, pero el presupuesto con el que se armó (su tasa y su fecha) se guarda
// aparte dentro de cada ítem para que NO se pierda. Puro, sin React ni Supabase,
// para poder probarlo directo en Node.
import type { RequirementLine } from '../types/database';

export type PresupuestoOriginalItem = {
  price_bs: number;
  total_bs: number;
  /** Tasa realmente usada: la escrita a mano si la hay, si no la del día. */
  tasa: number | null;
  /** ISO de la fecha de creación del requerimiento (hora Caracas). */
  fecha: string | null;
};

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/** Tasa que se usó de verdad en un renglón guardado (Bs unitarios / USD unitarios). */
export function tasaOriginalDeItem(item: Pick<RequirementLine, 'price_usd' | 'est_price' | 'price_bs'>): number | null {
  const usd = Number(item?.price_usd ?? item?.est_price) || 0;
  const bs = Number(item?.price_bs) || 0;
  return usd > 0 && bs > 0 ? r2(bs / usd) : null;
}

/** Presupuesto histórico de un renglón. No inventa si no hay precio en Bs. */
export function presupuestoOriginalDeItem(
  item: Pick<RequirementLine, 'price_usd' | 'est_price' | 'price_bs' | 'total_bs' | 'qty'>,
  fecha?: string | null,
  tasaBcvDeLaFecha?: number | null,
): PresupuestoOriginalItem | null {
  const bs = Number(item?.price_bs) || 0;
  const q = Math.max(0.0001, Number(item?.qty) || 1);
  const total = Number(item?.total_bs) || r2(bs * q);
  if (!(bs > 0) || !(total > 0)) return null;
  // La tasa escrita a mano (o la que se usó de verdad) manda; si no hay precio
  // en $, se cae a la tasa BCV guardada para la fecha de creación.
  const tasa = tasaOriginalDeItem(item) ?? (Number(tasaBcvDeLaFecha) > 0 ? r2(Number(tasaBcvDeLaFecha)) : null);
  return { price_bs: r2(bs), total_bs: r2(total), tasa, fecha: fecha ?? null };
}

/** Bs del renglón ya calculados con la tasa de hoy. Si no hay USD de referencia, no toca nada. */
export function itemConTasaDeHoy(
  item: Pick<RequirementLine, 'price_usd' | 'est_price' | 'total_usd' | 'qty' | 'modo_precio'>,
  tasaHoy: number | null | undefined,
): { price_bs: number; total_bs: number } | null {
  const bcv = Number(tasaHoy) || 0;
  const unitUsd = Number(item?.price_usd ?? item?.est_price) || 0;
  const q = Math.max(0.0001, Number(item?.qty) || 1);
  const totalUsd = item?.modo_precio === 'total' && Number(item?.total_usd) > 0
    ? Number(item.total_usd)
    : unitUsd * q;
  if (!(bcv > 0) || !(unitUsd > 0) || !(totalUsd > 0)) return null;
  return { price_bs: r2(unitUsd * bcv), total_bs: r2(totalUsd * bcv) };
}

/**
 * Antes de que el botón «🔄 Actualizar todos» sobrescriba los Bs, aparta el
 * presupuesto anterior. Si ya estaba apartado, lo respeta (nunca lo pisamos).
 */
export function capturarPresupuestoDeFila<T extends {
  price?: string | number; price_bs?: string | number; total_bs?: string | number; qty?: string | number;
  presupuesto_original?: PresupuestoOriginalItem | null;
}>(fila: T, tasaHoy: number | null | undefined, fecha?: string | null): PresupuestoOriginalItem | null {
  if (fila?.presupuesto_original) return fila.presupuesto_original;
  const usd = Number(fila?.price) || 0;
  const bs = Number(fila?.price_bs) || 0;
  const q = Math.max(0.0001, Number(fila?.qty) || 1);
  const total = Number(fila?.total_bs) || r2(bs * q);
  const bcv = Number(tasaHoy) || 0;
  if (!(usd > 0) || !(bs > 0) || !(total > 0) || !(bcv > 0)) return null;
  const tasa = r2(bs / usd);
  if (Math.abs(tasa - bcv) <= 0.05) return null;
  return { price_bs: r2(bs), total_bs: r2(total), tasa, fecha: fecha ?? null };
}
