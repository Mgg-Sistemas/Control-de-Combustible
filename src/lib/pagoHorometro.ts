// 💰 CONTROL DE HORÓMETROS — EL PAGO POR HORÓMETRO DE TRABAJO (02-oct-2026).
//
// PEDIDO DEL CLIENTE, textual: «crear otro apartado como el de control de las
// jornadas, pero para los horómetros, para colocar los precios y toda esa
// información (…) la idea es que los dos existan y que puedan usar los dos sin
// que choque (…) poder asignar los precios también en un rango en específico
// (…) y con eso tener también un reporte aparte de los pagos que corresponde en
// base a los horómetros».
//
// ⭐ LOS DOS CONTROLES NO SE TOCAN. Este módulo:
//    · LEE las horas de `lecturas_horometro_trabajo` (final − inicial por turno);
//    · tiene SUS PROPIOS precios (`horometro_precios`: precio por HORA de
//      horómetro, con «desde» y, si se blinda, «hasta»);
//    · NO lee ni escribe `machine_rounds`, ni `price_per_hour`, ni los cierres de
//      Control de jornadas. Lo que paga la jornada sigue exactamente igual.
//
// ⭐ REGLAS DE HORAS (supuestos del 02-oct, a confirmar por el cliente):
//    · Día SIN lectura → 0 h, sin alerta: no todas las máquinas trabajan todos
//      los días, y para ver «hubo jornada pero no hay lectura» está el reporte
//      ⚙️ Horómetro vs jornada. Acá NO se cae a las horas de la jornada: mezclar
//      las dos fuentes es justo lo que se quiere evitar.
//    · Lectura INVÁLIDA (la base la marcó: salto mayor a 12,5 h, final menor que
//      inicial…) → el DÍA vale 0 h, CON alerta, hasta que se corrija. Igual que
//      el reporte ⚙️ Horómetro, que ese día no da horas.
//    · Lectura INCOMPLETA (inicial sin final, o al revés) → ese turno vale 0 h,
//      con alerta; el otro turno, si está completo, sí cuenta.
//    · Hay horas pero NO hay precio vigente ese día → monto 0, con alerta.
//
// ⭐ EL PRECIO DE CADA DÍA ES EL QUE REGÍA ESE DÍA. Una semana puede cruzar dos
//    precios: cada día se multiplica por el suyo, así cambiar el precio hoy no
//    reescribe lo ya trabajado (mismo principio que las tarifas de viajes).
//
// TODO ESTE ARCHIVO ES PURO (su único import es la regla compartida del agrupado
// por encargado, `ordenMaquinas.ts`): `scripts/test-pago-horometro.mjs` lo prueba
// solo. Lo que toca la red vive en `pagoHorometroDb.ts`.
import { agruparMaquinas, ordenarMaquinas } from './ordenMaquinas';

// ── PRECIOS ─────────────────────────────────────────────────────────────────

/** Una fila de `horometro_precios`: precio por HORA de horómetro de una máquina. */
export type PrecioHorometro = {
  id: string;
  machinery_id: string;
  precio_hora: number | string;
  /** Jornada (AAAA-MM-DD) desde la que rige. */
  desde: string;
  /** Si viene, el precio está BLINDADO a ese rango y manda sobre el abierto. */
  hasta?: string | null;
  nota?: string | null;
  created_at?: string | null;
  created_by_nombre?: string | null;
  anulada_at?: string | null;
  anulada_motivo?: string | null;
};

const dia = (v: unknown): string => String(v ?? '').slice(0, 10);
const num = (v: unknown): number => {
  const n = Number(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};
const r2 = (n: number): number => Math.round(n * 100) / 100;
/**
 * Si el precio por hora viene de dividir una jornada entera de 12 h a 2 decimales
 * (ej. $83,33 de $1.000/12, o $41,67 de $500/12), usa la fracción exacta (J/12)
 * para que no se pierdan 3 o 4 centavos diarios frente al cálculo por jornada.
 */
export function precioHoraEfectivo(precioHora: number): number {
  const jEntera = Math.round(precioHora * 12);
  if (jEntera > 0 && Math.abs(r2(jEntera / 12) - r2(precioHora)) < 0.001) {
    return jEntera / 12;
  }
  return precioHora;
}
const limpio = (v: unknown): string => String(v ?? '').replace(/\s+/g, ' ').trim();
const esFecha = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

/**
 * El precio por hora que rige para una máquina en una fecha, o null.
 *
 *  1. No cuentan las anuladas ni las de precio 0 o menos.
 *  2. Tiene que haber empezado (`desde` ≤ fecha) y, si está blindada, no haber
 *     terminado (fecha ≤ `hasta`).
 *  3. Una BLINDADA (con `hasta`) manda sobre una abierta: se puso a propósito
 *     para ese rango. Entre dos blindadas, la última que se guardó.
 *  4. Entre abiertas, la de `desde` más reciente; con el mismo `desde`, la última
 *     que se guardó.
 */
export function precioHoraEn(
  precios: readonly PrecioHorometro[] | null | undefined,
  machineryId: string,
  fecha: string,
): PrecioHorometro | null {
  const f = dia(fecha);
  if (!machineryId || !esFecha(f)) return null;
  let mejor: PrecioHorometro | null = null;
  let clave: [number, string, string] = [0, '', ''];
  for (const p of precios ?? []) {
    if (!p || p.machinery_id !== machineryId || p.anulada_at || !(num(p.precio_hora) > 0)) continue;
    const desde = dia(p.desde);
    if (!esFecha(desde) || desde > f) continue;
    const hasta = p.hasta ? dia(p.hasta) : '';
    if (hasta && f > hasta) continue;
    const k: [number, string, string] = [hasta ? 1 : 0, hasta ? '' : desde, String(p.created_at ?? '')];
    if (!mejor || k[0] > clave[0] || (k[0] === clave[0] && (k[1] > clave[1] || (k[1] === clave[1] && k[2] > clave[2])))) {
      mejor = p; clave = k;
    }
  }
  return mejor;
}

/** Revisa un precio antes de guardarlo. Devuelve el motivo del rechazo o null. */
export function validarPrecioHorometro(p: { precio: unknown; desde: unknown; hasta?: unknown }): string | null {
  const precio = num(p.precio);
  if (!(precio > 0)) return 'Escribe un precio por hora mayor que 0.';
  if (precio > 100000) return 'Ese precio por hora es demasiado alto: revisa el número.';
  const desde = dia(p.desde);
  if (!esFecha(desde)) return 'Elige la fecha desde la que rige.';
  const hasta = p.hasta ? dia(p.hasta) : '';
  if (hasta && !esFecha(hasta)) return 'La fecha «hasta» no es válida.';
  if (hasta && hasta < desde) return 'La fecha «hasta» no puede ser anterior a «desde».';
  return null;
}

/** «$12,50/h desde 01/10/2026» o «… del 01/10 al 15/10 (blindado)», para listas. */
export function textoPrecioHorometro(p: PrecioHorometro): string {
  const d = (iso: string) => dia(iso).split('-').reverse().join('/');
  const base = `${usd(num(p.precio_hora))}/h`;
  return p.hasta ? `${base} del ${d(p.desde)} al ${d(p.hasta)} · 🔒 blindado` : `${base} desde el ${d(p.desde)}`;
}

// ── HORAS ───────────────────────────────────────────────────────────────────

/** Lo mínimo de una lectura (es un subconjunto de `LecturaTrabajo`). */
export type LecturaDia = {
  machineryId: string;
  roundDate: string;
  shift: 'day' | 'night';
  inicial: number | null;
  final: number | null;
  valida: boolean;
  motivoInvalida?: string | null;
};

// ── 🧾 AJUSTES «SOLO PARA CONTROL DE HORÓMETROS» ────────────────────────────
//
// Pedido del cliente (02-oct-2026, mismo día): «poder acomodar el horómetro para
// el reporte de horómetros (…) tener la opción de que ese horómetro que yo cargue
// desde control de horómetros me salga SOLO para el reporte de horómetros, o que
// me modifique el que cargó el inspector en ese día en específico».
//
// Son DOS destinos, y el usuario elige:
//   · 🧾 SOLO PARA HORÓMETROS → un AJUSTE en `horometro_ajustes`. Lo que cargó el
//     inspector queda INTACTO en su tabla; este módulo (pantalla y reporte de
//     pago) usa el ajuste EN LUGAR de la lectura de ese turno. El comparativo
//     «Horómetro vs jornada» sigue mostrando lo que cargó el inspector.
//   · ✎ CAMBIAR LA LECTURA DEL INSPECTOR → la corrección de Control de siempre
//     (`lecturas_horometro_trabajo`, origen 'control'): cambia en todas partes.
//
// Un ajuste no se edita ni se borra: se ANULA (y vuelve a mandar la lectura del
// inspector) o se reemplaza por otro. Siempre con motivo.

/** Una fila de `horometro_ajustes`: máquina + día + turno. */
export type AjusteHorometro = {
  id: string;
  machinery_id: string;
  round_date: string;
  shift: 'day' | 'night';
  inicial: number | string;
  final: number | string;
  motivo: string;
  created_at?: string | null;
  created_by_nombre?: string | null;
  anulada_at?: string | null;
  anulada_motivo?: string | null;
};

/** Revisa un ajuste antes de guardarlo. Devuelve el motivo del rechazo o null. */
export function validarAjusteHorometro(a: { inicial: unknown; final: unknown; motivo: unknown }): string | null {
  if (!limpio(a.motivo)) return 'Escribe el motivo del ajuste: queda grabado con tu nombre.';
  const vacio = (v: unknown) => String(v ?? '').trim() === '';
  if (vacio(a.inicial) || vacio(a.final)) return 'Escribe el horómetro inicial y el final.';
  const i = Number(String(a.inicial).replace(',', '.'));
  const f = Number(String(a.final).replace(',', '.'));
  if (!Number.isFinite(i) || i < 0) return 'El horómetro inicial no es un número válido (0 o más).';
  if (!Number.isFinite(f) || f < 0) return 'El horómetro final no es un número válido (0 o más).';
  if (f < i) return `El final (${f}) no puede ser menor al inicial (${i}).`;
  if (f - i > 24) return 'Ese ajuste da más de 24 horas en un turno: revisa los números.';
  return null;
}

/** Una lectura tal como la usa ESTE módulo: la del inspector, o su ajuste. */
export type LecturaEfectiva = LecturaDia & { ajustada?: boolean; motivoAjuste?: string };

/**
 * Las lecturas que valen para Control de horómetros: donde hay un ajuste ACTIVO
 * para esa máquina, día y turno, MANDA EL AJUSTE; donde no, la del inspector.
 * Un ajuste de un turno que el inspector nunca cargó también entra (así se puede
 * pagar un día en que no hubo lectura). No muta nada de lo que entra.
 */
export function lecturasEfectivas(
  lecturas: readonly LecturaDia[] | null | undefined,
  ajustes: readonly AjusteHorometro[] | null | undefined,
): LecturaEfectiva[] {
  const k = (m: string, f: string, s: string) => `${m}|${dia(f)}|${s === 'night' ? 'night' : 'day'}`;
  const activos = new Map<string, AjusteHorometro>();
  for (const a of ajustes ?? []) {
    if (!a || a.anulada_at) continue;
    const key = k(a.machinery_id, a.round_date, a.shift);
    const prev = activos.get(key);
    if (!prev || String(a.created_at ?? '') > String(prev.created_at ?? '')) activos.set(key, a);
  }
  const deAjuste = (a: AjusteHorometro): LecturaEfectiva => ({
    machineryId: a.machinery_id, roundDate: dia(a.round_date), shift: a.shift === 'night' ? 'night' : 'day',
    inicial: num(a.inicial), final: num(a.final), valida: true, motivoInvalida: null,
    ajustada: true, motivoAjuste: limpio(a.motivo),
  });
  const usados = new Set<string>();
  const out: LecturaEfectiva[] = [];
  for (const l of lecturas ?? []) {
    if (!l) continue;
    const key = k(l.machineryId, l.roundDate, l.shift);
    const a = activos.get(key);
    if (a) { usados.add(key); out.push(deAjuste(a)); } else out.push(l);
  }
  for (const [key, a] of activos) if (!usados.has(key)) out.push(deAjuste(a));
  return out;
}

export type EstadoDiaHorometro = 'ok' | 'sin_lectura' | 'incompleta' | 'invalida';

export type HorasDia = {
  horas: number;
  estado: EstadoDiaHorometro;
  /** Por qué no cuenta (o qué turno quedó incompleto). '' si todo bien. */
  detalle: string;
  inicial: number | null;
  final: number | null;
  /** 🧾 Algún turno de ese día viene de un ajuste de Control de horómetros. */
  ajustado: boolean;
  /** El motivo del ajuste (los de los dos turnos, sin repetir). */
  motivoAjuste: string;
};

/** Las horas de horómetro de UNA máquina en UN día, con las reglas de la cabecera. */
export function horasDelDia(lecturas: readonly LecturaEfectiva[] | null | undefined): HorasDia {
  const ls = (lecturas ?? []).filter(Boolean)
    .sort((a, b) => (a.shift === b.shift ? 0 : a.shift === 'day' ? -1 : 1));
  const inicial = ls.find((l) => l.inicial != null)?.inicial ?? null;
  const final = [...ls].reverse().find((l) => l.final != null)?.final ?? null;
  const ajustado = ls.some((l) => l.ajustada === true);
  const motivos: string[] = [];
  for (const l of ls) { const m = limpio(l.motivoAjuste); if (l.ajustada && m && !motivos.includes(m)) motivos.push(m); }
  const aj = { ajustado, motivoAjuste: motivos.join(' · ') };
  if (ls.length === 0) return { horas: 0, estado: 'sin_lectura', detalle: '', inicial: null, final: null, ...aj };
  const malas = ls.filter((l) => !l.valida);
  if (malas.length) {
    const razones: string[] = [];
    for (const l of malas) { const m = limpio(l.motivoInvalida); if (m && !razones.includes(m)) razones.push(m); }
    return { horas: 0, estado: 'invalida', detalle: razones.join(' · ') || 'lectura inválida', inicial, final, ...aj };
  }
  let horas = 0;
  const incompletos: string[] = [];
  for (const l of ls) {
    if (l.inicial != null && l.final != null) horas += Math.max(0, num(l.final) - num(l.inicial));
    else if (l.inicial != null || l.final != null) {
      incompletos.push(`${l.shift === 'night' ? 'noche' : 'día'}: falta el ${l.final == null ? 'final' : 'inicial'}`);
    }
  }
  horas = r2(horas);
  if (incompletos.length) return { horas, estado: 'incompleta', detalle: incompletos.join(' · '), inicial, final, ...aj };
  return { horas, estado: horas > 0 || inicial != null ? 'ok' : 'sin_lectura', detalle: '', inicial, final, ...aj };
}

// ── EL PAGO ─────────────────────────────────────────────────────────────────

export type MaquinaPago = {
  id: string; code: string;
  /** Placa, o serial si no tiene (la columna «Serial / Placa» de siempre). */
  placa: string; empresa: string;
  clasificacion: string; marca: string; modelo: string;
  // 26-oct-2026: columnas a elegir y agrupado por encargado. Opcionales porque la
  // FOTO de un cierre viejo no las trae: salen con guion / «SIN ENCARGADO».
  /** Responsable de la máquina (`machinery.encargado`). */
  encargado?: string | null;
  /** La placa sola (sin caer al serial). */
  placaSola?: string;
  /** El serial solo. */
  serial?: string;
};

export type DiaPago = HorasDia & {
  fecha: string;
  /** Precio por hora que regía ESE día (null = sin precio configurado). */
  precio: number | null;
  monto: number;
  /** Hay horas y no hay precio: no se puede pagar hasta ponerlo. */
  sinPrecio: boolean;
  /** 🔒 El día pertenece a un cierre: sus números están CONGELADOS (ver cierres). */
  cerrado: boolean;
  /** 🔁 Ese día hubo CAMBIO DE HORÓMETRO registrado (10-oct-2026). */
  cambio: boolean;
  /** Las ± horas reconocidas por el cambio (ya incluidas en `horas`). */
  horasCambio: number;
  /** El motivo del cambio (los de ese día, sin repetir). */
  motivoCambio: string;
};

export type FilaPagoHorometro = {
  maquina: MaquinaPago;
  dias: DiaPago[];
  horas: number;
  monto: number;
  /** Días que piden atención: inválidas, incompletas o con horas sin precio. */
  alertas: number;
  /** El precio vigente el último día del rango (el que se muestra en la fila). */
  precioVigente: number | null;
  /** Si dentro del rango rigió más de un precio (la fila lo avisa). */
  variosPrecios: boolean;
};

/** Los días del rango, ambos inclusive. Tope de 92 para que un rango mal puesto
 *  no arme miles de columnas. */
export function diasDelRango(desde: string, hasta: string): string[] {
  const a = dia(desde), b = dia(hasta);
  if (!esFecha(a) || !esFecha(b) || b < a) return [];
  const out: string[] = [];
  const d = new Date(`${a}T12:00:00Z`);
  while (out.length < 92) {
    const iso = d.toISOString().slice(0, 10);
    if (iso > b) break;
    out.push(iso);
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

// ── 🔒 CIERRES CON HISTÓRICO ────────────────────────────────────────────────
//
// Pedido del cliente (02-oct-2026): «coloca los cierres con histórico (como
// "Cerrar control" de jornadas)».
//
// Cerrar un rango GUARDA UNA FOTO de lo que se pagaba ese día: cada máquina con
// sus días, horas, precio y monto. Desde ese momento los días del cierre se leen
// DE LA FOTO, no de los datos vivos: cambiar después un precio, una lectura o un
// ajuste NO mueve lo ya cerrado (el mismo principio del precio congelado de
// Control de jornadas). Reabrir = anular el cierre, con motivo: los días vuelven
// a calcularse en vivo. Un cierre no se edita ni se borra.

/** Una fila de `horometro_cierres`. `detalle` es la foto (las filas del pago). */
export type CierreHorometro = {
  id: string;
  desde: string;
  hasta: string;
  total_horas: number | string;
  total_monto: number | string;
  maquinas: number;
  detalle: FilaPagoHorometro[] | null;
  nota?: string | null;
  created_at?: string | null;
  created_by_nombre?: string | null;
  anulada_at?: string | null;
  anulada_motivo?: string | null;
};

/** El cierre ACTIVO que cubre esa fecha, o null. */
export function cierreQueCubre(cierres: readonly CierreHorometro[] | null | undefined, fecha: string): CierreHorometro | null {
  const f = dia(fecha);
  for (const c of cierres ?? []) {
    if (!c || c.anulada_at) continue;
    if (dia(c.desde) <= f && f <= dia(c.hasta)) return c;
  }
  return null;
}

/** Los cierres ACTIVOS que tocan el rango [desde, hasta]. Dos cierres no pueden
 *  pisarse: un día no puede estar congelado con dos fotos distintas. */
export function cierresSolapados(cierres: readonly CierreHorometro[] | null | undefined, desde: string, hasta: string): CierreHorometro[] {
  const a = dia(desde), b = dia(hasta);
  return (cierres ?? []).filter((c) => !!c && !c.anulada_at && dia(c.desde) <= b && a <= dia(c.hasta));
}

/** Revisa un cierre antes de guardarlo. Devuelve el motivo del rechazo o null. */
export function validarCierreHorometro(
  c: { desde: string; hasta: string; filas: readonly FilaPagoHorometro[] },
  cierres: readonly CierreHorometro[] | null | undefined,
): string | null {
  const a = dia(c.desde), b = dia(c.hasta);
  if (!esFecha(a) || !esFecha(b) || b < a) return 'El rango del cierre no es válido.';
  if (diasDelRango(a, b).length >= 92) return 'Un cierre no puede pasar de 92 días: ciérralo por partes.';
  const pisa = cierresSolapados(cierres, a, b);
  if (pisa.length) {
    const d = (iso: string) => dia(iso).split('-').reverse().join('/');
    return `Ese rango ya tiene días cerrados (cierre del ${d(pisa[0].desde)} al ${d(pisa[0].hasta)}). Ajusta las fechas o reabre ese cierre.`;
  }
  if (!(c.filas ?? []).some((f) => f.dias.some((x) => x.estado !== 'sin_lectura'))) return 'No hay nada que cerrar en ese rango: ninguna máquina tiene lecturas.';
  return null;
}

// ── 🔁 CAMBIO DE HORÓMETRO FÍSICO (10-oct-2026) ─────────────────────────────
//
// Pedido del cliente: «cuando un horómetro está malo se coloca uno nuevo que
// comience de 0; poder sumarle o restarle horas si durante el cambio se perdió
// una hora; que el acumulado siga su secuencia; y que el reporte diga que hubo
// cambio de horómetro, no "menor que la última lectura válida"».
//
// El registro vive en `horometro_cambios` (tabla propia, anulable con motivo).
// La LECTURA de ese día la escribe Control con `reinicio = true` (la base ya
// sabía saltarse la regla de retroceso con esa marca): el aparato nuevo sienta
// base y la secuencia sigue. Las ± horas reconocidas se suman al PAGO de ese
// día con el precio que regía, y los papeles lo dicen con su 🔁 y su motivo.

/** Una fila de `horometro_cambios`. */
export type CambioHorometro = {
  id: string;
  machinery_id: string;
  round_date: string;
  shift: string;
  /** Lo último que marcó el aparato VIEJO al quitarlo (informativo). */
  lectura_vieja: number | string | null;
  /** Con qué arranca el NUEVO (casi siempre 0). */
  lectura_nueva: number | string | null;
  /** ± horas reconocidas por el cambio (perdidas o de más). */
  horas_ajuste: number | string;
  motivo: string;
  foto_vieja_url?: string | null;
  foto_nueva_url?: string | null;
  created_at?: string | null;
  created_by_nombre?: string | null;
  anulada_at?: string | null;
  anulada_motivo?: string | null;
};

/** Los cambios ACTIVOS agrupados por `machineryId|fecha` (las ± horas se suman). */
export function cambiosPorClave(cambios: readonly CambioHorometro[] | null | undefined): Map<string, { horas: number; motivos: string[] }> {
  const m = new Map<string, { horas: number; motivos: string[] }>();
  for (const c of cambios ?? []) {
    if (!c || c.anulada_at) continue;
    const k = `${c.machinery_id}|${dia(c.round_date)}`;
    const prev = m.get(k) ?? { horas: 0, motivos: [] };
    prev.horas = r2(prev.horas + num(c.horas_ajuste));
    const mo = limpio(c.motivo);
    if (mo && !prev.motivos.includes(mo)) prev.motivos.push(mo);
    m.set(k, prev);
  }
  return m;
}

/** Texto de las ± horas reconocidas: «+1,5 h» / «−2 h» / '' si es 0. */
export function horasCambioTexto(h: number): string {
  const n = r2(num(h));
  if (!n) return '';
  return `${n > 0 ? '+' : '−'}${fmtHoras(Math.abs(n))} h`;
}

/** Revisa un cambio de horómetro antes de guardarlo. Devuelve el rechazo o null. */
export function validarCambioHorometro(c: {
  nuevaInicial: number | null; nuevaFinal: number | null; horasAjuste: number; motivo: string;
}): string | null {
  if (!limpio(c.motivo)) return 'El motivo es obligatorio: di por qué se cambió el horómetro.';
  if (c.nuevaInicial == null || !Number.isFinite(num(c.nuevaInicial)) || num(c.nuevaInicial) < 0) {
    return 'Falta con cuánto arranca el horómetro NUEVO (casi siempre 0).';
  }
  if (c.nuevaFinal != null) {
    if (num(c.nuevaFinal) < num(c.nuevaInicial)) return 'El final del aparato nuevo no puede ser menor que su inicial.';
    if (num(c.nuevaFinal) - num(c.nuevaInicial) > 24) return 'Entre inicial y final del nuevo hay más de 24 h: la base lo marcaría inválido. Revisa los números.';
  }
  if (!Number.isFinite(num(c.horasAjuste)) || Math.abs(num(c.horasAjuste)) > 24) {
    return 'Las horas a reconocer no pueden pasar de 24 (en más o en menos).';
  }
  return null;
}

const diaVacio = (fecha: string, cerrado: boolean): DiaPago => ({
  horas: 0, estado: 'sin_lectura', detalle: '', inicial: null, final: null, ajustado: false, motivoAjuste: '',
  fecha, precio: null, monto: 0, sinPrecio: false, cerrado,
  cambio: false, horasCambio: 0, motivoCambio: '',
});

/** Un día leído de la foto de un cierre: se normaliza por si el JSON vino a medias. */
function diaDeFoto(d: any, fecha: string): DiaPago {
  const estado: EstadoDiaHorometro = d?.estado === 'ok' || d?.estado === 'incompleta' || d?.estado === 'invalida' ? d.estado : 'sin_lectura';
  return {
    horas: r2(num(d?.horas)), estado, detalle: limpio(d?.detalle),
    inicial: d?.inicial == null ? null : num(d.inicial), final: d?.final == null ? null : num(d.final),
    ajustado: d?.ajustado === true, motivoAjuste: limpio(d?.motivoAjuste),
    fecha, precio: d?.precio == null ? null : num(d.precio), monto: r2(num(d?.monto)),
    sinPrecio: d?.sinPrecio === true, cerrado: true,
    cambio: d?.cambio === true, horasCambio: r2(num(d?.horasCambio)), motivoCambio: limpio(d?.motivoCambio),
  };
}

/**
 * Arma el pago por horómetro del rango: una fila por máquina, con sus días.
 *
 * Entran las máquinas que tienen AL MENOS UNA lectura (o ajuste, o día cerrado
 * con horas) en el rango — una máquina sin nada no tiene qué pagar por horómetro
 * y solo haría ruido. `incluirSinLectura` suma además las que se le pasen (las
 * máquinas operativas del catálogo), para poder verlas y ponerles precio.
 *
 * Los días de un cierre ACTIVO salen de su foto (`cerrado: true`); el resto se
 * calcula en vivo. Los días cerrados no cuentan como alerta: ya no hay nada que
 * arreglarles.
 */
export function filasPagoHorometro(opts: {
  maquinas: readonly MaquinaPago[];
  lecturas: readonly LecturaDia[];
  precios: readonly PrecioHorometro[];
  desde: string;
  hasta: string;
  /** 🧾 Ajustes «solo para Control de horómetros»: mandan sobre la lectura. */
  ajustes?: readonly AjusteHorometro[] | null;
  /** 🔒 Cierres: sus días se leen de la foto, no de los datos vivos. */
  cierres?: readonly CierreHorometro[] | null;
  /** 🔁 Cambios de horómetro: sus ± horas se reconocen en el pago del día. */
  cambios?: readonly CambioHorometro[] | null;
  /** Máquinas a listar AUNQUE no tengan lecturas en el rango. */
  incluirSinLectura?: ReadonlySet<string> | null;
}): FilaPagoHorometro[] {
  const dias = diasDelRango(opts.desde, opts.hasta);
  if (dias.length === 0) return [];
  const primero = dias[0], ultimo = dias[dias.length - 1];
  const enRango = new Set(dias);

  // 🔒 Qué días están cerrados, y la foto de cada máquina en esos días.
  const cerrados = new Set<string>();
  const foto = new Map<string, DiaPago>();
  const maqDeFoto = new Map<string, MaquinaPago>();
  for (const c of opts.cierres ?? []) {
    if (!c || c.anulada_at) continue;
    const a = dia(c.desde) < primero ? primero : dia(c.desde);
    const b = dia(c.hasta) > ultimo ? ultimo : dia(c.hasta);
    for (const f of diasDelRango(a, b)) cerrados.add(f);
    for (const fila of c.detalle ?? []) {
      if (!fila?.maquina?.id) continue;
      for (const d of fila.dias ?? []) {
        const f = dia(d?.fecha);
        if (!enRango.has(f) || f < dia(c.desde) || f > dia(c.hasta)) continue;
        foto.set(`${fila.maquina.id}|${f}`, diaDeFoto(d, f));
        if (!maqDeFoto.has(fila.maquina.id)) maqDeFoto.set(fila.maquina.id, fila.maquina);
      }
    }
  }

  // 🔁 Los cambios de horómetro activos, por máquina y día.
  const porCambio = cambiosPorClave(opts.cambios);
  const porClave = new Map<string, LecturaEfectiva[]>();
  for (const l of lecturasEfectivas(opts.lecturas, opts.ajustes)) {
    if (!l) continue;
    const f = dia(l.roundDate);
    if (!enRango.has(f) || cerrados.has(f)) continue; // lo cerrado no se recalcula
    const k = `${l.machineryId}|${f}`;
    const arr = porClave.get(k); if (arr) arr.push(l); else porClave.set(k, [l]);
  }

  // Las máquinas del catálogo y, por si alguna ya no está, las de las fotos.
  const todas = new Map<string, MaquinaPago>();
  for (const m of opts.maquinas ?? []) if (m?.id) todas.set(m.id, m);
  for (const [id, m] of maqDeFoto) if (!todas.has(id)) todas.set(id, m);

  const filas: FilaPagoHorometro[] = [];
  for (const m of todas.values()) {
    let horas = 0, monto = 0, alertas = 0, conAlgo = false;
    const preciosVistos = new Set<number>();
    const ds: DiaPago[] = dias.map((fecha) => {
      let d: DiaPago;
      if (cerrados.has(fecha)) {
        d = foto.get(`${m.id}|${fecha}`) ?? diaVacio(fecha, true);
      } else {
        const h = horasDelDia(porClave.get(`${m.id}|${fecha}`));
        const p = precioHoraEn(opts.precios, m.id, fecha);
        const precio = p ? num(p.precio_hora) : null;
        // 🔁 Las ± horas del cambio de horómetro entran al día ANTES del precio:
        //    se pagan con el que regía ese día, y nunca dejan el día en negativo.
        const cc = porCambio.get(`${m.id}|${fecha}`);
        const horasDia = cc ? Math.max(0, r2(h.horas + cc.horas)) : h.horas;
        const sinPrecio = horasDia > 0 && precio == null;
        const tarifaEfectiva = precio != null ? precioHoraEfectivo(precio) : null;
        d = {
          ...h, horas: horasDia, fecha, precio, monto: tarifaEfectiva != null ? r2(horasDia * tarifaEfectiva) : 0, sinPrecio, cerrado: false,
          cambio: !!cc, horasCambio: cc ? cc.horas : 0, motivoCambio: cc ? cc.motivos.join(' · ') : '',
        };
        if (h.estado === 'invalida' || h.estado === 'incompleta' || sinPrecio) alertas++;
      }
      if (d.estado !== 'sin_lectura' || d.cambio) conAlgo = true;
      if (d.horas > 0 && d.precio != null) preciosVistos.add(d.precio);
      horas += d.horas; monto += d.monto;
      return d;
    });
    if (!conAlgo && !opts.incluirSinLectura?.has(m.id)) continue;
    const ult = precioHoraEn(opts.precios, m.id, ultimo);
    filas.push({
      maquina: m, dias: ds, horas: r2(horas), monto: r2(monto), alertas,
      precioVigente: ult ? num(ult.precio_hora) : null,
      variosPrecios: preciosVistos.size > 1,
    });
  }
  const cmp = (a: string, b: string) => a.localeCompare(b, 'es', { sensitivity: 'base', numeric: true });
  return filas.sort((a, b) => cmp(a.maquina.empresa, b.maquina.empresa) || cmp(a.maquina.code, b.maquina.code) || cmp(a.maquina.placa, b.maquina.placa));
}

/** Las filas de la FOTO de un cierre, para su PDF del histórico. Los totales se
 *  recalculan de los días guardados (no se confía en un número suelto).
 *
 *  `fichas` (opcional, 26-oct-2026): la ficha de HOY por id de máquina. Solo
 *  completa los datos de la ficha que la foto no trae (encargado, placa sola,
 *  serial): son datos del catálogo, no del pago; horas y montos no se tocan. */
export function filasDeCierre(c: CierreHorometro | null | undefined, fichas?: ReadonlyMap<string, MaquinaPago> | null): FilaPagoHorometro[] {
  const out: FilaPagoHorometro[] = [];
  for (const fila of c?.detalle ?? []) {
    if (!fila?.maquina?.id) continue;
    const ds = (fila.dias ?? []).map((d: any) => diaDeFoto(d, dia(d?.fecha)));
    const precios = new Set(ds.filter((d) => d.horas > 0 && d.precio != null).map((d) => d.precio as number));
    const ficha = fichas?.get(fila.maquina.id);
    const maquina: MaquinaPago = ficha
      ? {
        ...fila.maquina,
        encargado: fila.maquina.encargado ?? ficha.encargado ?? null,
        placaSola: fila.maquina.placaSola ?? ficha.placaSola,
        serial: fila.maquina.serial ?? ficha.serial,
      }
      : fila.maquina;
    out.push({
      maquina, dias: ds,
      horas: r2(ds.reduce((s, d) => s + d.horas, 0)), monto: r2(ds.reduce((s, d) => s + d.monto, 0)),
      alertas: 0, precioVigente: precios.size === 1 ? [...precios][0] : null, variosPrecios: precios.size > 1,
    });
  }
  return out;
}

export type TotalPagoHorometro = { maquinas: number; horas: number; monto: number; alertas: number; sinPrecio: number };

export function totalPagoHorometro(filas: readonly FilaPagoHorometro[] | null | undefined): TotalPagoHorometro {
  const t: TotalPagoHorometro = { maquinas: 0, horas: 0, monto: 0, alertas: 0, sinPrecio: 0 };
  for (const f of filas ?? []) {
    t.maquinas++; t.horas += f.horas; t.monto += f.monto; t.alertas += f.alertas;
    if (f.dias.some((d) => d.sinPrecio)) t.sinPrecio++;
  }
  t.horas = r2(t.horas); t.monto = r2(t.monto);
  return t;
}

/** Las filas agrupadas por empresa, con su subtotal, A→Z. */
export function pagoPorEmpresa(filas: readonly FilaPagoHorometro[] | null | undefined): { empresa: string; filas: FilaPagoHorometro[]; total: TotalPagoHorometro }[] {
  const m = new Map<string, FilaPagoHorometro[]>();
  for (const f of filas ?? []) { const a = m.get(f.maquina.empresa) ?? []; a.push(f); m.set(f.maquina.empresa, a); }
  return Array.from(m, ([empresa, fs]) => ({ empresa, filas: fs, total: totalPagoHorometro(fs) }))
    .sort((a, b) => a.empresa.localeCompare(b.empresa, 'es', { sensitivity: 'base' }));
}

// ── 👤 AGRUPAR POR EMPRESA O POR ENCARGADO (26-oct-2026) ────────────────────
// Pedido: «sacar el reporte de control de horómetro, ya sea por encargado también».
// AGRUPAR NO ES FILTRAR: entran las mismas máquinas y el TOTAL no cambia; solo
// cambia cómo se parten los bloques y sus subtotales. El agrupado por encargado
// se delega en `ordenMaquinas.ts` (la única regla: dos grafías del mismo nombre
// son UNA persona, y «SIN ENCARGADO» va de último).

export type AgruparPagoHorometro = 'empresa' | 'encargado';

export type GrupoPagoHorometro = { key: string; label: string; filas: FilaPagoHorometro[]; total: TotalPagoHorometro };

export function gruposPagoHorometro(filas: readonly FilaPagoHorometro[] | null | undefined, por: AgruparPagoHorometro): GrupoPagoHorometro[] {
  if (por !== 'encargado') return pagoPorEmpresa(filas).map((e) => ({ key: e.empresa, label: e.empresa, filas: e.filas, total: e.total }));
  const envueltas = (filas ?? []).map((fila) => ({ id: fila.maquina.id, code: fila.maquina.code, encargado: fila.maquina.encargado ?? null, fila }));
  return agruparMaquinas(ordenarMaquinas(envueltas, 'encargado'), 'encargado').map((g) => {
    const fs = g.items.map((x) => x.fila);
    return { key: g.key, label: g.label, filas: fs, total: totalPagoHorometro(fs) };
  });
}

// ── EL PAPEL ────────────────────────────────────────────────────────────────

const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const usd = (n: number) => `$${Number(n || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const fmtHoras = (n: number | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('es-VE', { maximumFractionDigits: 2 }));
const dmy = (iso: string) => dia(iso).split('-').reverse().join('/');

/**
 * 🖨️ Qué se oculta en el PDF (mismo criterio que los demás reportes de
 * maquinaria): cada pastilla ENCENDIDA quita su dato, y lo oculto NO DEJA RASTRO
 * — ni columna en blanco, ni «(oculto)», ni una nota que lo delate.
 */
export type OpcionesPagoHorometro = {
  sinMarca: boolean; sinModelo: boolean; sinPlaca: boolean;
  /** Sin el nombre de las empresas: ni la columna ni el cuadro por empresa. */
  sinEmpresas: boolean;
  /** Sin la columna del precio por hora. */
  sinPrecio: boolean;
  /**
   * Sin la columna «Control $/jornada» (19-oct-2026): el precio por JORNADA de
   * 12 h ya colocado en Control de maquinaria. Es SOLO REFERENCIA — no entra en
   * el monto (el pago sigue saliendo del precio por hora propio del módulo) y
   * solo se pinta si el panel pasa el mapa de referencia.
   */
  sinPrecioControl: boolean;
  /** Sin el cuadro resumen por empresa. */
  sinResumen: boolean;
  /** Sin el listado máquina por máquina. */
  sinListado: boolean;
  /** Sin el detalle día por día (nace oculto: es largo). */
  sinDias: boolean;
  /** Sin las columnas Inicio y Fin del horómetro en el detalle por día. */
  sinInicioFin: boolean;
  /** Sin la lista de días que piden atención. */
  sinAlertas: boolean;
  // 26-oct-2026: columnas de la ficha a elegir (NACEN APAGADAS) y el agrupado.
  /** Sin la columna «Placa» (la placa sola, aparte de «Serial / Placa»). */
  sinPlacaSola: boolean;
  /** Sin la columna «Serial» (el serial solo). */
  sinSerial: boolean;
  /** Sin la columna «Encargado» (responsable de la máquina). */
  sinEncargado: boolean;
  /** 👤 Cómo se parten los bloques del papel y de la pantalla: por empresa (hoy) o por encargado. */
  agruparPor: AgruparPagoHorometro;
};

/** Las opciones de sí/no (las pastillas); `agruparPor` va aparte. */
export type PastillaPagoHorometro = Exclude<keyof OpcionesPagoHorometro, 'agruparPor'>;

export const OPCIONES_PAGO_HOROMETRO: OpcionesPagoHorometro = {
  sinMarca: false, sinModelo: false, sinPlaca: false, sinEmpresas: false, sinPrecio: false,
  sinPrecioControl: false,
  sinResumen: false, sinListado: false, sinDias: true, sinInicioFin: false, sinAlertas: false,
  sinPlacaSola: true, sinSerial: true, sinEncargado: true,
  agruparPor: 'empresa',
};

/** 📋 Las COLUMNAS DE LA FICHA que se pueden poner o quitar (en pantalla van como
 *  pastillas positivas: encendida = sale). Las nuevas nacen apagadas. */
export const COLUMNAS_PAGO_HOROMETRO: { key: PastillaPagoHorometro; chip: string; archivo: string }[] = [
  { key: 'sinMarca', chip: '🏷️ Marca', archivo: 'sin marca' },
  { key: 'sinModelo', chip: '🏷️ Modelo', archivo: 'sin modelo' },
  { key: 'sinPlaca', chip: '🔢 Serial / Placa', archivo: 'sin placa' },
  { key: 'sinPlacaSola', chip: '🚗 Placa', archivo: 'sin placa sola' },
  { key: 'sinSerial', chip: '🔩 Serial', archivo: 'sin serial' },
  { key: 'sinEmpresas', chip: '🏢 Empresa', archivo: 'sin empresas' },
  { key: 'sinEncargado', chip: '👤 Encargado', archivo: 'sin encargado' },
];

/** 🖨️ Lo demás que se oculta en el PDF (encendida = NO sale). */
export const PASTILLAS_PAGO_HOROMETRO: { key: PastillaPagoHorometro; chip: string; archivo: string }[] = [
  { key: 'sinPrecio', chip: '🚫 Precio por hora', archivo: 'sin precio' },
  { key: 'sinPrecioControl', chip: '🚫 Precio en Control', archivo: 'sin precio control' },
  { key: 'sinResumen', chip: '🚫 Resumen por empresa', archivo: 'sin resumen' },
  { key: 'sinListado', chip: '🚫 Listado por máquina', archivo: 'sin listado' },
  { key: 'sinDias', chip: '🚫 Detalle día por día', archivo: 'sin dias' },
  { key: 'sinInicioFin', chip: '🚫 Inicio y Fin del horómetro', archivo: 'sin inicio-fin' },
  { key: 'sinAlertas', chip: '🚫 Días por revisar', archivo: 'sin alertas' },
];

/** Lo que se cambió respecto al papel de siempre va al NOMBRE DEL ARCHIVO, no al papel. */
export function sufijoArchivoPagoHorometro(o: OpcionesPagoHorometro): string {
  const partes = [...COLUMNAS_PAGO_HOROMETRO, ...PASTILLAS_PAGO_HOROMETRO]
    .filter((p) => o[p.key] !== OPCIONES_PAGO_HOROMETRO[p.key])
    .map((p) => (o[p.key] ? p.archivo : p.archivo.replace(/^sin /, 'con ')));
  if (o.agruparPor === 'encargado') partes.push('por encargado');
  return partes.length ? ` (${partes.join(', ')})` : '';
}

export const CSS_PAGO_HOROMETRO = `
  .ph h3{font-size:13px;color:#16324F;margin:14px 0 4px}
  .ph table{width:100%;border-collapse:collapse;font-size:11px;margin-bottom:6px}
  .ph th,.ph td{border:1px solid #c9d2dc;padding:4px 6px;text-align:left}
  .ph th{background:#16324F;color:#fff}
  .ph .r{text-align:right}
  .ph .b{font-weight:800}
  .ph tr.tot td{background:#16324F;color:#fff;font-weight:800}
  .ph tr.al td{background:#FEF3C7}
  .ph tr.grp td{background:#E8EEF5;color:#16324F;font-weight:800}
  .ph tr.sub td{background:#F3F6F9;font-weight:700}
  .ph .nota{font-size:10px;color:#555;margin:4px 0 8px}
`;

const ETIQUETA_ESTADO_DIA: Record<EstadoDiaHorometro, string> = {
  ok: '', sin_lectura: '', incompleta: 'Incompleta', invalida: 'Inválida',
};

/** Por qué un día pide atención, en criollo. '' = no pide. */
export function motivoAlertaDia(d: DiaPago): string {
  if (d.estado === 'invalida') return `Inválida: ${d.detalle}`;
  if (d.estado === 'incompleta') return `Incompleta (${d.detalle})`;
  if (d.sinPrecio) return 'Tiene horas pero no hay precio por hora ese día';
  return '';
}

/** El cuerpo del PDF «Pago por horómetro». */
export function cuerpoPagoHorometro(
  d: { desde: string; hasta: string; filas: readonly FilaPagoHorometro[] },
  oIn: Partial<OpcionesPagoHorometro> = OPCIONES_PAGO_HOROMETRO,
  /**
   * Precio por JORNADA (12 h) ya colocado en Control de maquinaria, por id de
   * máquina (19-oct-2026, pedido del cliente). SOLO REFERENCIA: se pinta como
   * columna aparte y NO entra en el monto. Si no llega el mapa, no sale nada
   * (así los llamados viejos quedan idénticos).
   */
  precioControl?: ReadonlyMap<string, number | null>,
): string {
  // Lo que no venga toma el valor de siempre (así un llamado viejo no enciende
  // de rebote una columna nueva).
  const o: OpcionesPagoHorometro = { ...OPCIONES_PAGO_HOROMETRO, ...oIn };
  // 👤 Los bloques (por empresa o por encargado) mandan el ORDEN de todo el papel.
  const grupos = gruposPagoHorometro(d.filas ?? [], o.agruparPor);
  const filas = grupos.flatMap((g) => g.filas);
  const porEnc = o.agruparPor === 'encargado';
  const tot = totalPagoHorometro(filas);
  // La columna de referencia solo existe si llegó el mapa y la pastilla no la oculta.
  const conControl = !!precioControl && !o.sinPrecioControl;
  const guion = (v: unknown) => { const t = limpio(v); return t ? esc(t) : '—'; };
  const tdControl = (id: string) => {
    const p = precioControl?.get(id);
    return p != null && p > 0 ? `${usd(p)} <i>(${usd(p / 12)}/h)</i>` : '—';
  };
  let html = `<div class="ph">`;
  html += `<p class="nota">Del ${dmy(d.desde)} al ${dmy(d.hasta)}. Horas = final − inicial del horómetro de trabajo, por turno. Cada día se paga con el precio por hora que regía ese día.${conControl ? ' «Control $/jornada» es el precio por jornada (12 h) ya colocado en Control de maquinaria: solo referencia, no entra en el monto.' : ''}</p>`;
  if (filas.length === 0) return `${html}<p class="nota">Sin lecturas de horómetro en el rango.</p></div>`;

  const mm = (m: MaquinaPago) => [!o.sinMarca ? m.marca : '', !o.sinModelo ? m.modelo : ''].filter(Boolean).join(' / ');
  const thMM = o.sinMarca && o.sinModelo ? '' : `<th>${o.sinMarca ? 'Modelo' : o.sinModelo ? 'Marca' : 'Marca / Modelo'}</th>`;
  const tdMM = (m: MaquinaPago) => (o.sinMarca && o.sinModelo ? '' : `<td>${esc(mm(m))}</td>`);

  // El resumen: por empresa (si no se ocultan los nombres) o por encargado.
  if (!o.sinResumen && (porEnc || !o.sinEmpresas)) {
    html += `<h3>Resumen por ${porEnc ? 'encargado' : 'empresa'}</h3><table><thead><tr><th>${porEnc ? 'Encargado' : 'Empresa'}</th><th class="r">Máquinas</th><th class="r">Horas</th><th class="r">Monto</th></tr></thead><tbody>`;
    for (const g of grupos) {
      html += `<tr><td>${esc(g.label)}</td><td class="r">${g.total.maquinas}</td><td class="r">${fmtHoras(g.total.horas)}</td><td class="r b">${usd(g.total.monto)}</td></tr>`;
    }
    html += `<tr class="tot"><td>TOTAL A PAGAR</td><td class="r">${tot.maquinas}</td><td class="r">${fmtHoras(tot.horas)}</td><td class="r">${usd(tot.monto)}</td></tr></tbody></table>`;
  }

  if (!o.sinListado) {
    // Columnas de la ficha, en este orden. Las apagadas NO existen (ni cabecera ni celda).
    const colsFicha: { th: string; td: (m: MaquinaPago) => string }[] = [];
    if (thMM) colsFicha.push({ th: thMM, td: tdMM });
    if (!o.sinPlaca) colsFicha.push({ th: '<th>Serial / Placa</th>', td: (m) => `<td>${esc(m.placa)}</td>` });
    if (!o.sinPlacaSola) colsFicha.push({ th: '<th>Placa</th>', td: (m) => `<td>${guion(m.placaSola)}</td>` });
    if (!o.sinSerial) colsFicha.push({ th: '<th>Serial</th>', td: (m) => `<td>${guion(m.serial)}</td>` });
    if (!o.sinEmpresas) colsFicha.push({ th: '<th>Empresa</th>', td: (m) => `<td>${esc(m.empresa)}</td>` });
    if (!o.sinEncargado) colsFicha.push({ th: '<th>Encargado</th>', td: (m) => `<td>${guion(m.encargado)}</td>` });
    const cols = 1 + colsFicha.length;
    // Las celdas de la derecha (horas · precio · control · monto) y su colspan al pie.
    const derecha = (horas: number, precio: string, control: string, monto: number) =>
      `<td class="r">${fmtHoras(horas)}</td>${o.sinPrecio ? '' : `<td class="r">${precio}</td>`}${conControl ? `<td class="r">${control}</td>` : ''}<td class="r b">${usd(monto)}</td>`;
    html += `<h3>Pago por máquina</h3><table><thead><tr><th>Máquina</th>${colsFicha.map((c) => c.th).join('')}<th class="r">Horas</th>${o.sinPrecio ? '' : '<th class="r">Precio/h</th>'}${conControl ? '<th class="r">Control $/jornada</th>' : ''}<th class="r">Monto</th></tr></thead><tbody>`;
    for (const g of grupos) {
      // 👤 Por encargado, cada bloque lleva su título y su subtotal (agrupar no cambia el TOTAL).
      if (porEnc) html += `<tr class="grp"><td colspan="${cols + 1 + (o.sinPrecio ? 0 : 1) + (conControl ? 1 : 0) + 1}">👤 ${esc(g.label)} · ${g.total.maquinas} máquina(s)</td></tr>`;
      for (const f of g.filas) {
        const precio = f.variosPrecios ? 'varios' : f.precioVigente != null ? usd(f.precioVigente) : '—';
        html += `<tr><td>${esc(f.maquina.code)}</td>${colsFicha.map((c) => c.td(f.maquina)).join('')}${derecha(f.horas, precio, tdControl(f.maquina.id), f.monto)}</tr>`;
      }
      if (porEnc) html += `<tr class="sub"><td colspan="${cols}">Subtotal ${esc(g.label)}</td>${derecha(g.total.horas, '', '', g.total.monto)}</tr>`;
    }
    html += `<tr class="tot"><td colspan="${cols}">TOTAL A PAGAR</td><td class="r">${fmtHoras(tot.horas)}</td>${o.sinPrecio ? '' : '<td></td>'}${conControl ? '<td></td>' : ''}<td class="r">${usd(tot.monto)}</td></tr></tbody></table>`;
  }

  if (!o.sinDias) {
    html += `<h3>Detalle día por día</h3><table><thead><tr><th>Fecha</th><th>Máquina</th>${o.sinPlaca ? '' : '<th>Serial / Placa</th>'}${o.sinInicioFin ? '' : '<th class="r">Inicio</th><th class="r">Fin</th>'}<th class="r">Horas</th>${o.sinPrecio ? '' : '<th class="r">Precio/h</th>'}<th class="r">Monto</th></tr></thead><tbody>`;
    for (const f of filas) for (const x of f.dias) {
      if (x.estado === 'sin_lectura' && !x.cambio) continue; // un día sin lectura ni cambio no es un renglón: no hubo nada
      // 🧾 Un día ajustado se dice: quien lee el papel tiene que poder distinguir el
      //    número del tablero del que acomodó la oficina, con su motivo.
      const ajuste = x.ajustado ? `<br/><i>🧾 ajustado en Control de horómetros${x.motivoAjuste ? `: ${esc(x.motivoAjuste)}` : ''}</i>` : '';
      // 🔁 Un día con cambio de horómetro también se dice, con sus ± horas reconocidas.
      const cambio = x.cambio ? `<br/><i>🔁 cambio de horómetro${horasCambioTexto(x.horasCambio) ? ` (${horasCambioTexto(x.horasCambio)} reconocidas)` : ''}${x.motivoCambio ? `: ${esc(x.motivoCambio)}` : ''}</i>` : '';
      html += `<tr${motivoAlertaDia(x) ? ' class="al"' : ''}><td>${dmy(x.fecha)}</td><td>${esc(f.maquina.code)}${ajuste}${cambio}</td>${o.sinPlaca ? '' : `<td>${esc(f.maquina.placa)}</td>`}${o.sinInicioFin ? '' : `<td class="r">${fmtHoras(x.inicial)}</td><td class="r">${fmtHoras(x.final)}</td>`}<td class="r">${fmtHoras(x.horas)}${ETIQUETA_ESTADO_DIA[x.estado] ? ` <i>(${ETIQUETA_ESTADO_DIA[x.estado]})</i>` : ''}</td>${o.sinPrecio ? '' : `<td class="r">${x.precio != null ? usd(x.precio) : '—'}</td>`}<td class="r b">${usd(x.monto)}</td></tr>`;
    }
    html += `</tbody></table>`;
  }

  if (!o.sinAlertas && tot.alertas > 0) {
    html += `<h3>Días por revisar (${tot.alertas})</h3><p class="nota">Estos días valen $0 hasta que se corrija la lectura o se le ponga precio a la máquina.</p><table><thead><tr><th>Fecha</th><th>Máquina</th>${o.sinPlaca ? '' : '<th>Serial / Placa</th>'}<th>Qué pasa</th></tr></thead><tbody>`;
    for (const f of filas) for (const x of f.dias) {
      const motivo = motivoAlertaDia(x);
      if (!motivo) continue;
      html += `<tr class="al"><td>${dmy(x.fecha)}</td><td>${esc(f.maquina.code)}</td>${o.sinPlaca ? '' : `<td>${esc(f.maquina.placa)}</td>`}<td>${esc(motivo)}</td></tr>`;
    }
    html += `</tbody></table>`;
  }
  return `${html}</div>`;
}
