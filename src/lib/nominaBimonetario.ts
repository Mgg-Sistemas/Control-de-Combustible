// LÓGICA PURA DE VISUALIZACIÓN BIMONETARIA Y TASA DE CAMBIO EN NÓMINA (04-nov-2026)
//
// Reglas:
// 1. Cada período de nómina (`staff_pay_periods` o `payroll_periods`) puede tener su
//    propia tasa aplicable (`exchange_rate`). Si no tiene una fijada (> 0), usa la tasa
//    vigente del día (`bcvRate`).
// 2. Acepta punto (.) o coma (,) al ingresar la tasa manual usando `leerNumero`.
// 3. Calcula y formatea automáticamente los montos tanto en dólares (USD) como en
//    bolívares (VES) para el resumen, el detalle por trabajador y los documentos PDF.

import { leerNumero } from './numeros';

export const round2 = (n: number): number =>
  Math.round((Number(n) + Number.EPSILON) * 100) / 100;

export const round4 = (n: number): number =>
  Math.round((Number(n) + Number.EPSILON) * 10000) / 10000;

/**
 * Resuelve la tasa aplicable a un período de nómina:
 * - Si el período tiene `exchange_rate > 0`, manda esa tasa.
 * - Si no, usa la tasa general del día (`bcvRate > 0`).
 * - Si ninguna está disponible, devuelve `null`.
 */
export function resolverTasaPeriodo(
  periodRate?: number | string | null,
  dailyRate?: number | string | null
): number | null {
  const pr = typeof periodRate === 'string' ? leerNumero(periodRate) : Number(periodRate ?? 0);
  if (isFinite(pr) && pr > 0) return round4(pr);
  const dr = typeof dailyRate === 'string' ? leerNumero(dailyRate) : Number(dailyRate ?? 0);
  if (isFinite(dr) && dr > 0) return round4(dr);
  return null;
}

/**
 * Indica de dónde proviene la tasa activa del período:
 * - `'periodo'` si el período tiene su propia tasa fijada.
 * - `'dia'` si está usando la tasa general del día (BCV / manual del día).
 * - `'ninguna'` si no hay tasa cargada.
 */
export function origenTasaPeriodo(
  periodRate?: number | string | null,
  dailyRate?: number | string | null
): 'periodo' | 'dia' | 'ninguna' {
  const pr = typeof periodRate === 'string' ? leerNumero(periodRate) : Number(periodRate ?? 0);
  if (isFinite(pr) && pr > 0) return 'periodo';
  const dr = typeof dailyRate === 'string' ? leerNumero(dailyRate) : Number(dailyRate ?? 0);
  if (isFinite(dr) && dr > 0) return 'dia';
  return 'ninguna';
}

/**
 * Valida y convierte un texto escrito por el usuario (con punto o coma) en una tasa válida.
 * Devuelve `{ ok: true, valor }` si es mayor a 0, o `{ ok: false, error }` si es inválido.
 */
export function validarTasaManual(raw: unknown): { ok: true; valor: number } | { ok: false; error: string } {
  const texto = String(raw ?? '').trim();
  if (!texto) {
    return { ok: false, error: 'Escribe una tasa de cambio mayor a 0 (ej. 45,50).' };
  }
  const n = leerNumero(texto);
  if (!isFinite(n) || n <= 0) {
    return { ok: false, error: 'La tasa de cambio debe ser un número mayor a 0.' };
  }
  if (n > 1000000) {
    return { ok: false, error: 'La tasa ingresada parece demasiado alta. Verifica los decimales.' };
  }
  return { ok: true, valor: round4(n) };
}

/** Convierte un monto en USD a Bolívares (VES) según la tasa indicada. */
export function calcularVesDesdeUsd(usdAmount: number, rate?: number | null): number {
  const r = Number(rate ?? 0);
  if (!isFinite(r) || r <= 0) return 0;
  return round2((Number(usdAmount) || 0) * r);
}

/** Convierte un monto en Bolívares (VES) a USD según la tasa indicada. */
export function calcularUsdDesdeVes(vesAmount: number, rate?: number | null): number {
  const r = Number(rate ?? 0);
  if (!isFinite(r) || r <= 0) return 0;
  return round2((Number(vesAmount) || 0) / r);
}

/** Formatea un monto en dólares: `$1.234,56`. */
export function fmtMontoUsd(n: number): string {
  const val = round2(Number(n) || 0);
  return `$${val.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Formatea un monto en bolívares: `Bs 1.234,56`. */
export function fmtMontoVes(n: number): string {
  const val = round2(Number(n) || 0);
  return `Bs ${val.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Formatea una tasa de cambio: `Bs 45,20 / US$`. */
export function fmtTasaCambio(rate?: number | null): string {
  const r = Number(rate ?? 0);
  if (!isFinite(r) || r <= 0) return 'Sin tasa';
  return `Bs ${round2(r).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} / US$`;
}

/**
 * Devuelve las cadenas formateadas en USD, VES y combinada (`$100,00 · Bs 4.520,00`).
 * Si no hay tasa (> 0), `ves` queda vacío y `bimonetario` muestra solo USD.
 */
export function formatearBimonetario(
  usdAmount: number,
  rate?: number | null
): { usd: string; ves: string; bimonetario: string; vesNumero: number } {
  const usd = fmtMontoUsd(usdAmount);
  const r = Number(rate ?? 0);
  if (!isFinite(r) || r <= 0) {
    return { usd, ves: '', bimonetario: usd, vesNumero: 0 };
  }
  const vesNumero = calcularVesDesdeUsd(usdAmount, r);
  const ves = fmtMontoVes(vesNumero);
  return {
    usd,
    ves,
    bimonetario: `${usd} · ${ves}`,
    vesNumero,
  };
}
