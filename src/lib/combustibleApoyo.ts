// 🆘 Máquinas de apoyo en Combustible (02-nov-2026).
//
// Una máquina de apoyo es un equipo que NO está en el catálogo (prestado, de un
// contratista, de paso) al que el surtidor le echa combustible. Se guarda como un
// surtido normal en dispatches (asset_kind 'maquinaria', machinery_id NULL) con
// sus datos en las columnas apoyo_* y las fotos de la máquina en apoyo_fotos.
// Las fotos de lo surtido van en photos, como cualquier surtido.
//
// Columnas creadas y verificadas el 02-nov-2026. El interruptor APOYO_ACTIVO queda
// por si hubiera que apagarlo: en false nada consulta ni escribe apoyo_*.
// El trigger del tanque descuenta los litros como en cualquier surtido.

/** Enciende el surtido a máquinas de apoyo (requiere las columnas apoyo_* en dispatches). */
export const APOYO_ACTIVO = true;

export type DespachoConApoyo = {
  machinery_id?: string | null;
  vehicle_id?: string | null;
  apoyo_nombre?: string | null;
  apoyo_placa?: string | null;
  apoyo_serial?: string | null;
  apoyo_empresa?: string | null;
  apoyo_fotos?: string[] | null;
};

const limpio = (v: any): string => String(v ?? '').trim();

/** ¿El surtido fue a una máquina de apoyo (fuera del catálogo)? */
export function esDeApoyo(d: DespachoConApoyo | null | undefined): boolean {
  return !!d && !d.machinery_id && !d.vehicle_id && limpio(d.apoyo_nombre) !== '';
}

/** Nombre normalizado: sin acentos, minúsculas y espacios simples. */
export function normalizarApoyo(s: any): string {
  return limpio(s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/** Clave para agrupar los surtidos de una misma máquina de apoyo: nombre + placa. */
export function claveApoyo(d: DespachoConApoyo): string {
  return `${normalizarApoyo(d.apoyo_nombre)}|${normalizarApoyo(d.apoyo_placa).replace(/[\s-]/g, '')}`;
}

/** Lo que se muestra como «equipo» de un surtido (código, nombre o la máquina de apoyo). */
export function etiquetaEquipo(
  d: DespachoConApoyo,
  maquinas: { id: string; code?: string | null }[] | null | undefined,
  vehiculos: { id: string; name?: string | null }[] | null | undefined,
): string {
  if (d?.machinery_id) {
    const m = (maquinas || []).find((x) => x.id === d.machinery_id);
    if (m) return m.code || 'Maquinaria';
  }
  if (d?.vehicle_id) {
    const v = (vehiculos || []).find((x) => x.id === d.vehicle_id);
    if (v) return v.name || 'Vehículo';
  }
  if (esDeApoyo(d)) return `🆘 ${limpio(d.apoyo_nombre)}`;
  return 'General';
}

/** Valida el formulario de apoyo. Devuelve el mensaje de error o null si está bien. */
export function validarApoyo(p: { nombre: string; litros: number | null | undefined }): string | null {
  if (limpio(p.nombre) === '') return 'Escribe el nombre o la descripción de la máquina de apoyo.';
  if (limpio(p.nombre).length < 3) return 'El nombre de la máquina de apoyo es muy corto.';
  const l = Number(p.litros);
  if (!isFinite(l) || l <= 0) return 'Ingresa cuántos litros se surtieron (mayor a 0).';
  return null;
}

export type DatosApoyo = {
  nombre: string;
  placa?: string | null;
  serial?: string | null;
  empresa?: string | null;
  fotosMaquina?: string[];
  fotosSurtido?: string[];
  litros: number;
  tankId: string | null;
  fecha: string;
  contadorIni?: number | null;
  contadorFin?: number | null;
  horometro?: number | null;
  autorizadoPor?: string | null;
  creadoPor?: string | null;
  precioLitro?: number | null;
  nota?: string | null;
  conNota?: boolean;
};

const oNulo = (v: any): string | null => (limpio(v) === '' ? null : limpio(v));

/** Arma la fila de dispatches para un surtido a máquina de apoyo. */
export function armarFilaApoyo(p: DatosApoyo): Record<string, any> {
  const precio = p.precioLitro != null && p.precioLitro > 0 ? p.precioLitro : null;
  const fila: Record<string, any> = {
    dispatch_date: String(p.fecha).slice(0, 10),
    asset_kind: 'maquinaria',
    machinery_id: null,
    vehicle_id: null,
    apoyo_nombre: limpio(p.nombre),
    apoyo_placa: oNulo(p.placa),
    apoyo_serial: oNulo(p.serial),
    apoyo_empresa: oNulo(p.empresa),
    apoyo_fotos: (p.fotosMaquina || []).filter(Boolean),
    photos: (p.fotosSurtido || []).filter(Boolean),
    liters: p.litros,
    tank_id: p.tankId,
    fuel_start: p.contadorIni ?? null,
    fuel_end: p.contadorFin ?? null,
    hourmeter_h: p.horometro != null && p.horometro > 0 ? p.horometro : null,
    driver_operator: oNulo(p.autorizadoPor),
    created_by: p.creadoPor ?? null,
    price_per_liter: precio,
    total_amount: precio ? Math.round(precio * p.litros * 100) / 100 : null,
  };
  if (p.conNota) fila.notes = oNulo(p.nota);
  return fila;
}

export type GrupoApoyo<T> = { clave: string; nombre: string; placa: string | null; empresa: string | null; litros: number; surtidos: T[] };

/** Agrupa los surtidos de apoyo por máquina, con total de litros (mayor consumo primero). */
export function agruparApoyo<T extends DespachoConApoyo & { liters?: any }>(filas: T[]): GrupoApoyo<T>[] {
  const mapa = new Map<string, GrupoApoyo<T>>();
  for (const d of filas || []) {
    if (!esDeApoyo(d)) continue;
    const k = claveApoyo(d);
    const g = mapa.get(k) ?? { clave: k, nombre: limpio(d.apoyo_nombre), placa: oNulo(d.apoyo_placa), empresa: oNulo(d.apoyo_empresa), litros: 0, surtidos: [] };
    g.litros = Math.round((g.litros + (Number(d.liters) || 0)) * 100) / 100;
    if (!g.empresa && oNulo(d.apoyo_empresa)) g.empresa = oNulo(d.apoyo_empresa);
    g.surtidos.push(d);
    mapa.set(k, g);
  }
  return Array.from(mapa.values()).sort((a, b) => b.litros - a.litros);
}
