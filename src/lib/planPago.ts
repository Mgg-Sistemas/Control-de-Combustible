// 📋 PLAN DE PAGO de una cuenta por pagar (02-nov-2026).
//
// Una misma cuenta a veces se paga por partes y en monedas distintas: la base en $
// y el IVA en Bs a tasa BCV; o la base en Bs a tasa USDT y el IVA a tasa BCV; o una
// parte en $, otra en USDT o Zelle… El plan es la lista de esas partes:
//   • qué es (Base, IVA o una parte libre) y su monto en US$ (la cuenta es en US$);
//   • con qué se paga (método) y en qué moneda;
//   • con qué tasa se pasa a esa moneda (BCV, USDT, Euro u otra escrita a mano).
// Las partes DEBEN sumar el total en US$ de la cuenta: si no, no se guarda.
//
// Dónde vive: cuentas.plan_pago (jsonb) y inventory_requirements.plan_pago (lo pone
// la analista; Por Pagar lo usa mientras la cuenta no tenga uno propio). Cada abono
// puede decir a qué parte va (cuenta_abonos.parte_id), y así se ve qué parte falta.
// Columnas creadas y probadas el 02-nov-2026; PLAN_PAGO_ACTIVO queda por si hay que apagarlo.

/** Enciende el plan de pago (requiere cuentas.plan_pago, inventory_requirements.plan_pago y cuenta_abonos.parte_id). */
export const PLAN_PAGO_ACTIVO = true;

export type ConceptoParte = 'base' | 'iva' | 'parte';
export type MetodoParte =
  | 'transferencia_bs' | 'pago_movil' | 'efectivo_bs'
  | 'efectivo_usd' | 'transferencia_usd' | 'zelle' | 'usdt' | 'otro';
export type TasaTipo = 'bcv' | 'usdt' | 'euro' | 'manual';

export type PartePlan = {
  id: string;
  concepto: ConceptoParte;
  /** Texto libre opcional («50% adelanto»…). */
  etiqueta?: string | null;
  monto_usd: number;
  metodo: MetodoParte;
  /** Solo para métodos en Bs. */
  tasa_tipo?: TasaTipo | null;
  tasa?: number | null;
};

export type PlanPago = { partes: PartePlan[]; nota?: string | null; actualizado_por?: string | null; actualizado_at?: string | null };

export const METODOS_PARTE: { key: MetodoParte; label: string; moneda: 'VES' | 'USD' | 'USDT' }[] = [
  { key: 'transferencia_bs', label: '🏦 Transferencia Bs', moneda: 'VES' },
  { key: 'pago_movil', label: '📲 Pago móvil', moneda: 'VES' },
  { key: 'efectivo_bs', label: '💵 Efectivo Bs', moneda: 'VES' },
  { key: 'efectivo_usd', label: '💵 Efectivo $', moneda: 'USD' },
  { key: 'transferencia_usd', label: '🏦 Transferencia $', moneda: 'USD' },
  { key: 'zelle', label: '💸 Zelle', moneda: 'USD' },
  { key: 'usdt', label: '🪙 USDT / Binance', moneda: 'USDT' },
  { key: 'otro', label: '📝 Otro', moneda: 'USD' },
];

export const TASAS: { key: TasaTipo; label: string }[] = [
  { key: 'bcv', label: 'BCV' },
  { key: 'usdt', label: 'USDT' },
  { key: 'euro', label: 'Euro' },
  { key: 'manual', label: 'Otra' },
];

export const CONCEPTOS: { key: ConceptoParte; label: string }[] = [
  { key: 'base', label: 'Base' },
  { key: 'iva', label: 'IVA' },
  { key: 'parte', label: 'Parte' },
];

export const monedaDeMetodo = (m: MetodoParte): 'VES' | 'USD' | 'USDT' =>
  METODOS_PARTE.find((x) => x.key === m)?.moneda ?? 'USD';
export const etiquetaMetodo = (m: MetodoParte): string => METODOS_PARTE.find((x) => x.key === m)?.label ?? m;
export const etiquetaTasa = (t?: TasaTipo | null): string => TASAS.find((x) => x.key === t)?.label ?? '';

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

let contador = 0;
export const nuevoIdParte = () => `p${Date.now().toString(36)}${(contador++).toString(36)}`;

/** Título de la parte: «Base», «IVA 16%», «Parte: 50% adelanto»… */
export function tituloParte(p: PartePlan, alicuotaIva?: number | null): string {
  const extra = String(p.etiqueta ?? '').trim();
  if (p.concepto === 'iva') return `IVA${alicuotaIva ? ` ${alicuotaIva}%` : ''}${extra ? ` · ${extra}` : ''}`;
  if (p.concepto === 'base') return `Base${extra ? ` · ${extra}` : ''}`;
  return extra || 'Parte';
}

/** Lo que se paga en la moneda de la parte (Bs con su tasa; $ y USDT igual que en US$). */
export function montoEnMoneda(p: PartePlan): number {
  if (monedaDeMetodo(p.metodo) === 'VES') return r2((Number(p.monto_usd) || 0) * (Number(p.tasa) || 0));
  return r2(Number(p.monto_usd) || 0);
}

/** Base e IVA de la cuenta (el IVA sale de la alícuota; la base es el resto). */
export function baseEIva(totalUsd: number, alicuotaIva?: number | null): { base: number; iva: number } {
  const alic = Number(alicuotaIva) || 0;
  if (alic <= 0) return { base: r2(totalUsd), iva: 0 };
  const base = r2(totalUsd / (1 + alic / 100));
  return { base, iva: r2(totalUsd - base) };
}

export type PlantillaPlan = 'todo_usd' | 'todo_bs_bcv' | 'base_usd_iva_bs' | 'base_bs_usdt_iva_bs_bcv' | 'base_usdt_iva_bs' | 'base_zelle_iva_bs';

export const PLANTILLAS: { key: PlantillaPlan; label: string; necesitaIva?: boolean }[] = [
  { key: 'todo_usd', label: 'Todo en $' },
  { key: 'todo_bs_bcv', label: 'Todo en Bs (BCV)' },
  { key: 'base_usd_iva_bs', label: 'Base en $ + IVA en Bs (BCV)', necesitaIva: true },
  { key: 'base_bs_usdt_iva_bs_bcv', label: 'Base en Bs (USDT) + IVA en Bs (BCV)', necesitaIva: true },
  { key: 'base_usdt_iva_bs', label: 'Base en USDT + IVA en Bs (BCV)', necesitaIva: true },
  { key: 'base_zelle_iva_bs', label: 'Base en Zelle + IVA en Bs (BCV)', necesitaIva: true },
];

/** Arma las partes de una plantilla. Las tasas que no se conocen quedan en null (se escriben). */
export function aplicarPlantilla(
  k: PlantillaPlan, totalUsd: number, alicuotaIva: number | null | undefined, tasas: { bcv?: number | null; usdt?: number | null },
): PartePlan[] {
  const { base, iva } = baseEIva(totalUsd, alicuotaIva);
  const bcv = Number(tasas.bcv) > 0 ? Number(tasas.bcv) : null;
  const usdt = Number(tasas.usdt) > 0 ? Number(tasas.usdt) : null;
  const ivaBs = (): PartePlan => ({ id: nuevoIdParte(), concepto: 'iva', monto_usd: iva, metodo: 'transferencia_bs', tasa_tipo: 'bcv', tasa: bcv });
  switch (k) {
    case 'todo_usd': return [{ id: nuevoIdParte(), concepto: 'parte', etiqueta: 'Total', monto_usd: r2(totalUsd), metodo: 'efectivo_usd' }];
    case 'todo_bs_bcv': return [{ id: nuevoIdParte(), concepto: 'parte', etiqueta: 'Total', monto_usd: r2(totalUsd), metodo: 'transferencia_bs', tasa_tipo: 'bcv', tasa: bcv }];
    case 'base_usd_iva_bs': return [{ id: nuevoIdParte(), concepto: 'base', monto_usd: base, metodo: 'efectivo_usd' }, ivaBs()];
    case 'base_bs_usdt_iva_bs_bcv': return [{ id: nuevoIdParte(), concepto: 'base', monto_usd: base, metodo: 'transferencia_bs', tasa_tipo: 'usdt', tasa: usdt }, ivaBs()];
    case 'base_usdt_iva_bs': return [{ id: nuevoIdParte(), concepto: 'base', monto_usd: base, metodo: 'usdt' }, ivaBs()];
    case 'base_zelle_iva_bs': return [{ id: nuevoIdParte(), concepto: 'base', monto_usd: base, metodo: 'zelle' }, ivaBs()];
  }
}

/** Valida el plan contra el total de la cuenta. Devuelve el mensaje de error o null. */
export function validarPlan(partes: PartePlan[], totalUsd: number): string | null {
  if (!partes || partes.length === 0) return 'Agrega al menos una parte.';
  for (const [i, p] of partes.entries()) {
    if (!(Number(p.monto_usd) > 0)) return `La parte ${i + 1} no tiene monto en $.`;
    if (monedaDeMetodo(p.metodo) === 'VES' && !(Number(p.tasa) > 0)) return `La parte ${i + 1} se paga en Bs: escribe su tasa.`;
  }
  const suma = r2(partes.reduce((s, p) => s + (Number(p.monto_usd) || 0), 0));
  const dif = r2(suma - r2(totalUsd));
  if (Math.abs(dif) > 0.01) {
    return dif > 0
      ? `Las partes suman $${suma.toFixed(2)}: se pasan por $${dif.toFixed(2)} del total ($${r2(totalUsd).toFixed(2)}).`
      : `Las partes suman $${suma.toFixed(2)}: faltan $${Math.abs(dif).toFixed(2)} para el total ($${r2(totalUsd).toFixed(2)}).`;
  }
  return null;
}

/** Lo guardado puede venir viejo o roto: se limpia sin inventar montos. */
export function normalizarPlan(raw: any): PlanPago | null {
  const partesRaw = Array.isArray(raw?.partes) ? raw.partes : Array.isArray(raw) ? raw : null;
  if (!partesRaw) return null;
  const partes: PartePlan[] = partesRaw
    .filter((p: any) => p && Number(p.monto_usd) > 0)
    .map((p: any) => ({
      id: String(p.id || nuevoIdParte()),
      concepto: (['base', 'iva', 'parte'].includes(p.concepto) ? p.concepto : 'parte') as ConceptoParte,
      etiqueta: p.etiqueta ? String(p.etiqueta) : null,
      monto_usd: r2(Number(p.monto_usd)),
      metodo: (METODOS_PARTE.some((m) => m.key === p.metodo) ? p.metodo : 'otro') as MetodoParte,
      tasa_tipo: (TASAS.some((t) => t.key === p.tasa_tipo) ? p.tasa_tipo : null) as TasaTipo | null,
      tasa: Number(p.tasa) > 0 ? Number(p.tasa) : null,
    }));
  if (partes.length === 0) return null;
  return { partes, nota: raw?.nota ?? null, actualizado_por: raw?.actualizado_por ?? null, actualizado_at: raw?.actualizado_at ?? null };
}

export type EstadoParte = { parte: PartePlan; abonadoUsd: number; faltaUsd: number; pagada: boolean };

/**
 * Cuánto lleva pagado cada parte. Los abonos marcados con su parte_id cuentan para
 * esa parte; los que no dicen parte se reparten en orden (primero la primera parte).
 */
export function estadoPartes(partes: PartePlan[], abonos: { monto: number | string | null; parte_id?: string | null }[]): EstadoParte[] {
  const pagado = new Map<string, number>();
  let libre = 0;
  for (const a of abonos || []) {
    const m = Number(a?.monto) || 0;
    if (a?.parte_id && partes.some((p) => p.id === a.parte_id)) pagado.set(a.parte_id, (pagado.get(a.parte_id) || 0) + m);
    else libre += m;
  }
  return (partes || []).map((p) => {
    let ab = pagado.get(p.id) || 0;
    const falta0 = Math.max(0, r2(p.monto_usd - ab));
    if (libre > 0 && falta0 > 0) {
      const usa = Math.min(libre, falta0);
      ab += usa;
      libre = r2(libre - usa);
    }
    const falta = Math.max(0, r2(p.monto_usd - ab));
    return { parte: p, abonadoUsd: r2(ab), faltaUsd: falta, pagada: falta <= 0.005 };
  });
}

/** 1234.5 → «1.234,50» */
const montoEs = (n: number): string => {
  const v = r2(n);
  const [ent, dec] = Math.abs(v).toFixed(2).split('.');
  return `${v < 0 ? '-' : ''}${ent.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${dec}`;
};

/** Una línea de la parte para el mensaje / PDF: «Base: $2.680,00 → Bs 2.948.000,00 (tasa USDT 1.100,00) · 🏦 Transferencia Bs». */
export function lineaParte(p: PartePlan, alicuotaIva?: number | null, estado?: EstadoParte | null): string {
  const moneda = monedaDeMetodo(p.metodo);
  const enMoneda = moneda === 'VES'
    ? ` → Bs ${montoEs(montoEnMoneda(p))}${Number(p.tasa) > 0 ? ` (tasa ${etiquetaTasa(p.tasa_tipo) ? `${etiquetaTasa(p.tasa_tipo)} ` : ''}${montoEs(Number(p.tasa))})` : ''}`
    : moneda === 'USDT' ? ` → ${montoEs(montoEnMoneda(p))} USDT` : '';
  const marca = estado?.pagada ? '✅ ' : '';
  const falta = estado && !estado.pagada && estado.abonadoUsd > 0 ? ` · falta $${montoEs(estado.faltaUsd)}` : '';
  return `${marca}${tituloParte(p, alicuotaIva)}: $${montoEs(p.monto_usd)}${enMoneda} · ${etiquetaMetodo(p.metodo)}${falta}`;
}

/** Qué bloques bancarios hacen falta según los métodos del plan. */
export function bloquesBancoDelPlan(partes: PartePlan[]): { transferencia: boolean; pagoMovil: boolean; binance: boolean } {
  const ms = new Set((partes || []).map((p) => p.metodo));
  return {
    transferencia: ms.has('transferencia_bs') || ms.has('transferencia_usd'),
    pagoMovil: ms.has('pago_movil'),
    binance: ms.has('usdt'),
  };
}
