// HISTORIAL DEL PRECIO POR JORNADA DE CADA MÁQUINA (14-sep-2026).
//
// El problema: una jornada SIN precio congelado (`machine_rounds.frozen_price`) se
// cobraba con el precio que la máquina tuviera HOY. Cambiar el precio de una máquina
// reescribía semanas ya trabajadas: la semana del 7 al 13-sep tenía 182 de 338
// jornadas de camiones sin precio congelado.
//
// El arreglo: la base anota cada cambio de `machinery.price_per_hour` en
// `machinery_precio_historial`, con la JORNADA desde la que rige (7am→7am, Caracas).
// Para una jornada sin precio congelado, el precio es el que estaba vigente ESE día:
//   · si hubo un cambio que empezó a regir DESPUÉS de esa jornada → el precio de antes
//     del primero de esos cambios;
//   · si no → el precio actual.
// Lo anterior al 14-sep no tiene historial, así que esas jornadas siguen igual que
// antes. No se modifica ninguna fila vieja: solo cambia cómo se LEE el precio.
//
// El precio congelado (`frozen_price` > 0) siempre manda sobre esto.
//
// ⭐ SIN IMPORTS, a propósito: se prueba sola (scripts/test-precio-historial.mjs).

export type CambioPrecio = {
  machinery_id: string;
  precio_anterior: number | string | null;
  /** Jornada ISO (AAAA-MM-DD) desde la que rige el precio nuevo. */
  vigente_desde: string;
  cambiado_at?: string | null;
};

type Tramo = { desde: string; anterior: number | null; at: string };

/** Cambios por máquina, del más viejo al más nuevo. */
export type HistorialPrecios = Map<string, Tramo[]>;

const num = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export function indexarHistorialPrecios(filas: CambioPrecio[] | null | undefined): HistorialPrecios {
  const idx: HistorialPrecios = new Map();
  (filas ?? []).forEach((f) => {
    if (!f?.machinery_id || !f.vigente_desde) return;
    const lista = idx.get(f.machinery_id) ?? [];
    lista.push({ desde: String(f.vigente_desde).slice(0, 10), anterior: num(f.precio_anterior), at: String(f.cambiado_at ?? '') });
    idx.set(f.machinery_id, lista);
  });
  // Dos cambios la misma jornada: el primero guarda el precio que regía ANTES de ese día.
  idx.forEach((lista) => lista.sort((a, b) => a.desde.localeCompare(b.desde) || a.at.localeCompare(b.at)));
  return idx;
}

/** Precio por jornada que regía para esa máquina en esa fecha de jornada. */
export function precioVigenteEn(
  hist: HistorialPrecios | null | undefined,
  machineryId: string | null | undefined,
  fechaJornada: string | null | undefined,
  precioActual: unknown,
): number | null {
  const actual = num(precioActual);
  if (!hist || !machineryId || !fechaJornada) return actual;
  const lista = hist.get(machineryId);
  if (!lista) return actual;
  const fecha = String(fechaJornada).slice(0, 10);
  for (const c of lista) if (fecha < c.desde) return c.anterior;
  return actual;
}

/** Precio de una jornada: el congelado si es válido (> 0); si no, el vigente ese día. */
export function precioEfectivoJornada(
  frozen: unknown,
  hist: HistorialPrecios | null | undefined,
  machineryId: string | null | undefined,
  fechaJornada: string | null | undefined,
  precioActual: unknown,
): number | null {
  const f = num(frozen);
  if (f != null && f > 0) return f;
  return precioVigenteEn(hist, machineryId, fechaJornada, precioActual);
}
