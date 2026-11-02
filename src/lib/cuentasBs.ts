// 💱 Bs de una cuenta por pagar que viene de un requerimiento (02-nov-2026).
//
// La cuenta se guarda en US$ (req_sync_compra), pero si en el requerimiento se
// escribieron los montos en Bs, esos Bs son los de la factura y no deben cambiar
// con la tasa del día. Antes Por pagar mostraba «≈ US$ × tasa de hoy» y no
// cuadraba con el requerimiento (Bs 150.800 se veía como 150.801,60 y se movía).
//
// Regla: si la cuenta está enlazada a un requerimiento que trae Bs escritos, el
// monto en Bs es el total en Bs del requerimiento (calcularTotalesReqBs) y el
// saldo en Bs es la parte proporcional de lo que falta por pagar. Si no hay Bs
// escritos, se sigue mostrando el equivalente con la tasa de hoy (aproximado).
import { calcularTotalesReqBs } from './requerimientoFlujo';

type ReqParaBs = {
  items?: any[] | null;
  iva_alicuota?: number | string | null;
};

type CuentaParaBs = {
  monto?: number | string | null;
  saldo?: number | null;
  nota?: string | null;
  alicuota_iva?: number | string | null;
};

export type MontosBsCuenta = {
  montoBs: number;
  saldoBs: number;
  /** true = Bs escritos en el requerimiento (fijos); false = aproximado con la tasa de hoy. */
  fijo: boolean;
};

/** ¿El requerimiento trae montos escritos en Bs? */
export function reqTieneBsEscritos(req: ReqParaBs | null | undefined): boolean {
  return (req?.items || []).some((it: any) =>
    Number(it?.price_bs) > 0 || Number(it?.total_bs) > 0 || String(it?.currency || '').toUpperCase() === 'VES');
}

/** Tasa congelada que la base escribe en la nota de la cuenta: «(Bs 100.50 por $)». */
export function tasaDeNotaCuenta(nota?: string | null): number | null {
  const m = String(nota || '').match(/\(Bs\s*([\d.]+)\s*por \$\)/);
  return m && Number(m[1]) > 0 ? Number(m[1]) : null;
}

export function montosBsCuenta(c: CuentaParaBs, req: ReqParaBs | null | undefined, tasaHoy: number | null | undefined): MontosBsCuenta {
  const monto = Number(c.monto) || 0;
  const saldo = c.saldo != null ? Number(c.saldo) || 0 : monto;
  const hoy = Number(tasaHoy) || 0;
  if (req && reqTieneBsEscritos(req)) {
    const tasa = tasaDeNotaCuenta(c.nota) ?? hoy;
    const alic = c.alicuota_iva != null && c.alicuota_iva !== '' ? Number(c.alicuota_iva) || 0 : Number(req.iva_alicuota) || 0;
    const { totalBs } = calcularTotalesReqBs((req.items || []) as any[], tasa, alic);
    if (totalBs > 0) {
      const saldoBs = monto > 0 ? (saldo >= monto ? totalBs : Math.round(totalBs * (saldo / monto) * 100) / 100) : 0;
      return { montoBs: totalBs, saldoBs: Math.max(0, saldoBs), fijo: true };
    }
  }
  return {
    montoBs: hoy > 0 ? Math.round(monto * hoy * 100) / 100 : 0,
    saldoBs: hoy > 0 ? Math.round(saldo * hoy * 100) / 100 : 0,
    fijo: false,
  };
}
