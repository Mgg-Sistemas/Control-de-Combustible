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
  inactivated_at: 'Retirada el', inactivated_by: 'Retirada por',
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
};

export const fieldLabel = (k: string) => FIELD_LABEL[k] ?? k;

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
