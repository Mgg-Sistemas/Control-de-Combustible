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
      label: `🚜 ${limpio(m.code) || 'Máquina'} · Placa ${placa || 'S/P'}`,
      sub: [limpio(m.tipo || m.name), placa ? `Placa ${placa}` : 'Placa S/P', serial && `Serial ${serial}`].filter(Boolean).join(' · '),
      buscar: [m.code, m.name, m.tipo, m.plate, m.serial, m.identifier].map(limpio).join(' '),
    });
  }
  for (const v of vehiculos || []) {
    if (!v?.id) continue;
    const key = `v:${v.id}`;
    const placaV = limpio(v.plate);
    out.push({
      key, orden: conConsumo.has(key) ? 0 : 1,
      label: `🚗 ${placaV || limpio(v.name) || 'Vehículo'}${placaV && limpio(v.name) ? ` · ${limpio(v.name)}` : ''}`,
      sub: [limpio(v.name), placaV ? `Placa ${placaV}` : 'Placa S/P', limpio(v.model), limpio(v.serial || v.identifier) && `Serial ${limpio(v.serial || v.identifier)}`].filter(Boolean).join(' · '),
      buscar: [v.plate, v.name, v.model, v.serial, v.identifier].map(limpio).join(' '),
    });
  }
  const vistos = new Set<string>();
  for (const d of despachos || []) {
    const key = claveEquipo(d);
    if (!key.startsWith('a:') || vistos.has(key)) continue;
    vistos.add(key);
    const placaA = limpio(d.apoyo_placa);
    const serialA = limpio(d.apoyo_serial);
    out.push({
      key, orden: 0,
      label: `🆘 ${limpio(d.apoyo_nombre)} · Placa ${placaA || 'S/P'}`,
      sub: ['Máquina de apoyo', placaA ? `Placa ${placaA}` : 'Placa S/P', serialA && `Serial ${serialA}`, limpio(d.apoyo_empresa)].filter(Boolean).join(' · '),
      buscar: [d.apoyo_nombre, d.apoyo_placa, d.apoyo_serial, d.apoyo_empresa, 'apoyo'].map(limpio).join(' '),
    });
  }
  return out
    .sort((a, b) => a.orden - b.orden || a.label.localeCompare(b.label, 'es'))
    .map(({ orden, ...o }) => o);
}

/** Opciones exclusivas de máquinas de apoyo (con nombre, placa, serial y empresa). */
export function opcionesApoyo(despachos: any[] | null | undefined): OpcionSeleccion[] {
  const mapa = new Map<string, { label: string; nombre: string; placa: string; serial: string; empresa: string }>();
  for (const d of despachos || []) {
    const key = claveEquipo(d);
    if (!key.startsWith('a:')) continue;
    const prev = mapa.get(key) || {
      label: limpio(d?.apoyo_nombre) || 'Máquina de apoyo',
      nombre: limpio(d?.apoyo_nombre) || 'Máquina de apoyo',
      placa: '',
      serial: '',
      empresa: '',
    };
    if (!prev.placa && limpio(d?.apoyo_placa)) prev.placa = limpio(d.apoyo_placa);
    if (!prev.serial && limpio(d?.apoyo_serial)) prev.serial = limpio(d.apoyo_serial);
    if (!prev.empresa && limpio(d?.apoyo_empresa)) prev.empresa = limpio(d.apoyo_empresa);
    mapa.set(key, prev);
  }
  return Array.from(mapa.entries())
    .map(([key, g]) => ({
      key,
      label: `🆘 ${g.nombre} · Placa ${g.placa || 'S/P'}`,
      sub: ['Máquina de apoyo', g.placa ? `Placa ${g.placa}` : 'Placa S/P', g.serial && `Serial ${g.serial}`, g.empresa].filter(Boolean).join(' · '),
      buscar: [g.nombre, g.placa, g.serial, g.empresa, 'apoyo'].filter(Boolean).join(' '),
    }))
    .sort((a, b) => a.label.localeCompare(b.label, 'es'));
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
