// 🏭 CENTRO DE OPERACIONES — GUARDAR EL REPORTE GENERAL DEL 📅 PARTE DIARIO (lote 5, 25-oct-2026).
//
// Las reglas que decide el bloque «1 · 📊 Reporte General» antes de guardar, para que la
// pantalla solo pinte:
//   · ¿Se reconoció un Reporte General? Con la fecha sola NO (lote 5 B13): cualquier
//     mensaje de WhatsApp con una fecha se leía y dejaba «guardar» — y reemplazar uno
//     bueno por uno vacío. Hacen falta los totales o alguna fila de empresa o de frente.
//   · El instante REAL de un corte (R28): un corte a las 07:00 o antes cierra la jornada
//     anterior, así que «el de las 07:00 de la jornada del 24» es el 25 a las 07:00.
//   · La confirmación de REEMPLAZO dice qué hay guardado y qué entra (corte, viajes, t), y
//     advierte si el nuevo es de un corte ANTERIOR al guardado (lote 5 A9: un mensaje viejo
//     de las 19:00 no pisa sin decirlo al de las 07:00, que cierra el día).
//   · Una jornada posterior a hoy no existe todavía (lote 5 B7): no se guarda.
//
// PURA: sin React ni Supabase. `scripts/test-centro-operaciones-parte-diario.mjs` la prueba.
import { fechaValida } from '../../lib/centroOperaciones';
import { sumarDias } from '../../lib/centroOperacionesMateriales';
import type { ReporteGeneral } from '../../lib/centroOperacionesReporteGeneral';
import { textoToneladasRg, textoViajesRg } from './parteDiario';

/** La hora de corte de la madrugada que todavía es de la jornada anterior (R28). */
const HORA_CIERRE = '07:00';

const dmy = (iso: string): string => {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};

/** ¿Lo leído es un Reporte General? Hacen falta los totales o alguna fila (la fecha sola no). */
export function reporteReconocido(r: Pick<ReporteGeneral, 'viajesTotal' | 'toneladasTotal' | 'empresas' | 'frentes'> | null | undefined): boolean {
  if (!r) return false;
  const num = (n: unknown) => typeof n === 'number' && Number.isFinite(n);
  return num(r.viajesTotal) || num(r.toneladasTotal) || (r.empresas?.length ?? 0) > 0 || (r.frentes?.length ?? 0) > 0;
}

/**
 * El instante real del corte, «AAAA-MM-DD HH:MM»: la jornada y la hora; si la hora es
 * las 07:00 o antes, el día siguiente (la madrugada que cierra la jornada, R28). Sin
 * hora o sin fecha válida: null.
 */
export function instanteDelCorte(jornada: string | null | undefined, horaCorte: string | null | undefined): string | null {
  const j = String(jornada ?? '').trim();
  const h = String(horaCorte ?? '').trim();
  if (!fechaValida(j) || !/^\d{2}:\d{2}$/.test(h)) return null;
  const dia = h <= HORA_CIERRE ? sumarDias(j, 1) : j;
  return dia ? `${dia} ${h}` : null;
}

/** «corte 07:00 del 25/10/2026» (el día real del corte); sin hora: «jornada del 24/10/2026». */
function textoCorte(jornada: string, horaCorte: string | null): string {
  const inst = instanteDelCorte(jornada, horaCorte);
  if (!inst) return fechaValida(jornada) ? `jornada del ${dmy(jornada)} (sin hora de corte)` : 'sin fecha';
  const [dia, hora] = inst.split(' ');
  return `corte ${hora} del ${dmy(dia)}`;
}

type Cifras = { horaCorte: string | null; viajesTotal: number | null; toneladasTotal: number | null };

/**
 * El mensaje de la confirmación de reemplazo: lo guardado y lo nuevo, cada uno con su
 * corte y sus cifras, y la advertencia si el nuevo es de un corte ANTERIOR.
 */
export function textoReemplazo(guardado: Cifras & { fecha: string }, nuevo: Cifras & { jornada: string }): string {
  // Sin cifra, «— viajes» y «— t» (que se lea qué es lo que falta).
  const viajes = (n: number | null) => (typeof n === 'number' && Number.isFinite(n) ? textoViajesRg(n) : '— viajes');
  const ton = (n: number | null) => (typeof n === 'number' && Number.isFinite(n) ? textoToneladasRg(n) : '— t');
  const linea = (j: string, c: Cifras) => `${textoCorte(j, c.horaCorte)} · ${viajes(c.viajesTotal)} · ${ton(c.toneladasTotal)}`;
  const partes = [`Guardado: ${linea(guardado.fecha, guardado)}`, `Nuevo: ${linea(nuevo.jornada, nuevo)}`];
  const antes = instanteDelCorte(guardado.fecha, guardado.horaCorte);
  const ahora = instanteDelCorte(nuevo.jornada, nuevo.horaCorte);
  if (antes && ahora && ahora < antes) {
    partes.push('⚠️ El nuevo es de un corte ANTERIOR al guardado: el guardado cierra más tarde el día.');
  }
  return partes.join('\n');
}

/** ¿La jornada es posterior a hoy? (todavía no existe: no se anota en ella) */
export function jornadaFutura(jornada: string | null | undefined, hoy: string): boolean {
  const j = String(jornada ?? '').trim();
  return !!fechaValida(j) && !!fechaValida(hoy) && j > hoy;
}
