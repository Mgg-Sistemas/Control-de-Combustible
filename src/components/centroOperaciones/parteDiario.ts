// 🏭 CENTRO DE OPERACIONES — 📅 PARTE DIARIO: LAS CUENTAS DE LA PANTALLA (24-oct-2026).
//
// Lo que ParteDiarioTab, BloqueReporteGeneral y BloquePatios necesitan calcular y
// decir, sin React ni la base (se prueba solo en
// scripts/test-centro-operaciones-parte-diario.mjs):
//   · mover la jornada elegida un día (◀ ▶) sin pasarse de hoy;
//   · avisar cuando el Reporte General pegado es de OTRA jornada que la elegida (y
//     explicar el corte de las 07:00, que cierra la jornada anterior: R28);
//   · leer los viajes que trae cada renglón de patio guardado (la MISMA regla que
//     `guardarPatiosDelDia` usa para encontrarlos: `esRenglonDePatio` de la librería),
//     sumarlos y compararlos con el total del Reporte General: «Patios 250 · Reporte
//     238 · diferencia +12»; y decir APARTE lo anotado en ✍️ Carga libre hacia cada
//     patio (lote 5 A1), que no va en el campo ni se suma;
//   · un campo por patio: si el mismo nombre está «para todos los sitios» y en el sitio,
//     manda el del sitio (`patiosDeLista`, revisión final A#5).
//
// ⭐ LA DIFERENCIA NO ES UN ERROR: el conteo por patio es SUYO (solo ella sabe por qué
//    patio entró cada camión) y no tiene por qué coincidir con el reporte. Por eso
//    los textos son neutros: «diferencia», nunca «error» ni «descuadre».
//
// Vive junto a los componentes (no en src/lib) porque solo lo usa esta pantalla; el
// candado de aislamiento revisa igual todo lo que hay en esta carpeta.
import type { ItemLista, Movimiento } from '../../lib/centroOperaciones';
import { esRenglonDePatio } from '../../lib/centroOperaciones';
import { sumarDias } from '../../lib/centroOperacionesMateriales';
import { dmy } from '../../lib/centroOperacionesCarga';
import { cmpText, norm } from '../../lib/text';

const fmtEntero = (n: number): string => n.toLocaleString('es-VE', { maximumFractionDigits: 0 });
const fmtTon = (n: number): string => n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Viajes en número (entero, con miles «1.240»). */
export function textoViajesRg(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${fmtEntero(n)} ${n === 1 ? 'viaje' : 'viajes'}`;
}

/** Toneladas con dos decimales («4.321,09 t»). */
export function textoToneladasRg(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${fmtTon(n)} t`;
}

// ═══════════════════════════ La jornada elegida ═══════════════════════════

/**
 * La jornada `fecha` movida `dias` (◀ = −1, ▶ = +1). Nunca pasa de `hoy` (la jornada
 * de hoy: no hay nada que anotar en una que no ha empezado). Si `fecha` no es válida,
 * devuelve `hoy`.
 */
export function moverJornada(fecha: string, dias: number, hoy: string): string {
  const otra = sumarDias(fecha, dias);
  if (!otra) return hoy;
  return otra > hoy ? hoy : otra;
}

/** ¿Se puede avanzar un día? Solo si la jornada elegida es anterior a hoy. */
export const puedeAvanzar = (fecha: string, hoy: string): boolean => fecha < hoy;

/** Lo mínimo del Reporte General leído que estas cuentas usan. */
export type LecturaJornada = { fecha: string | null; horaCorte: string | null; jornada: string | null };

/** ¿El reporte pegado es de otra jornada que la elegida arriba? (sin jornada leída, no se sabe: false) */
export function jornadaDistinta(r: LecturaJornada | null | undefined, elegida: string): boolean {
  return !!r?.jornada && r.jornada !== elegida;
}

/**
 * El aviso cuando el reporte pegado es de OTRA jornada que la elegida, o null si es
 * la misma (o no se leyó la fecha). Guardar lo deja en la jornada DEL REPORTE.
 */
export function avisoJornadaDistinta(r: LecturaJornada | null | undefined, elegida: string): string | null {
  if (!jornadaDistinta(r, elegida)) return null;
  return `Este Reporte General es de la jornada del ${dmy(r!.jornada)}, y arriba está elegida la del ${dmy(elegida)}. `
    + `Al guardarlo queda en la jornada del ${dmy(r!.jornada)} (la del reporte).`;
}

/**
 * Cuando la fecha escrita en el reporte no es su jornada (corte a las 07:00 o antes),
 * la explicación; si no, null. R28: el corte de las 07:00 CIERRA la jornada anterior.
 */
export function notaCorteMadrugada(r: LecturaJornada | null | undefined): string | null {
  if (!r?.fecha || !r.jornada || r.fecha === r.jornada) return null;
  const hora = r.horaCorte ? ` a las ${r.horaCorte}` : '';
  return `El corte es del ${dmy(r.fecha)}${hora}: cierra la jornada del ${dmy(r.jornada)} (la jornada va de 7am a 7am).`;
}

// ═══════════════════════════ Entrada por patio ═══════════════════════════

/**
 * Los patios del sitio: su lista «terraza» activa, A→Z, UN campo por nombre.
 * ⭐ Si el mismo patio está «para todos los sitios» Y en el sitio (el índice único de
 *    cop_listas lo permite), queda el DEL SITIO: la regla de `itemDeLista` (lote 5 A8).
 *    Antes salían dos campos iguales y «Guardar patios» los rechazaba por repetidos
 *    (revisión final A#5). Las filas que apuntan al general escondido salen en «otros».
 */
export function patiosDeLista(listas: ItemLista[]): ItemLista[] {
  const activos = (listas ?? []).filter((i) => i && i.clase === 'terraza' && i.activo && String(i.nombre ?? '').trim());
  const porNombre = new Map<string, ItemLista>();
  for (const i of activos) {
    const k = norm(String(i.nombre).trim());
    const ya = porNombre.get(k);
    if (!ya || (ya.sitioId == null && i.sitioId != null)) porNombre.set(k, i);
  }
  return [...porNombre.values()].sort((a, b) => cmpText(a.nombre, b.nombre));
}

/**
 * ¿Es un renglón de patio? Es LA regla de la librería (`esRenglonDePatio` de
 * src/lib/centroOperaciones.ts, lote 5 A1), la misma que usa `guardarPatiosDelDia`: una
 * entrada pelada, sin unidad (ni escrita), placa, transportista, origen, material,
 * toneladas, m³, hora, capacidad ni observación. Se re-exporta acá porque el Reporte
 * completo la importa de este archivo.
 */
export { esRenglonDePatio };

/** Lo anotado en ✍️ Carga libre hacia UN patio ese día (no va en su campo ni se suma). */
export type CargaLibrePatio = { viajes: number; renglones: number };

export type PatiosGuardados = {
  /** Por id del patio: los viajes guardados ese día (null = ese patio no tiene renglón). */
  porPatio: Record<string, number | null>;
  /** Renglones sueltos de entrada (sin transportista ni unidad) cuyo destino no es un
   *  patio de la lista (uno desactivado, o anotado a mano en ✍️ Carga libre). No se
   *  suman: se muestran para que no se pierdan de vista. */
  otros: { destino: string; viajes: number }[];
  /** ⭐ Lote 5 A1: por id del patio, las ENTRADAS de ✍️ Carga libre hacia ese patio (con
   *  unidad, toneladas, transportista, nota…). NO son su conteo por patio: no van en el
   *  campo ni en la suma; se dicen aparte para que no se cuenten dos veces sin saberlo.
   *  Solo están los patios que tienen alguna. */
  cargaLibre: Record<string, CargaLibrePatio>;
};

/** El patio de la lista al que va un renglón: por el id del ítem y, si el renglón no lo
 *  trae, por el nombre (sin mayúsculas, tildes ni espacios), salvo que apunte a OTRO ítem. */
function patioDe(m: Movimiento, patios: ItemLista[]): ItemLista | undefined {
  const destino = String(m.destino ?? '').trim();
  const porId = m.destinoId ? patios.find((p) => p.id === m.destinoId) : undefined;
  if (porId) return porId;
  return patios.find((p) => norm(p.nombre) === norm(destino) && !(m.destinoId && m.destinoId !== p.id));
}

/**
 * Los viajes guardados por patio en el día (`movs` son los renglones de ESA jornada).
 * Se busca como `guardarPatiosDelDia`: por el id del ítem de la lista y, si el renglón
 * no lo trae, por el nombre (sin mayúsculas, tildes ni espacios). Si un patio tiene dos
 * o más renglones, se SUMAN: guardar deja lo escrito en el primero y los demás en 0.
 * Las entradas de ✍️ Carga libre hacia un patio van aparte, en `cargaLibre`.
 */
export function patiosGuardados(movs: Movimiento[], patios: ItemLista[]): PatiosGuardados {
  const porPatio: Record<string, number | null> = {};
  for (const p of patios) porPatio[p.id] = null;
  const otros = new Map<string, { destino: string; viajes: number }>();
  const cargaLibre: Record<string, CargaLibrePatio> = {};
  for (const m of movs ?? []) {
    if (!m) continue;
    const viajes = typeof m.viajes === 'number' && Number.isFinite(m.viajes) ? m.viajes : 0;
    if (!esRenglonDePatio(m)) {
      // Una entrada con detalle hacia un patio de la lista: es de ✍️ Carga libre.
      const patio = m.tipo === 'entrada' ? patioDe(m, patios) : undefined;
      if (patio) {
        const c = cargaLibre[patio.id] ?? (cargaLibre[patio.id] = { viajes: 0, renglones: 0 });
        c.viajes += viajes;
        c.renglones += 1;
      }
      continue;
    }
    const destino = String(m.destino ?? '').trim();
    const patio = patioDe(m, patios);
    if (patio) {
      porPatio[patio.id] = (porPatio[patio.id] ?? 0) + viajes;
    } else if (destino) {
      const k = norm(destino);
      const ya = otros.get(k);
      if (ya) ya.viajes += viajes; else otros.set(k, { destino, viajes });
    }
  }
  return { porPatio, otros: [...otros.values()].sort((a, b) => cmpText(a.destino, b.destino)), cargaLibre };
}

/**
 * La línea informativa debajo de un patio con entradas de ✍️ Carga libre (lote 5 A1):
 *   «+20 viajes de ✍️ Carga libre hacia este patio (no van en este campo ni se suman)».
 * Sin ninguna, null.
 */
export function textoCargaLibrePatio(c: CargaLibrePatio | null | undefined): string | null {
  if (!c || !(c.renglones > 0)) return null;
  if (c.viajes > 0) {
    const uno = c.viajes === 1;
    return `+${fmtEntero(c.viajes)} ${uno ? 'viaje' : 'viajes'} de ✍️ Carga libre hacia este patio `
      + `(${uno ? 'no va en este campo ni se suma' : 'no van en este campo ni se suman'})`;
  }
  const uno = c.renglones === 1;
  return `+${fmtEntero(c.renglones)} ${uno ? 'renglón' : 'renglones'} sin viajes de ✍️ Carga libre hacia este patio (no ${uno ? 'va' : 'van'} en este campo)`;
}

/** La suma de los viajes por patio (un campo vacío o con error no suma). */
export function sumaPatios(viajes: (number | null | undefined)[]): number {
  return (viajes ?? []).reduce<number>((s, v) => s + (typeof v === 'number' && Number.isFinite(v) ? v : 0), 0);
}

/**
 * La línea que compara su conteo por patio con el total del Reporte General del día:
 *   «Patios 250 · Reporte 238 · diferencia +12»
 *   «Patios 238 · Reporte 238 · sin diferencia»
 *   «Patios 250 · sin Reporte General de ese día» (o sin el total de viajes)
 * La diferencia es patios − reporte, con su signo.
 */
export function textoPatiosVsReporte(suma: number, totalReporte: number | null | undefined, hayReporte: boolean): string {
  const patios = `Patios ${fmtEntero(suma)}`;
  if (!hayReporte) return `${patios} · sin Reporte General de ese día`;
  if (totalReporte == null || !Number.isFinite(totalReporte)) return `${patios} · el Reporte General no trae el total de viajes`;
  const d = suma - totalReporte;
  const dif = d === 0 ? 'sin diferencia' : `diferencia ${d > 0 ? '+' : '−'}${fmtEntero(Math.abs(d))}`;
  return `${patios} · Reporte ${fmtEntero(totalReporte)} · ${dif}`;
}

// ═══════════════════════════ El sello ═══════════════════════════

/** «2026-10-24T23:05:00Z» → «24/10/2026 19:05» en hora de Caracas (UTC−4, sin horario de verano). */
export function fechaHoraCaracas(iso: string | null | undefined): string {
  const t = Date.parse(String(iso ?? ''));
  if (!Number.isFinite(t)) return '';
  const d = new Date(t - 4 * 3600 * 1000);
  const p2 = (n: number) => String(n).padStart(2, '0');
  return `${p2(d.getUTCDate())}/${p2(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`;
}

/** «Pegado por Ana el 24/10/2026 19:05 · reemplazado por Luis el 25/10/2026 07:10». */
export function textoSelloReporte(s: { creadoPor: string | null; creadoAt: string | null; editadoPor: string | null; editadoAt: string | null }): string {
  const parte = (verbo: string, quien: string | null, cuando: string | null) => {
    const q = String(quien ?? '').trim();
    const c = fechaHoraCaracas(cuando);
    if (!q && !c) return '';
    return [verbo, q ? `por ${q}` : '', c ? `el ${c}` : ''].filter(Boolean).join(' ');
  };
  const creado = parte('Pegado', s.creadoPor, s.creadoAt);
  // Reemplazado solo si de verdad cambió después (la base pone updated_at también al crear).
  const huboCambio = !!s.editadoAt && s.editadoAt !== s.creadoAt
    && Date.parse(s.editadoAt) - Date.parse(String(s.creadoAt ?? '')) > 1000;
  const editado = huboCambio ? parte('reemplazado', s.editadoPor, s.editadoAt) : '';
  return [creado, editado].filter(Boolean).join(' · ');
}
