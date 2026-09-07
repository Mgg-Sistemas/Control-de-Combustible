// LOS MÓDULOS DE LA AUDITORÍA — las SECCIONES DE LA APP, no las tablas de la base.
//
// Pedido del cliente (07-sep-2026), textual: «cuando me refiero a módulo, no me
// refiero a flota y maquinaria, sino que por módulo me imaginaba a Control,
// Inspecciones… la idea es que si yo busco por módulos, pueda ver los cambios que
// se hicieron en Nómina, o en Inspecciones, o en cualquier otro».
//
// ANTES estaba cortado por TABLA, en once cajones, y uno solo —"Maquinaria y
// flota"— se tragaba el Catálogo, el Control de maquinaria, el Servicio (averías),
// el Mantenimiento y la flota. Quien preguntaba "¿qué se tocó en Control?" no tenía
// cómo saberlo.
//
// ⚠️ EL LÍMITE, Y HAY QUE DECIRLO: `audit_log` guarda QUÉ TABLA se tocó, no DE QUÉ
//    PANTALLA vino. Y a `machinery` le escriben ~20 pantallas. Lo que salva el
//    reparto es que los eventos propios de la app traen su ACCIÓN (JORNADA_INICIO,
//    JORNADA_FIN, PARADA, CHECK, SCAN), y esa sí dice de dónde salió. Por eso el
//    módulo se decide por (tabla + acción), en ese orden.
//
// ⚠️ NO SE TOCA LA BASE DE DATOS. Nada de triggers nuevos, columnas nuevas ni filas
//    de más: el cliente pidió expresamente que la auditoría no se abuse ni se
//    tumbe. Todo esto se decide EN MEMORIA sobre las filas ya cargadas.
//
// Si un día se audita una tabla nueva, agrégala acá: lo que no esté cae en
// "📁 Otro". `scripts/test-auditoria-modulos.mjs` falla si alguna queda fuera.

export type ModuloAuditoria = { key: string; label: string; icon: string };

/** Las secciones, en el orden en que salen las pastillas y los grupos. */
export const MODULOS_AUDITORIA: ModuloAuditoria[] = [
  { key: 'combustible', label: 'Combustible', icon: '⛽' },
  { key: 'equipos', label: 'Catálogo de equipos', icon: '🚜' },
  { key: 'control', label: 'Control de maquinaria (jornadas)', icon: '🕐' },
  { key: 'inspecciones', label: 'Inspecciones', icon: '📋' },
  { key: 'operadores', label: 'Operadores', icon: '👷' },
  { key: 'servicio', label: 'Servicio de maquinaria (averías)', icon: '🔧' },
  { key: 'mantenimiento', label: 'Mantenimiento', icon: '🛠️' },
  { key: 'viajes', label: 'Viajes de camiones', icon: '🚛' },
  { key: 'acarreo', label: 'Acarreo y fletes', icon: '🚚' },
  { key: 'nomina', label: 'Nómina y personal', icon: '👥' },
  { key: 'empresas', label: 'Empresas y facturación', icon: '🏢' },
  { key: 'inventario', label: 'Inventario y compras', icon: '📦' },
  { key: 'alimentacion', label: 'Alimentación', icon: '🍽️' },
  { key: 'obras', label: 'Obras Públicas', icon: '🏗️' },
  { key: 'usuarios', label: 'Usuarios y permisos', icon: '🔑' },
  { key: 'avisos', label: 'Avisos del sistema', icon: '🔔' },
];

const PORCLAVE = new Map(MODULOS_AUDITORIA.map((m) => [m.key, m]));

/**
 * Tabla → sección, para todo lo que NO trae una acción propia de la app.
 *
 * `machinery` va al CATÁLOGO: una fila INSERT/UPDATE/DELETE sobre esa tabla es
 * alguien editando la ficha del equipo (nombre, marca, retirada, en espera). Lo
 * que hace el supervisor en la calle sobre la misma tabla llega con su propia
 * acción y se desvía abajo, antes de llegar acá.
 */
const TABLA_A_MODULO: Record<string, string> = {
  // ⛽ Combustible
  tanks: 'combustible', fuel_intakes: 'combustible', dispatches: 'combustible',
  transfers: 'combustible', authorizations: 'combustible', stock_movements: 'combustible',
  // 🚜 Catálogo de equipos (las fichas: máquinas y vehículos)
  machinery: 'equipos', vehicles: 'equipos',
  // 🕐 Control de maquinaria: la jornada de cada máquina y su cierre
  machine_rounds: 'control', control_closures: 'control', truck_yard_logs: 'control',
  // 📋 Inspecciones: las revisiones y las rondas del supervisor
  machine_inspections: 'inspecciones', supervisor_visits: 'inspecciones',
  machine_inspectors: 'inspecciones', machine_guards: 'inspecciones',
  // 👷 Operadores asignados a las máquinas
  operator_assignments: 'operadores', machine_operators: 'operadores',
  // 🔧 Servicio de maquinaria (el taller: averías, órdenes y repuestos)
  maintenance_requests: 'servicio', machinery_service_orders: 'servicio',
  machinery_service_parts: 'servicio', service_intervention_types: 'servicio',
  // 🛠️ Mantenimiento (los expedientes de reparación)
  machinery_repairs: 'mantenimiento',
  // 🚛 / 🚚 Transporte
  camion_viajes: 'viajes', fletes: 'acarreo',
  // 👥 Nómina y personal
  employees: 'nomina', payroll_companies: 'nomina', attendance: 'nomina',
  uniform_deliveries: 'nomina', staff_pay_payments: 'nomina', staff_pay_periods: 'nomina',
  payroll_periods: 'nomina', aliados: 'nomina',
  // 🏢 Empresas, tarifas y cobros
  companies: 'empresas', company_payments: 'empresas',
  price_tariffs: 'empresas', company_price_tariffs: 'empresas',
  // 📦 Inventario y compras
  inventory_items: 'inventario', inventory_movements: 'inventario',
  inventory_transfers: 'inventario', purchase_orders: 'inventario',
  purchase_requests: 'inventario', suppliers: 'inventario',
  // 🍽️ Alimentación
  food_distributions: 'alimentacion', food_company_meals: 'alimentacion',
  // 🏗️ Obras Públicas
  op_edificio_base: 'obras', op_edificio_removidos: 'obras',
  // 🔑 Usuarios y permisos
  profiles: 'usuarios', app_roles: 'usuarios', module_permissions: 'usuarios',
  // 🔔 Avisos
  notifications: 'avisos', notification_reads: 'avisos',
};

/**
 * ⭐ LO QUE HACE POSIBLE SEPARAR "CONTROL" DE "CATÁLOGO": los eventos que escribe
 *    la app traen su propia acción, y la acción sí dice de qué pantalla salió.
 *    Ganan sobre la tabla.
 *
 *    - JORNADA_INICIO / JORNADA_FIN / PARADA → la jornada de la máquina (Control).
 *    - CHECK  → asignar la máquina a un inspector (Inspecciones). También lo usa
 *               el coordinador de operadores; queda en Inspecciones porque es la
 *               inmensa mayoría, y el detalle de la fila dice cuál fue.
 *    - SCAN   → escanear el QR: de una máquina es una revisión; de un empleado es
 *               su carnet. Por eso depende de la tabla, no solo de la acción.
 *    - LOGIN / LOGOUT → entrar y salir del sistema (Usuarios).
 */
const ACCION_A_MODULO: Record<string, string> = {
  JORNADA_INICIO: 'control',
  JORNADA_FIN: 'control',
  PARADA: 'control',
  CHECK: 'inspecciones',
  SCAN: 'inspecciones',
  LOGIN: 'usuarios',
  LOGOUT: 'usuarios',
  EDIT_VIAJE_FUERA_JORNADA: 'viajes',
};

/** Las acciones del trigger de la base: dicen QUÉ pasó, no DE DÓNDE. Manda la tabla. */
const ACCIONES_DE_TABLA = new Set(['INSERT', 'UPDATE', 'DELETE']);

const txt = (v: unknown): string => String(v ?? '').trim();

/**
 * La sección a la que pertenece una fila de la bitácora, o `null` si no se sabe
 * (la pantalla la muestra como "📁 Otro").
 *
 * El orden importa: primero la acción propia de la app —que identifica la
 * pantalla— y solo después la tabla.
 */
export function moduloDeFila(fila: { table_name?: string | null; action?: string | null }): ModuloAuditoria | null {
  const tabla = txt(fila?.table_name).toLowerCase();
  const accion = txt(fila?.action).toUpperCase();

  // Un SCAN sobre un empleado es su carnet, no una inspección de maquinaria.
  if (accion === 'SCAN' && tabla === 'employees') return PORCLAVE.get('nomina') ?? null;

  if (accion && !ACCIONES_DE_TABLA.has(accion)) {
    const porAccion = ACCION_A_MODULO[accion];
    if (porAccion) return PORCLAVE.get(porAccion) ?? null;
  }
  const porTabla = TABLA_A_MODULO[tabla];
  return porTabla ? (PORCLAVE.get(porTabla) ?? null) : null;
}

/** Lo que se muestra cuando no se pudo ubicar: nunca se esconde una fila. */
export const MODULO_OTRO = '📁 Otro';

/** Etiqueta con ícono, lista para pintar: "🕐 Control de maquinaria (jornadas)". */
export function etiquetaModulo(fila: { table_name?: string | null; action?: string | null }): string {
  const m = moduloDeFila(fila);
  return m ? `${m.icon} ${m.label}` : MODULO_OTRO;
}

/** ¿La fila cae en alguno de los módulos marcados? Vacío = todos (sin filtrar). */
export function filaEnModulos(fila: { table_name?: string | null; action?: string | null }, claves: Set<string>): boolean {
  if (!claves.size) return true;
  const m = moduloDeFila(fila);
  return !!m && claves.has(m.key);
}

/** Todas las tablas que este mapa conoce (lo usa la prueba de cobertura). */
export function tablasConocidas(): string[] {
  return Object.keys(TABLA_A_MODULO).sort();
}
