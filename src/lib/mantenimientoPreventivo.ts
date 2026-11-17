// ============================================================================
// MANTENIMIENTO PREVENTIVO (Ciclo 250H, registro retroactivo, anulación sin
// DELETE y filtrado de alertas por permisos).
// ============================================================================
import { leerNumero } from './numeros';
import { HOROMETRO_UMBRAL_ALTA, HOROMETRO_UMBRAL_BAJA } from './horometroAlertas';

export const CICLO_MANTENIMIENTO_HORAS = HOROMETRO_UMBRAL_ALTA; // 250 h
export const UMBRAL_PROXIMO_HORAS = HOROMETRO_UMBRAL_BAJA; // 200 h

export interface ServicioPreventivoRow {
  id: string;
  machinery_id: string;
  horometro_servicio: number;
  horometro_anterior: number | null;
  fecha_servicio: string;
  notas: string | null;
  realizado_por: string | null;
  realizado_por_nombre: string | null;
  created_at: string;
  anulado: boolean;
  anulado_el: string | null;
  anulado_por: string | null;
  anulado_por_nombre: string | null;
  motivo_anulacion: string | null;
}

export interface ProyeccionCicloPreventivo {
  horometroBase: number;
  acumuladas: number;
  restante: number;
  proximoObjetivo: number;
  vencida: boolean;
  proxima: boolean;
}

/**
 * Calcula el ciclo 250H de forma retroactiva o al día:
 *   acumuladas = max(0, lastHorometro - horometroServicio)
 *   restante = 250 - acumuladas
 *   proximoObjetivo = horometroServicio + 250
 */
export function calcularCicloPreventivo(
  lastHorometro: number | null | undefined,
  horometroServicio: number,
  cicloHoras = CICLO_MANTENIMIENTO_HORAS,
): ProyeccionCicloPreventivo {
  const base = Math.round(horometroServicio * 100) / 100;
  const acumRaw = lastHorometro != null && Number.isFinite(lastHorometro)
    ? Math.max(0, lastHorometro - base)
    : 0;
  const acumuladas = Math.round(acumRaw * 100) / 100;
  const restante = Math.round((cicloHoras - acumuladas) * 100) / 100;
  const proximoObjetivo = Math.round((base + cicloHoras) * 100) / 100;
  return {
    horometroBase: base,
    acumuladas,
    restante,
    proximoObjetivo,
    vencida: acumuladas >= cicloHoras,
    proxima: acumuladas >= UMBRAL_PROXIMO_HORAS,
  };
}

/**
 * Valida el texto del horómetro de servicio (acepta punto o coma).
 * No permite 0, negativos ni lecturas superiores al horómetro actual de la máquina.
 */
export function validarHorometroServicio(
  texto: string,
  lastHorometro?: number | null,
): { ok: true; valor: number } | { ok: false; error: string } {
  const limpio = String(texto ?? '').trim();
  if (!limpio) return { ok: false, error: 'Escribe el horómetro exacto en el que se realizó el servicio.' };
  const n = leerNumero(limpio);
  if (n == null || !Number.isFinite(n) || n <= 0) {
    return { ok: false, error: 'El horómetro del servicio debe ser un número mayor que cero.' };
  }
  const valor = Math.round(n * 100) / 100;
  if (lastHorometro != null && Number.isFinite(lastHorometro) && valor > lastHorometro) {
    return {
      ok: false,
      error: `El horómetro del servicio (${valor}) no puede ser mayor que el horómetro actual de la máquina (${lastHorometro}).`,
    };
  }
  return { ok: true, valor };
}

/**
 * Tras anular un servicio, busca el servicio activo anterior más reciente
 * para restaurar `machinery.horometro_base` sin perder el historial.
 */
export function resolverBaseTrasAnulacion(
  servicios: ServicioPreventivoRow[],
  fallbackBase: number | null = null,
): number | null {
  const activos = servicios
    .filter((s) => !s.anulado)
    .sort((a, b) => {
      const fa = Date.parse(a.fecha_servicio || a.created_at) || 0;
      const fb = Date.parse(b.fecha_servicio || b.created_at) || 0;
      if (fb !== fa) return fb - fa;
      return (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0);
    });
  if (activos.length > 0) return activos[0].horometro_servicio;

  // Si todos fueron anulados, intentar restaurar el horometro_anterior del primer servicio registrado
  const ordenadosAsc = [...servicios].sort(
    (a, b) => (Date.parse(a.created_at) || 0) - (Date.parse(b.created_at) || 0)
  );
  const primeroConAnterior = ordenadosAsc.find((s) => s.horometro_anterior != null);
  if (primeroConAnterior?.horometro_anterior != null) {
    return primeroConAnterior.horometro_anterior;
  }
  return fallbackBase;
}

/** Identificación obligatoria de maquinaria: código + PLACA. */
export function etiquetaMaquinaConPlaca(code: string, plate?: string | null): string {
  const p = String(plate ?? '').trim();
  return `🚜 ${code} · Placa: ${p || 'Sin placa'}`;
}

export type PermisosNotificaciones = {
  uid: string | null;
  role: string | null;
  canMantenimiento: boolean;
  canServicio: boolean;
  canCompras: boolean;
  canInventario: boolean;
};

/**
 * Filtra notificaciones de la tabla `notifications` según los permisos del usuario
 * para no filtrar información de módulos restringidos.
 */
export function filtrarNotificacionesPorPermisos<T extends { type: string; recipient_id?: string | null }>(
  items: T[],
  perms: PermisosNotificaciones,
): T[] {
  if (perms.role === 'admin') return items;
  return items.filter((n) => {
    if (n.recipient_id && perms.uid && n.recipient_id === perms.uid) return true;
    const t = String(n.type || '').toLowerCase();
    if (t === 'requerimiento' || t === 'compra' || t === 'aclaratoria_tecnica') {
      return perms.canCompras;
    }
    if (t === 'solicitud_existencia') {
      return perms.canInventario;
    }
    if (t === 'mantenimiento_preventivo' || t === 'mantenimiento') {
      return perms.canMantenimiento || perms.canServicio;
    }
    return false;
  });
}
