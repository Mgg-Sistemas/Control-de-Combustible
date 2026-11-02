/**
 * 02-nov-2026: lógica PURA de los reportes personalizables de Consumos y de
 * Entradas (sin base de datos ni React, para poder probarla con node).
 *  - Filtra por día o rango (fecha del registro, inclusive) y deja fuera los
 *    ajustes de nivel de tanque, igual que las pantallas.
 *  - Arma las series de las gráficas y los totales.
 *  - Mezcla las opciones guardadas por persona con las de fábrica.
 * Lo que la persona apaga no sale en el papel: aquí solo se calcula.
 */
import { esRegistroAjusteTanque } from './fuelRules';

export type OpcionReporte = { key: string; label: string; defecto: boolean };
export type OpcionesActivas = Record<string, boolean>;

/** Interruptores del reporte de Consumos. */
export const OPCIONES_REPORTE_CONSUMOS: OpcionReporte[] = [
  { key: 'graficas', label: '📊 Gráficas (litros por día y por máquina)', defecto: true },
  { key: 'tabla', label: '📋 Tabla de consumos del día / rango', defecto: true },
  { key: 'placa', label: '🚗 Placa', defecto: true },
  { key: 'serial', label: '🔢 Serial', defecto: true },
  { key: 'horometro', label: '⏱️ Horómetro (del inspector)', defecto: true },
  { key: 'contador', label: '🔢 Contador de bomba', defecto: false },
  { key: 'tanque', label: '🛢️ Tanque de origen', defecto: true },
  { key: 'operador', label: '👷 Conductor / operador', defecto: true },
  { key: 'monto', label: '💲 Precio y monto', defecto: false },
  { key: 'nota', label: '📝 Nota', defecto: false },
  { key: 'totales', label: 'Σ Totales por máquina', defecto: true },
];

/** Interruptores del reporte de Entradas. */
export const OPCIONES_REPORTE_ENTRADAS: OpcionReporte[] = [
  { key: 'graficas', label: '📊 Gráficas (litros por tanque y por proveedor)', defecto: true },
  { key: 'tabla', label: '📋 Tabla de entradas del día / rango', defecto: true },
  { key: 'proveedor', label: '🏭 Proveedor', defecto: true },
  { key: 'factura', label: '🧾 Factura', defecto: true },
  { key: 'tanque', label: '🛢️ Tanque destino', defecto: true },
  { key: 'combustible', label: '⛽ Tipo de combustible', defecto: true },
  { key: 'costoUnitario', label: '💲 Costo unitario', defecto: false },
  { key: 'costoTotal', label: '💰 Costo total', defecto: false },
  { key: 'nota', label: '📝 Nota', defecto: false },
  { key: 'totales', label: 'Σ Totales por tanque y proveedor', defecto: true },
];

/** Opciones de fábrica + lo que la persona guardó (solo claves conocidas y booleanas). */
export function mezclarOpciones(defs: OpcionReporte[], guardadas: any): OpcionesActivas {
  const out: OpcionesActivas = {};
  for (const o of defs) {
    const g = guardadas && typeof guardadas === 'object' ? guardadas[o.key] : undefined;
    out[o.key] = typeof g === 'boolean' ? g : o.defecto;
  }
  return out;
}

const dia = (v: any) => String(v ?? '').slice(0, 10);

/** ¿La fecha (YYYY-MM-DD) cae en [desde, hasta]? Si hasta falta, es un solo día. */
export function enRango(fecha: any, desde: string, hasta?: string | null): boolean {
  const f = dia(fecha);
  if (!f) return false;
  const h = hasta || desde;
  const [a, b] = desde <= h ? [desde, h] : [h, desde];
  return f >= a && f <= b;
}

const num = (v: any): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const redondear = (n: number) => Math.round(n * 100) / 100;

/** Consumos del día/rango, sin ajustes de tanque, ordenados por fecha y hora. */
export function filtrarConsumos<T = any>(rows: T[], desde: string, hasta?: string | null): T[] {
  return (rows || [])
    .filter((d: any) => d && !esRegistroAjusteTanque(d) && enRango(d.dispatch_date, desde, hasta))
    .sort((a: any, b: any) =>
      dia(a.dispatch_date).localeCompare(dia(b.dispatch_date)) || String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')));
}

/** Entradas (ingresos) del día/rango, sin ajustes de tanque. */
export function filtrarEntradas<T = any>(rows: T[], desde: string, hasta?: string | null): T[] {
  return (rows || [])
    .filter((i: any) => i && !esRegistroAjusteTanque(i) && enRango(i.intake_date, desde, hasta))
    .sort((a: any, b: any) =>
      dia(a.intake_date).localeCompare(dia(b.intake_date)) || String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')));
}

export type EquipoConsumo = {
  clave: string;
  tipo: 'maquinaria' | 'vehiculo' | 'apoyo' | 'otro';
  codigo: string;
  placa: string;
  serial: string;
  /** Lo que se muestra: «🆘 nombre» en las de apoyo. */
  nombre: string;
};

/**
 * Equipo de un consumo. Si no tiene máquina ni vehículo pero trae apoyo_nombre
 * (máquina de apoyo sin catálogo; la columna puede no existir aún), sale como
 * «🆘 nombre». Nunca nombra columnas: solo lee lo que venga en la fila.
 */
export function equipoDeConsumo(d: any): EquipoConsumo {
  const mach = d?.machine;
  const veh = d?.vehicle;
  if (mach || d?.machinery_id) {
    const codigo = String(mach?.code || 'MAQUINARIA').trim();
    return {
      clave: `m:${d?.machinery_id || codigo}`,
      tipo: 'maquinaria',
      codigo,
      placa: String(mach?.plate || '').trim(),
      serial: String(mach?.serial || mach?.identifier || '').trim(),
      nombre: codigo,
    };
  }
  if (veh || d?.vehicle_id) {
    const placa = String(veh?.plate || '').trim();
    const codigo = String(veh?.name || placa || 'VEHÍCULO').trim();
    return {
      clave: `v:${d?.vehicle_id || placa}`,
      tipo: 'vehiculo',
      codigo,
      placa,
      serial: String(veh?.serial || veh?.identifier || '').trim(),
      nombre: codigo,
    };
  }
  const apoyo = String(d?.apoyo_nombre ?? '').trim();
  if (apoyo) {
    return {
      clave: `a:${apoyo.toLowerCase()}`,
      tipo: 'apoyo',
      codigo: apoyo,
      placa: String(d?.apoyo_placa ?? '').trim(),
      serial: String(d?.apoyo_serial ?? '').trim(),
      nombre: `🆘 ${apoyo}`,
    };
  }
  return { clave: 'otro', tipo: 'otro', codigo: 'SIN EQUIPO', placa: '', serial: '', nombre: 'SIN EQUIPO' };
}

export type Barra = { label: string; value: number };

/** Suma genérica por clave, de mayor a menor (o por etiqueta si porEtiqueta). */
export function agruparSuma<T>(rows: T[], claveDe: (r: T) => string, valorDe: (r: T) => number, porEtiqueta = false): Barra[] {
  const m = new Map<string, number>();
  for (const r of rows || []) {
    const k = claveDe(r) || '—';
    m.set(k, (m.get(k) || 0) + valorDe(r));
  }
  const arr = Array.from(m.entries()).map(([label, value]) => ({ label, value: redondear(value) }));
  return porEtiqueta ? arr.sort((a, b) => a.label.localeCompare(b.label)) : arr.sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
}

export type TotalEquipo = { clave: string; nombre: string; placa: string; serial: string; litros: number; surtidos: number; monto: number };

/** Totales por máquina/vehículo/apoyo: litros, cantidad de surtidos y monto. */
export function totalesPorEquipo(rows: any[]): TotalEquipo[] {
  const m = new Map<string, TotalEquipo>();
  for (const d of rows || []) {
    const e = equipoDeConsumo(d);
    const t = m.get(e.clave) || { clave: e.clave, nombre: e.nombre, placa: e.placa, serial: e.serial, litros: 0, surtidos: 0, monto: 0 };
    t.litros = redondear(t.litros + num(d.liters));
    t.surtidos += 1;
    t.monto = redondear(t.monto + num(d.total_amount));
    m.set(e.clave, t);
  }
  return Array.from(m.values()).sort((a, b) => b.litros - a.litros || a.nombre.localeCompare(b.nombre));
}

/** Series de las gráficas de Consumos: las mismas de la pestaña (por día y por máquina). */
export function seriesConsumos(rows: any[]): { porDia: Barra[]; porEquipo: Barra[]; total: number } {
  const porDia = agruparSuma(rows, (d: any) => dia(d.dispatch_date), (d: any) => num(d.liters), true);
  const porEquipo = agruparSuma(rows, (d: any) => equipoDeConsumo(d).nombre, (d: any) => num(d.liters));
  return { porDia, porEquipo, total: redondear((rows || []).reduce((s, d: any) => s + num(d.liters), 0)) };
}

/** Series de las gráficas de Entradas: litros por tanque y por proveedor. */
export function seriesEntradas(rows: any[], nombreTanque: (id: string) => string): { porTanque: Barra[]; porProveedor: Barra[]; porDia: Barra[]; total: number; costo: number } {
  return {
    porTanque: agruparSuma(rows, (i: any) => nombreTanque(String(i.tank_id ?? '')) || 'Sin tanque', (i: any) => num(i.liters)),
    porProveedor: agruparSuma(rows, (i: any) => String(i.supplier ?? '').trim() || 'Sin proveedor', (i: any) => num(i.liters)),
    porDia: agruparSuma(rows, (i: any) => dia(i.intake_date), (i: any) => num(i.liters), true),
    total: redondear((rows || []).reduce((s, i: any) => s + num(i.liters), 0)),
    costo: redondear((rows || []).reduce((s, i: any) => s + num(i.total_cost), 0)),
  };
}

/** Día anterior (YYYY-MM-DD): el horómetro de un surtido antes de las 7am es de la jornada previa. */
export function diaAnterior(fecha: string): string {
  const dt = new Date(`${dia(fecha)}T12:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() - 1);
  return dt.toISOString().slice(0, 10);
}

/** Fecha válida YYYY-MM-DD. */
export const esFechaValida = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '').trim()) && !Number.isNaN(Date.parse(`${String(s).trim()}T12:00:00Z`));
