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
  /** true = Bs de ese día / del requerimiento (fijos); false = actualizado a la tasa BCV del día de hoy. */
  fijo: boolean;
  /** true si existe un monto/tasa histórica del día en que se creó el requerimiento. */
  tieneTasaEseDia?: boolean;
  /** Monto total en Bs calculado con la tasa de ese día (del requerimiento). */
  montoBsEseDia?: number;
  /** Saldo pendiente en Bs calculado con la tasa de ese día (del requerimiento). */
  saldoBsEseDia?: number;
  /** Tasa efectiva (Bs/$) de ese día en que se registró el requerimiento. */
  tasaEseDia?: number | null;
  /** Monto total en Bs actualizado a la tasa BCV de hoy. */
  montoBsHoy?: number;
  /** Saldo pendiente en Bs actualizado a la tasa BCV de hoy. */
  saldoBsHoy?: number;
};

export type OpcionesMontosBsCuenta = {
  /**
   * true = actualiza SIEMPRE los montos en Bs a la tasa del día de hoy (`tasaHoy`).
   * false = usa los montos en Bs / tasa de ese día (del requerimiento).
   */
  actualizarATasaDelDia?: boolean;
  /** Tasa BCV histórica de la fecha de emisión/creación (para requerimientos sin Bs explícitos en renglones). */
  tasaFechaEmision?: number | null;
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

export function montosBsCuenta(
  c: CuentaParaBs,
  req: ReqParaBs | null | undefined,
  tasaHoy: number | null | undefined,
  opciones?: OpcionesMontosBsCuenta | boolean,
): MontosBsCuenta {
  const monto = Number(c.monto) || 0;
  const saldo = c.saldo != null ? Number(c.saldo) || 0 : monto;
  const hoy = Number(tasaHoy) || 0;
  const montoBsHoy = hoy > 0 ? Math.round(monto * hoy * 100) / 100 : 0;
  const saldoBsHoy = hoy > 0 ? Math.round(saldo * hoy * 100) / 100 : 0;

  const opts: OpcionesMontosBsCuenta =
    typeof opciones === 'boolean' ? { actualizarATasaDelDia: opciones } : (opciones ?? {});

  let tieneTasaEseDia = false;
  let montoBsEseDia = 0;
  let saldoBsEseDia = 0;
  let tasaEseDia: number | null = null;

  const tasaNota = tasaDeNotaCuenta(c.nota);
  const tasaHist = tasaNota ?? (Number(opts.tasaFechaEmision) > 0 ? Number(opts.tasaFechaEmision) : null);

  if (req && reqTieneBsEscritos(req)) {
    const tasaRef = tasaHist ?? hoy;
    const alic = c.alicuota_iva != null && c.alicuota_iva !== '' ? Number(c.alicuota_iva) || 0 : Number(req.iva_alicuota) || 0;
    const { totalBs } = calcularTotalesReqBs((req.items || []) as any[], tasaRef, alic);
    if (totalBs > 0) {
      tieneTasaEseDia = true;
      montoBsEseDia = totalBs;
      saldoBsEseDia = Math.max(0, monto > 0 ? (saldo >= monto ? totalBs : Math.round(totalBs * (saldo / monto) * 100) / 100) : 0);
      tasaEseDia = tasaNota ?? (monto > 0 ? Math.round((totalBs / monto) * 100) / 100 : tasaHist);
    }
  } else if (tasaHist && tasaHist > 0 && monto > 0) {
    tieneTasaEseDia = true;
    montoBsEseDia = Math.round(monto * tasaHist * 100) / 100;
    saldoBsEseDia = Math.max(0, Math.round(saldo * tasaHist * 100) / 100);
    tasaEseDia = Math.round(tasaHist * 100) / 100;
  }

  // Si actualizarATasaDelDia === true (comportamiento por defecto en Por Pagar: siempre actualizar a tasa BCV del día),
  // devuelve montoBsHoy / saldoBsHoy pero conserva montoBsEseDia / saldoBsEseDia para el botón de alternar a la tasa de ese día.
  const usarEseDia =
    opts.actualizarATasaDelDia === true
      ? false
      : opts.actualizarATasaDelDia === false
        ? tieneTasaEseDia && montoBsEseDia > 0
        : Boolean(req && reqTieneBsEscritos(req) && montoBsEseDia > 0);

  if (usarEseDia && montoBsEseDia > 0) {
    return {
      montoBs: montoBsEseDia,
      saldoBs: saldoBsEseDia,
      fijo: true,
      tieneTasaEseDia,
      montoBsEseDia,
      saldoBsEseDia,
      tasaEseDia,
      montoBsHoy,
      saldoBsHoy,
    };
  }

  return {
    montoBs: montoBsHoy,
    saldoBs: saldoBsHoy,
    fijo: false,
    tieneTasaEseDia,
    montoBsEseDia: tieneTasaEseDia ? montoBsEseDia : montoBsHoy,
    saldoBsEseDia: tieneTasaEseDia ? saldoBsEseDia : saldoBsHoy,
    tasaEseDia,
    montoBsHoy,
    saldoBsHoy,
  };
}
