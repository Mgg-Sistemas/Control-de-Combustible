// 🕐 MONTO DE JORNADAS POR MÁQUINA EN UN RANGO (19-oct-2026).
//
// Para el Reporte consolidado de pagos. Regla del cliente: «deben ser lo mismo
// [que Control de pagos], ese reporte no inventa nada».
//
// ⭐ ESTA LIB ES EL CALCO LÍNEA POR LÍNEA de la receta de Control de Pagos
//    (src/screens/ControlPagosScreen.tsx: periodStartISO/periodEndISO :45-52,
//    billableHours :126-128, la agregación :298-373 y recomputeGroup :157-198),
//    en su MODO POR DEFECTO ('actual'):
//      · períodos: 26-jun→05-jul fijo (primer cierre) y luego semanas lunes–domingo;
//      · varias rondas el mismo día → el MÁXIMO de cada campo;
//      · horas cobrables del día = workedFromShifts(día, noche, parada, extras),
//        SOLO si día+noche > 0 (un día de puras extras vale $0);
//      · precio: frozen_price de la semana (priceRango, manda para TODA la
//        semana) → si no, el precio que regía CADA día (historial) → si no,
//        machinery.price_per_hour; sin precio → $0 y bandera;
//      · monto = precio × horas/12, acumulado SIN redondear y redondeado UNA vez;
//      · fuera: las rondas antes del 26-jun (FLEET_HOURS_START) y los FLETES
//        (no son jornadas; Pagos los suma aparte);
//      · la empresa es la ACTUAL de la máquina (igual que Pagos).
//
// ⚠️ DEUDA DECLARADA: lo correcto a futuro es que ControlPagosScreen importe
//    esta lib en vez de su copia (hoy no se tocó: sus pruebas fijan ese código
//    con regex — scripts/test-precio-historial.mjs). Si cambias la regla ALLÁ,
//    cámbiala ACÁ: scripts/test-pago-jornadas.mjs vigila la paridad.
//
// PURA: no toca Supabase ni React. El que llama carga las rondas (el mismo
// select de Pagos) y el historial (cargarHistorialPrecios), idealmente SEMANAS
// COMPLETAS: el precio por rango es semanal y un pedazo de semana podría dar
// distinto que Pagos.
import { workedFromShifts } from './hours';
import { precioVigenteEn, type HistorialPrecios } from './precioHistorial';

export const INICIO_JORNADAS = '2026-06-26'; // FLEET_HOURS_START
export const FIN_PRIMER_CIERRE = '2026-07-05'; // FLEET_HOURS_CUTOFF

const toISO = (d: Date) => {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
};
export function weekStartISO(iso: string): string {
  const d = new Date(iso + 'T12:00:00');
  const diff = (d.getDay() + 6) % 7; // días desde el lunes
  d.setDate(d.getDate() - diff);
  return toISO(d);
}
export function addDaysISO(iso: string, n: number): string {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return toISO(d);
}
/** Inicio del período de facturación (el primer cierre 26-jun→05-jul es uno solo). */
export function periodStartISO(iso: string): string {
  if (iso <= FIN_PRIMER_CIERRE) return INICIO_JORNADAS;
  return weekStartISO(iso);
}
export function periodEndISO(start: string): string {
  return start === INICIO_JORNADAS ? FIN_PRIMER_CIERRE : addDaysISO(start, 6);
}

type DiaJ = { day: number; night: number; stopped: number; overtime: number };
/** Horas cobrables del día — el MISMO billableHours de Pagos. */
export const horasCobrables = (d: DiaJ): number =>
  d.day + d.night > 0 ? workedFromShifts(d.day, d.night, d.stopped, d.overtime) : 0;

/** La fila de machine_rounds tal como la trae el select de Pagos. */
export type RondaJornada = {
  round_date: string;
  day_hours: number | string | null;
  night_hours: number | string | null;
  hours_stopped: number | string | null;
  overtime_hours: number | string | null;
  frozen_price: number | string | null;
  machinery: {
    id: string;
    code: string | null;
    serial: string | null;
    plate: string | null;
    price_per_hour: number | string | null;
    company: { id: string; name: string | null } | null;
  } | null;
};

export type FilaJornadas = {
  id: string;
  code: string;
  placa: string;
  empresa: string;
  horas: number;
  monto: number;
  sinPrecio: boolean;
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/**
 * Monto de jornadas por máquina entre `desde` y `hasta` (ambos inclusive),
 * con la receta exacta de Control de Pagos en modo 'actual'.
 */
export function montosJornadaPorMaquina(opts: {
  rounds: readonly RondaJornada[] | null | undefined;
  hist: HistorialPrecios | null | undefined;
  desde: string;
  hasta: string;
}): FilaJornadas[] {
  const { hist, desde, hasta } = opts;
  // Precio POR RANGO (frozen_price) por máquina|semana — manda para TODA la semana.
  const rangePriceWk = new Map<string, number>();
  for (const r of opts.rounds ?? []) {
    const mid = r.machinery?.id;
    if (!mid || !r.round_date) continue;
    const fp = Number(r.frozen_price);
    if (r.frozen_price != null && Number.isFinite(fp) && fp > 0) rangePriceWk.set(`${mid}|${periodStartISO(r.round_date)}`, fp);
  }

  // Agregar por máquina → día (máximo de cada campo, como Pagos), con el precio
  // del día por historial. Solo los días dentro del rango pedido.
  type Agg = {
    fila: FilaJornadas;
    priceActual: number | null;
    perDay: Record<string, DiaJ>;
    pricePerDay: Record<string, number | null>;
  };
  const porMaquina = new Map<string, Agg>();
  for (const r of opts.rounds ?? []) {
    const m = r.machinery;
    const fecha = String(r.round_date ?? '').slice(0, 10);
    if (!m?.id || !fecha) continue;
    if (fecha < INICIO_JORNADAS) continue; // mismo piso que Pagos y el Informe
    if (fecha < desde || fecha > hasta) continue;
    const price = m.price_per_hour != null && Number.isFinite(Number(m.price_per_hour)) ? Number(m.price_per_hour) : null;
    const a = porMaquina.get(m.id) ?? {
      fila: {
        id: m.id,
        code: m.code ?? '—',
        placa: (m.serial ?? m.plate ?? '') || '',
        empresa: m.company?.name ?? 'Sin empresa',
        horas: 0, monto: 0, sinPrecio: false,
      },
      priceActual: price,
      perDay: {},
      pricePerDay: {},
    };
    const prev = a.perDay[fecha] ?? { day: 0, night: 0, stopped: 0, overtime: 0 };
    a.perDay[fecha] = {
      day: Math.max(prev.day, num(r.day_hours)),
      night: Math.max(prev.night, num(r.night_hours)),
      stopped: Math.max(prev.stopped, num(r.hours_stopped)),
      overtime: Math.max(prev.overtime, num(r.overtime_hours)),
    };
    a.pricePerDay[fecha] = precioVigenteEn(hist, m.id, fecha, price);
    porMaquina.set(m.id, a);
  }

  // Monto: por día con su precio, salvo que la semana tenga precio por rango
  // (entonces ese precio × horas de ESA semana). Acumulado sin redondear.
  const filas: FilaJornadas[] = [];
  porMaquina.forEach((a, mid) => {
    let bruto = 0;
    let horas = 0;
    let sinPrecio = false;
    for (const [fecha, d] of Object.entries(a.perDay)) {
      const h = horasCobrables(d);
      if (h <= 0) continue;
      horas += h;
      const rango = rangePriceWk.get(`${mid}|${periodStartISO(fecha)}`);
      const p = rango != null && rango > 0 ? rango : (a.pricePerDay[fecha] !== undefined ? a.pricePerDay[fecha] : a.priceActual);
      if (p == null) { sinPrecio = true; continue; } // $0, con bandera (como Pagos)
      bruto += p * (h / 12);
    }
    if (horas <= 0) return; // sin horas cobrables no sale (Pagos oculta las de 0 h)
    filas.push({ ...a.fila, horas: r2(horas), monto: r2(bruto), sinPrecio });
  });
  return filas.sort((x, y) => x.empresa.localeCompare(y.empresa, 'es') || x.code.localeCompare(y.code, 'es', { numeric: true }));
}
