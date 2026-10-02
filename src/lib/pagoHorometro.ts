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
// TODO ESTE ARCHIVO ES PURO Y SIN IMPORTS: `scripts/test-pago-horometro.mjs` lo
// prueba solo. Lo que toca la red vive en `pagoHorometroDb.ts`.

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
  id: string; code: string; placa: string; empresa: string;
  clasificacion: string; marca: string; modelo: string;
};

export type DiaPago = HorasDia & {
  fecha: string;
  /** Precio por hora que regía ESE día (null = sin precio configurado). */
  precio: number | null;
  monto: number;
  /** Hay horas y no hay precio: no se puede pagar hasta ponerlo. */
  sinPrecio: boolean;
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

/**
 * Arma el pago por horómetro del rango: una fila por máquina, con sus días.
 *
 * Entran las máquinas que tienen AL MENOS UNA lectura en el rango (una máquina
 * sin lecturas no tiene nada que pagar por horómetro y solo haría ruido).
 */
export function filasPagoHorometro(opts: {
  maquinas: readonly MaquinaPago[];
  lecturas: readonly LecturaDia[];
  precios: readonly PrecioHorometro[];
  desde: string;
  hasta: string;
  /** 🧾 Ajustes «solo para Control de horómetros»: mandan sobre la lectura. */
  ajustes?: readonly AjusteHorometro[] | null;
}): FilaPagoHorometro[] {
  const dias = diasDelRango(opts.desde, opts.hasta);
  if (dias.length === 0) return [];
  const enRango = new Set(dias);
  const porClave = new Map<string, LecturaEfectiva[]>();
  const conLectura = new Set<string>();
  for (const l of lecturasEfectivas(opts.lecturas, opts.ajustes)) {
    if (!l) continue;
    const f = dia(l.roundDate);
    if (!enRango.has(f)) continue;
    const k = `${l.machineryId}|${f}`;
    const arr = porClave.get(k); if (arr) arr.push(l); else porClave.set(k, [l]);
    conLectura.add(l.machineryId);
  }
  const filas: FilaPagoHorometro[] = [];
  for (const m of opts.maquinas ?? []) {
    if (!m || !conLectura.has(m.id)) continue;
    let horas = 0, monto = 0, alertas = 0;
    const preciosVistos = new Set<number>();
    const ds: DiaPago[] = dias.map((fecha) => {
      const h = horasDelDia(porClave.get(`${m.id}|${fecha}`));
      const p = precioHoraEn(opts.precios, m.id, fecha);
      const precio = p ? num(p.precio_hora) : null;
      const sinPrecio = h.horas > 0 && precio == null;
      const mto = precio != null ? r2(h.horas * precio) : 0;
      if (h.horas > 0 && precio != null) preciosVistos.add(precio);
      if (h.estado === 'invalida' || h.estado === 'incompleta' || sinPrecio) alertas++;
      horas += h.horas; monto += mto;
      return { ...h, fecha, precio, monto: mto, sinPrecio };
    });
    const ult = precioHoraEn(opts.precios, m.id, dias[dias.length - 1]);
    filas.push({
      maquina: m, dias: ds, horas: r2(horas), monto: r2(monto), alertas,
      precioVigente: ult ? num(ult.precio_hora) : null,
      variosPrecios: preciosVistos.size > 1,
    });
  }
  const cmp = (a: string, b: string) => a.localeCompare(b, 'es', { sensitivity: 'base', numeric: true });
  return filas.sort((a, b) => cmp(a.maquina.empresa, b.maquina.empresa) || cmp(a.maquina.code, b.maquina.code) || cmp(a.maquina.placa, b.maquina.placa));
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
};

export const OPCIONES_PAGO_HOROMETRO: OpcionesPagoHorometro = {
  sinMarca: false, sinModelo: false, sinPlaca: false, sinEmpresas: false, sinPrecio: false,
  sinResumen: false, sinListado: false, sinDias: true, sinInicioFin: false, sinAlertas: false,
};

export const PASTILLAS_PAGO_HOROMETRO: { key: keyof OpcionesPagoHorometro; chip: string; archivo: string }[] = [
  { key: 'sinMarca', chip: '🚫 Marca', archivo: 'sin marca' },
  { key: 'sinModelo', chip: '🚫 Modelo', archivo: 'sin modelo' },
  { key: 'sinPlaca', chip: '🚫 Serial / Placa', archivo: 'sin placa' },
  { key: 'sinEmpresas', chip: '🚫 Nombre de empresas', archivo: 'sin empresas' },
  { key: 'sinPrecio', chip: '🚫 Precio por hora', archivo: 'sin precio' },
  { key: 'sinResumen', chip: '🚫 Resumen por empresa', archivo: 'sin resumen' },
  { key: 'sinListado', chip: '🚫 Listado por máquina', archivo: 'sin listado' },
  { key: 'sinDias', chip: '🚫 Detalle día por día', archivo: 'sin dias' },
  { key: 'sinInicioFin', chip: '🚫 Inicio y Fin del horómetro', archivo: 'sin inicio-fin' },
  { key: 'sinAlertas', chip: '🚫 Días por revisar', archivo: 'sin alertas' },
];

export function sufijoArchivoPagoHorometro(o: OpcionesPagoHorometro): string {
  const partes = PASTILLAS_PAGO_HOROMETRO
    .filter((p) => o[p.key] !== OPCIONES_PAGO_HOROMETRO[p.key])
    .map((p) => (o[p.key] ? p.archivo : p.archivo.replace(/^sin /, 'con ')));
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
  o: OpcionesPagoHorometro = OPCIONES_PAGO_HOROMETRO,
): string {
  const filas = d.filas ?? [];
  const tot = totalPagoHorometro(filas);
  let html = `<div class="ph">`;
  html += `<p class="nota">Del ${dmy(d.desde)} al ${dmy(d.hasta)}. Horas = final − inicial del horómetro de trabajo, por turno. Cada día se paga con el precio por hora que regía ese día.</p>`;
  if (filas.length === 0) return `${html}<p class="nota">Sin lecturas de horómetro en el rango.</p></div>`;

  const mm = (m: MaquinaPago) => [!o.sinMarca ? m.marca : '', !o.sinModelo ? m.modelo : ''].filter(Boolean).join(' / ');
  const thMM = o.sinMarca && o.sinModelo ? '' : `<th>${o.sinMarca ? 'Modelo' : o.sinModelo ? 'Marca' : 'Marca / Modelo'}</th>`;
  const tdMM = (m: MaquinaPago) => (o.sinMarca && o.sinModelo ? '' : `<td>${esc(mm(m))}</td>`);

  if (!o.sinResumen && !o.sinEmpresas) {
    html += `<h3>Resumen por empresa</h3><table><thead><tr><th>Empresa</th><th class="r">Máquinas</th><th class="r">Horas</th><th class="r">Monto</th></tr></thead><tbody>`;
    for (const e of pagoPorEmpresa(filas)) {
      html += `<tr><td>${esc(e.empresa)}</td><td class="r">${e.total.maquinas}</td><td class="r">${fmtHoras(e.total.horas)}</td><td class="r b">${usd(e.total.monto)}</td></tr>`;
    }
    html += `<tr class="tot"><td>TOTAL A PAGAR</td><td class="r">${tot.maquinas}</td><td class="r">${fmtHoras(tot.horas)}</td><td class="r">${usd(tot.monto)}</td></tr></tbody></table>`;
  }

  if (!o.sinListado) {
    html += `<h3>Pago por máquina</h3><table><thead><tr><th>Máquina</th>${thMM}${o.sinPlaca ? '' : '<th>Serial / Placa</th>'}${o.sinEmpresas ? '' : '<th>Empresa</th>'}<th class="r">Horas</th>${o.sinPrecio ? '' : '<th class="r">Precio/h</th>'}<th class="r">Monto</th></tr></thead><tbody>`;
    for (const f of filas) {
      const precio = f.variosPrecios ? 'varios' : f.precioVigente != null ? usd(f.precioVigente) : '—';
      html += `<tr><td>${esc(f.maquina.code)}</td>${tdMM(f.maquina)}${o.sinPlaca ? '' : `<td>${esc(f.maquina.placa)}</td>`}${o.sinEmpresas ? '' : `<td>${esc(f.maquina.empresa)}</td>`}<td class="r">${fmtHoras(f.horas)}</td>${o.sinPrecio ? '' : `<td class="r">${precio}</td>`}<td class="r b">${usd(f.monto)}</td></tr>`;
    }
    const cols = 1 + (thMM ? 1 : 0) + (o.sinPlaca ? 0 : 1) + (o.sinEmpresas ? 0 : 1);
    html += `<tr class="tot"><td colspan="${cols}">TOTAL A PAGAR</td><td class="r">${fmtHoras(tot.horas)}</td>${o.sinPrecio ? '' : '<td></td>'}<td class="r">${usd(tot.monto)}</td></tr></tbody></table>`;
  }

  if (!o.sinDias) {
    html += `<h3>Detalle día por día</h3><table><thead><tr><th>Fecha</th><th>Máquina</th>${o.sinPlaca ? '' : '<th>Serial / Placa</th>'}${o.sinInicioFin ? '' : '<th class="r">Inicio</th><th class="r">Fin</th>'}<th class="r">Horas</th>${o.sinPrecio ? '' : '<th class="r">Precio/h</th>'}<th class="r">Monto</th></tr></thead><tbody>`;
    for (const f of filas) for (const x of f.dias) {
      if (x.estado === 'sin_lectura') continue; // un día sin lectura no es un renglón: no hubo nada
      // 🧾 Un día ajustado se dice: quien lee el papel tiene que poder distinguir el
      //    número del tablero del que acomodó la oficina, con su motivo.
      const ajuste = x.ajustado ? `<br/><i>🧾 ajustado en Control de horómetros${x.motivoAjuste ? `: ${esc(x.motivoAjuste)}` : ''}</i>` : '';
      html += `<tr${motivoAlertaDia(x) ? ' class="al"' : ''}><td>${dmy(x.fecha)}</td><td>${esc(f.maquina.code)}${ajuste}</td>${o.sinPlaca ? '' : `<td>${esc(f.maquina.placa)}</td>`}${o.sinInicioFin ? '' : `<td class="r">${fmtHoras(x.inicial)}</td><td class="r">${fmtHoras(x.final)}</td>`}<td class="r">${fmtHoras(x.horas)}${ETIQUETA_ESTADO_DIA[x.estado] ? ` <i>(${ETIQUETA_ESTADO_DIA[x.estado]})</i>` : ''}</td>${o.sinPrecio ? '' : `<td class="r">${x.precio != null ? usd(x.precio) : '—'}</td>`}<td class="r b">${usd(x.monto)}</td></tr>`;
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
