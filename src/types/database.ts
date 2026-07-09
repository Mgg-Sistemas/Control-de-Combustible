// Tipos del dominio (alineados con supabase/schema.sql).
// Para regenerar automáticamente desde el esquema:
//   npx supabase gen types typescript --project-id <ref> > src/types/supabase.ts

export type UserRole = 'admin' | 'supervisor' | 'operador' | 'conductor';
export type FuelType = 'gasolina' | 'diesel';
export type AuthorizationStatus = 'pendiente' | 'aprobado' | 'rechazado';
export type AssetKind = 'vehiculo' | 'maquinaria';

export interface Profile {
  id: string;
  full_name: string | null;
  role: UserRole;
  active: boolean;
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
  grupo: string | null;
  encargado: string | null;
  tipo: string | null; // tipo de máquina (Jumbo, Tractor, Chuto...) — para agrupar reportes
  referencia: string | null; // UBICACIÓN / referencia de la máquina — se muestra en los reportes
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
  notes: string | null;
  recorded_by: string | null;
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
