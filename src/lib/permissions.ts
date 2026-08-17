// Matriz de permisos por usuario y por módulo.
// Niveles: sin acceso (none) · lectura · escritura · full control.

export type PermLevel = 'none' | 'lectura' | 'escritura' | 'full';

/** Etiqueta visible de cada rol del sistema (la CLAVE interna no cambia: el rol
 *  sigue siendo 'supervisor' en la BD/lógica; el usuario ve "inspector"). */
export const ROLE_LABEL: Record<string, string> = {
  admin: 'admin', supervisor: 'inspector', analista: 'analista',
  operador: 'operador', conductor: 'conductor', cocina: 'cocina',
  coordinador_patio: 'coordinador de patio',
  coordinador_inspectores: 'coordinador de inspectores',
};
export const roleLabel = (r?: string | null) => (r ? (ROLE_LABEL[r] ?? r) : '');

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
  { key: 'servicio', label: 'Servicio de maquinaria (averías)' },
  { key: 'operadores', label: 'Operadores' },
  { key: 'supervision', label: 'Inspecciones (rondas)' },
  { key: 'inspecciones_maq', label: 'Inspecciones de Maquinaria' },
  { key: 'coordinador_inspectores', label: 'Coordinador de inspectores' },
  { key: 'coordinacion_operadores', label: 'Coordinador de operadores (máquinas)' },
  { key: 'comida', label: 'Distribución de comida' },
  { key: 'empleados', label: 'Empleados (RRHH)' },
  { key: 'aliados', label: 'Aliados' },
  { key: 'nomina', label: 'Nómina' },
  { key: 'uniformes', label: 'Distribución de uniformes' },
  { key: 'asistencia', label: 'Control de asistencia' },
  { key: 'compras', label: 'Compras' },
  { key: 'inventario', label: 'Inventario / Almacén' },
  { key: 'autorizaciones', label: 'Autorizaciones' },
  { key: 'traslados', label: 'Traslados' },
  { key: 'acarreo', label: 'Acarreo / Transporte' },
  { key: 'mapa', label: 'Mapa' },
  { key: 'reportes', label: 'Reportes' },
  { key: 'asistencia_camiones', label: 'Asistencia de camiones' },
  { key: 'viajes_camiones', label: 'Registro de viajes (camiones)' },
  { key: 'usuarios', label: 'Usuarios' },
  { key: 'mangueras', label: 'Fabricación' },
  { key: 'fabricacion_planta', label: 'Fabricación · Kiosco de planta' },
  { key: 'geodesta', label: 'Geodesta (topografía)' },
  { key: 'lavado_maquinaria', label: 'Lavado de maquinaria' },
  { key: 'op_asignacion', label: 'Obras Públicas · asignar máquinas' },
];

/** Nivel por defecto para un usuario no-admin sin fila explícita.
 *  Control de Pagos y Usuarios quedan restringidos; el resto abierto (compat.). */
export function defaultLevel(moduleKey: string): PermLevel {
  if (moduleKey === 'control_pagos' || moduleKey === 'margen_ganancia' || moduleKey === 'usuarios' || moduleKey === 'empleados' || moduleKey === 'aliados' || moduleKey === 'nomina' || moduleKey === 'uniformes' || moduleKey === 'compras' || moduleKey === 'inventario' || moduleKey === 'supervision' || moduleKey === 'comida' || moduleKey === 'asistencia' || moduleKey === 'asistencia_camiones' || moduleKey === 'viajes_camiones' || moduleKey === 'inspecciones_maq' || moduleKey === 'coordinador_inspectores' || moduleKey === 'coordinacion_operadores' || moduleKey === 'mangueras' || moduleKey === 'fabricacion_planta' || moduleKey === 'acarreo' || moduleKey === 'geodesta' || moduleKey === 'lavado_maquinaria' || moduleKey === 'op_asignacion') return 'none';
  return 'escritura';
}

/** Módulos que NACEN heredando el permiso de otro (hijo → padre).
 *
 *  'servicio' salió de partir en dos el módulo 'mantenimiento': lo preventivo
 *  (horómetros) se quedó en Mantenimiento y lo correctivo (averías, taller,
 *  reporte) pasó a Servicio. Mientras un admin no le ponga un nivel propio,
 *  cada usuario ve Servicio con el MISMO nivel que ya tenía en Mantenimiento.
 *
 *  Sin esta herencia la división cambiaría accesos sola, en las dos direcciones:
 *  quien tenía Mantenimiento en "Sin acceso" vería Servicio abierto (porque
 *  `defaultLevel` devuelve 'escritura' para todo lo que no esté en su lista
 *  negra), y quien lo tenía por rol dinámico perdería las averías de un día
 *  para otro (su `app_roles.modules` no trae la clave nueva). */
export const MODULE_HEREDA_DE: Record<string, string> = { servicio: 'mantenimiento' };

const ORDER: PermLevel[] = ['none', 'lectura', 'escritura', 'full'];
/** ¿el nivel `have` cubre al menos `need`? */
export function levelMeets(have: PermLevel, need: PermLevel): boolean {
  return ORDER.indexOf(have) >= ORDER.indexOf(need);
}
/** Devuelve el MAYOR de dos niveles (para combinar rol + permisos por módulo). */
export function maxLevel(a: PermLevel, b: PermLevel): PermLevel {
  return ORDER.indexOf(a) >= ORDER.indexOf(b) ? a : b;
}
