import { leerNumero } from './numeros';

/**
 * ⏱️ HORAS EXTRAS EN CONTROL DE PAGO A PERSONAL (28-nov-2026).
 *
 * En los períodos "Por día" y "Por semana", cada trabajador puede tener además
 * horas extras cargadas en los campos «Precio hora ($)» (`precio_hora`) y
 * «Horas» (`horas`). Antes esos dos campos solo se leían cuando el período
 * entero era "Por hora", dejando en $0 las horas extras del personal por día
 * o por semana.
 *
 * REGLAS DE BLINDAJE EN PRODUCCIÓN:
 * 1. En modo "Por hora", todas las `horas` siguen siendo la base normal
 *    (`horas × precio_hora`), nunca se suman dos veces.
 * 2. En modos "Por día" y "Por semana":
 *    - `devengado = devengadoBase + (horasExtras × precio_hora)`.
 *    - Para operadores automáticos (`source === 'auto'`) cuya fila NO ha sido
 *      ajustada con horas extras (`!overridden` o `precio_hora <= 0`), cualquier
 *      valor arrastrado de `worked_hours` de máquina vale 0 horas extras para
 *      jamás cobrar dos veces la misma jornada (por día y por horas de máquina).
 * 3. Períodos CERRADOS (`aprobada` / `pagada`): son foto histórica congelada.
 *    Si un período viejo se cerró antes de existir esta regla (su `devengado`
 *    guardado coincide con `devengadoBase` sin horas extras), se respeta
 *    exactamente su monto congelado sin alterarlo retroactivamente.
 */

export type ModeNomina = 'hora' | 'dia' | 'semana';
export type StatusPeriodoNomina = 'borrador' | 'aprobada' | 'pagada';

export interface LineaMontoNomina {
  label?: string | null;
  amount?: number | string | null;
}

export interface ItemCalculoNomina {
  source?: 'auto' | 'manual' | string | null;
  overridden?: boolean | null;
  precio_hora?: number | string | null;
  precio_dia?: number | string | null;
  precio_noche?: number | string | null;
  precio_semana?: number | string | null;
  dias?: number | string | null;
  dias_noche?: number | string | null;
  horas?: number | string | null;
  semanas?: number | string | null;
  devengado?: number | string | null;
  bonos?: LineaMontoNomina[] | null;
  deducciones?: LineaMontoNomina[] | null;
  total?: number | string | null;
}

const r2 = (n: number) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const pos = (v: unknown) => Math.max(0, leerNumero(v));

const fmtUsdDefault = (n: number) =>
  `$${r2(n).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Escapa texto libre antes de interpolarlo en HTML de recibos o reportes PDF. */
export function escHtmlNomina(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Suma líneas de bonos o deducciones aceptando números o textos con punto/coma. */
export function sumarLineasNomina(lines?: LineaMontoNomina[] | null): number {
  return r2((lines || []).reduce((s, x) => s + leerNumero(x?.amount), 0));
}

/** Devengado únicamente de la modalidad base del período (sin horas extras adicionales). */
export function devengadoBaseOf(it: ItemCalculoNomina, mode: ModeNomina): number {
  if (mode === 'dia') {
    return r2(pos(it.dias) * pos(it.precio_dia) + pos(it.dias_noche) * pos(it.precio_noche));
  }
  if (mode === 'semana') {
    return r2(pos(it.semanas) * pos(it.precio_semana));
  }
  return r2(pos(it.horas) * pos(it.precio_hora));
}

/**
 * Detecta si `it.horas` proviene del conteo automático de horas de máquina
 * (`operator_assignments.worked_hours`) en un período que NO es "Por hora".
 */
export function esHorasAutoSinTocar(it: ItemCalculoNomina, mode: ModeNomina): boolean {
  if (mode === 'hora') return false;
  if (it.source !== 'auto') return false;
  if (!it.overridden) return true;
  if (pos(it.precio_hora) <= 0) return true;
  return false;
}

/** Precio unitario configurado para la hora extra ($/h). */
export function precioHoraExtraOf(it: ItemCalculoNomina): number {
  return r2(pos(it.precio_hora));
}

/**
 * Cantidad de horas extras efectivas para períodos "Por día" o "Por semana".
 * En modo "Por hora" devuelve 0 porque allí todas las horas son horas base.
 */
export function horasExtrasEfectivas(
  it: ItemCalculoNomina,
  mode: ModeNomina,
  periodStatus: StatusPeriodoNomina = 'borrador',
): number {
  if (mode === 'hora') return 0;
  if (esHorasAutoSinTocar(it, mode)) return 0;
  const h = r2(pos(it.horas));
  if (h <= 0) return 0;

  if (periodStatus !== 'borrador') {
    const ph = precioHoraExtraOf(it);
    const extraPotencial = r2(h * ph);
    if (extraPotencial <= 0) return 0;
    if (it.devengado !== undefined && it.devengado !== null) {
      const base = devengadoBaseOf(it, mode);
      const guardado = r2(leerNumero(it.devengado));
      if (Math.abs(guardado - (base + extraPotencial)) > 0.05) {
        return 0;
      }
    }
  }

  return h;
}

/** Monto en US$ correspondiente a las horas extras (`horasExtras × precio_hora`). */
export function montoHorasExtrasOf(
  it: ItemCalculoNomina,
  mode: ModeNomina,
  periodStatus: StatusPeriodoNomina = 'borrador',
): number {
  const h = horasExtrasEfectivas(it, mode, periodStatus);
  const ph = precioHoraExtraOf(it);
  return h > 0 && ph > 0 ? r2(h * ph) : 0;
}

/** Devengado total = devengado base del modo + monto de horas extras (si aplica). */
export function devengadoTotalOf(
  it: ItemCalculoNomina,
  mode: ModeNomina,
  periodStatus: StatusPeriodoNomina = 'borrador',
): number {
  return r2(devengadoBaseOf(it, mode) + montoHorasExtrasOf(it, mode, periodStatus));
}

/** Total neto a pagar al trabajador = devengado total + bonos − deducciones. */
export function totalRenglonOf(
  it: ItemCalculoNomina,
  mode: ModeNomina,
  periodStatus: StatusPeriodoNomina = 'borrador',
): number {
  return r2(
    devengadoTotalOf(it, mode, periodStatus) +
      sumarLineasNomina(it.bonos) -
      sumarLineasNomina(it.deducciones),
  );
}

/** Valor inicial para el input de Horas al abrir el editor de renglón. */
export function horasInicialesEditor(
  it: ItemCalculoNomina,
  mode: ModeNomina,
  periodStatus: StatusPeriodoNomina = 'borrador',
): number {
  if (mode === 'hora') return r2(pos(it.horas));
  if (periodStatus !== 'borrador') return horasExtrasEfectivas(it, mode, periodStatus);
  if (esHorasAutoSinTocar(it, mode)) return 0;
  return r2(pos(it.horas));
}

/** Descripción legible de la parte base (sin horas extras). */
export function desgloseBaseTexto(
  it: ItemCalculoNomina,
  mode: ModeNomina,
  fmtUsd: (n: number) => string = fmtUsdDefault,
): string {
  if (mode === 'dia') {
    return `☀️ ${r2(pos(it.dias))} × ${fmtUsd(pos(it.precio_dia))} · 🌙 ${r2(pos(it.dias_noche))} × ${fmtUsd(pos(it.precio_noche))}`;
  }
  if (mode === 'semana') {
    return `${r2(pos(it.semanas))} sem × ${fmtUsd(pos(it.precio_semana))}`;
  }
  return `${r2(pos(it.horas))} h × ${fmtUsd(pos(it.precio_hora))}`;
}

/**
 * Descripción completa del devengado para tarjetas y recibos:
 * incluye jornadas/semanas y, cuando hay horas extras con precio > 0,
 * añade «· ⏱️ X h ext. × $Y ($Subtotal)».
 */
export function desgloseDevengadoTexto(
  it: ItemCalculoNomina,
  mode: ModeNomina,
  fmtUsd: (n: number) => string = fmtUsdDefault,
  periodStatus: StatusPeriodoNomina = 'borrador',
): string {
  const baseTxt = desgloseBaseTexto(it, mode, fmtUsd);
  const hExt = horasExtrasEfectivas(it, mode, periodStatus);
  const pExt = precioHoraExtraOf(it);
  const mExt = montoHorasExtrasOf(it, mode, periodStatus);
  if (mExt > 0) {
    return `${baseTxt} · ⏱️ ${hExt} h ext. × ${fmtUsd(pExt)} (${fmtUsd(mExt)})`;
  }
  return baseTxt;
}
