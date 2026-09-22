// CARGA DE DATOS DEL HISTÓRICO DE UBICACIONES (22-sep-2026). El «cómo» de
// ubicacionesReporte.ts, que tiene el «qué». Acá solo va lo que toca la red.
//
// ⚠️ TODO PAGINADO con `selectAllRows`: los puntos GPS son miles (7.000 al 22-sep) y la
//    consulta simple corta en 1.000 sin avisar. Se traen TODOS los puntos hasta el fin del
//    rango, no solo los del rango: la ubicación de un día sin punto es el último ANTERIOR.
//
// ⚠️ LA BITÁCORA (`audit_log`) SOLO LA LEEN LOS ADMINISTRADORES. Por eso el edificio se
//    pide por el RPC `historial_referencia_maquinas` (SECURITY DEFINER, solo devuelve
//    máquina, fecha, de → a). Si el RPC falla o no existe, se sigue sin bitácora y el
//    papel lo dice.
import { supabase, selectAllRows } from './supabase';
import { sectorLabel, sectorOf } from './mapZones';
import { CambioEdificio, MaquinaUbic, PuntoGps, RondaDia, VisitaDia, fechaCaracas } from './ubicacionesReporte';

export type DatosUbicaciones = {
  maquinas: MaquinaUbic[];
  puntos: PuntoGps[];
  cambios: CambioEdificio[];
  visitas: VisitaDia[];
  rondas: RondaDia[];
  hayBitacora: boolean;
};

const limpio = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();

export async function cargarDatosUbicaciones(desde: string, hasta: string): Promise<DatosUbicaciones> {
  const hastaFin = `${hasta}T23:59:59.999-04:00`;
  const [maqs, pts, vis, ron, cam] = await Promise.all([
    selectAllRows('machinery', 'id, code, marca, modelo, plate, serial, clasificacion, referencia, company:company_id(name)'),
    selectAllRows('machinery_locations', 'machinery_id, latitude, longitude, recorded_at', (q: any) => q.lte('recorded_at', hastaFin).not('latitude', 'is', null)),
    selectAllRows('supervisor_visits', 'machinery_id, visit_date, visited_at, supervisor_name, status', (q: any) => q.gte('visit_date', desde).lte('visit_date', hasta)),
    selectAllRows('machine_rounds', 'machinery_id, round_date, day_hours, night_hours, hours_stopped, status, inspector_day, inspector_night', (q: any) => q.gte('round_date', desde).lte('round_date', hasta)),
    supabase.rpc('historial_referencia_maquinas').then((r) => r, () => ({ data: null, error: { message: 'sin rpc' } })),
  ]);
  const maquinas: MaquinaUbic[] = (maqs as any[]).map((m) => ({
    id: String(m.id), code: limpio(m.code) || '—', marca: limpio(m.marca), modelo: limpio(m.modelo),
    placa: limpio(m.plate) || limpio(m.serial), empresa: limpio(m.company?.name) || 'Sin empresa',
    clasificacion: limpio(m.clasificacion) || 'Sin clasificación', referenciaActual: limpio(m.referencia),
  }));
  const puntos: PuntoGps[] = (pts as any[]).map((p) => {
    const s = sectorOf(Number(p.latitude), Number(p.longitude));
    return { machineryId: String(p.machinery_id), at: String(p.recorded_at), sector: s ? sectorLabel(s) : null };
  });
  const visitas: VisitaDia[] = (vis as any[]).map((v) => ({
    machineryId: String(v.machinery_id), fecha: String(v.visit_date).slice(0, 10), at: String(v.visited_at ?? ''),
    inspector: limpio(v.supervisor_name), estado: limpio(v.status),
  }));
  const rondas: RondaDia[] = (ron as any[]).map((r) => ({
    machineryId: String(r.machinery_id), fecha: String(r.round_date).slice(0, 10),
    dia: Number(r.day_hours) || 0, noche: Number(r.night_hours) || 0, parada: Number(r.hours_stopped) || 0,
    estado: r.status ?? null, inspectorDia: r.inspector_day ?? null, inspectorNoche: r.inspector_night ?? null,
  }));
  const hayBitacora = !(cam as any)?.error && Array.isArray((cam as any)?.data);
  const cambios: CambioEdificio[] = hayBitacora
    ? ((cam as any).data as any[]).map((c) => ({ machineryId: String(c.machinery_id), at: String(c.at), de: c.de ?? null, a: c.a ?? null }))
    : [];
  // `fechaCaracas` se usa acá solo para descartar puntos con fecha ilegible antes de armar.
  return { maquinas, puntos: puntos.filter((p) => fechaCaracas(p.at)), cambios, visitas, rondas, hayBitacora };
}
