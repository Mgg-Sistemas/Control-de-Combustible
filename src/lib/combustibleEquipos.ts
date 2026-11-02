// 🚜 Elegir uno o varios equipos (o tanques) en Combustible (02-nov-2026).
//
// Un mismo filtro para todas las pantallas: Consumos (lista y reporte), el parte
// diario del Surtidor, el desglose de Conciliación; y por tanque en Ingresos y en
// Conciliación. Vacío = todos.
//
// Clave de un equipo:  m:<machinery_id> · v:<vehicle_id> · a:<nombre|placa> (apoyo).
import { norm } from './text';

export type OpcionSeleccion = { key: string; label: string; sub?: string; buscar: string };

const limpio = (v: any) => String(v ?? '').trim();

/** Clave del equipo surtido en un consumo ('' si no tiene equipo). */
export function claveEquipo(d: any): string {
  if (d?.machinery_id) return `m:${d.machinery_id}`;
  if (d?.vehicle_id) return `v:${d.vehicle_id}`;
  const apoyo = limpio(d?.apoyo_nombre);
  if (apoyo) return `a:${norm(apoyo)}|${norm(limpio(d?.apoyo_placa)).replace(/[\s-]/g, '')}`;
  return '';
}

/**
 * Opciones para el selector: todas las máquinas y vehículos del catálogo y las
 * máquinas de apoyo que aparezcan en los consumos. Primero las que tienen consumos.
 */
export function opcionesEquipos(maquinas: any[] | null | undefined, vehiculos: any[] | null | undefined, despachos?: any[] | null): OpcionSeleccion[] {
  const conConsumo = new Set((despachos || []).map(claveEquipo).filter(Boolean));
  const out: (OpcionSeleccion & { orden: number })[] = [];
  for (const m of maquinas || []) {
    if (!m?.id) continue;
    const key = `m:${m.id}`;
    const placa = limpio(m.plate);
    const serial = limpio(m.serial || m.identifier);
    out.push({
      key, orden: conConsumo.has(key) ? 0 : 1,
      label: `🚜 ${limpio(m.code) || 'Máquina'}`,
      sub: [limpio(m.tipo || m.name), placa && `Placa ${placa}`, serial && `Serial ${serial}`].filter(Boolean).join(' · '),
      buscar: [m.code, m.name, m.tipo, m.plate, m.serial, m.identifier].map(limpio).join(' '),
    });
  }
  for (const v of vehiculos || []) {
    if (!v?.id) continue;
    const key = `v:${v.id}`;
    out.push({
      key, orden: conConsumo.has(key) ? 0 : 1,
      label: `🚗 ${limpio(v.plate) || limpio(v.name) || 'Vehículo'}`,
      sub: [limpio(v.name), limpio(v.model), limpio(v.serial || v.identifier) && `Serial ${limpio(v.serial || v.identifier)}`].filter(Boolean).join(' · '),
      buscar: [v.plate, v.name, v.model, v.serial, v.identifier].map(limpio).join(' '),
    });
  }
  const vistos = new Set<string>();
  for (const d of despachos || []) {
    const key = claveEquipo(d);
    if (!key.startsWith('a:') || vistos.has(key)) continue;
    vistos.add(key);
    out.push({
      key, orden: 0,
      label: `🆘 ${limpio(d.apoyo_nombre)}`,
      sub: ['Máquina de apoyo', limpio(d.apoyo_placa) && `Placa ${limpio(d.apoyo_placa)}`, limpio(d.apoyo_empresa)].filter(Boolean).join(' · '),
      buscar: [d.apoyo_nombre, d.apoyo_placa, d.apoyo_serial, d.apoyo_empresa, 'apoyo'].map(limpio).join(' '),
    });
  }
  return out
    .sort((a, b) => a.orden - b.orden || a.label.localeCompare(b.label, 'es'))
    .map(({ orden, ...o }) => o);
}

/** Opciones de tanques. */
export function opcionesTanques(tanques: any[] | null | undefined): OpcionSeleccion[] {
  return (tanques || [])
    .filter((t) => t?.id)
    .map((t) => ({
      key: String(t.id),
      label: `🛢 ${limpio(t.name) || 'Tanque'}`,
      sub: [limpio(t.responsable) && `Resp. ${limpio(t.responsable)}`, limpio(t.location), t.is_mobile ? 'Móvil' : ''].filter(Boolean).join(' · '),
      buscar: [t.name, t.responsable, t.chofer, t.location].map(limpio).join(' '),
    }))
    .sort((a, b) => a.label.localeCompare(b.label, 'es'));
}

/** Busca en las opciones (sin acentos ni mayúsculas). */
export function buscarOpciones(opciones: OpcionSeleccion[], q: string, max = 60): OpcionSeleccion[] {
  const nq = norm(String(q || '').trim());
  const lista = nq ? opciones.filter((o) => norm(`${o.label} ${o.sub ?? ''} ${o.buscar}`).includes(nq)) : opciones;
  return lista.slice(0, max);
}

/** Consumos de los equipos elegidos (vacío = todos). */
export function filtrarPorEquipos<T>(rows: T[], seleccion: string[] | null | undefined): T[] {
  if (!seleccion || seleccion.length === 0) return rows;
  const s = new Set(seleccion);
  return (rows || []).filter((d) => s.has(claveEquipo(d)));
}

/** Filas de los tanques elegidos (vacío = todos). Por defecto mira tank_id. */
export function filtrarPorTanques<T>(rows: T[], seleccion: string[] | null | undefined, campo = 'tank_id'): T[] {
  if (!seleccion || seleccion.length === 0) return rows;
  const s = new Set(seleccion);
  return (rows || []).filter((r: any) => s.has(String(r?.[campo] ?? '')));
}
