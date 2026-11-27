// ============================================================================
// MONTO QUINCENAL de un empleado — para la CONSTANCIA DE TRABAJO.
//
// POR QUÉ EXISTE
// ---------------------------------------------------------------------------
// La constancia de trabajo no llevaba sueldo (decisión vieja del cliente). Pero
// muchos trámites —bancos, créditos, alquileres— la piden CON el monto. Pedido
// del cliente (21-ago-2026): «que salga un check para que le salga el monto
// quincenal; si le doy al check que le salga el monto que gana quincenal, y si
// no tiene un monto específico que haga un recálculo de cuánto gana si es
// semanal o mensual».
//
// De dónde sale el número, en este orden:
//   1) `precio_quincena` — el monto EXACTO, si está cargado. No se calcula nada.
//   2) `precio_semana` × 2 — una quincena son DOS semanas en este sistema
//      (`spanDias` en PagoPorPersona: semanal = 6 días, quincenal = 14).
//   3) `base_salary` × 2 — el campo «Salario Semanal» de la ficha del empleado
//      (en EmpleadosScreen el formulario guarda el sueldo semanal en `base_salary`).
//   4) `precio_mes` ÷ 2 — un mes son dos quincenas (mensual = 29 días).
//   5) `precio_dia` × 14 — turno diurno por 14 días (2 semanas).
//   6) `precio_noche` × 14 — turno nocturno por 14 días (2 semanas).
//
// Si no hay ninguno, devuelve `null`: NO se inventa un monto y la pantalla lo dice.
//
// `scripts/test-monto-quincenal.mjs` amarra estas reglas.
// ============================================================================

/** Lo mínimo que se necesita del empleado para sacar la quincena. */
export type EmpleadoSueldo = {
  precio_quincena?: number | string | null;
  precio_semana?: number | string | null;
  precio_mes?: number | string | null;
  base_salary?: number | string | null;
  precio_dia?: number | string | null;
  precio_noche?: number | string | null;
};

/** De dónde salió el número: si fue exacto o de qué se convirtió. */
export type OrigenMonto = 'quincena' | 'semana' | 'mes' | 'dia' | 'noche';

export type MontoQuincenal = {
  /** El monto de la quincena, ya redondeado a 2 decimales. */
  monto: number;
  origen: OrigenMonto;
  /** ¿Es el monto exacto cargado, o una conversión? */
  exacto: boolean;
  /** Explicación corta para mostrar en pantalla (NO va en el PDF). */
  detalle: string;
};

const num = (v: any): number => {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};
const r2 = (n: number) => Math.round(n * 100) / 100;
const money = (n: number) =>
  `$${r2(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Monto QUINCENAL del empleado, o `null` si no hay con qué calcularlo.
 * Solo cuentan los montos MAYORES QUE CERO: un 0 cargado es "sin definir", no
 * un sueldo de cero — si no, alguien con `precio_quincena = 0` y un sueldo
 * mensual bien cargado saldría ganando cero en la constancia.
 */
export function montoQuincenal(e: EmpleadoSueldo | null | undefined): MontoQuincenal | null {
  if (!e) return null;
  const quincena = num(e.precio_quincena);
  const semana = num(e.precio_semana);
  const baseSalary = num(e.base_salary);
  const mes = num(e.precio_mes);
  const dia = num(e.precio_dia);
  const noche = num(e.precio_noche);

  if (quincena > 0) {
    return { monto: r2(quincena), origen: 'quincena', exacto: true, detalle: 'Monto quincenal cargado en su ficha.' };
  }
  if (semana > 0) {
    return {
      monto: r2(semana * 2), origen: 'semana', exacto: false,
      detalle: `Calculado del sueldo semanal: ${money(semana)} × 2 semanas.`,
    };
  }
  if (baseSalary > 0) {
    return {
      monto: r2(baseSalary * 2), origen: 'semana', exacto: false,
      detalle: `Calculado del salario semanal: ${money(baseSalary)} × 2 semanas.`,
    };
  }
  if (mes > 0) {
    return {
      monto: r2(mes / 2), origen: 'mes', exacto: false,
      detalle: `Calculado del sueldo mensual: ${money(mes)} ÷ 2 quincenas.`,
    };
  }
  if (dia > 0) {
    return {
      monto: r2(dia * 14), origen: 'dia', exacto: false,
      detalle: `Calculado del turno diurno: ${money(dia)} × 14 días.`,
    };
  }
  if (noche > 0) {
    return {
      monto: r2(noche * 14), origen: 'noche', exacto: false,
      detalle: `Calculado del turno nocturno: ${money(noche)} × 14 días.`,
    };
  }
  return null;
}

/** El monto ya formateado para el PDF ("$1.234,56"), o null si no hay. */
export function montoQuincenalTexto(e: EmpleadoSueldo | null | undefined): string | null {
  const m = montoQuincenal(e);
  return m ? money(m.monto) : null;
}
