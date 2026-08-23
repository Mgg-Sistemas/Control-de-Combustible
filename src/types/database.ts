// Tipos del dominio (alineados con supabase/schema.sql).
// Para regenerar automáticamente desde el esquema:
//   npx supabase gen types typescript --project-id <ref> > src/types/supabase.ts

export type UserRole = 'admin' | 'supervisor' | 'analista' | 'operador' | 'conductor' | 'cocina' | 'coordinador_patio' | 'coordinador_inspectores';
export type FuelType = 'gasolina' | 'diesel';
export type AuthorizationStatus = 'pendiente' | 'aprobado' | 'rechazado';
export type AssetKind = 'vehiculo' | 'maquinaria';

export interface Profile {
  id: string;
  full_name: string | null;
  role: UserRole;
  active: boolean;
  cedula: string | null; // cédula del usuario (única entre usuarios)
  username?: string | null; // usuario para iniciar sesión (único, máx. 10 caracteres)
  failed_attempts?: number; // intentos de login fallidos (se bloquea al 3ro)
  locked?: boolean; // bloqueado por intentos fallidos (el admin desbloquea)
  locked_at?: string | null;
  app_role_id?: string | null; // rol dinámico asignado (define qué módulos ve)
  can_audit?: boolean; // puede ver el módulo de Auditoría (bitácora de todos)
  created_at: string;
}

/** Un ítem del inventario de una inspección de maquinaria (una fila de la tabla). */
export interface InspectionItem {
  descripcion: string;
  cantidad: number;
  unidad: string;              // "Unid.", "Juego", "Rollo"…
  serial: string | null;       // Serial / Especificación
  estado: string;              // texto libre del estado (ej. "Verificado (1000 lbs)")
  nivel: 'ok' | 'warn' | 'bad'; // color del estado: 🟢 ok · 🟠 warn · 🔴 bad
}

/** Una OBSERVACIÓN de la sección 2 (etiqueta + texto). */
export interface InspectionNote {
  label: string;
  text: string;
}

/** Inspección de una máquina (control por equipo). Guarda historial por máquina. */
export interface MachineInspection {
  id: string;
  created_at: string;
  machinery_id: string | null;
  machine_code: string | null;
  machine_type: string | null;   // "Tipo de Unidad" (ej. Camión Taller Soldadura)
  machine_plate: string | null;
  machine_serial: string | null;
  inspected_at: string;          // fecha + hora de la inspección
  inspector_name: string | null;
  operator_name: string | null;  // chofer / operador responsable
  condicion_general: string | null;
  observaciones: InspectionNote[];
  items: InspectionItem[];
  created_by: string | null;
}

/** Notificación in-app (campana). Se le refleja al rol destino (target_role) o a un
 *  destinatario específico (recipient_id). El estado "leído" es por usuario. */
export interface AppNotification {
  id: string;
  created_at: string;
  type: string;                 // 'requerimiento' | 'compra' | 'cierre_control' | ...
  title: string;
  body: string | null;
  target_role: string | null;   // audiencia por rol (p. ej. 'admin')
  recipient_id: string | null;  // destinatario específico (opcional)
  entity_type: string | null;   // a qué apunta (para "ir a…")
  entity_id: string | null;
  created_by: string | null;
  meta: Record<string, any> | null;
}

/** Bitácora de auditoría: quién hizo qué (crear/modificar/eliminar) y cuándo. */
export interface AuditLog {
  id: number;
  at: string;
  user_id: string | null;
  user_name: string | null;
  // INSERT/UPDATE/DELETE los escriben los triggers; el resto son EVENTOS de la app
  // (login, escaneo de QR, jornada) que registra audit_event(...).
  action: 'INSERT' | 'UPDATE' | 'DELETE' | 'LOGIN' | 'LOGOUT' | 'SCAN' | 'CHECK' | 'JORNADA_INICIO' | 'JORNADA_FIN' | 'PARADA';
  table_name: string;
  row_id: string | null;
  detail?: string | null; // texto legible del evento (p. ej. el código de la máquina)
  device?: string | null; // dispositivo desde donde se hizo (📱 teléfono / 💻 PC)
  row_label?: string | null; // nombre/código legible del registro afectado (audit_detalle.sql)
  changes?: Record<string, any> | null; // UPDATE: {campo:{de,a}}; INSERT/DELETE: la fila (audit_detalle.sql)
}

/** Registro de ENTRADA / SALIDA de un camión al patio (Coordinador de Patio). */
export interface TruckYardLog {
  id: string;
  machinery_id: string | null;
  machine_code: string | null;
  direction: 'entrada' | 'salida';
  logged_by: string | null;
  logged_by_name: string | null;
  note: string | null;
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
  chofer: string | null;        // chofer de la cisterna (para tanques móviles)
  machinery_id: string | null;  // vínculo con la cisterna del catálogo (camión cisterna)
  responsable: string | null;   // encargado a cargo del tanque
}

export interface TankLevel {
  id: string;
  name: string;
  fuel: FuelType;
  capacity_l: number;
  current_l: number;
  pct: number | null;
  responsable: string | null;   // encargado a cargo del tanque (de tanks.responsable)
  location?: string | null;
}

export interface Vehicle {
  id: string;
  plate: string;
  name?: string | null;               // nombre del vehículo (como "Código/Nombre" de maquinaria); columna `supabase/vehiculos_nombre.sql`
  brand: string | null;
  model: string | null;
  vehicle_type: string | null;
  tank_capacity_l: number | null;
  expected_kml: number | null;
  /** Responsable del vehículo. Obligatorio AL CREAR (lo exige la app, no la BD:
   *  un `not null` trancaría los vehículos viejos que nunca lo tuvieron).
   *  La columna la agrega `supabase/vehiculos_encargado.sql`. */
  encargado?: string | null;
  en_espera?: boolean | null; // 3er estado "Esperando instrucciones" (vehiculos_en_espera.sql)
  // Ficha completa (como maquinaria) — columnas de `supabase/vehiculos_ficha_maquinaria.sql`.
  clasificacion?: string | null;
  identifier?: string | null;
  serial?: string | null;
  grupo?: string | null;
  company_id?: string | null;
  photo_url?: string | null;          // foto del vehículo
  photo_serial_url?: string | null;   // foto del serial / placa
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
  photo_url: string | null;          // foto de la MAQUINARIA
  photo_serial_url: string | null;   // foto del SERIAL / PLACA
  company_id: string | null;
  active: boolean;
  operational: boolean;
  en_espera: boolean; // 3er estado: "En espera por recepción" (aún no recibida en control)
  inactivated_at?: string | null; // fecha en que se marcó NO OPERATIVA (inactivó)
  reactivated_at?: string | null; // fecha en que se volvió a marcar OPERATIVA (reactivó)
  inactivated_by?: string | null; // profiles.id de quién la inactivó
  inactivated_reason?: string | null; // MOTIVO obligatorio al retirar (sacar de servicio)
  reactivated_by?: string | null; // profiles.id de quién la reactivó
  inactivated_by_profile?: { full_name: string | null } | null; // embebido (join) para mostrar el nombre sin query aparte
  reactivated_by_profile?: { full_name: string | null } | null;
  con_tapa?: boolean | null; // ¿el equipo cuenta con tapa? (check Sí/No en el Catálogo)
  tapa_doble?: boolean | null; // ¿la tapa es doble? (solo aplica si con_tapa)
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
  tipo: string | null; // MARCA-MODELO combinado (histórico; se mantiene = marca+modelo al guardar) — para agrupar
  marca: string | null; // MARCA (CAT, Komatsu, Kodiak...) — campo separado del catálogo
  modelo: string | null; // MODELO (320, PC200, D6...) — campo separado del catálogo
  clasificacion: string | null; // CLASIFICACIÓN de la máquina (Excavadora, Volteo, Retro...) — para agrupar
  referencia: string | null; // UBICACIÓN / referencia (edificio) de la máquina — se muestra en los reportes
  parroquia: string | null; // PARROQUIA (texto editable) — ubicación administrativa
  sector: string | null; // SECTOR (texto editable) — complementa el sector geográfico del GPS
  last_horometro: number | null; // última lectura de horómetro (se arrastra al próximo inicio)
  horometro_base: number | null; // horómetro del último mantenimiento confirmado (marca "cero" para las horas acumuladas — ver supabase/horometro_alertas.sql)
  horometro_maint_pending?: boolean; // arrastre: llegó a ≥250 h acumuladas y sigue "requiere mantenimiento" hasta confirmar reparada + reiniciar horómetro
  viajes: number | null; // nº de viajes realizados (solo Golden Touch) — extra al subtotal por jornada
  precio_viaje: number | null; // precio por viaje en $ (solo Golden Touch)
  // Especificaciones para ACARREO/transporte (módulo haul_*):
  weight_ton?: number | null;       // peso de la máquina (toneladas)
  length_m?: number | null;         // largo (m)
  width_m?: number | null;          // ancho (m)
  height_m?: number | null;         // alto (m)
  transport_status?: 'operativa' | 'para_reparacion' | 'chatarra' | null; // estado para transporte
  // Lubricación — bloque de la FICHA TÉCNICA que pidió el cliente (18-ago-2026).
  // Se edita en Control de Maquinaria y se imprime en machineServiceReport.ts.
  oil_type?: string | null;        // tipo de aceite recomendado del motor
  oil_capacity_l?: number | null;  // cantidad requerida, en litros
  oil_notes?: string | null;       // nota libre, para lo que no se mide en litros
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
  machines: { machine: string; tipo?: string | null; hours: number; price: number; subtotal: number }[];
  totalHours: number;
  total: number;
}

export interface Company {
  id: string;
  name: string;
  rif: string | null;      // RIF fiscal (se imprime en los reportes)
  hidden: boolean;         // empresa oculta: no aparece en selectores ni reportes
  food_only: boolean;      // solo comidas: aparece únicamente en distribución de comidas
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
  /** EMPRESA FILTRO NÓMINA: lista propia de Nómina (tabla `payroll_companies`),
   *  aparte del catálogo general. Es REFERENCIAL — solo agrupa y filtra en la
   *  pantalla de Empleados; NO la lee maquinaria, ni reportes, ni compras, ni
   *  comidas: esas ni conocen la tabla.
   *  La empresa REAL del empleado sigue siendo `company_id`, que usan los períodos
   *  de nómina, la pantalla de comidas y el carnet.
   *  La columna la agrega `supabase/nomina_empresa_filtro.sql`. */
  payroll_company_id?: string | null;
  base_salary: number | null;
  salary_currency: string | null;
  bank_name: string | null;      // banco (datos bancarios)
  bank_account: string | null;   // número de cuenta
  bank_holder: string | null;    // nombre y apellido del titular
  bank_cedula: string | null;    // cédula del titular
  talla_camisa: string | null;   // talla de camisa (uniforme)
  talla_pantalon: string | null; // talla de pantalón (uniforme)
  talla_zapatos: string | null;  // talla de zapatos (uniforme)
  talla_braga: string | null;    // talla de braga / overol (uniforme)
  talla_chaqueta: string | null; // talla de chaqueta (uniforme)
  precio_hora: number | null;    // pago a personal: precio por hora
  precio_dia: number | null;     // pago a personal: precio por jornada de DÍA
  precio_noche: number | null;   // pago a personal: precio por jornada de NOCHE
  precio_semana: number | null;  // pago a personal: precio por semana
  precio_quincena: number | null;// pago a personal: precio por quincena
  precio_mes: number | null;     // pago a personal: precio por mes
  notes: string | null;
  created_by: string | null;
  created_at: string;
}

/** Marca de asistencia (entrada/salida) de un empleado, hecha al escanear el carnet.
 *  Una fila por marca; se permiten varios pares entrada/salida por día. */
export interface Attendance {
  id: string;
  employee_id: string;
  ts: string;              // momento exacto (ISO) de la marca
  work_date: string;       // fecha (AAAA-MM-DD, zona Caracas) para agrupar por día
  kind: 'entrada' | 'salida';
  recorded_by: string | null;
  created_at: string;
}

/** Entrega de uniforme: cuántas camisas/pantalones/zapatos se le entregaron a un
 *  empleado, con la fecha y hora. Se acumulan varias entregas por persona. */
export interface UniformDelivery {
  id: string;
  employee_id: string;
  camisas: number;
  pantalones: number;
  zapatos: number;
  bragas: number;         // bragas (overol) entregadas
  chaquetas: number;      // chaquetas entregadas
  delivered_at: string;   // momento exacto (ISO) de la entrega
  work_date: string;      // fecha (AAAA-MM-DD, zona Caracas)
  note: string | null;
  recorded_by: string | null;
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

/** Catálogo ÚNICO de edificios (ubicación de las máquinas). Ver src/lib/edificios.ts. */
export interface Edificio {
  id: string;
  name: string;
  active: boolean;
  created_at: string;
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
  precio_dia: number;          // precio por jornada de DÍA
  precio_noche: number;        // precio por jornada de NOCHE
  precio_semana: number;
  dias: number;                // jornadas de DÍA (modo "Por día")
  dias_noche: number;          // jornadas de NOCHE (modo "Por día")
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

/** Tabulador de sueldos por CARGO: precios que se sincronizan a los empleados
 *  con ese cargo (así el sueldo se define por cargo, no uno por uno). */
export interface StaffCargoTariff {
  id: string;
  cargo: string;
  departamento: string | null;
  precio_hora: number;
  precio_dia: number;    // precio por jornada de DÍA (operadores)
  precio_noche: number;  // precio por jornada de NOCHE (operadores)
  precio_semana: number; // sueldo semanal (resto del personal)
  precio_quincena: number; // sueldo quincenal
  precio_mes: number;      // sueldo mensual
  updated_at: string;
}

/** Movimiento de pago POR PERSONA (ledger independiente de los períodos). Cada
 *  fila es un pago hecho a un empleado, con frecuencia diaria (día/noche), semanal,
 *  quincenal o mensual, su recibo y su historial. */
export interface StaffPersonPayment {
  id: string;
  employee_id: string | null;
  cedula: string | null;
  person_name: string;          // snapshot del nombre
  cargo: string | null;         // snapshot del cargo
  fecha: string;                // fecha del pago / inicio del período que cubre (AAAA-MM-DD)
  fecha_hasta: string | null;   // fin del período que cubre (rango). null = un solo día
  frecuencia: 'diario' | 'semanal' | 'quincenal' | 'mensual';
  jornada: 'dia' | 'noche' | null; // (heredado) jornada única; en "diario" ahora se usan los campos día+noche
  cantidad: number;             // nº de jornadas/semanas/quincenas/meses (en diario = día + noche)
  precio_unit: number;          // precio unitario (semanal/quincenal/mensual)
  cantidad_dia: number;         // "diario": nº de jornadas de DÍA
  cantidad_noche: number;       // "diario": nº de jornadas de NOCHE
  precio_dia: number;           // "diario": precio por jornada de DÍA (snapshot)
  precio_noche: number;         // "diario": precio por jornada de NOCHE (snapshot)
  monto: number;                // total pagado (editable). Diario = día×p_día + noche×p_noche
  metodo: string | null;        // efectivo / transferencia / pago móvil / otro
  banco: string | null;         // snapshot bancario
  cuenta: string | null;
  concepto: string | null;
  nota: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
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
  tags: string[] | null; // etiquetas de rubro (VÍVERES, REPUESTOS…) — para filtrar
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
  /** Requerimiento (inventory_requirements) que originó la orden, si nació de uno
   *  (migración requerimiento_a_compras.sql). Null en órdenes de solicitud directa. */
  inventory_requirement_id?: string | null;
}

/**
 * COMPRA DIRECTA (direct_purchases): compra ya hecha (con factura) que entra DIRECTO
 * al inventario al crearla y genera su cuenta por pagar. Reemplaza a "Solicitudes de
 * pedido". Migración: supabase/compras_directas.sql.
 */
export interface DirectPurchase {
  id: string;
  code: string;                 // CD-#### (correlativo en la base)
  company_id: string | null;
  supplier_id: string | null;
  category: string | null;
  items: PurchaseLine[];
  total: number;
  factura_url: string | null;
  factura_type: 'image' | 'pdf' | null;
  factura_name: string | null;
  note: string | null;
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
  tipo: string | null;    // tipo de producto (bombona, silla, mecate…) para filtrar
  carga: string | null;   // carga de la bombona: vacía | en uso | llena
  created_at: string;
  // Módulo de Fabricación (MRP) — Fase 2: distingue materia prima / componente /
  // producto terminado del stock "general" ya existente. Columna aditiva
  // (supabase/fabricacion_maestros.sql), default 'general'.
  item_kind?: string;
}

/** Vista de existencias: producto + stock derivado de los movimientos. */
export interface InventoryLevel extends InventoryItem {
  stock: number;
}

export type InventoryMovementKind = 'entrada' | 'salida' | 'consumo' | 'ajuste';

/** Snapshot de un empleado al momento de una salida (nombre/cédula/cargo pueden cambiar luego). */
export interface InventoryMovementEmployee {
  id: string;
  name: string;
  cedula?: string | null;
  cargo?: string | null;
}

export interface InventoryMovement {
  id: string;
  item_id: string;
  kind: InventoryMovementKind;
  qty: number;
  unit_cost: number | null;
  reason: string | null;
  order_id: string | null;
  company_id: string | null;
  machinery_id: string | null; // equipo destino de la salida (para el gasto por equipo en Mantenimiento)
  note: string | null;
  employee_ids: string[];                        // empleados que reciben la salida (multi)
  employees_detail: InventoryMovementEmployee[];  // snapshot nombre/cédula/cargo al momento de la salida
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
  to_company_name: string | null;   // empresa destino NO registrada (texto libre)
  motivo: string | null;
  items: InventoryTransferLine[];
  descontado: boolean;
  lugar: string | null;             // lugar/obra a donde se hizo el traslado
  estado: string | null;            // condición al trasladar: usado|lleno|dañado
  returned: boolean;                // ya se retornó al inventario
  returned_at: string | null;
  return_note: string | null;
  created_by: string | null;
  created_at: string;
}

/** Tasa BCV (Bs por 1 US$) de un día. */
export interface BcvRate {
  rate_date: string;
  rate: number;
  source: string | null;            // 'BCV' (automática) | 'manual'
  created_at?: string;
}

/** Renglón de un requerimiento de compra (guardado en JSONB). */
export interface RequirementLine {
  product_id: string | null;        // producto del inventario, o null si es NUEVO
  name: string;
  unit: string | null;
  qty: number;
  est_price: number;                // precio estimado unitario (en la moneda indicada)
  currency: 'USD' | 'VES';          // moneda del precio estimado
  note?: string | null;
  image_url?: string | null;        // foto/imagen de referencia del producto (Storage)
  received?: boolean;               // ya se recibió en inventario
}

export type RequirementStatus = 'pendiente' | 'aprobado' | 'rechazado' | 'recibido';

/** Requerimiento de compra: se pasa al jefe para aprobar/rechazar; si se compra, se recibe. */
export interface InventoryRequirement {
  id: string;
  code: string | null;
  title: string | null;
  note: string | null;
  status: RequirementStatus;
  items: RequirementLine[];
  company_id: string | null;          // empresa para la que se pide (opcional)
  supplier_id: string | null;         // proveedor (opcional) → orden de compra + cuenta por pagar
  requested_by: string | null;
  requested_by_name: string | null;
  decided_by: string | null;
  decided_by_name: string | null;
  decided_at: string | null;
  decision_note: string | null;
  received_at: string | null;
  attachment_url: string | null;      // formato adjunto (imagen o PDF) en Storage
  attachment_type: string | null;     // 'image' | 'pdf'
  attachment_name: string | null;     // nombre original del archivo
  created_at: string;
}

export interface MachineryLocation {
  id: string;
  machinery_id: string;
  latitude: number | null;
  longitude: number | null;
  note: string | null;
  recorded_at: string;
  recorded_by: string | null;   // quién colocó la ubicación (para el monitoreo)
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
  jornada_start_at: string | null;   // inicio de la jornada por TIEMPO abierta (null = cerrada)
  jornada_shift: 'day' | 'night' | null; // turno del inicio de la jornada por tiempo
  declared_day: boolean | null;      // declaró/inició (o bancó horas) la jornada de DÍA — durable por turno (no se pisa entre turnos, a diferencia de jornada_shift)
  declared_night: boolean | null;    // idem para la jornada de NOCHE
  jornada_marked_by: string | null;  // supervisor/inspector que INICIÓ la jornada (no se pisa al finalizar)
  created_at: string;
}

/** Historial AUDITABLE de cada tramo de trabajo de una máquina (hora de inicio /
 *  hora de parada), EN PARALELO a day_hours/night_hours de MachineRound (que no
 *  se toca). Solo agrega trazabilidad fila-por-tramo. */
export interface MachineWorkSegment {
  id: string;
  machinery_id: string;
  round_date: string;
  shift: 'day' | 'night';
  started_at: string;
  ended_at: string;
  hours: number;
  source: 'manual_finish' | 'manual_finish_early' | 'parada_averia' | 'parada_no_trabajo' | 'auto_close' | 'ajuste_manual' | 'auto_full_shift';
  recorded_by: string | null;
  notes: string | null;
  // Motivo del cierre MANUAL ANTICIPADO (solo cuando source='manual_finish_early').
  close_reason: string | null;
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
  /** Monto por litro y monto total del surtido (chofer de combustible). */
  price_per_liter: number | null;
  total_amount: number | null;
  /** Fotos del surtido (URLs del bucket 'machinery'). */
  photos: string[] | null;
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
  /** Turno ('day' | 'night') fijado por trigger en el servidor al crear el ticket
   *  (ver supabase/maintenance_requests_shift_round_date.sql). Opcional porque las
   *  consultas existentes no siempre lo seleccionan y filas viejas pueden no tenerlo. */
  shift?: 'day' | 'night' | null;
  /** Día de negocio Caracas al que pertenece el ticket, fijado por el mismo trigger. */
  round_date?: string | null;
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

// ── Servicio de Maquinaria ───────────────────────────────────────────────────
// Registro de lo que se le hizo a una máquina, con el formato del formulario en
// papel del cliente. SIN DINERO: este módulo no lleva costos ni pagos.
// La lógica vive en `src/lib/machineService.ts`; el PDF, en `machineServiceReport.ts`.
export type MachineryServiceOrigen = 'interno' | 'externo';

export interface MachineryServiceOrder {
  id: string;
  machinery_id: string;
  /** La avería que atiende. Apuntar a ella NO la modifica: el módulo no escribe
   *  en `maintenance_requests`. Ver la frontera en `machineService.ts`. */
  maintenance_request_id: string | null;
  service_date: string;             // AAAA-MM-DD
  origen: MachineryServiceOrigen | string;
  technician: string | null;        // «Operador / Técnico» (interno)
  provider: string | null;          // persona o taller externo
  /** 'mecanica' | 'electricidad' | 'mangueras' | 'servicio' — se puede marcar varias. */
  intervenciones: string[];
  problem: string | null;           // «Descripción del problema»
  work_done: string | null;         // «Acciones realizadas»
  photos: string[];
  notes: string | null;
  created_by: string | null;
  created_at: string;
}

export interface MachineryServicePart {
  id: string;
  service_order_id: string;
  quantity: number | null;
  description: string;
  estado: string | null;            // Nuevo | Usado | Reparado | Reacondicionado (sin candado en la base)
  /** Conserva el orden en que se cargaron los renglones. */
  position: number;
}

// Rol dinámico creado desde Usuarios: define qué módulos ve (clave → nivel).
export interface AppRole {
  id: string;
  name: string;
  modules: Record<string, string>; // { module_key: 'lectura'|'escritura'|'full' }
  /** Tipo de panel del rol: 'modulos' = lista de módulos (por defecto);
   *  'coordinador_qr' = panel de coordinador con escáner QR (surtir gasoil,
   *  avería y marcar máquina lista); 'chofer_combustible' = una sola pantalla
   *  de surtir; 'conductor' = panel de CHOFER con sus 3 pestañas (Surtir ·
   *  Camiones · Asistencia), igual que el rol fijo "conductor" pero para un
   *  rol personalizado (ej. "Chofer camión de combustible" con módulos extra
   *  de tanques/consumos para reportes). */
  panel_type?: 'modulos' | 'coordinador_qr' | 'chofer_combustible' | 'conductor';
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

// Módulo de Fabricación (MRP) — Fase 1: Control de mangueras hidráulicas (Taller).
export type HoseInstallStatus = 'en_proceso' | 'instalada';
// 'modificada_aprobada' = una manguera YA aprobada/pagada que se editó después
// (sigue contando como aprobada; el estatus solo deja constancia de que cambió).
export type HosePaymentStatus = 'pendiente' | 'en_proceso_autorizacion' | 'pagado' | 'modificada_aprobada';

export interface HoseService {
  id: string;
  code: string;
  machinery_id: string | null;
  /** Fabricación para una máquina/empresa EXTERNA (fuera de la flota). Si true,
   *  `machinery_id` va vacío y se usa `external_client` (texto libre). */
  is_external: boolean;
  /** Nombre de la máquina o empresa externa (solo cuando `is_external`). */
  external_client: string | null;
  description: string | null;
  service_date: string; // YYYY-MM-DD
  cost_usd: number;
  provider: string | null; // nombre del proveedor (espejo de supplier_id, para lista/reporte)
  /** Proveedor real (catálogo suppliers) al que se le paga; genera la cuenta por pagar. */
  supplier_id: string | null;
  /** Empresa a la que se le COBRA la manguera. LISTA PROPIA de mangueras
   *  (`hose_empresas`), NO el catálogo `companies`. Genera la cuenta por cobrar. */
  hose_empresa_id: string | null;
  /** @deprecated Antes la empresa a cobrar salía de `companies`; ahora es
   *  `hose_empresa_id` (lista propia). Se conserva por compatibilidad de datos. */
  company_id: string | null;
  /** Encargado (catálogo `encargados`) a quien se le cobra. Si el encargado tiene
   *  `cobrar=false` (CHELI), NO se genera cuenta por cobrar. */
  encargado_id: string | null;
  /** Margen de cobro (%). Monto por cobrar = cost_usd × (1 + sale_margin_pct/100). */
  sale_margin_pct: number;
  install_status: HoseInstallStatus;
  payment_status: HosePaymentStatus;
  created_by: string | null;
  created_at: string;
  approved_by: string | null;
  approved_at: string | null;
}

/** Encargado (persona a la que se le cobra una manguera). `cobrar=false` = no se
 *  le genera cuenta por cobrar (caso CHELI). Catálogo editable desde la app. */
export interface Encargado {
  id: string;
  name: string;
  cobrar: boolean;
  active: boolean;
  created_by: string | null;
  created_at: string;
}

/** Empresa a cobrar de MANGUERAS. Lista PROPIA del módulo (NO el catálogo
 *  `companies`): agregar una nueva NO ensucia el catálogo del resto del sistema. */
export interface HoseEmpresa {
  id: string;
  name: string;
  active: boolean;
  created_by: string | null;
  created_at: string;
}

// Módulo de Fabricación (MRP) — Fase 2: Centros de trabajo (áreas/máquinas/
// cuadrillas usados para planificar y costear la manufactura).
export type WorkCenterType = 'maquina' | 'area' | 'cuadrilla';

/** Un turno del centro de trabajo (jsonb `shifts`); se edita en una fase futura. */
export interface WorkCenterShift {
  label: string;
  start: string; // HH:mm
  end: string; // HH:mm
}

export interface WorkCenter {
  id: string;
  code: string;
  name: string;
  type: WorkCenterType;
  machinery_id: string | null; // solo aplica si type === 'maquina'
  capacity_units_per_hour: number | null;
  hourly_cost_labor: number;
  hourly_cost_machine: number;
  setup_minutes: number;
  cleanup_minutes: number;
  shifts: WorkCenterShift[];
  active: boolean;
  created_by: string | null;
  created_at: string;
}

// Módulo de Fabricación (MRP) — Fase 2: Rutas de producción (secuencia de pasos
// por centro de trabajo que sigue la materia prima hasta convertirse en
// producto terminado, con puntos de control de calidad opcionales por paso).
export type ProductionRouteStatus = 'borrador' | 'activa' | 'obsoleta';
export type RouteCheckpointType = 'foto' | 'medicion' | 'aprobacion';

/** Un paso de la ruta (array `steps`, jsonb en `production_routes`). */
export interface RouteStep {
  step_no: number;
  work_center_id: string | null;
  name: string;
  description?: string | null;
  standard_minutes: number;
  is_quality_checkpoint: boolean;
  /** Solo aplica si `is_quality_checkpoint` es true. */
  checkpoint_type?: RouteCheckpointType | null;
  /** Nota libre (p. ej. rango numérico esperado si `checkpoint_type` es 'medicion'). */
  checkpoint_spec?: string | null;
}

export interface ProductionRoute {
  id: string;
  product_item_id: string;
  bom_version_id: string | null;
  name: string;
  status: ProductionRouteStatus;
  steps: RouteStep[];
  created_by: string | null;
  created_at: string;
}

// Módulo de Fabricación (MRP) — Fase 2: Recetas de producción (Bill of Materials).
// Cada producto terminado (inventory_items.item_kind = 'producto_terminado') puede
// tener varias versiones de receta; solo UNA puede estar 'activa' a la vez (lo
// aplica un índice único parcial en la BD — ver supabase/fabricacion_maestros.sql).
export type BomVersionStatus = 'borrador' | 'activa' | 'obsoleta';

/** Producto sustituto de un componente (se guarda solo id + nombre snapshot,
 *  para no depender de un JOIN al mostrar la receta). */
export interface BomSubstitute {
  item_id: string;
  name: string;
}

/** Un renglón de la receta (array `components`, jsonb en `bom_versions`). */
export interface BomComponentLine {
  component_item_id: string;
  qty_per_output: number;
  unit: string | null;
  waste_pct: number; // % de merma (0-100), sobre la cantidad por unidad de salida
  substitutes: BomSubstitute[];
  notes: string | null;
}

export interface BomVersion {
  id: string;
  product_item_id: string;
  version_no: number;
  status: BomVersionStatus;
  output_qty: number;
  output_unit: string | null;
  components: BomComponentLine[];
  notes: string | null;
  created_by: string | null;
  created_at: string;
  activated_by: string | null;
  activated_at: string | null;
}

// Módulo de Fabricación (MRP) — Fase 3: Órdenes de fabricación (MO) y las
// órdenes de trabajo (WO) que se generan por cada paso de su ruta activa.
export type ManufacturingOrderStatus =
  | 'planificada'
  | 'reservada'
  | 'en_proceso'
  | 'pausada'
  | 'completada'
  | 'cerrada'
  | 'cancelada';
export type ManufacturingOrderTrigger = 'manual' | 'stock_minimo' | 'pedido_venta';

/** Renglón de componente requerido (array `components_snapshot`, jsonb en
 *  `manufacturing_orders`). Se calcula UNA vez desde la receta activa al crear
 *  la orden (qty_required = qty_per_output × qty_planned, ajustado por
 *  waste_pct) y no se recalcula si la receta cambia después. */
export interface ManufacturingOrderComponentSnapshot {
  component_item_id: string;
  name: string;
  qty_required: number;
  unit: string | null;
  waste_pct: number;
}

export interface ManufacturingOrder {
  id: string;
  code: string;
  product_item_id: string;
  bom_version_id: string | null;
  route_id: string | null;
  demand_trigger: ManufacturingOrderTrigger;
  qty_planned: number;
  qty_produced: number;
  uom: string | null;
  status: ManufacturingOrderStatus;
  components_snapshot: ManufacturingOrderComponentSnapshot[];
  planned_start: string | null;
  planned_end: string | null;
  started_at: string | null;
  finished_at: string | null;
  estimated_cost: number;
  real_cost: number;
  company_id: string | null;
  note: string | null;
  created_by: string | null;
  created_at: string;
  closed_by: string | null;
  closed_at: string | null;
}

export type WorkOrderStatus = 'pendiente' | 'en_proceso' | 'pausada' | 'completada' | 'cancelada';
export type WorkOrderQcResult = 'pendiente' | 'aprobado' | 'rechazado';

/** Orden de trabajo: un paso de la ruta de una MO, ejecutado en un centro de
 *  trabajo. Se crea una por cada paso al iniciar la producción de la MO. */
export interface WorkOrder {
  id: string;
  mo_id: string;
  wo_no: number;
  work_center_id: string | null;
  step_no: number | null;
  name: string;
  description: string | null;
  status: WorkOrderStatus;
  qty_planned: number;
  qty_completed: number;
  qty_scrap: number;
  assigned_operator_id: string | null;
  operator_name: string | null;
  operator_cedula: string | null;
  started_at: string | null;
  ended_at: string | null;
  paused_minutes: number;
  is_quality_checkpoint: boolean;
  qc_result: WorkOrderQcResult;
  qc_data: Record<string, any>;
  stop_reason: string | null;
  notes: string | null;
  created_at: string;
}

export type WoTimeLogEvent = 'inicio' | 'pausa' | 'reanudacion' | 'fin' | 'falla' | 'cantidad' | 'cancelada';

/** Bitácora de una orden de trabajo: un evento de ciclo de vida (inicio/pausa/
 *  reanudación/fin/falla/cancelada) o un avance de cantidad (`event:'cantidad'`,
 *  `qty_delta` con el valor registrado). La columna es NOT NULL en la base
 *  (ver supabase/fabricacion_ordenes.sql) — todo evento tiene un tipo. */
export interface WoTimeLog {
  id: string;
  wo_id: string;
  event: WoTimeLogEvent;
  qty_delta: number | null;
  note: string | null;
  created_by: string | null;
  operator_name: string | null;
  operator_cedula: string | null;
  created_at: string;
}

// ============================================================================
// MÓDULO DE ACARREO / TRANSPORTE (tablas haul_*) — alineado con schema.sql
// ============================================================================

/** Estado del viaje de acarreo (máquina de estados). */
export type HaulStatus =
  | 'programado' | 'en_carga' | 'en_transito' | 'en_descarga' | 'completado' | 'cancelado';

/** Cliente / proyecto emisor o receptor (interno o externo). */
export interface HaulClient {
  id: string;
  name: string;
  kind: 'interno' | 'externo';
  tax_id: string | null;
  contact: string | null;
  phone: string | null;
  active: boolean;
  created_at: string;
}

/** Ubicación predefinida (obra, almacén, taller, mina, pozo…). */
export interface HaulLocation {
  id: string;
  name: string;
  type: 'obra' | 'almacen' | 'taller' | 'mina' | 'pozo' | 'otro' | null;
  client_id: string | null;
  latitude: number | null;
  longitude: number | null;
  active: boolean;
  created_at: string;
}

/** Chuto / camión de arrastre. */
export interface HaulTruck {
  id: string;
  plate: string;
  brand: string | null;
  model: string | null;
  max_tow_ton: number | null;       // capacidad de arrastre (toneladas)
  odometer_km: number;              // km recorridos (para mantenimiento preventivo)
  maint_interval_km: number | null; // intervalo de mantenimiento (km)
  status: 'operativo' | 'taller' | 'inactivo';
  active: boolean;
  created_at: string;
}

/** Batea / lowboy / remolque. */
export interface HaulTrailer {
  id: string;
  plate: string;
  kind: 'batea' | 'lowboy' | 'remolque';
  axles: number | null;
  max_load_ton: number | null;      // capacidad de carga (toneladas)
  deck_len_m: number | null;
  deck_width_m: number | null;
  deck_height_m: number | null;
  status: 'operativo' | 'taller' | 'inactivo';
  active: boolean;
  created_at: string;
}

/** Chofer / operador de transporte pesado. */
export interface HaulDriver {
  id: string;
  user_id: string | null;           // vínculo opcional con un perfil (profiles)
  full_name: string;
  phone: string | null;
  license_number: string | null;
  license_class: string | null;
  license_expires_at: string | null; // vigencia de la licencia
  hazmat_expires_at: string | null;  // vigencia carga peligrosa
  availability: 'disponible' | 'en_ruta' | 'reposo' | 'suspendido';
  active: boolean;
  created_at: string;
}

/** Documento con vencimiento de un camión / remolque / chofer. */
export interface HaulDocument {
  id: string;
  owner_type: 'truck' | 'trailer' | 'driver';
  owner_id: string;
  doc_type: 'permiso_carga_pesada' | 'poliza' | 'revision_tecnica' | 'licencia' | 'otro';
  number: string | null;
  issued_at: string | null;
  expires_at: string | null;
  file_url: string | null;
  created_at: string;
}

/** Orden de acarreo (cabecera del viaje). */
export interface HaulOrder {
  id: string;
  folio: string;                    // AC-00001…
  status: HaulStatus;
  client_from_id: string | null;
  client_to_id: string | null;
  origin_location_id: string | null;
  dest_location_id: string | null;
  requested_departure_at: string | null;
  required_arrival_at: string | null;
  departed_at: string | null;       // salida real
  arrived_at: string | null;        // llegada real
  truck_id: string | null;
  trailer_id: string | null;
  driver_id: string | null;
  route_km_est: number | null;
  tolls_est: number | null;
  per_diem_advanced: number | null; // viáticos otorgados
  tariff_mode: 'km' | 'ton' | 'hora' | 'plana' | null;
  billed_amount: number | null;     // valorización congelada
  cancel_reason: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** Equipo (máquina) a trasladar dentro de una orden. */
export interface HaulOrderItem {
  id: string;
  order_id: string;
  machinery_id: string;
  weight_ton_snap: number | null;
  horometro_ini: number | null;
  horometro_fin: number | null;
  km_ini: number | null;
  km_fin: number | null;
}

/** Bitácora de cambios de estado de una orden. */
export interface HaulStatusEvent {
  id: string;
  order_id: string;
  from_status: string | null;
  to_status: string;
  at: string;
  by: string | null;
  notes: string | null;
}

/** Check-in de salida / check-out de recepción. */
export interface HaulCheck {
  id: string;
  order_id: string;
  kind: 'salida' | 'recepcion';
  fuel_level: string | null;
  tires_ok: boolean | null;
  straps_ok: boolean | null;
  checklist: Record<string, any> | null;
  signed_by_name: string | null;
  signature_url: string | null;
  at: string;
  by: string | null;
}

/** Foto de evidencia del viaje. */
export interface HaulPhoto {
  id: string;
  order_id: string;
  check_id: string | null;
  tag: 'antes' | 'despues' | 'amarre' | 'incidencia' | 'otro' | null;
  url: string;
  at: string;
  by: string | null;
}

/** Incidencia en ruta. */
export interface HaulIncident {
  id: string;
  order_id: string;
  type: 'mecanica' | 'clima' | 'permiso' | 'alcabala' | 'otro';
  description: string | null;
  photo_url: string | null;
  at: string;
  by: string | null;
}

/** Gasto del viaje (combustible / viático / peaje…). */
export interface HaulExpense {
  id: string;
  order_id: string;
  kind: 'combustible' | 'viatico_comida' | 'viatico_hospedaje' | 'peaje' | 'otro';
  amount: number;
  currency: string;
  liters: number | null;
  receipt_url: string | null;
  note: string | null;
  approved: boolean;
  at: string;
  by: string | null;
}

/** Tarifa de acarreo para servicio a terceros. */
export interface HaulTariff {
  id: string;
  mode: 'km' | 'ton' | 'hora' | 'plana';
  unit_price: number;
  client_id: string | null;
  route_from_id: string | null;
  route_to_id: string | null;
  active: boolean;
  created_at: string;
}

// ── Módulo de Geodesta (topografía) ─────────────────────────────────────────
/** Proyecto de levantamiento topográfico, ligado a una obra/edificio.
 *  Coordenadas de trabajo: UTM SIRGAS-REGVEN 19N (EPSG:2202). */
export interface GeodestaProject {
  id: string;
  name: string;
  edificio_id: string | null;
  referencia: string | null;
  coord_system: string;        // 'UTM19N'
  srid: number;                // 2202 (REGVEN / UTM 19N)
  gps_tolerance_m: number;     // rechazo de tomas GPS peores a esto (m)
  basemap_url: string | null;  // capa base personalizada (ortofoto): URL de tiles
  basemap_kind: string | null; // 'xyz' | 'tms'
  geoid_n: number;             // separación de geoide N (m): H ortométrica = h − N
  description: string | null;
  status: string;              // activo | cerrado | archivado
  created_by: string | null;
  created_at: string;
}

/** Punto de un levantamiento (N/E/Z + lat/lon, precisión, capa, foto). */
export interface GeodestaPoint {
  id: string;
  project_id: string;
  code: string | null;
  norte_m: number | null;
  este_m: number | null;
  cota_z: number | null;
  lat: number | null;
  lon: number | null;
  precision_m: number | null;
  source: 'gps' | 'manual' | 'import';
  layer: string | null;
  is_gcp: boolean;
  excluded: boolean;
  photo_url: string | null;
  description: string | null;
  created_by: string | null;
  created_at: string;
}

// ── CUENTAS POR PAGAR Y POR COBRAR (módulo `cuentas`) ────────────────────────
// Tablas creadas por `supabase/cuentas_por_pagar_y_cobrar.sql`.

/** De qué lado del dinero está la cuenta. */
export type CuentaTipo = 'por_pagar' | 'por_cobrar';
/** 'anulada' = registrada por error / sin efecto; NO suma en ningún total. */
export type CuentaEstado = 'pendiente' | 'pagada' | 'anulada';

/** Una deuda viva. La contraparte va SIEMPRE por id contra los maestros que ya
 *  existen — el nombre NO se copia en texto, se resuelve con el catálogo:
 *  'por_pagar' usa `supplier_id` (obligatorio, `company_id` null) y
 *  'por_cobrar' usa `company_id` (obligatorio, `supplier_id` null). Un CHECK en
 *  la base lo garantiza. El saldo se calcula en pantalla: `monto − Σ abonos`. */
export interface Cuenta {
  id: string;
  tipo: CuentaTipo;
  supplier_id: string | null;   // obligatorio si tipo = 'por_pagar'
  company_id: string | null;    // 'por_cobrar' del catálogo companies (o null si es por nombre)
  /** Nombre libre de la contraparte cuando NO viene del catálogo (p. ej. empresa
   *  de mangueras): una 'por_cobrar' vale con company_id O con contraparte. */
  contraparte: string | null;
  order_id: string | null;        // orden de compra que originó la deuda
  concepto: string;
  documento: string | null;       // Nº de factura / control / recibo
  factura_url: string | null;     // archivo de la factura (imagen/PDF) en storage
  prioridad: 'alta' | 'media' | 'baja' | null; // grado de prioridad (opcional)
  monto: number;
  moneda: string;
  fecha_emision: string;          // date
  fecha_vencimiento: string | null; // date — sin ella la cuenta nunca vence
  estado: CuentaEstado;
  nota: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  settled_by: string | null;
  settled_at: string | null;
}

/** Abono (pago parcial) contra una cuenta. */
export interface CuentaAbono {
  id: string;
  cuenta_id: string;
  monto: number;
  fecha: string;                  // date
  metodo: string | null;          // efectivo / transferencia / cheque…
  referencia: string | null;
  nota: string | null;
  created_by: string | null;
  created_at: string;
}
