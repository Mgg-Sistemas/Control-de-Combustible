// Estado (activo/inactivo/suspendido[/otro]) de empleados y aliados: color y tono
// de <Badge> compartidos entre EmpleadosScreen, AliadosScreen y AsistenciaScreen
// para no duplicar el mismo mapa en cada pantalla.
export const EMPLOYEE_STATUS_COLOR: Record<string, string> = {
  activo: '#16A34A',
  inactivo: '#DC2626',
  suspendido: '#F59E0B',
  otro: '#6B7280',
};

export type StatusTone = 'success' | 'warning' | 'danger' | 'muted';

/** Tono para <Badge> según el estado del empleado/aliado. */
export function employeeStatusTone(status?: string | null): StatusTone {
  switch ((status || '').toLowerCase()) {
    case 'activo':
      return 'success';
    case 'suspendido':
      return 'warning';
    case 'inactivo':
      return 'danger';
    default:
      return 'muted'; // "otro" u otro valor no contemplado
  }
}

// Estado (borrador/aprobada/pagada) de los períodos de pago compartido entre
// NominaScreen y PagoPersonalScreen (antes cada una definía su propio STATUS_META
// idéntico).
export type PagoEstado = 'borrador' | 'aprobada' | 'pagada';

export const PAGO_STATUS_META: Record<PagoEstado, { label: string; color: string; tone: StatusTone }> = {
  borrador: { label: '📝 Borrador', color: '#F59E0B', tone: 'warning' },
  aprobada: { label: '✅ Aprobada', color: '#2563EB', tone: 'muted' },
  pagada: { label: '💵 Pagada', color: '#16A34A', tone: 'success' },
};

export const PAGO_STATUS_LABEL: Record<PagoEstado, string> = {
  borrador: PAGO_STATUS_META.borrador.label,
  aprobada: PAGO_STATUS_META.aprobada.label,
  pagada: PAGO_STATUS_META.pagada.label,
};
