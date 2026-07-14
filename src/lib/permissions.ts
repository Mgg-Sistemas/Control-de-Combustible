// Matriz de permisos por usuario y por módulo.
// Niveles: sin acceso (none) · lectura · escritura · full control.

export type PermLevel = 'none' | 'lectura' | 'escritura' | 'full';

export const LEVELS: { value: PermLevel; label: string; short: string }[] = [
  { value: 'none', label: 'Sin acceso', short: '—' },
  { value: 'lectura', label: 'Lectura', short: 'L' },
  { value: 'escritura', label: 'Escritura', short: 'E' },
  { value: 'full', label: 'Full control', short: 'F' },
];

/** Módulos de la app (clave usada en la BD + etiqueta visible). */
export const MODULES: { key: string; label: string }[] = [
  { key: 'tanques', label: 'Tanques' },
  { key: 'ingresos', label: 'Ingresos' },
  { key: 'consumos', label: 'Consumos' },
  { key: 'equipos', label: 'Catálogo (equipos)' },
  { key: 'control_maquinaria', label: 'Control Maquinaria' },
  { key: 'control_pagos', label: 'Control de Pagos' },
  { key: 'margen_ganancia', label: 'Margen de ganancia' },
  { key: 'mantenimiento', label: 'Mantenimiento maquinaria' },
  { key: 'operadores', label: 'Operadores' },
  { key: 'supervision', label: 'Supervisión (rondas)' },
  { key: 'empleados', label: 'Empleados (RRHH)' },
  { key: 'nomina', label: 'Nómina' },
  { key: 'compras', label: 'Compras' },
  { key: 'inventario', label: 'Inventario / Almacén' },
  { key: 'autorizaciones', label: 'Autorizaciones' },
  { key: 'traslados', label: 'Traslados' },
  { key: 'mapa', label: 'Mapa' },
  { key: 'reportes', label: 'Reportes' },
  { key: 'usuarios', label: 'Usuarios' },
];

/** Nivel por defecto para un usuario no-admin sin fila explícita.
 *  Control de Pagos y Usuarios quedan restringidos; el resto abierto (compat.). */
export function defaultLevel(moduleKey: string): PermLevel {
  if (moduleKey === 'control_pagos' || moduleKey === 'margen_ganancia' || moduleKey === 'usuarios' || moduleKey === 'empleados' || moduleKey === 'nomina' || moduleKey === 'compras' || moduleKey === 'inventario' || moduleKey === 'supervision') return 'none';
  return 'escritura';
}

const ORDER: PermLevel[] = ['none', 'lectura', 'escritura', 'full'];
/** ¿el nivel `have` cubre al menos `need`? */
export function levelMeets(have: PermLevel, need: PermLevel): boolean {
  return ORDER.indexOf(have) >= ORDER.indexOf(need);
}
