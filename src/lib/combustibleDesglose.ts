// 🧾 Desglose del rango para Conciliación (02-nov-2026).
//
// Lo mismo que el «Parte diario» del Surtidor móvil (cuánto se le surtió a cada
// equipo), pero para todo el rango [desde, hasta] que se escoge en Conciliación, y
// con las ENTRADAS además de los consumos. Función pura: recibe las filas ya
// cargadas y devuelve filas + totales. No consulta la base.
//
// - Los ajustes internos de tanque se excluyen igual que en el balance
//   (esRegistroAjusteTanque).
// - El horómetro es el que cargan los inspectores (machine_rounds), por máquina y
//   jornada 7am–7am (jornadaDeDespacho). Solo se lee.
// - Máquina de apoyo (no está en el catálogo): si la fila trae apoyo_nombre, el
//   equipo sale con ese nombre. La columna puede no existir todavía: se lee con
//   (d as any).
import { esRegistroAjusteTanque } from './fuelRules';
import { claveHorometro, horasHorometro, jornadaDeDespacho, HorometroDia } from './combustibleHorometro';

export type FilaConsumoDesglose = {
  id: string;
  fecha: string; // fecha del surtido (YYYY-MM-DD)
  jornada: string; // jornada 7am–7am: la que decide el horómetro
  hora: string; // HH:MM (Caracas) o ''
  equipo: string;
  equipoClave: string;
  placa: string;
  serial: string;
  esApoyo: boolean;
  machineryId: string | null;
  tanque: string;
  litros: number;
  contadorIni: number | null;
  contadorFin: number | null;
  horometroIni: number | null;
  horometroFin: number | null;
  horas: number | null;
  /** De dónde salió el horómetro mostrado. */
  horometroFuente: 'inspector' | 'ajuste' | 'ninguno';
  autorizado: string;
  nota: string;
};

export type FilaEntradaDesglose = {
  id: string;
  fecha: string;
  proveedor: string;
  factura: string;
  tanque: string;
  litros: number;
  costoUnitario: number | null;
  costoTotal: number | null;
  nota: string;
};

export type TotalTanqueDesglose = { tanque: string; entro: number; salio: number };
export type TotalEquipoDesglose = { clave: string; equipo: string; placa: string; serial: string; litros: number; surtidos: number; horas: number | null };

export type DesgloseRango = {
  desde: string;
  hasta: string;
  consumos: FilaConsumoDesglose[];
  entradas: FilaEntradaDesglose[];
  porTanque: TotalTanqueDesglose[];
  porEquipo: TotalEquipoDesglose[];
  totalConsumido: number;
  totalEntrado: number;
  totalCosto: number;
};

export type EntradaDesglose = {
  dispatches: any[];
  intakes: any[];
  maquinas: any[];
  vehiculos: any[];
  tanques: any[];
  horometros: Map<string, HorometroDia>;
  desde: string;
  hasta: string;
};

const numOrNull = (v: any): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const txt = (v: any) => String(v ?? '').trim();

/** HH:MM en hora de Caracas (UTC−4, sin horario de verano). */
export function horaCaracas(createdAt: string | null | undefined): string {
  if (!createdAt) return '';
  const t = new Date(createdAt).getTime();
  if (!Number.isFinite(t)) return '';
  const d = new Date(t - 4 * 3600 * 1000);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

/** Nombre, placa y serial del equipo surtido (catálogo, vehículo o apoyo). */
export function equipoDeDespacho(d: any, maqPorId: Map<string, any>, vehPorId: Map<string, any>) {
  const apoyo = txt((d as any)?.apoyo_nombre);
  if (apoyo) {
    const placa = txt((d as any)?.apoyo_placa);
    const serial = txt((d as any)?.apoyo_serial);
    return { clave: `apoyo:${apoyo.toUpperCase()}|${placa.toUpperCase()}|${serial.toUpperCase()}`, equipo: `${apoyo} (apoyo)`, placa, serial, esApoyo: true };
  }
  const m = d?.machinery_id ? maqPorId.get(d.machinery_id) : null;
  if (m || d?.machinery_id) {
    return {
      clave: `maq:${d.machinery_id}`,
      equipo: txt(m?.code) || 'Maquinaria',
      placa: txt(m?.plate),
      serial: txt(m?.serial || m?.identifier),
      esApoyo: false,
    };
  }
  const v = d?.vehicle_id ? vehPorId.get(d.vehicle_id) : null;
  if (v || d?.vehicle_id) {
    return {
      clave: `veh:${d.vehicle_id}`,
      equipo: txt(v?.name || v?.model) || 'Vehículo',
      placa: txt(v?.plate),
      serial: txt(v?.serial || v?.identifier),
      esApoyo: false,
    };
  }
  return { clave: 'sin_equipo', equipo: 'Sin equipo', placa: '', serial: '', esApoyo: false };
}

export function armarDesgloseRango(p: EntradaDesglose): DesgloseRango {
  const { desde, hasta } = p;
  const maqPorId = new Map<string, any>((p.maquinas || []).map((m) => [m.id, m]));
  const vehPorId = new Map<string, any>((p.vehiculos || []).map((v) => [v.id, v]));
  const tanquePorId = new Map<string, any>((p.tanques || []).map((t) => [t.id, t]));
  const nombreTanque = (id: any) => txt(tanquePorId.get(id)?.name) || 'Sin tanque';
  const enRango = (f: string) => !!f && f >= desde && f <= hasta;

  const consumos: FilaConsumoDesglose[] = [];
  for (const d of p.dispatches || []) {
    if (!d || esRegistroAjusteTanque(d)) continue;
    // Mismo corte de fecha que el balance (dispatch_date); la jornada solo decide el horómetro.
    const fechaReg = txt(d.dispatch_date).slice(0, 10);
    if (!enRango(fechaReg)) continue;
    const jornada = jornadaDeDespacho(d) || fechaReg;
    const eq = equipoDeDespacho(d, maqPorId, vehPorId);
    const h = !eq.esApoyo && d.machinery_id ? p.horometros?.get(claveHorometro(d.machinery_id, jornada)) ?? null : null;
    consumos.push({
      id: String(d.id ?? ''),
      fecha: fechaReg,
      jornada,
      hora: horaCaracas(d.created_at),
      equipo: eq.equipo,
      equipoClave: eq.clave,
      placa: eq.placa,
      serial: eq.serial,
      esApoyo: eq.esApoyo,
      machineryId: eq.esApoyo ? null : d.machinery_id ?? null,
      tanque: nombreTanque(d.tank_id),
      litros: Number(d.liters) || 0,
      contadorIni: numOrNull(d.fuel_start),
      contadorFin: numOrNull(d.fuel_end),
      horometroIni: h?.inicial ?? null,
      horometroFin: h?.final ?? null,
      horas: horasHorometro(h),
      horometroFuente: h?.fuente ?? 'ninguno',
      autorizado: txt(d.authorized_by || d.driver_operator),
      nota: txt(d.notes),
    });
  }
  consumos.sort((a, b) => (a.fecha + (a.hora || '99')).localeCompare(b.fecha + (b.hora || '99')));

  const entradas: FilaEntradaDesglose[] = [];
  for (const i of p.intakes || []) {
    if (!i || esRegistroAjusteTanque(i)) continue;
    const fecha = txt(i.intake_date).slice(0, 10);
    if (!enRango(fecha)) continue;
    const litros = Number(i.liters) || 0;
    const cu = numOrNull(i.unit_cost);
    const ct = numOrNull(i.total_cost) ?? (cu != null ? Math.round(cu * litros * 100) / 100 : null);
    entradas.push({
      id: String(i.id ?? ''),
      fecha,
      proveedor: txt(i.supplier),
      factura: txt(i.invoice_no),
      tanque: nombreTanque(i.tank_id),
      litros,
      costoUnitario: cu,
      costoTotal: ct,
      nota: txt(i.notes),
    });
  }
  entradas.sort((a, b) => a.fecha.localeCompare(b.fecha));

  const tanq = new Map<string, TotalTanqueDesglose>();
  const tot = (n: string) => {
    let t = tanq.get(n);
    if (!t) { t = { tanque: n, entro: 0, salio: 0 }; tanq.set(n, t); }
    return t;
  };
  for (const e of entradas) tot(e.tanque).entro += e.litros;
  for (const c of consumos) tot(c.tanque).salio += c.litros;

  // Horas por equipo: una sola vez por máquina y jornada (varios surtidos el mismo día no las repiten).
  const equipos = new Map<string, TotalEquipoDesglose>();
  const horasVistas = new Set<string>();
  for (const c of consumos) {
    let e = equipos.get(c.equipoClave);
    if (!e) { e = { clave: c.equipoClave, equipo: c.equipo, placa: c.placa, serial: c.serial, litros: 0, surtidos: 0, horas: null }; equipos.set(c.equipoClave, e); }
    e.litros += c.litros;
    e.surtidos += 1;
    const kh = `${c.equipoClave}|${c.jornada}`;
    if (c.horas != null && !horasVistas.has(kh)) {
      horasVistas.add(kh);
      e.horas = Math.round(((e.horas ?? 0) + c.horas) * 10) / 10;
    }
  }

  const r2 = (n: number) => Math.round(n * 100) / 100;
  return {
    desde,
    hasta,
    consumos,
    entradas,
    porTanque: Array.from(tanq.values()).map((t) => ({ ...t, entro: r2(t.entro), salio: r2(t.salio) })).sort((a, b) => a.tanque.localeCompare(b.tanque)),
    porEquipo: Array.from(equipos.values()).map((e) => ({ ...e, litros: r2(e.litros) })).sort((a, b) => b.litros - a.litros),
    totalConsumido: r2(consumos.reduce((s, c) => s + c.litros, 0)),
    totalEntrado: r2(entradas.reduce((s, e) => s + e.litros, 0)),
    totalCosto: r2(entradas.reduce((s, e) => s + (e.costoTotal ?? 0), 0)),
  };
}

/** Opciones del desglose (interruptores, recordados por persona). */
export type OpcionesDesglose = {
  consumos: boolean;
  entradas: boolean;
  placa: boolean;
  serial: boolean;
  horometro: boolean;
  contador: boolean;
  totalesEquipo: boolean;
  totalesTanque: boolean;
};

export const OPCIONES_DESGLOSE_DEFECTO: OpcionesDesglose = {
  consumos: true,
  entradas: true,
  placa: true,
  serial: true,
  horometro: true,
  contador: true,
  totalesEquipo: true,
  totalesTanque: true,
};

/** Mezcla lo guardado con los valores por defecto (ignora claves raras o no booleanas). */
export function normalizarOpcionesDesglose(raw: any): OpcionesDesglose {
  const out: OpcionesDesglose = { ...OPCIONES_DESGLOSE_DEFECTO };
  if (raw && typeof raw === 'object') {
    for (const k of Object.keys(out) as (keyof OpcionesDesglose)[]) {
      if (typeof raw[k] === 'boolean') out[k] = raw[k];
    }
  }
  return out;
}
