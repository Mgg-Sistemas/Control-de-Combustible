// LOS MÓDULOS DE LA AUDITORÍA — las SECCIONES DEL MENÚ, no las tablas de la base.
//
// Pedido del cliente (07-sep-2026), textual: «cuando me refiero a módulo, no me
// refiero a flota y maquinaria, sino que por módulo me imaginaba a Control,
// Inspecciones… la idea es que si yo busco por módulos, pueda ver los cambios que
// se hicieron en Nómina, o en Inspecciones, o en cualquier otro». Y después, con el
// menú abierto: «si ya están todos los módulos o apartados».
//
// ANTES estaba cortado por TABLA, en once cajones, y uno solo —"Maquinaria y
// flota"— se tragaba el Catálogo, el Control de maquinaria, el Servicio (averías),
// el Mantenimiento y la flota. Quien preguntaba "¿qué se tocó en Control?" no tenía
// cómo saberlo.
//
// AHORA la lista es el MENÚ de la app (MoreScreen), sección por sección, con sus
// mismos nombres e íconos. `scripts/test-auditoria-modulos.mjs` compara las dos
// listas: si alguien agrega una sección al menú y no la agrega acá, falla.
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
// ⚠️ "SIN RASTRO AÚN": hay secciones del menú cuyas tablas NO tienen trigger de
//    auditoría en ningún .sql (Fabricación, Geodesta, Lavado, Obras Públicas, Avisos).
//    Salen en la lista para que el menú esté completo, marcadas, y no pueden traer
//    filas hasta que se auditen. (Otra cosa es que el trigger exista y esté APAGADO
//    en la base —pasó en 32 tablas del 09-ago al 07-sep-2026—: eso no lo puede saber
//    este archivo; ver supabase/PENDIENTES.md.)
//
// Si un día se audita una tabla nueva, agrégala acá: lo que no esté cae en
// "📁 Otro". La prueba falla si alguna tabla auditada queda fuera.

export type ModuloAuditoria = {
  key: string;
  label: string;
  icon: string;
  /** Ninguna de sus tablas tiene trigger de auditoría todavía (por diseño). */
  sinRastro?: boolean;
};

/** Las secciones, en el orden del menú (alfabético, como MoreScreen). */
export const MODULOS_AUDITORIA: ModuloAuditoria[] = [
  { key: 'acarreo', label: 'Acarreo / Transporte', icon: '🛻' },
  { key: 'aliados', label: 'Aliados', icon: '🤝' },
  { key: 'asistencia_camiones', label: 'Asistencia de camiones', icon: '🚚' },
  { key: 'equipos', label: 'Catálogo de equipos', icon: '🚜' },
  { key: 'alimentacion', label: 'Cocina y distribución de comida', icon: '🍽️' },
  { key: 'combustible', label: 'Combustible', icon: '⛽' },
  { key: 'compras', label: 'Compras', icon: '🛒' },
  { key: 'asistencia', label: 'Control de asistencia', icon: '🕒' },
  { key: 'control', label: 'Control de maquinaria (jornadas)', icon: '🕐' },
  { key: 'pagos', label: 'Control de pagos', icon: '💰' },
  { key: 'empresas', label: 'Empresas y tarifas', icon: '🏢' },
  { key: 'fabricacion', label: 'Fabricación', icon: '🏭', sinRastro: true },
  { key: 'geodesta', label: 'Geodesta', icon: '📐', sinRastro: true },
  { key: 'inspecciones', label: 'Inspecciones (rondas de inspectores)', icon: '🪖' },
  { key: 'inspecciones_maq', label: 'Inspecciones de maquinaria', icon: '🔍' },
  { key: 'inventario', label: 'Inventario', icon: '📦' },
  { key: 'lavado', label: 'Lavado de maquinaria', icon: '🚿', sinRastro: true },
  { key: 'mantenimiento', label: 'Mantenimiento de maquinaria', icon: '🧰' },
  { key: 'nomina', label: 'Nómina', icon: '🧾' },
  { key: 'obras', label: 'Obras Públicas', icon: '🏛️', sinRastro: true },
  { key: 'operadores', label: 'Operadores y coordinación', icon: '👷' },
  { key: 'servicio', label: 'Servicio de maquinaria (averías)', icon: '🔧' },
  { key: 'usuarios', label: 'Usuarios y permisos', icon: '👥' },
  { key: 'viajes', label: 'Viajes de camiones', icon: '🚛' },
  { key: 'avisos', label: 'Avisos del sistema', icon: '🔔', sinRastro: true },
];

const PORCLAVE = new Map(MODULOS_AUDITORIA.map((m) => [m.key, m]));

/**
 * Tabla → sección, para todo lo que NO trae una acción propia de la app.
 *
 * `machinery` va al CATÁLOGO: una fila INSERT/UPDATE/DELETE sobre esa tabla es
 * alguien editando la ficha del equipo (nombre, marca, retirada, en espera, costo
 * inicial desde Margen de ganancia). Lo que hace el supervisor en la calle sobre la
 * misma tabla llega con su propia acción y se desvía abajo, antes de llegar acá.
 *
 * Están también las tablas que HOY nadie audita: si un día les ponen trigger, ya
 * caen en su sección y no en "Otro".
 */
const TABLA_A_MODULO: Record<string, string> = {
  // 🛻 Acarreo / Transporte: fletes y las órdenes de acarreo (flota, choferes, costos)
  fletes: 'acarreo',
  haul_orders: 'acarreo', haul_order_items: 'acarreo', haul_status_events: 'acarreo',
  haul_trucks: 'acarreo', haul_trailers: 'acarreo', haul_drivers: 'acarreo', haul_clients: 'acarreo',
  haul_locations: 'acarreo', haul_tariffs: 'acarreo', haul_documents: 'acarreo', haul_expenses: 'acarreo',
  haul_checks: 'acarreo', haul_incidents: 'acarreo', haul_photos: 'acarreo',
  // 🤝 Aliados
  aliados: 'aliados',
  // 🚚 Asistencia de camiones (presente/ausente en el patio)
  truck_yard_logs: 'asistencia_camiones', truck_attendance: 'asistencia_camiones',
  // 🚜 Catálogo de equipos: las fichas y su ubicación en el mapa
  machinery: 'equipos', vehicles: 'equipos', machinery_locations: 'equipos', map_zone_offsets: 'equipos',
  // 🍽️ Cocina y distribución de comida
  food_distributions: 'alimentacion', food_company_meals: 'alimentacion',
  // ⛽ Combustible
  tanks: 'combustible', tank_levels: 'combustible', fuel_intakes: 'combustible', dispatches: 'combustible',
  transfers: 'combustible', authorizations: 'combustible', stock_movements: 'combustible',
  // 🛒 Compras: pedidos, órdenes, proveedores y cuentas
  purchase_orders: 'compras', purchase_requests: 'compras', suppliers: 'compras',
  direct_purchases: 'compras', inventory_requirements: 'compras', cuentas: 'compras', cuenta_abonos: 'compras',
  // 🕒 Control de asistencia (el carnet del personal)
  attendance: 'asistencia',
  // 🕐 Control de maquinaria: la jornada de cada máquina y su cierre
  machine_rounds: 'control', control_closures: 'control', machine_work_segments: 'control',
  // 💰 Control de pagos (cuentas por pagar por empresa y semana)
  company_payments: 'pagos', payrolls: 'pagos',
  // 🏢 Empresas y tarifas
  companies: 'empresas', price_tariffs: 'empresas', company_price_tariffs: 'empresas',
  // 🏭 Fabricación (taller: mangueras, centros de trabajo, recetas y rutas)
  bom_versions: 'fabricacion', manufacturing_orders: 'fabricacion', production_routes: 'fabricacion',
  work_centers: 'fabricacion', work_orders: 'fabricacion', wo_time_logs: 'fabricacion', wo_oee: 'fabricacion',
  hose_empresas: 'fabricacion', hose_services: 'fabricacion', encargados: 'fabricacion',
  // 📐 Geodesta
  geodesta_projects: 'geodesta', geodesta_points: 'geodesta', geodesta_breaklines: 'geodesta',
  geodesta_surfaces: 'geodesta', geodesta_inspections: 'geodesta',
  // 🪖 Inspecciones: las rondas de los inspectores, sus guardias y a quién le toca cada máquina
  supervisor_visits: 'inspecciones', machine_inspectors: 'inspecciones', machine_guards: 'inspecciones',
  guard_shifts: 'inspecciones', guard_inspector_meta: 'inspecciones',
  // 🔍 Inspecciones de maquinaria: el inventario de herramientas/accesorios por equipo
  machine_inspections: 'inspecciones_maq',
  // 📦 Inventario
  inventory_items: 'inventario', inventory_movements: 'inventario', inventory_transfers: 'inventario',
  bcv_rates: 'inventario',
  // 🚿 Lavado de maquinaria
  lm_washes: 'lavado', lm_wash_types: 'lavado',
  // 🧰 Mantenimiento de maquinaria (expedientes y servicios preventivos)
  machinery_repairs: 'mantenimiento', machine_services: 'mantenimiento',
  // 🧾 Nómina
  employees: 'nomina', payroll_companies: 'nomina', uniform_deliveries: 'nomina',
  staff_pay_payments: 'nomina', staff_pay_periods: 'nomina', staff_pay_items: 'nomina',
  payroll_periods: 'nomina', payroll_items: 'nomina', dias_libres_cargo: 'nomina',
  // 🏛️ Obras Públicas
  op_edificio_base: 'obras', op_edificio_removidos: 'obras', op_daily_reports: 'obras',
  op_external_machines: 'obras', op_machine_rounds: 'obras', op_machine_supervisors: 'obras',
  op_maintenance: 'obras', op_report_settings: 'obras', op_supervisor_visits: 'obras', edificios: 'obras',
  // 👷 Operadores y su coordinación
  operator_assignments: 'operadores', machine_operators: 'operadores',
  coordinator_company_scope: 'operadores', coordinator_machine_scope: 'operadores',
  // 🔧 Servicio de maquinaria (el taller: averías, órdenes y repuestos)
  maintenance_requests: 'servicio', machinery_service_orders: 'servicio',
  machinery_service_parts: 'servicio', service_intervention_types: 'servicio', machinery_service_edits: 'servicio',
  // 👥 Usuarios y permisos
  profiles: 'usuarios', app_roles: 'usuarios', module_permissions: 'usuarios', feature_toggles: 'usuarios',
  // 🚛 Viajes de camiones
  camion_viajes: 'viajes', camion_viajes_config: 'viajes',
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
 *    - SCAN   → escanear el QR: de una máquina es una ronda; de un empleado es
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

  // Un SCAN sobre un empleado es su carnet, no una ronda de inspección.
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

/** Texto de la pastilla del filtro; avisa cuando la sección todavía no deja rastro. */
export const SIN_RASTRO_SUFIJO = ' · sin rastro aún';
export function etiquetaPastilla(m: ModuloAuditoria): string {
  return `${m.icon} ${m.label}${m.sinRastro ? SIN_RASTRO_SUFIJO : ''}`;
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

/** Las tablas de una sección (lo usa la prueba para comprobar "sin rastro"). */
export function tablasDeModulo(key: string): string[] {
  return Object.keys(TABLA_A_MODULO).filter((t) => TABLA_A_MODULO[t] === key).sort();
}

/** Las acciones propias de la app que caen en una sección (ídem). */
export function accionesDeModulo(key: string): string[] {
  return Object.keys(ACCION_A_MODULO).filter((a) => ACCION_A_MODULO[a] === key).sort();
}
