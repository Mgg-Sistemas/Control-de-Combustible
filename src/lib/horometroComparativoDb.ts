// CARGA DE DATOS DEL COMPARATIVO «HORÓMETRO VS JORNADA» (modo sombra, 23-sep-2026).
// El «cómo» de compararJornadaHorometro (src/lib/horometroTrabajo.ts), que tiene el
// «qué». Acá solo va lo que toca la red: catálogo, rondas del rango y lecturas.
//
// ⚠️ TODO PAGINADO con `selectAllRows` (como ubicacionesReporteDb): una semana de toda
//    la flota pasa de 1.000 filas y la consulta simple corta sin avisar.
// ⚠️ Dos rondas del mismo día por máquina se funden tomando el MÁXIMO por turno, igual
//    que hace el histórico de ubicaciones: nunca se suman, porque son la misma jornada.
import { selectAllRows } from './supabase';
import { LecturaTrabajo, RondaHoras } from './horometroTrabajo';
import { cargarLecturasHorometro } from './horometroTrabajoDb';

export type RondaComparativa = {
  machineryId: string; code: string; empresa: string; clasificacion: string;
  marca: string; modelo: string; placa: string; fecha: string; ronda: RondaHoras;
};

export type DatosComparativo = { rondas: RondaComparativa[]; lecturas: LecturaTrabajo[] };

const limpio = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
const num = (v: unknown) => Number(v) || 0;

export async function cargarDatosComparativo(desde: string, hasta: string): Promise<DatosComparativo> {
  const [maqs, ron, lecturas] = await Promise.all([
    selectAllRows('machinery', 'id, code, marca, modelo, plate, serial, clasificacion, company:company_id(name)'),
    selectAllRows('machine_rounds', 'machinery_id, round_date, day_hours, night_hours, hours_stopped, overtime_hours', (q: any) => q.gte('round_date', desde).lte('round_date', hasta)),
    cargarLecturasHorometro(desde, hasta),
  ]);
  const porMaq = new Map<string, { code: string; empresa: string; clasificacion: string; marca: string; modelo: string; placa: string }>();
  for (const m of maqs as any[]) {
    porMaq.set(String(m.id), {
      code: limpio(m.code) || '—', empresa: limpio(m.company?.name) || 'Sin empresa', clasificacion: limpio(m.clasificacion) || 'Sin clasificación',
      // Igual que ubicaciones: placa, o serial si no tiene placa.
      marca: limpio(m.marca), modelo: limpio(m.modelo), placa: limpio(m.plate) || limpio(m.serial),
    });
  }
  const porClave = new Map<string, RondaComparativa>();
  for (const r of ron as any[]) {
    const machineryId = String(r.machinery_id);
    const m = porMaq.get(machineryId);
    if (!m) continue; // ronda de una máquina que ya no está en el catálogo
    const fecha = String(r.round_date).slice(0, 10);
    const ronda: RondaHoras = { dia: num(r.day_hours), noche: num(r.night_hours), parada: num(r.hours_stopped), extras: num(r.overtime_hours) };
    const k = `${machineryId}|${fecha}`;
    const cur = porClave.get(k);
    if (!cur) porClave.set(k, { machineryId, ...m, fecha, ronda });
    else { cur.ronda.dia = Math.max(cur.ronda.dia, ronda.dia); cur.ronda.noche = Math.max(cur.ronda.noche, ronda.noche); cur.ronda.parada = Math.max(cur.ronda.parada, ronda.parada); cur.ronda.extras = Math.max(cur.ronda.extras, ronda.extras); }
  }
  return { rondas: Array.from(porClave.values()), lecturas };
}
