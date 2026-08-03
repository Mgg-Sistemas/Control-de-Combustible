// ============================================================================
// ALERTAS POR HORÓMETRO (mantenimiento preventivo de maquinaria).
// ----------------------------------------------------------------------------
// horometro_base = lectura del horómetro en el último mantenimiento confirmado
// (ver supabase/horometro_alertas.sql). Horas acumuladas = last_horometro −
// horometro_base. Umbrales: 200h = BAJA · 220h = MEDIA · 250h = ALTA (máxima).
// Se usa igual en Mantenimiento de Maquinaria e Inspecciones (mismo banner).
// ============================================================================

export type HorometroNivel = 'BAJA' | 'MEDIA' | 'ALTA';

export interface HorometroAlerta {
  nivel: HorometroNivel;
  horas: number;      // horas acumuladas desde el último mantenimiento
  label: string;      // texto con emoji, ej. "🔴 ALTA (máxima)"
  color: string;       // color de acento para el nivel
}

export const HOROMETRO_UMBRAL_BAJA = 200;
export const HOROMETRO_UMBRAL_MEDIA = 220;
export const HOROMETRO_UMBRAL_ALTA = 250;

/** Horas acumuladas desde el último mantenimiento (o null si falta el horómetro). */
export function horasAcumuladas(lastHorometro: number | null | undefined, horometroBase: number | null | undefined): number | null {
  if (lastHorometro == null) return null;
  const base = horometroBase != null ? horometroBase : lastHorometro; // sin base registrada aún → 0 acumulado
  const h = lastHorometro - base;
  return h > 0 ? Math.round(h * 100) / 100 : 0;
}

/** Devuelve la alerta vigente (o null si no cruza ningún umbral). */
export function horometroAlertaDe(lastHorometro: number | null | undefined, horometroBase: number | null | undefined): HorometroAlerta | null {
  const horas = horasAcumuladas(lastHorometro, horometroBase);
  if (horas == null) return null;
  if (horas >= HOROMETRO_UMBRAL_ALTA) return { nivel: 'ALTA', horas, label: '🔴 ALTA (máxima)', color: '#B91C1C' };
  if (horas >= HOROMETRO_UMBRAL_MEDIA) return { nivel: 'MEDIA', horas, label: '🟠 MEDIA', color: '#B45309' };
  if (horas >= HOROMETRO_UMBRAL_BAJA) return { nivel: 'BAJA', horas, label: '🟡 BAJA', color: '#CA8A04' };
  return null;
}

/** Orden de severidad (mayor primero) para listar las alertas. */
export const NIVEL_RANK: Record<HorometroNivel, number> = { ALTA: 0, MEDIA: 1, BAJA: 2 };
