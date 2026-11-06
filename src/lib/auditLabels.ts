// ============================================================================
// AUDITORÍA — nombres legibles de las columnas y resumen de cambios.
//
// La bitácora guarda el nombre CRUDO de la columna (`en_espera`, `active`,
// `exit_date`). Mostrarlo tal cual no le dice nada a quien lee la pantalla, así
// que acá se traduce. Vive aparte de AuditScreen porque es lógica pura, sin
// React ni Supabase: así se puede probar (scripts/test-auditoria-labels.mjs).
// ============================================================================

// Lo que no esté en el mapa cae al nombre original: agregar una columna nueva a
// la BD nunca rompe la pantalla, solo se ve menos bonita hasta que se traduzca.
export const FIELD_LABEL: Record<string, string> = {
  // Estado de la máquina — lo más consultado: quién la retiró o la puso en espera.
  active: 'Activa', en_espera: 'En espera', operational: 'Operativa', qr_blocked: 'QR bloqueado',
  entry_date: 'Fecha de ingreso', exit_date: 'Fecha de salida', entry_at: 'Ingresó el',
  inactivated_at: 'Retirada el', inactivated_by: 'Retirada por', inactivated_reason: 'Motivo de retiro',
  reactivated_at: 'Reactivada el', reactivated_by: 'Reactivada por',
  // Identidad y ficha de la máquina / vehículo.
  code: 'Código', identifier: 'Identificador', serial: 'Serial', plate: 'Placa',
  tipo: 'Tipo', marca: 'Marca', modelo: 'Modelo', referencia: 'Referencia',
  company_id: 'Empresa', price_per_hour: 'Precio por hora', grupo: 'Grupo',
  encargado: 'Encargado', zona: 'Zona', location: 'Ubicación',
  photo_url: 'Foto', photo_serial_url: 'Foto del serial',
  // Jornadas.
  round_date: 'Fecha de jornada', round_no: 'Ronda', day_hours: 'Horas de día',
  night_hours: 'Horas de noche', hours_stopped: 'Horas parada', overtime_hours: 'Horas extra',
  jornada_shift: 'Turno', jornada_start_at: 'Jornada iniciada', jornada_marked_by: 'Jornada marcada por',
  inspector_day: 'Inspector de día', inspector_night: 'Inspector de noche',
  // Comunes a casi todas las tablas.
  status: 'Estado', notes: 'Notas', full_name: 'Nombre', cedula: 'Cédula', role: 'Rol',
  liters: 'Litros', created_at: 'Creado el', created_by: 'Creado por',
  recorded_by: 'Registrado por', closed_by: 'Cerrado por', approved_by: 'Aprobado por',
  // Compras, Requerimientos, Solicitudes, Cuentas por Pagar / Cobrar y Abonos.
  observaciones: 'Observaciones / Notas', nota: 'Nota', note: 'Nota técnica',
  concepto: 'Concepto', documento: 'Documento / Referencia', monto: 'Monto (USD)',
  moneda: 'Moneda', metodo: 'Método de pago', supplier_id: 'Proveedor / Beneficiario',
  contraparte: 'Contraparte / Beneficiario', inventory_requirement_id: 'Requerimiento vinculado',
  order_id: 'Orden de compra vinculada', cuenta_id: 'Cuenta vinculada',
  factura_url: 'Factura adjunta', presupuesto_files: 'Presupuestos adjuntos',
  alicuota_iva: 'Alícuota IVA (%)', iva_alicuota: 'Alícuota IVA (%)',
  prioridad: 'Prioridad', fecha_emision: 'Fecha de emisión', fecha_vencimiento: 'Fecha de vencimiento',
  fecha: 'Fecha', estado: 'Estado', settled_by: 'Liquidado / Pagado por',
  settled_at: 'Fecha de liquidación / pago', plan_pago: 'Plan de pago',
  condiciones_pago: 'Condiciones de pago', items: 'Renglones / Ítems', title: 'Título',
  solicitante_nombre: 'Solicitante', autorizado_nombre: 'Autorizado por',
  responsable_id: 'Responsable (ID)', responsable_nombre: 'Responsable',
  motorizado_user_id: 'Motorizado (ID)', motorizado_nombre: 'Motorizado / Comprador',
  empresa_pagadora_id: 'Empresa pagadora (ID)', empresa_pagadora_nombre: 'Empresa pagadora',
  requested_by: 'Solicitado por (ID)', requested_by_name: 'Solicitado por',
  decided_by: 'Decidido por (ID)', decided_by_name: 'Decidido por', decided_at: 'Fecha de decisión',
  decision_note: 'Nota de decisión', received_at: 'Recibido en almacén el', received_by_name: 'Recibido por',
  gerente_aprobado: 'Aprobado por Gerencia', gerente_aprobado_por: 'Aprobado por (Gerencia)',
  gerente_aprobado_at: 'Fecha aprobación gerencial', area: 'Área / Departamento',
  destino_tipo: 'Tipo de destino', destino_id: 'Destino (ID)',
  aclaratoria_motivo: 'Pregunta de aclaratoria', aclaratoria_respuesta: 'Respuesta de aclaratoria',
  attachment_url: 'Archivo adjunto', attachment_name: 'Nombre de adjunto',
  comprobante_url: 'URL del comprobante',
  // Vehículos, Maquinaria, Combustible, Viajes, Nómina, Inventario.
  machinery_id: 'Maquinaria', vehicle_id: 'Vehículo / Carro', tank_id: 'Tanque',
  employee_id: 'Empleado', brand: 'Marca', model: 'Modelo', year: 'Año', color: 'Color',
  driver: 'Chofer / Conductor', driver_operator: 'Chofer / Operador',
  operator_name: 'Operador', inspector_name: 'Inspector', cargo: 'Cargo',
  department: 'Departamento', phone: 'Teléfono', rif: 'RIF / Documento',
  address: 'Dirección', email: 'Correo electrónico', name: 'Nombre',
  descripcion: 'Descripción', sku: 'Código SKU', quantity: 'Cantidad', unit: 'Unidad',
  horometro: 'Horómetro', kilometraje: 'Kilometraje',
};

export const fieldLabel = (k: string) => FIELD_LABEL[k] ?? k;

/**
 * Convierte el contenido crudo de `nota` u `observaciones` (que puede traer bloques
 * codificados `[[HISTORIAL_COMPRA:...]]`, `[RECIBO_PAGO:...]`, `[EMPRESA:...]`, etc.)
 * en un resumen limpio y legible para el humano en Auditoría.
 */
export function formatAuditTextValue(raw: string): string {
  if (!raw || typeof raw !== 'string') return raw;
  if (
    !raw.includes('[[HISTORIAL_COMPRA:') &&
    !raw.includes('[RECIBO_PAGO:') &&
    !raw.includes('[FACTURA_') &&
    !raw.includes('[EMPRESA:') &&
    !raw.includes('[SIN_EMPRESA_REQ]') &&
    !raw.includes('[CONDICIONES_PAGO:') &&
    !raw.includes('[APROBADO_CXP:') &&
    !raw.includes('[ENVIADO_CXP:')
  ) {
    return raw;
  }

  const partes: string[] = [];
  const notaLimpia = raw
    .replace(/\[\[HISTORIAL_COMPRA:[\s\S]*?:FIN_HISTORIAL\]\]/gi, '')
    .replace(/\[\[HISTORIAL_COMPRA:[^\]]*\]\]/gi, '')
    .replace(/\[\[FORMATOS_ADJUNTOS:[\s\S]*?:FIN_FORMATOS\]\]/gi, '')
    .replace(/\[\[COTIZACIONES_COMPLETAS:[\s\S]*?:FIN_COTIZACIONES\]\]/gi, '')
    .replace(/\[RECIBO_PAGO:[^\]]*\]/gi, '')
    .replace(/\[FACTURA_CUENTA:[^\]]*\]/gi, '')
    .replace(/\[FACTURA_REQ:[^\]]*\]/gi, '')
    .replace(/\[APROBADO_CXP:[^\]]*\]/gi, '')
    .replace(/\[ENVIADO_CXP:[^\]]*\]/gi, '')
    .replace(/\[PRESUPUESTO_CUENTA:[^\]]*\]/gi, '')
    .replace(/\[IVA_CUENTA:[^\]]*\]/gi, '')
    .replace(/\[COMPROBANTE_ABONO:[^\]]*\]/gi, '')
    .replace(/\[EMPRESA:[^\]]*\]/gi, '')
    .replace(/\[SIN_EMPRESA_REQ\]/gi, '')
    .replace(/\[CONVERTIDA_REQ\]/gi, '')
    .replace(/\[CONDICIONES_PAGO:[^\]]*\]/gi, '')
    .replace(/\[DESPACHO_ALMACEN:[^\]]*\]/gi, '')
    .replace(/Generada automáticamente desde Requerimiento REQ-\d+\. El monto se sincroniza con los ítems aprobados\.?/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (notaLimpia) partes.push(`Nota: "${notaLimpia}"`);

  const empMatch = raw.match(/\[EMPRESA:([^:\]]+)(?::([^\]]*))?\]/i);
  if (empMatch) {
    partes.push(`Empresa: ${empMatch[2]?.trim() || empMatch[1]?.trim()}`);
  } else if (/\[SIN_EMPRESA_REQ\]/i.test(raw)) {
    partes.push('Empresa: Sin empresa asignada');
  }

  const condMatch = raw.match(/\[CONDICIONES_PAGO:\s*([^\]]*)\]/i);
  if (condMatch && condMatch[1]?.trim()) {
    partes.push(`Condiciones: ${condMatch[1].trim()}`);
  }

  const recMatch = raw.match(/\[RECIBO_PAGO:\s*Url:\s*([^|]*)\|\s*Tipo:\s*([^|]*)\|\s*Nombre:\s*([^|]*)\|\s*Fecha:\s*([^|]*)\|\s*Ref:\s*([^|]*)\|\s*SubidoPor:\s*([^|\]]*)/i);
  if (recMatch) {
    const ref = recMatch[5]?.trim();
    const por = recMatch[6]?.trim();
    partes.push(`Comprobante de pago${por ? ` (subido por ${por})` : ''}${ref ? ` Ref: ${ref}` : ''}`);
  } else if (/\[RECIBO_PAGO:/i.test(raw)) {
    const porAlt = raw.match(/(?:SubidoPor|Por):\s*([^|\]]+)/i)?.[1]?.trim();
    partes.push(`Comprobante de pago${porAlt ? ` (subido por ${porAlt})` : ''}`);
  }

  const facMatch = raw.match(/\[FACTURA_(?:CUENTA|REQ):\s*Nro:\s*([^|]*)\|\s*Empresa:\s*([^|]*)\|\s*Fecha:\s*([^|]*)\|\s*Url:\s*([^|]*)\|\s*Tipo:\s*([^|]*)\|\s*Nombre:\s*([^|]*)\|\s*SubidaPor:\s*([^|]*)/i);
  if (facMatch) {
    const nro = facMatch[1]?.trim();
    const por = facMatch[7]?.trim();
    partes.push(`Factura ${nro || 'S/N'}${por ? ` (subida por ${por})` : ''}`);
  }

  const apMatch = raw.match(/\[APROBADO_CXP:\s*Estado:\s*([^|]*)\|\s*Por:\s*([^|]*)/i);
  if (apMatch) {
    partes.push(`Aprobación CXP: ${apMatch[1]?.trim()}${apMatch[2]?.trim() ? ` por ${apMatch[2].trim()}` : ''}`);
  }

  return partes.length > 0 ? partes.join(' · ') : '∅ (sin nota)';
}

// La tarjeta de la lista es de una línea: más de dos campos no caben legibles.
// El desglose completo sigue estando a un toque, en el detalle.
export const RESUMEN_MAX_CAMPOS = 2;

/**
 * Resumen de UNA LÍNEA de los cambios de una fila de la bitácora, para leerlos en
 * la lista sin abrir fila por fila (ej. "En espera: no → sí").
 *
 * `fmt` es el formateador de valores de la pantalla (fmtVal): se recibe como
 * parámetro para que este archivo no dependa de zonas horarias ni de React.
 * Solo aplica a UPDATE — un INSERT/DELETE trae la fila entera, no un antes/después.
 */
export function changesSummary(
  action: string,
  changes: Record<string, any> | null | undefined,
  fmt: (v: any) => string,
): string | null {
  if (action !== 'UPDATE' || !changes) return null;
  const entries = Object.entries(changes);
  if (entries.length === 0) return null;
  const partes = entries.slice(0, RESUMEN_MAX_CAMPOS).map(
    ([k, v]) => `${fieldLabel(k)}: ${fmt((v as any)?.de)} → ${fmt((v as any)?.a)}`,
  );
  const resto = entries.length - partes.length;
  return partes.join('  ·  ') + (resto > 0 ? `  ·  +${resto} más` : '');
}
