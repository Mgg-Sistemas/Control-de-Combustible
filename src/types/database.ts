// Tipos del dominio (alineados con supabase/schema.sql).
// Para regenerar automáticamente desde el esquema:
//   npx supabase gen types typescript --project-id <ref> > src/types/supabase.ts

export type UserRole = 'admin' | 'supervisor' | 'analista' | 'operador' | 'conductor' | 'cocina';
export type FuelType = 'gasolina' | 'diesel';
export type AuthorizationStatus = 'pendiente' | 'aprobado' | 'rechazado';
export type AssetKind = 'vehiculo' | 'maquinaria';

export interface Profile {
  id: string;
  full_name: string | null;
  role: UserRole;
  active: boolean;
  cedula: string | null; // cédula del usuario (única entre usuarios)
  failed_attempts?: number; // intentos de login fallidos (se bloquea al 3ro)
  locked?: boolean; // bloqueado por intentos fallidos (el admin desbloquea)
  locked_at?: string | null;
  app_role_id?: string | null; // rol dinámico asignado (define qué módulos ve)
  created_at: string;
}

export interface Tank {
  id: string;
  name: string;
  location: string | null;
  fuel: FuelType;
  capacity_l: number;
  is_mobile: boolean;
  active: boolean;
  created_at: string;
}

export interface TankLevel {
  id: string;
  name: string;
  fuel: FuelType;
  capacity_l: number;
  current_l: number;
  pct: number | null;
}

export interface Vehicle {
  id: string;
  plate: string;
  brand: string | null;
  model: string | null;
  vehicle_type: string | null;
  tank_capacity_l: number | null;
  expected_kml: number | null;
  active: boolean;
  created_at: string;
}

export interface Machinery {
  id: string;
  code: string;
  description: string | null;
  machinery_type: string | null;
  expected_lph: number | null;
  plate: string | null;
  serial: string | null;
  identifier: string | null;
  photo_url: string | null;
  company_id: string | null;
  active: boolean;
  operational: boolean;
  en_espera: boolean; // 3er estado: "En espera por recepción" (aún no recibida en control)
  qr_blocked?: boolean; // QR bloqueado: al escanear solo se muestra el logo (sin datos ni acciones)
  latitude: number | null;
  longitude: number | null;
  location_at: string | null;
  entry_date: string | null;
  exit_date: string | null;
  entry_at: string | null;
  exit_at: string | null;
  location: string | null;
  price_per_hour: number | null;
  initial_cost: number | null; // costo inicial de la máquina (margen de ganancia)
  useful_value: number | null; // valor útil de la máquina (margen de ganancia)
  daily_consumption_l: number | null; // consumo diario de combustible (L) — tope de surtido = 2×
  operator_id: string | null; // operador asignado por defecto (rol operador) — para la vista de operador
  grupo: string | null;
  encargado: string | null;
  zona: string | null; // ZONA / a disposición de (Gobernación, FANB, CVM, Zona Este…) — filtro del conteo
  tipo: string | null; // MODELO de la máquina (marca/modelo: CAT 320, Komatsu PC200...) — para agrupar
  clasificacion: string | null; // CLASIFICACIÓN de la máquina (Excavadora, Volteo, Retro...) — para agrupar
  referencia: string | null; // UBICACIÓN / referencia de la máquina — se muestra en los reportes
  last_horometro: number | null; // última lectura de horómetro (se arrastra al próximo inicio)
  viajes: number | null; // nº de viajes realizados (solo Golden Touch) — extra al subtotal por jornada
  precio_viaje: number | null; // precio por viaje en $ (solo Golden Touch)
  created_at: string;
}

export interface CompanyPayment {
  id: string;
  company_id: string | null;
  company_name: string;
  period_start: string;
  period_end: string;
  amount: number;
  currency: string;
  detail: PaymentDetail | null;
  paid_at: string;
  created_by: string | null;
  created_at: string;
}

/** Snapshot que se guarda al marcar como pagada una cuenta. */
export interface PaymentDetail {
  machines: { machine: string; hours: number; price: number; subtotal: number }[];
  totalHours: number;
  total: number;
}

export interface Company {
  id: string;
  name: string;
  rif: string | null;      // RIF fiscal (se imprime en los reportes)
  hidden: boolean;         // empresa oculta: no aparece en selectores ni reportes
  created_at: string;
}

/** Empleado / trabajador (RRHH). El QR de su ficha abre una pantalla con TODOS
 *  estos datos; el carnet imprimible resume foto + cargo + N° ficha + cédula + grupo sanguíneo. */
export interface Employee {
  id: string;
  company_id: string | null;
  ficha_number: string | null;   // número de ficha (carnet)
  first_name: string;
  last_name: string;
  cedula: string | null;
  cargo: string | null;
  department: string | null;
  grupo: string | null;
  photo_url: string | null;
  birth_date: string | null;     // fecha de nacimiento (la edad se deriva)
  gender: string | null;
  blood_type: string | null;     // grupo sanguíneo
  nationality: string | null;
  marital_status: string | null; // estado civil
  phone: string | null;
  email: string | null;
  address: string | null;        // dónde vive
  city: string | null;
  state: string | null;          // estado / provincia
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  emergency_contact_relation: string | null;
  hire_date: string | null;      // fecha de ingreso
  status: 'activo' | 'inactivo' | 'suspendido';
  base_salary: number | null;
  salary_currency: string | null;
  bank_name: string | null;      // banco (datos bancarios)
  bank_account: string | null;   // número de cuenta
  bank_holder: string | null;    // nombre y apellido del titular
  bank_cedula: string | null;    // cédula del titular
  talla_camisa: string | null;   // talla de camisa (uniforme)
  talla_pantalon: string | null; // talla de pantalón (uniforme)
  talla_zapatos: string | null;  // talla de zapatos (uniforme)
  precio_hora: number | null;    // pago a personal: precio por hora
  precio_dia: number | null;     // pago a personal: precio por día
  precio_semana: number | null;  // pago a personal: precio por semana
  notes: string | null;
  created_by: string | null;
  created_at: string;
}

/** Aliado: contacto/colaborador externo con ficha y carnet propios. */
export interface Aliado {
  id: string;
  ficha_number: string | null;   // número de ficha (4 dígitos aleatorio, único)
  first_name: string;
  last_name: string;
  cedula: string | null;
  organizacion: string | null;   // empresa/institución del aliado
  rol: string | null;            // rol o cargo del aliado
  photo_url: string | null;
  blood_type: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  status: 'activo' | 'inactivo' | 'suspendido';
  notes: string | null;
  created_by: string | null;
  created_at: string;
}

/** Tabulador maestro de precios por jornada (clasificación + modelo).
 *  Editable desde Control de pagos. La sincronización lo aplica a
 *  machinery.price_per_hour (precios ACTUALES); los cierres viejos NO se tocan
 *  (quedan congelados). Los cierres nuevos congelan estos precios al cerrar. */
export interface PriceTariff {
  id: string;
  clasificacion: string;
  modelo: string;        // clave única — se empareja con el code de la máquina
  price_jornada: number; // precio por jornada (12 h)
  sort_order: number;
  updated_at: string;
}

/** Precio de un modelo para una EMPRESA puntual (sobrescribe el tabulador general). */
export interface CompanyPriceTariff {
  id: string;
  company_id: string;
  modelo: string;
  price_jornada: number;
  updated_at: string;
}

/** Línea de asignación o deducción de un recibo de nómina. */
export interface PayrollLine {
  label: string;
  amount: number;
}

/** Período de nómina de una empresa (borrador → aprobada → pagada). */
export interface PayrollPeriod {
  id: string;
  company_id: string | null;
  name: string;
  period_start: string | null;
  period_end: string | null;
  status: 'borrador' | 'aprobada' | 'pagada';
  total_amount: number;
  currency: string | null;
  created_by: string | null;
  created_at: string;
}

/** Renglón de nómina por empleado. Neto = base + asignaciones − deducciones. */
export interface PayrollItem {
  id: string;
  period_id: string;
  employee_id: string | null;
  employee_name: string | null;
  cargo: string | null;
  ficha_number: string | null;
  cedula: string | null;
  hire_date: string | null;   // fecha de ingreso (copiada del empleado)
  base_amount: number;
  additions: PayrollLine[];
  deductions: PayrollLine[];
  net_amount: number;
  note: string | null;
  created_at: string;
}

// ===== CONTROL DE PAGO A PERSONAL (dentro de Nómina) =====

/** Concepto con monto (bono o deducción). */
export interface StaffPayLine {
  label: string;
  amount: number;
}

/** Período de pago a personal (borrador → aprobada → pagada). */
export interface StaffPayPeriod {
  id: string;
  company_id: string | null;
  name: string;
  period_type: 'dia' | 'semana' | 'quincena'; // rango de fechas del período
  date_from: string;
  date_to: string;
  mode: 'hora' | 'dia' | 'semana';            // base del pago: por hora / día / semana
  only_validated: boolean; // solo cuentan jornadas validadas por el supervisor
  status: 'borrador' | 'aprobada' | 'pagada';
  total_amount: number;
  created_by: string | null;
  created_at: string;
}

/** Línea por persona. devengado = precio_del_modo × cantidad. total = devengado + Σbonos − Σdeducciones. */
export interface StaffPayItem {
  id: string;
  period_id: string;
  employee_id: string | null;
  cedula: string | null;
  person_name: string;
  cargo: string | null;
  source: 'auto' | 'manual';   // auto = jornadas de operador; manual = a mano
  precio_hora: number;         // precios snapshot del trabajador
  precio_dia: number;
  precio_semana: number;
  dias: number;                // cantidades del período
  horas: number;
  semanas: number;
  jornadas_validadas: number;
  jornadas_pendientes: number;
  overridden: boolean;         // cantidades ajustadas a mano
  devengado: number;
  bonos: StaffPayLine[];
  deducciones: StaffPayLine[];
  total: number;
  nota: string | null;
  created_at: string;
}

/** Abono (pago parcial) de una línea de persona. */
export interface StaffPayPayment {
  id: string;
  item_id: string;
  monto: number;
  metodo: string;
  fecha: string;
  nota: string | null;
  created_by: string | null;
  created_at: string;
}

// ===== F3 COMPRAS =====

export interface Supplier {
  id: string;
  name: string;
  rif: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  active: boolean;
  created_at: string;
}

/** Renglón de una solicitud/orden de compra (guardado en JSONB). */
export interface PurchaseLine {
  description: string;
  qty: number;
  unit: string | null;
  price: number; // estimado (solicitud) o unitario (orden)
  item_id?: string | null; // producto de inventario enlazado (si aplica)
}

export type PurchaseRequestStatus = 'solicitada' | 'aprobada' | 'rechazada' | 'ordenada';

/** Solicitud de pedido → se aprueba/rechaza → genera una orden de compra. */
export interface PurchaseRequest {
  id: string;
  company_id: string | null;
  requested_by: string | null;
  needed_for: string | null;
  category: string | null;
  note: string | null;
  items: PurchaseLine[];
  estimated_total: number;
  status: PurchaseRequestStatus;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
}

export type PurchaseOrderStatus = 'borrador' | 'aprobada' | 'recibida' | 'anulada';

/** Orden de compra (nace de una solicitud aprobada). */
export interface PurchaseOrder {
  id: string;
  request_id: string | null;
  supplier_id: string | null;
  company_id: string | null;
  category: string | null;
  note: string | null;
  items: PurchaseLine[];
  total: number;
  status: PurchaseOrderStatus;
  approved_by: string | null;
  approved_at: string | null;
  received_at: string | null;
  created_by: string | null;
  created_at: string;
}

// ── Inventario / Almacén ─────────────────────────────────────────────────────
export interface InventoryItem {
  id: string;
  name: string;
  category: string | null;
  unit: string | null;
  sku: string | null;
  min_stock: number;
  avg_cost: number;       // Precio Medio Ponderado (PMP)
  company_id: string | null;
  machinery_id: string | null; // equipo/máquina al que pertenece el material
  active: boolean;
  estado: string | null;  // estado físico del material (Nuevo/Bueno/Regular/Dañado)
  created_at: string;
}

/** Vista de existencias: producto + stock derivado de los movimientos. */
export interface InventoryLevel extends InventoryItem {
  stock: number;
}

export type InventoryMovementKind = 'entrada' | 'salida' | 'consumo' | 'ajuste';

export interface InventoryMovement {
  id: string;
  item_id: string;
  kind: InventoryMovementKind;
  qty: number;
  unit_cost: number | null;
  reason: string | null;
  order_id: string | null;
  company_id: string | null;
  note: string | null;
  created_by: string | null;
  created_at: string;
}

/** Renglón de una nota de traslado (guardado en JSONB). */
export interface InventoryTransferLine {
  item_id: string;
  name: string;
  qty: number;
  unit: string;
}

/** Nota de traslado: materiales que pasan de una máquina/empleado (origen) a otra (destino). */
export interface InventoryTransfer {
  id: string;
  company_id: string | null;
  from_machinery_id: string | null;
  from_machinery_label: string | null;
  from_employee_id: string | null;
  from_employee_name: string | null;
  to_machinery_id: string | null;
  to_machinery_label: string | null;
  to_employee_id: string | null;
  to_employee_name: string | null;
  motivo: string | null;
  items: InventoryTransferLine[];
  descontado: boolean;
  created_by: string | null;
  created_at: string;
}

export interface MachineryLocation {
  id: string;
  machinery_id: string;
  latitude: number | null;
  longitude: number | null;
  note: string | null;
  recorded_at: string;
}

export interface MachineRound {
  id: string;
  machinery_id: string;
  round_date: string;
  round_no: number; // 1=07:00 2=11:00 3=15:00 4=19:00
  status: 'operativa' | 'parada';
  hours_stopped: number;
  overtime_hours: number | null;
  day_hours: number | null;   // turno de día trabajado (0 / 6 / 12)
  night_hours: number | null; // turno de noche trabajado (0 / 6 / 12)
  day_operator: string | null;      // operador del turno de día
  day_operator_ci: string | null;
  night_operator: string | null;    // operador del turno de noche
  night_operator_ci: string | null;
  closed: boolean;
  frozen_price: number | null; // precio por jornada congelado al cerrar el corte (los reportes lo usan si existe)
  notes: string | null;
  recorded_by: string | null;
  horometro_inicial: number | null; // lectura del horómetro al iniciar la jornada
  horometro_final: number | null;   // lectura del horómetro al finalizar (horas = HF − HI)
  horometro_photo: string | null;   // foto del horómetro al iniciar
  created_at: string;
}

/** Asignación de una máquina a un operador en un día (módulo OPERADORES).
 *  Regla: 1 máquina por operador por día (único por cédula + fecha). En una
 *  semana un operador sí puede tener varias máquinas, pero no en el mismo día. */
export interface OperatorAssignment {
  id: string;
  first_name: string;
  last_name: string;
  cedula: string;
  machinery_id: string;
  company_name: string | null; // empresa de la máquina (para el reporte)
  work_date: string;           // día de la jornada (ISO Caracas)
  shift: 'day' | 'night' | null;
  started_at: string;
  ended_at: string | null;
  worked_hours: number | null;
  horometro_inicial: number | null;
  horometro_final: number | null;
  horometro_photo: string | null;
  // Ubicación GPS del operador al INICIAR y al FINALIZAR la jornada (traza).
  start_lat: number | null;
  start_lng: number | null;
  end_lat: number | null;
  end_lng: number | null;
  created_by: string | null;
  created_at: string;
}

export interface MachineDayOperator {
  machinery_id: string;
  round_date: string;
  first_name: string | null;
  last_name: string | null;
  cedula: string | null;
  closed: boolean;
  updated_at: string;
}

/** Una entrega de comida a una persona (registrada por Cocina al escanear su carnet). */
export interface FoodDistribution {
  id: string;
  employee_id: string | null;
  employee_name: string;
  cedula: string | null;
  meals: number;
  meal_type: MealType | null;  // desayuno/almuerzo/cena (1 por día por persona)
  delivered_at: string;        // hora de entrega (ISO UTC)
  distribution_date: string;   // día (ISO Caracas)
  note: string | null;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
}

export type MealType = 'desayuno' | 'almuerzo' | 'cena';

/** Comida entregada a una EMPRESA en un día (desayuno/almuerzo/cena), 1 vez por día. */
export interface FoodCompanyMeal {
  id: string;
  company_id: string | null;
  company_name: string;
  meal_type: MealType;
  meal_date: string;           // día (ISO Caracas)
  machines: number;            // nº de máquinas de la empresa al registrar
  suggested: number;           // sugerido = máquinas × 2 + 15
  delivered: number;           // lo que el cocinero entregó realmente
  delivered_at: string;        // hora de entrega (ISO UTC)
  note: string | null;
  created_by: string | null;
  created_by_name: string | null;
  created_by_cargo: string | null;
  created_at: string;
}

/** Estado con que el supervisor marca la máquina al visitarla. */
export type VisitStatus = 'trabajando' | 'parada' | 'no_esta';

/**
 * Visita (check-in) de un supervisor a una máquina: hora + GPS + estado.
 * VALIDA la jornada de esa máquina ese día (sin visita, el operador no cobra).
 */
export interface SupervisorVisit {
  id: string;
  machinery_id: string;
  supervisor_id: string | null;
  supervisor_name: string;
  visit_date: string;       // día (ISO Caracas)
  visited_at: string;       // hora exacta (ISO UTC)
  status: VisitStatus;
  lat: number | null;
  lng: number | null;
  distance_m: number | null; // metros hasta la ubicación conocida de la máquina
  near: boolean | null;      // ¿dentro de la tolerancia?
  note: string | null;
  created_at: string;
}

/** Fila del snapshot que se guarda al cerrar el control del día. */
export interface ClosureMachine {
  code: string;
  machineId?: string | null; // id único de la máquina física
  serial?: string | null;    // serial (o placa) — identifica la máquina, puede repetirse el nombre
  company: string;
  operator: string; // (compat) "Nombre Apellido"
  cedula: string;
  date?: string; // fecha del registro (cuando el cierre abarca varios días)
  dayOperator?: string;   // operador del turno de día
  dayCedula?: string;
  nightOperator?: string; // operador del turno de noche
  nightCedula?: string;
  statuses?: (string | null)[]; // (histórico viejo) 4 rondas
  dayHours?: number;   // turno de día (0/6/12)
  nightHours?: number; // turno de noche (0/6/12)
  hoursStopped: number;
  overtime?: number; // horas extras del día
  worked: number; // horas trabajadas totales del día (turnos − parada + extras)
  price?: number; // precio por jornada CONGELADO al cerrar (semana cerrada = inmutable)
}

export interface ControlClosure {
  id: string;
  closure_date: string;
  closed_by: string | null;
  detail: { machines: ClosureMachine[]; totalMachines: number; dateFrom?: string; dateTo?: string } | null;
  created_at: string;
}

export interface Authorization {
  id: string;
  requested_by: string | null;
  asset_kind: AssetKind;
  vehicle_id: string | null;
  machinery_id: string | null;
  tank_id: string | null;
  liters: number;
  reason: string | null;
  status: AuthorizationStatus;
  approved_by: string | null;
  resolved_at: string | null;
  created_at: string;
}

export interface FuelIntake {
  id: string;
  intake_date: string;
  supplier: string | null;
  fuel: FuelType;
  liters: number;
  unit_cost: number | null;
  total_cost: number | null;
  tank_id: string;
  invoice_no: string | null;
  created_by: string | null;
  created_at: string;
}

export interface Dispatch {
  id: string;
  dispatch_date: string;
  asset_kind: AssetKind;
  vehicle_id: string | null;
  machinery_id: string | null;
  liters: number;
  odometer_km: number | null;
  hourmeter_h: number | null;
  driver_operator: string | null;
  tank_id: string;
  authorization_id: string | null;
  created_by: string | null;
  created_at: string;
}

export interface Payroll {
  id: string;
  company_name: string;
  amount: number;
  note: string | null;
  created_by: string | null;
  created_at: string;
}

/** Guardia / militar encargado de una máquina. El historial es ACUMULABLE:
 *  al cambiar de militar, el registro anterior se cierra (ended_at + active=false)
 *  y se inserta uno nuevo activo, para que quede la traza de quién la cuidó. */
export interface MachineGuard {
  id: string;
  machinery_id: string;
  guard_name: string;      // nombre del militar/guardia
  rank: string | null;     // grado / rango (opcional)
  note: string | null;
  assigned_at: string;     // inicio del período de custodia
  ended_at: string | null; // fin (null = actual/activo)
  active: boolean;
  created_by: string | null;
  created_at: string;
}

export type MaintenanceMaterial = 'caucho' | 'aceite' | 'filtro' | 'repuesto';
export type MaintenanceStatus = 'pendiente' | 'realizado';

export interface MaintenanceRequest {
  id: string;
  machinery_id: string;
  material: MaintenanceMaterial | string;
  quantity: number | null;
  notes: string | null;
  status: MaintenanceStatus;
  requested_by: string | null;
  created_at: string;
  resolved_by: string | null;
  resolved_at: string | null;
}

export type RepairTipo = 'preventivo' | 'correctivo';
export type RepairStatus = 'en_reparacion' | 'operativa';

export interface MachineryRepair {
  id: string;
  machinery_id: string;
  tipo: RepairTipo | string;
  out_at: string;                 // fecha de salida a reparación (ISO date)
  estimated_days: number | null;  // por cuánto tiempo (días)
  estimated_note: string | null;  // detalle del tiempo
  work_done: string | null;       // qué se le cambió
  back_at: string | null;         // cuándo volvió operativa (null = en reparación)
  status: RepairStatus | string;
  created_by: string | null;
  closed_by: string | null;
  created_at: string;
}

// Rol dinámico creado desde Usuarios: define qué módulos ve (clave → nivel).
export interface AppRole {
  id: string;
  name: string;
  modules: Record<string, string>; // { module_key: 'lectura'|'escritura'|'full' }
  created_at: string;
}

export interface Transfer {
  id: string;
  transfer_date: string;
  from_tank_id: string;
  to_tank_id: string;
  liters: number;
  notes: string | null;
  created_by: string | null;
  created_at: string;
}
