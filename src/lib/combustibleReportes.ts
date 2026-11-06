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

export type LogoCombustibleKey = 'bcv' | 'sos' | 'golden' | 'renace' | 'jhenzaen';
export type LogosReporteCombustible = Record<LogoCombustibleKey, boolean>;

/** Catálogo de logos institucionales disponibles en todos los reportes PDF de Combustible. */
export const LOGOS_COMBUSTIBLE_CATALOGO: { key: LogoCombustibleKey; label: string; nombre: string }[] = [
  { key: 'bcv', label: '🏛️ BCV', nombre: 'Banco Central de Venezuela' },
  { key: 'sos', label: '🛟 SOS La Guaira', nombre: 'SOS La Guaira' },
  { key: 'golden', label: '✨ Golden Touch', nombre: 'Golden Touch' },
  { key: 'renace', label: '🇻🇪 Plan Venezuela Renace', nombre: 'Plan Venezuela Renace' },
  { key: 'jhenzaen', label: '🏗️ Jhenzaen 2.012 C.A', nombre: 'Jhenzaen 2.012 C.A' },
];

export const LOGOS_COMBUSTIBLE_DEFECTO: LogosReporteCombustible = {
  bcv: true,
  sos: true,
  golden: false,
  renace: false,
  jhenzaen: false,
};

/** Mezcla los logos guardados por persona con los de fábrica. */
export function mezclarLogosCombustible(
  guardados?: Record<string, any> | null,
  defecto: LogosReporteCombustible = LOGOS_COMBUSTIBLE_DEFECTO,
): LogosReporteCombustible {
  const out: LogosReporteCombustible = { ...defecto };
  if (guardados && typeof guardados === 'object') {
    for (const item of LOGOS_COMBUSTIBLE_CATALOGO) {
      if (typeof guardados[item.key] === 'boolean') {
        out[item.key] = guardados[item.key];
      }
    }
  }
  return out;
}

/** Interruptores del reporte de Consumos. */
export const OPCIONES_REPORTE_CONSUMOS: OpcionReporte[] = [
  { key: 'kpis', label: '📊 Cuadros superiores de resumen', defecto: true },
  { key: 'graficas', label: '📊 Gráficas (litros por día y por máquina)', defecto: true },
  { key: 'tabla', label: '📋 Tabla de consumos del día / rango', defecto: true },
  { key: 'hora', label: '🕒 Hora del surtido', defecto: true },
  { key: 'placa', label: '🚗 Placa', defecto: true },
  { key: 'serial', label: '🔢 Serial', defecto: true },
  { key: 'horometro', label: '⏱️ Horómetro (del inspector)', defecto: true },
  { key: 'contador', label: '🔢 Contador de bomba', defecto: false },
  { key: 'tanque', label: '🛢️ Tanque de origen', defecto: true },
  { key: 'operador', label: '👷 Conductor / operador', defecto: true },
  { key: 'monto', label: '💲 Precio y monto', defecto: false },
  { key: 'nota', label: '📝 Nota', defecto: false },
  { key: 'totales', label: 'Σ Totales por máquina', defecto: true },
  { key: 'firmas', label: '✍️ Firmas al pie del reporte', defecto: false },
  { key: 'marcaTexto', label: '🏢 Marca de empresa en texto y pie', defecto: true },
];

/** Interruptores del reporte de Entradas. */
export const OPCIONES_REPORTE_ENTRADAS: OpcionReporte[] = [
  { key: 'kpis', label: '📊 Cuadros superiores de resumen', defecto: true },
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
  { key: 'firmas', label: '✍️ Firmas al pie del reporte', defecto: false },
  { key: 'marcaTexto', label: '🏢 Marca de empresa en texto y pie', defecto: true },
];

/** Interruptores del Parte Diario de Surtido (Surtidor Móvil). */
export const OPCIONES_REPORTE_PARTE_DIARIO: OpcionReporte[] = [
  { key: 'resumen', label: '📊 Cinta superior de resumen (chofer, despachos, litros)', defecto: true },
  { key: 'hora', label: '🕒 Hora del surtido', defecto: true },
  { key: 'placa', label: '🚗 Placa', defecto: true },
  { key: 'serial', label: '🔢 Serial', defecto: true },
  { key: 'tanque', label: '🛢️ Tanque de origen', defecto: true },
  { key: 'contador', label: '🔢 Contador de bomba', defecto: true },
  { key: 'horometro', label: '⏱️ Horómetro (h)', defecto: true },
  { key: 'autorizado', label: '👷 Autorizó', defecto: true },
  { key: 'nota', label: '📝 Nota / observación', defecto: true },
  { key: 'totalesEquipo', label: 'Σ Tabla resumen por máquina / equipo', defecto: true },
  { key: 'firmas', label: '✍️ Firmas al pie del reporte', defecto: true },
  { key: 'marcaTexto', label: '🏢 Marca de empresa en texto y pie', defecto: true },
];

/** Interruptores del Reporte de Máquinas de Apoyo (🆘). */
export const OPCIONES_REPORTE_APOYO: OpcionReporte[] = [
  { key: 'kpis', label: '📊 Cuadros superiores de resumen', defecto: true },
  { key: 'graficas', label: '📊 Gráficas (litros por máquina de apoyo y por día)', defecto: true },
  { key: 'totales', label: 'Σ Tabla resumen por máquina de apoyo', defecto: true },
  { key: 'tabla', label: '📋 Tabla detallada de cada surtido', defecto: true },
  { key: 'hora', label: '🕒 Hora del surtido', defecto: true },
  { key: 'placa', label: '🚗 Placa', defecto: true },
  { key: 'serial', label: '🔢 Serial', defecto: true },
  { key: 'empresa', label: '🏢 Empresa / contratista', defecto: true },
  { key: 'tanque', label: '🛢️ Tanque de origen', defecto: true },
  { key: 'contador', label: '🔢 Contador de bomba', defecto: false },
  { key: 'horometro', label: '⏱️ Horómetro', defecto: true },
  { key: 'operador', label: '👷 Autorizó / operador', defecto: true },
  { key: 'monto', label: '💲 Precio y monto', defecto: false },
  { key: 'nota', label: '📝 Nota', defecto: true },
  { key: 'firmas', label: '✍️ Firmas al pie del reporte', defecto: false },
  { key: 'marcaTexto', label: '🏢 Marca de empresa en texto y pie', defecto: true },
];

/** Interruptores del Acta de Conciliación de Combustible. */
export const OPCIONES_REPORTE_CONCILIACION: OpcionReporte[] = [
  { key: 'meta', label: '📋 Cinta del corte (período, responsable, elaborado, revisado)', defecto: true },
  { key: 'tipoCombustible', label: '⛽ Columna Tipo de combustible', defecto: true },
  { key: 'saldoInicial', label: '🛢️ Columna Saldo Inicial (L)', defecto: true },
  { key: 'entradas', label: '📥 Columna + Entradas (L)', defecto: true },
  { key: 'despachos', label: '📤 Columna - Despachos (L)', defecto: true },
  { key: 'traslados', label: '🔁 Columna ± Traslados (L)', defecto: true },
  { key: 'saldoTeorico', label: '📐 Columna Saldo Teórico (L)', defecto: true },
  { key: 'saldoFisico', label: '📏 Columna Saldo Físico (L)', defecto: true },
  { key: 'diferencia', label: '⚖️ Columnas Diferencia (L) y % Dif.', defecto: true },
  { key: 'observaciones', label: '📝 Bloque de Observaciones / Notas', defecto: true },
  { key: 'firmas', label: '✍️ Firmas de conformidad al pie', defecto: true },
  { key: 'marcaTexto', label: '🏢 Marca de empresa en texto y pie', defecto: true },
];

/** Interruptores del Reporte de Solicitudes de Combustible. */
export const OPCIONES_REPORTE_SOLICITUDES: OpcionReporte[] = [
  { key: 'fecha', label: '🕒 Fecha y hora', defecto: true },
  { key: 'activo', label: '🚜 Activo (máquina / vehículo)', defecto: true },
  { key: 'placa', label: '🚗 Placa', defecto: true },
  { key: 'serial', label: '🔢 Serial', defecto: true },
  { key: 'tipo', label: '🏷️ Tipo de activo', defecto: true },
  { key: 'empresa', label: '🏢 Empresa', defecto: true },
  { key: 'tanque', label: '🛢️ Tanque de origen', defecto: true },
  { key: 'litros', label: '⛽ Litros solicitados', defecto: true },
  { key: 'estado', label: '📌 Estado', defecto: true },
  { key: 'solicita', label: '👷 Solicitado por', defecto: true },
  { key: 'motivo', label: '📝 Motivo', defecto: false },
  { key: 'totales', label: 'Σ Total de litros al pie', defecto: true },
  { key: 'firmas', label: '✍️ Firmas al pie del reporte', defecto: false },
  { key: 'marcaTexto', label: '🏢 Marca de empresa en texto y pie', defecto: true },
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

/** ¿Es un surtido de máquina de apoyo (sin máquina/vehículo del catálogo y con apoyo_nombre)? */
export function esFilaApoyo(d: any): boolean {
  if (!d || d.machinery_id || d.vehicle_id) return false;
  if (esRegistroAjusteTanque(d)) return false;
  return String(d.apoyo_nombre ?? '').trim().length > 0;
}

/** Surtidos de máquinas de apoyo del día o rango, ordenados por fecha y hora. */
export function filtrarConsumosApoyo<T = any>(rows: T[], desde: string, hasta?: string | null): T[] {
  return filtrarConsumos(rows, desde, hasta).filter(esFilaApoyo);
}

export type TotalMaquinaApoyo = {
  clave: string;
  nombre: string;
  placa: string;
  serial: string;
  empresa: string;
  litros: number;
  surtidos: number;
  monto: number;
};

const normApoyo = (v: any) =>
  String(v ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');

/** Totales agrupados por máquina de apoyo (nombre + placa), ordenados de mayor a menor consumo. */
export function totalesPorMaquinaApoyo(rows: any[]): TotalMaquinaApoyo[] {
  const m = new Map<string, TotalMaquinaApoyo>();
  for (const d of rows || []) {
    if (!esFilaApoyo(d)) continue;
    const nombre = String(d.apoyo_nombre ?? '').trim() || 'Máquina de apoyo';
    const placa = String(d.apoyo_placa ?? '').trim();
    const serial = String(d.apoyo_serial ?? '').trim();
    const empresa = String(d.apoyo_empresa ?? '').trim();
    const clave = `a:${normApoyo(nombre)}|${normApoyo(placa).replace(/[\s-]/g, '')}`;
    const prev = m.get(clave) || {
      clave,
      nombre,
      placa: '',
      serial: '',
      empresa: '',
      litros: 0,
      surtidos: 0,
      monto: 0,
    };
    prev.litros = redondear(prev.litros + num(d.liters));
    prev.surtidos += 1;
    prev.monto = redondear(prev.monto + num(d.total_amount));
    if (!prev.placa && placa) prev.placa = placa;
    if (!prev.serial && serial) prev.serial = serial;
    if (!prev.empresa && empresa) prev.empresa = empresa;
    m.set(clave, prev);
  }
  return Array.from(m.values()).sort((a, b) => b.litros - a.litros || a.nombre.localeCompare(b.nombre));
}

/** Series de gráficas para el reporte de Máquinas de Apoyo. */
export function seriesApoyo(rows: any[]): { porDia: Barra[]; porEquipo: Barra[]; total: number; monto: number; maquinas: number } {
  const soloApoyo = (rows || []).filter(esFilaApoyo);
  const tot = totalesPorMaquinaApoyo(soloApoyo);
  const porDia = agruparSuma(soloApoyo, (d: any) => dia(d.dispatch_date), (d: any) => num(d.liters), true);
  const porEquipo: Barra[] = tot.map((t) => ({
    label: `🆘 ${t.nombre} · Placa ${t.placa || 'S/P'}${t.empresa ? ` (${t.empresa})` : ''}`,
    value: t.litros,
  }));
  return {
    porDia,
    porEquipo,
    total: redondear(soloApoyo.reduce((s, d: any) => s + num(d.liters), 0)),
    monto: redondear(soloApoyo.reduce((s, d: any) => s + num(d.total_amount), 0)),
    maquinas: tot.length,
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
