// ── PRIORIDAD Y MOTORIZADO DEL REQUERIMIENTO (29-oct-2026) ───────────────────
// Pedido: «en las solicitudes, una vez que ya se aceptó, necesito poder colocar el
// nivel de prioridad del requerimiento, y eso también se debe poder ver en el por
// pagar» y «necesito poder seleccionar el motorizado responsable, que puede ser un
// almacenista, en los requerimientos».
//
// La prioridad usa los MISMOS valores que `cuentas.prioridad` ('alta' | 'media' |
// 'baja', NULL = sin prioridad) y la base la copia en los dos sentidos
// (trg_req_prioridad_cxp y trg_cxp_req_sync, SQL del 29-oct que se corre a mano).
//
// ⚠️ Columnas nuevas: si la app se publica ANTES de correr el SQL, mandar
//    `prioridad` / `motorizado_*` en el mismo update que el resto haría fallar el
//    guardado entero. Por eso van SIEMPRE en un update APARTE, solo con lo que
//    cambió (y nunca un null en un alta), y si la columna no existe se avisa.

export type PrioridadCompra = 'alta' | 'media' | 'baja';
export const PRIORIDADES_COMPRA: PrioridadCompra[] = ['alta', 'media', 'baja'];
/** Mismas etiquetas y tonos que Cuentas por pagar (CuentasScreen). */
export const PRIORIDAD_COMPRA_INFO: Record<PrioridadCompra, { label: string; tone: 'danger' | 'warning' | 'info' }> = {
  alta:  { label: '🔺 Alta',  tone: 'danger'  },
  media: { label: '🔸 Media', tone: 'warning' },
  baja:  { label: '🔹 Baja',  tone: 'info'    },
};

export const esPrioridadCompra = (v: unknown): v is PrioridadCompra => v === 'alta' || v === 'media' || v === 'baja';

/** Terna Soft (fondo · borde · texto) del tema para el tono de la prioridad. */
export function colorPrioridad(colors: any, p: PrioridadCompra) {
  switch (PRIORIDAD_COMPRA_INFO[p].tone) {
    case 'danger': return { bg: colors.dangerSoftBg, border: colors.dangerSoftBorder, text: colors.dangerSoftText };
    case 'warning': return { bg: colors.warningSoftBg, border: colors.warningSoftBorder, text: colors.warningSoftText };
    default: return { bg: colors.infoSoftBg, border: colors.infoSoftBorder, text: colors.infoSoftText };
  }
}

/** Estados en los que la solicitud ya fue ACEPTADA (convertida en requerimiento). */
export const ESTADOS_REQ_ACEPTADO = ['aprobado', 'esperando_recepcion', 'recibido', 'pagado'];

/** El error de la base dice que la columna aún no existe (falta correr el SQL). */
export function faltaColumnaSyncCompras(msg: string | null | undefined): boolean {
  const m = String(msg ?? '');
  return /prioridad|motorizado/i.test(m) && /column|does not exist|schema cache|no existe/i.test(m);
}

export interface ExtrasReq {
  prioridad?: string | null;
  motorizado_user_id?: string | null;
  motorizado_nombre?: string | null;
}

const limpio = (v: string | null | undefined) => {
  const t = (v ?? '').trim();
  return t ? t : null;
};

/**
 * Arma el parche de las columnas nuevas SOLO con lo que cambió.
 * · Alta (`antes` = null): solo lo que trae valor (nunca un null).
 * · Edición: solo lo que difiere de lo guardado. El motorizado viaja en pareja
 *   (id + nombre) para que nunca quede un id con el nombre de otro.
 */
export function parcheExtrasReq(antes: ExtrasReq | null, ahora: ExtrasReq): Record<string, any> {
  const p: Record<string, any> = {};
  const prio = esPrioridadCompra(ahora.prioridad) ? ahora.prioridad : null;
  const motoId = limpio(ahora.motorizado_user_id);
  const motoNombre = limpio(ahora.motorizado_nombre);
  if (!antes) {
    if (prio) p.prioridad = prio;
    if (motoNombre) { p.motorizado_nombre = motoNombre; if (motoId) p.motorizado_user_id = motoId; }
    return p;
  }
  const prioAntes = esPrioridadCompra(antes.prioridad) ? antes.prioridad : null;
  if (prio !== prioAntes) p.prioridad = prio;
  if (motoId !== limpio(antes.motorizado_user_id) || motoNombre !== limpio(antes.motorizado_nombre)) {
    p.motorizado_user_id = motoNombre ? motoId : null;
    p.motorizado_nombre = motoNombre;
  }
  return p;
}
