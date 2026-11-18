// 💳 FUENTE ÚNICA DE VERDAD PARA MONEDA REAL, MÉTODO DE PAGO Y PLAN (18-nov-2026)
//
// Resuelve de forma pura y unificada (para Por Pagar, Solo Resumen PDF, Tabla Detallada
// y Lista Tesorería WS) cuál es la moneda real de pago de cada cuenta/orden:
//   - BS (Transferencia Bs, Pago Móvil Bs, Efectivo Bs)
//   - USDT (Binance / USDT)
//   - USD_EFECTIVO (Efectivo $ / Divisas / Transferencia $)
//   - ZELLE (Zelle)
//   - MIXTO (varias partes o proveedores en distintas monedas, ej. Base USDT + IVA Bs)
//   - POR_DEFINIR (sin método definido o ficha con múltiples canales sin especificar en la orden)
//
// ⚠️ Puro (sin React Native ni Supabase) para poder probarlo directo en Node.

import {
  monedaDeMetodo,
  etiquetaMetodo,
  etiquetaTasa,
  tituloParte,
  type PlanPago,
  type PartePlan,
  type TasaTipo,
} from './planPago';

export type MonedaRealPago =
  | 'BS'
  | 'USDT'
  | 'USD_EFECTIVO'
  | 'ZELLE'
  | 'MIXTO'
  | 'POR_DEFINIR';

export type CubetaPagoResuelta = {
  monedaReal: Exclude<MonedaRealPago, 'MIXTO'>;
  metodoClave: string;
  metodoLabel: string;
  icono: string;
  tasaTipo: TasaTipo | null;
  tasaValor: number | null;
  montoUsd: number;
  /** Monto real en Bs a desembolsar (solo > 0 cuando monedaReal === 'BS'). */
  montoBs: number;
  concepto?: string | null;
  proveedor?: string | null;
};

export type PagoResueltoCuenta = {
  monedaReal: MonedaRealPago;
  monedaLabel: string;
  monedaIcono: string;
  metodoClave: string;
  metodoLabel: string;
  cubetas: CubetaPagoResuelta[];
  notasUnificadas: string;
};

export type BancoMinParaResolver = {
  banco?: string | null;
  numeroCuenta?: string | null;
  pagoMovilBanco?: string | null;
  pagoMovilTelefono?: string | null;
  binanceId?: string | null;
  instruccionesPago?: string | null;
};

export type CuentaMinParaResolver = {
  monto?: number | null;
  saldo?: number | null;
  situacion?: string | null;
  contraparte?: string | null;
  condicionesPago?: string | null;
  notaLimpia?: string | null;
  nota?: string | null;
  notaEspera?: string | null;
  alicuotaIva?: number | null;
  plan?: PlanPago | null;
  banco?: BancoMinParaResolver | null;
  metodosActivos?: string[] | null;
  desgloseProveedores?: {
    proveedor: string;
    totalUsd: number;
    totalBs?: number;
    pago?: string | null;
    banco?: BancoMinParaResolver | null;
  }[] | null;
};

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const limpio = (v: unknown) => String(v ?? '').trim();

export const ETIQUETA_MONEDA_REAL: Record<MonedaRealPago, { label: string; icono: string }> = {
  BS:           { label: 'Bolívares (Bs)',       icono: '🇻🇪' },
  USDT:         { label: 'USDT / Binance',       icono: '🪙' },
  USD_EFECTIVO: { label: 'Efectivo $ / Divisas', icono: '💵' },
  ZELLE:        { label: 'Zelle',                icono: '💸' },
  MIXTO:        { label: 'Mixto (varias monedas)', icono: '🔀' },
  POR_DEFINIR:  { label: 'Por definir',          icono: '📌' },
};

/** Clasifica un texto libre (condiciones, pago de ítem o nota) en moneda + método concreto. */
export function clasificarTextoMonedaMetodo(textoRaw: string): {
  monedaReal: Exclude<MonedaRealPago, 'MIXTO'>;
  metodoClave: string;
  metodoLabel: string;
  icono: string;
  tasaTipo: TasaTipo | null;
} | null {
  const t = limpio(textoRaw).toUpperCase();
  if (!t) return null;

  const esEuro = /TASA\s*EURO|EURO\s*BCV|💶/.test(t);
  const esBcv = /TASA\s*(DOLAR\s*)?BCV|🏛️/.test(t);
  const tasaTipo: TasaTipo | null = esEuro ? 'euro' : esBcv ? 'bcv' : null;

  if (/BINANCE|USDT|TRC20|TRX\b/.test(t)) {
    return { monedaReal: 'USDT', metodoClave: 'usdt', metodoLabel: 'USDT / Binance', icono: '🪙', tasaTipo: null };
  }
  if (/ZELLE|BOFA/.test(t)) {
    return { monedaReal: 'ZELLE', metodoClave: 'zelle', metodoLabel: 'Zelle', icono: '💸', tasaTipo: null };
  }
  if (/PAGO\s*M[OÓ]VIL/.test(t)) {
    return { monedaReal: 'BS', metodoClave: 'pago_movil', metodoLabel: 'Pago móvil (Bs)', icono: '📲', tasaTipo };
  }
  if (/EFECTIVO\s*BS|BOL[IÍ]VAR(ES)?\s*EN\s*EFECTIVO/.test(t)) {
    return { monedaReal: 'BS', metodoClave: 'efectivo_bs', metodoLabel: 'Efectivo Bs', icono: '💵', tasaTipo };
  }
  if (/EFECTIVO|DIVISA|CASH|EFECTIVO\s*\$|DOLARES\s*EFECTIVO|D[OÓ]LARES\s*EFECTIVO/.test(t)) {
    return { monedaReal: 'USD_EFECTIVO', metodoClave: 'efectivo_usd', metodoLabel: 'Efectivo $ / Divisas', icono: '💵', tasaTipo: null };
  }
  if (/TRANSFERENCIA\s*\$|TRANSFERENCIA\s*USD/.test(t)) {
    return { monedaReal: 'USD_EFECTIVO', metodoClave: 'transferencia_usd', metodoLabel: 'Transferencia $', icono: '🏦', tasaTipo: null };
  }
  if (/TRANSFERENCIA|PUNTO|D[EÉ]BITO|BIOPAGO|TASA\s*EURO|TASA\s*BCV|\bEN\s*BS\b|\bBS\b|BOL[IÍ]VAR/.test(t)) {
    const esPunto = /PUNTO|D[EÉ]BITO|BIOPAGO/.test(t);
    return {
      monedaReal: 'BS',
      metodoClave: esPunto ? 'debito' : 'transferencia_bs',
      metodoLabel: esPunto ? 'Punto / Débito (Bs)' : 'Transferencia bancaria (Bs)',
      icono: esPunto ? '💳' : '🏦',
      tasaTipo,
    };
  }
  return null;
}

function resolverDesdeBancoSiEsUnico(b?: BancoMinParaResolver | null): {
  monedaReal: Exclude<MonedaRealPago, 'MIXTO'>;
  metodoClave: string;
  metodoLabel: string;
  icono: string;
} | null {
  if (!b) return null;
  const tieneTransf = Boolean(limpio(b.numeroCuenta) || limpio(b.banco));
  const tienePm = Boolean(limpio(b.pagoMovilTelefono));
  const tieneBinance = Boolean(limpio(b.binanceId));
  const deInstr = clasificarTextoMonedaMetodo(limpio(b.instruccionesPago));

  // Canales distintos por moneda: Bs (transf/pm) vs Binance (USDT) vs instrucciones
  const canalesBs = tieneTransf || tienePm;
  const canalesUsd = tieneBinance || (deInstr && deInstr.monedaReal !== 'BS');

  // Si la ficha tiene canales de monedas distintas (ej. Banco Bs Y Binance), NO adivinamos.
  if (canalesBs && canalesUsd) return null;

  if (tieneBinance && !canalesBs) {
    return { monedaReal: 'USDT', metodoClave: 'usdt', metodoLabel: 'USDT / Binance', icono: '🪙' };
  }
  if (canalesBs && !canalesUsd) {
    if (tieneTransf && !tienePm) {
      return { monedaReal: 'BS', metodoClave: 'transferencia_bs', metodoLabel: 'Transferencia bancaria (Bs)', icono: '🏦' };
    }
    if (tienePm && !tieneTransf) {
      return { monedaReal: 'BS', metodoClave: 'pago_movil', metodoLabel: 'Pago móvil (Bs)', icono: '📲' };
    }
    return { monedaReal: 'BS', metodoClave: 'transferencia_bs', metodoLabel: 'Transferencia / Pago móvil (Bs)', icono: '🏦' };
  }
  if (deInstr) return deInstr;
  return null;
}

function cubetaDePartePlan(
  p: PartePlan,
  factorSaldo: number,
  tasaBcvHoy: number | null,
  alicuotaIva?: number | null,
  proveedor?: string | null,
): CubetaPagoResuelta {
  const montoUsd = r2((Number(p.monto_usd) || 0) * factorSaldo);
  const mon = monedaDeMetodo(p.metodo);
  const tasaTipo = p.tasa_tipo ?? null;
  const tasaValor = Number(p.tasa) > 0 ? Number(p.tasa) : (mon === 'VES' && tasaBcvHoy && tasaBcvHoy > 0 ? tasaBcvHoy : null);

  let monedaReal: Exclude<MonedaRealPago, 'MIXTO'> = 'POR_DEFINIR';
  let icono = '📝';
  let label = etiquetaMetodo(p.metodo).replace(/^[^\wÁÉÍÓÚÑ]+/i, '').trim();

  if (mon === 'VES') {
    monedaReal = 'BS';
    icono = p.metodo === 'pago_movil' ? '📲' : p.metodo === 'efectivo_bs' ? '💵' : '🏦';
    if (tasaTipo) label = `${label} (${etiquetaTasa(tasaTipo)})`;
  } else if (mon === 'USDT' || p.metodo === 'usdt') {
    monedaReal = 'USDT';
    icono = '🪙';
  } else if (p.metodo === 'zelle') {
    monedaReal = 'ZELLE';
    icono = '💸';
  } else if (p.metodo === 'efectivo_usd' || p.metodo === 'transferencia_usd') {
    monedaReal = 'USD_EFECTIVO';
    icono = p.metodo === 'transferencia_usd' ? '🏦' : '💵';
  } else {
    const inf = clasificarTextoMonedaMetodo(limpio(p.etiqueta));
    if (inf) {
      monedaReal = inf.monedaReal;
      icono = inf.icono;
      label = inf.metodoLabel;
    }
  }

  const montoBs = monedaReal === 'BS' && tasaValor ? r2(montoUsd * tasaValor) : 0;
  return {
    monedaReal,
    metodoClave: p.metodo,
    metodoLabel: label,
    icono,
    tasaTipo,
    tasaValor,
    montoUsd,
    montoBs,
    concepto: tituloParte(p, alicuotaIva),
    proveedor: proveedor ?? null,
  };
}

/**
 * Unifica las notas de una cuenta sin duplicar textos idénticos.
 */
export function unificarNotasCuenta(c: CuentaMinParaResolver): string {
  const partes: string[] = [];
  const push = (pref: string, val?: string | null) => {
    const t = limpio(val);
    if (!t) return;
    if (partes.some((x) => x.toLowerCase().includes(t.toLowerCase()))) return;
    partes.push(pref ? `${pref}: ${t}` : t);
  };
  push('', c.notaLimpia);
  push('Espera', c.notaEspera);
  push('Plan', c.plan?.nota);
  return partes.join(' · ');
}

/**
 * Resuelve moneda real, método y cubetas para cualquier cuenta por pagar/cobrar.
 */
export function resolverPagoCuenta(
  c: CuentaMinParaResolver,
  tasaBcvHoy: number | null | undefined,
  bsFijoCuenta?: number | null,
): PagoResueltoCuenta {
  const tasaHoy = tasaBcvHoy != null && isFinite(Number(tasaBcvHoy)) && Number(tasaBcvHoy) > 0
    ? Number(tasaBcvHoy)
    : null;
  const monto = Number(c.monto) || 0;
  const saldo = c.situacion === 'pagada' ? 0 : (c.saldo != null ? Number(c.saldo) : monto);
  const factorSaldo = monto > 0 && saldo >= 0 ? Math.min(1, saldo / monto) : 1;
  const baseUsd = saldo > 0 ? saldo : monto;
  const notasUnificadas = unificarNotasCuenta(c);

  let cubetas: CubetaPagoResuelta[] = [];

  // 1. Plan de pagos explícito (máxima prioridad: distingue Base Euro / IVA BCV / USDT / Zelle / Efectivo)
  if (c.plan?.partes && c.plan.partes.length > 0) {
    cubetas = c.plan.partes.map((p) =>
      cubetaDePartePlan(p, factorSaldo, tasaHoy, c.alicuotaIva, c.contraparte ?? null),
    );
  }
  // 2. Desglose multi-proveedor (prorrateado por saldo pendiente)
  else if (c.desgloseProveedores && c.desgloseProveedores.length > 1) {
    cubetas = c.desgloseProveedores.map((dp) => {
      const dpUsd = r2((Number(dp.totalUsd) || 0) * factorSaldo);
      const cls =
        clasificarTextoMonedaMetodo(limpio(dp.pago))
        ?? resolverDesdeBancoSiEsUnico(dp.banco)
        ?? clasificarTextoMonedaMetodo(`${limpio(c.condicionesPago)} ${limpio(c.notaLimpia)}`)
        ?? { monedaReal: 'POR_DEFINIR' as const, metodoClave: 'por_definir', metodoLabel: 'Por definir', icono: '📌', tasaTipo: null };
      const dpBs = cls.monedaReal === 'BS'
        ? (dp.totalBs && dp.totalBs > 0 ? r2(dp.totalBs * factorSaldo) : (tasaHoy ? r2(dpUsd * tasaHoy) : 0))
        : 0;
      return {
        monedaReal: cls.monedaReal,
        metodoClave: cls.metodoClave,
        metodoLabel: cls.metodoLabel,
        icono: cls.icono,
        tasaTipo: 'tasaTipo' in cls ? cls.tasaTipo ?? null : null,
        tasaValor: cls.monedaReal === 'BS' ? tasaHoy : null,
        montoUsd: dpUsd,
        montoBs: dpBs,
        concepto: null,
        proveedor: dp.proveedor,
      };
    });
  }
  // 3. Cuenta simple sin plan: primero condiciones/nota/método explícito, luego ficha si es inequívoca
  else {
    const dpUnico = c.desgloseProveedores?.[0];
    const textoOrden = [
      limpio(dpUnico?.pago),
      limpio(c.condicionesPago),
      limpio(c.notaLimpia),
      limpio(c.notaEspera),
    ].filter(Boolean).join(' ');

    const clsTexto = clasificarTextoMonedaMetodo(textoOrden);
    const clsBanco = !clsTexto ? resolverDesdeBancoSiEsUnico(c.banco ?? dpUnico?.banco) : null;
    const cls = clsTexto ?? clsBanco ?? {
      monedaReal: 'POR_DEFINIR' as const,
      metodoClave: 'por_definir',
      metodoLabel: 'Método por definir',
      icono: '📌',
      tasaTipo: null,
    };

    const montoBs = cls.monedaReal === 'BS'
      ? (bsFijoCuenta != null && bsFijoCuenta > 0 ? r2(bsFijoCuenta) : (tasaHoy ? r2(baseUsd * tasaHoy) : 0))
      : 0;

    cubetas = [{
      monedaReal: cls.monedaReal,
      metodoClave: cls.metodoClave,
      metodoLabel: cls.metodoLabel,
      icono: cls.icono,
      tasaTipo: 'tasaTipo' in cls ? cls.tasaTipo ?? null : null,
      tasaValor: cls.monedaReal === 'BS' ? tasaHoy : null,
      montoUsd: r2(baseUsd),
      montoBs,
      concepto: null,
      proveedor: c.contraparte ?? null,
    }];
  }

  // Determinar la moneda real consolidada de la cuenta
  const monedasDistintas = Array.from(new Set(cubetas.map((x) => x.monedaReal)));
  const monedasDefinidas = monedasDistintas.filter((m) => m !== 'POR_DEFINIR');
  let monedaReal: MonedaRealPago = 'POR_DEFINIR';
  if (monedasDefinidas.length > 1) monedaReal = 'MIXTO';
  else if (monedasDefinidas.length === 1) monedaReal = monedasDefinidas[0];
  else monedaReal = 'POR_DEFINIR';

  const meta = ETIQUETA_MONEDA_REAL[monedaReal];
  const metodoUnico = cubetas.length === 1 ? cubetas[0] : null;

  return {
    monedaReal,
    monedaLabel: meta.label,
    monedaIcono: meta.icono,
    metodoClave: monedaReal === 'MIXTO' ? 'mixto' : (metodoUnico?.metodoClave ?? cubetas[0]?.metodoClave ?? 'por_definir'),
    metodoLabel: monedaReal === 'MIXTO'
      ? Array.from(new Set(cubetas.map((x) => x.metodoLabel))).join(' + ')
      : (metodoUnico?.metodoLabel ?? meta.label),
    cubetas,
    notasUnificadas,
  };
}
