// ============================================================================
// 💼 TIPOS DE PRESUPUESTOS Y COTIZACIONES DE MAQUINARIA
// ============================================================================

export type UnidadAlquiler =
  | 'hora'
  | 'dia'
  | 'semana'
  | 'mes'
  | 'flete'
  | 'standby'
  | 'viaje'
  | 'servicio'
  | 'personalizado';

export interface OpcionUnidadAlquiler {
  key: UnidadAlquiler;
  label: string;
  shortLabel: string;
  defaultDescription: string;
}

export const UNIDADES_ALQUILER: OpcionUnidadAlquiler[] = [
  { key: 'hora', label: 'Por Hora (h)', shortLabel: 'h', defaultDescription: 'Tarifa horaria según horómetro de trabajo' },
  { key: 'dia', label: 'Por Día / Turno', shortLabel: 'Día', defaultDescription: 'Turno de trabajo diario (8 horas)' },
  { key: 'semana', label: 'Por Semana', shortLabel: 'Semana', defaultDescription: 'Alquiler semanal en obra' },
  { key: 'mes', label: 'Por Mes (tarifa mensual)', shortLabel: 'Mes', defaultDescription: 'Mensualidad (base 200 horas garantizadas)' },
  { key: 'flete', label: 'Flete / Movilización', shortLabel: 'Flete', defaultDescription: 'Traslado ida y vuelta en Lowboy' },
  { key: 'standby', label: 'Horas Standby / Espera', shortLabel: 'Standby', defaultDescription: 'Equipo disponible en sitio sin operar por causas del cliente' },
  { key: 'viaje', label: 'Por Viaje / Acarreo', shortLabel: 'Viaje', defaultDescription: 'Viaje de acarreo o transporte' },
  { key: 'servicio', label: 'Servicio puntual', shortLabel: 'Serv.', defaultDescription: 'Servicio especializado o puntual' },
  { key: 'personalizado', label: 'Otra unidad (personalizada)', shortLabel: 'Otro', defaultDescription: 'Unidad a convenir' },
];

export interface PresupuestoItem {
  id: string;
  machine_id?: string | null;
  machine_code?: string | null;
  description: string;
  unit: UnidadAlquiler;
  unit_label?: string;
  qty: number;
  unit_price: number;
  subtotal: number;
  notes?: string;
}

export interface CondicionesAlquiler {
  incluye_operador: boolean;
  detalle_operador?: string;
  incluye_combustible: boolean;
  detalle_combustible?: string;
  horas_minimas_dia?: number | null;
  horas_minimas_mes?: number | null;
  flete_incluido: boolean;
  detalle_flete?: string;
  mantenimiento?: string;
  forma_pago?: string;
  vigencia_dias: number;
  observaciones_generales?: string;
}

export type PresupuestoEstado = 'borrador' | 'emitido' | 'aceptado' | 'rechazado' | 'vencido';

export interface Presupuesto {
  id: string;
  code: string;                          // ej. PRES-0001
  company_id: string;                    // ID de la empresa del grupo que emite
  company_name: string;                  // ej. GOLDEN TOUCH 1127 CA
  company_rif?: string | null;
  client_id?: string | null;             // ID en contacts o sales_clients
  client_name: string;
  client_doc?: string | null;            // RIF o Cédula
  client_phone?: string | null;
  client_email?: string | null;
  client_address?: string | null;
  client_contact_person?: string | null; // Atención a: Ing. / Encargado
  project_name?: string | null;          // Nombre de la obra o proyecto
  date: string;                          // YYYY-MM-DD
  valid_until: string;                   // YYYY-MM-DD
  items: PresupuestoItem[];
  subtotal: number;                      // en USD
  con_iva: boolean;
  iva_pct: number;
  iva_monto: number;
  total: number;                         // en USD
  rate_bs: number;                       // Tasa BCV
  total_bs: number;                      // Equivalente en Bs
  conditions: CondicionesAlquiler;
  status: PresupuestoEstado;
  status_note?: string | null;           // Nota de motivo de aceptación o rechazo
  created_by?: string | null;
  created_by_name?: string | null;
  created_at: string;
  updated_at?: string | null;
}
