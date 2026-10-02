// HORÓMETRO DE TRABAJO (23-sep-2026) — la regla, sin red.
//
// Pedido del cliente: pagar ciertas máquinas por lo que marca el HORÓMETRO (final − inicial
// del turno) y no por las horas que declara la jornada del inspector. Diseño en
// docs/superpowers/specs/2026-09-23-horometro-trabajo-design.md (4.1, 4.4 y 5).
//
// ⭐ UNA LECTURA POR MÁQUINA, DÍA DE JORNADA Y TURNO (día / noche). Nunca se borra; se corrige.
//    La base la VALIDA (marca, no rechaza) y acá está el ESPEJO EXACTO de esa validación
//    (`validarLectura`) para que el teléfono y Control puedan avisar antes de guardar.
//
// ⭐ UNA SOLA FUNCIÓN DE HORAS PAGABLES (`horasPagables`). Modo jornada, o modo horómetro
//    sin lectura válida completa → exactamente la fórmula de la jornada (`workedFromShifts`
//    de src/lib/hours.ts, reescrita acá para no arrastrar React ni Supabase). Modo horómetro
//    con lecturas válidas → final − inicial de cada turno, y NO suma extras ni resta paradas:
//    el horómetro ya las incluye y las excluye (si no, pagaría doble las extras).
//
// ⭐ EL DÍA CAE ENTERO. Si un turno con trabajo declarado no tiene lectura válida completa,
//    TODO el día se paga por jornada y el papel dice por qué («sin lectura» / «inválida»).
//    Mezclar medio día de horómetro con medio día de jornada duplicaría paradas y extras.
//
// ⭐ EL ORIGEN SIEMPRE SE DEVUELVE (`OrigenPago`): jornada · horometro · sin_lectura ·
//    invalida · averiado · sin_horometro_fisico. El recibo lo escribe tal cual.
//
// Sin imports: la prueba (scripts/test-horometro-trabajo.mjs) lo carga solo.

const limpio = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const redondear = (n: number) => Math.round(n * 100) / 100;
const cmp = (a: string, b: string) => a.localeCompare(b, 'es', { numeric: true, sensitivity: 'base' });
const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const dmy = (iso: string): string => { const [y, m, d] = String(iso ?? '').split('-'); return y && m && d ? `${d}/${m}/${y}` : (iso || '—'); };
/** Horas para el papel: coma decimal, sin ceros de sobra («8,5», «12», «0,25»). */
const fmtH = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? '—' : String(redondear(n)).replace('.', ','));
/** Un número de horómetro tal cual se leyó del tablero (sin redondear a horas): un
 *  horómetro puede traer decimales y redondearlo escondería justo la corrección. */
const fmtNum = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? '—' : String(n).replace('.', ','));
/** Día siguiente en ISO (aaaa-mm-dd), sin zona: solo se usa para saber si dos fechas son seguidas. */
const diaSiguiente = (iso: string): string => {
  const t = Date.parse(String(iso ?? '').slice(0, 10) + 'T00:00:00Z');
  return Number.isFinite(t) ? new Date(t + 86400000).toISOString().slice(0, 10) : '';
};

// ── LECTURAS ─────────────────────────────────────────────────────────────────

export type Turno = 'day' | 'night';
export type OrigenLectura = 'inspector' | 'qr' | 'control' | 'reinicio';

/** Fila de `lecturas_horometro_trabajo` tal como la ve el cliente. `inicial`/`final` pueden faltar. */
export type LecturaTrabajo = {
  machineryId: string;
  roundDate: string;
  shift: Turno;
  inicial: number | null;
  final: number | null;
  valida: boolean;
  motivoInvalida: string | null;
  reinicio: boolean;
  origen: OrigenLectura;
  corregidoPor?: string | null;
  /** Por qué se corrigió desde Control. La base lo exige en toda corrección. */
  motivoCorreccion?: string | null;
  fotoInicialUrl?: string | null;
  fotoFinalUrl?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  createdBy?: string | null;
  updatedBy?: string | null;
};

/** Ventana del turno (12 h) más media hora de gracia. Se compara contra la ventana, no contra la hora de captura. */
export const TOPE_HORAS_TURNO = 12.5;

/**
 * Espejo exacto de la validación del disparador en la base. Marca, no rechaza.
 * `ultimaValida` = última lectura válida (final, o inicial si no hay final) de la MISMA
 * máquina en un turno anterior; null si no hay ninguna. Una lectura INCOMPLETA (falta
 * inicial o final) no es inválida: solo no produce horas.
 */
export function validarLectura(
  l: { inicial: number | null; final: number | null; reinicio: boolean },
  ultimaValida: number | null,
): { valida: boolean; motivo: string } {
  const ini = l.inicial == null ? null : num(l.inicial);
  const fin = l.final == null ? null : num(l.final);
  if ((ini != null && ini < 0) || (fin != null && fin < 0)) return { valida: false, motivo: 'lectura negativa' };
  if (fin != null && ini != null && fin < ini) return { valida: false, motivo: 'final menor que inicial' };
  // Un reinicio sienta base nueva (aparato cambiado): no se compara con lo anterior.
  if (!l.reinicio && ultimaValida != null && ini != null && ini < ultimaValida) return { valida: false, motivo: 'menor que la última lectura válida' };
  if (fin != null && ini != null && fin - ini > TOPE_HORAS_TURNO) return { valida: false, motivo: 'salto mayor a 12,5 h' };
  return { valida: true, motivo: '' };
}

/**
 * ⭐ COMA Y PUNTO VALEN IGUAL EN TODOS LOS HOROMETROS (29-sep-2026).
 *
 * Pedido del cliente: «en todos los horometros valida , y . ... desde la vista
 * de tlf y desde la pc en control».
 *
 * Antes cada pantalla lo leia por su cuenta con `Number(txt.replace(',', '.'))`,
 * que cambia SOLO LA PRIMERA coma. Escribir el numero como se escribe aca
 * —«7.919,5»— daba NaN: en el telefono el boton no hacia nada y en Control
 * saltaba «no es un numero valido», sin decir que el problema era el punto.
 *
 * Ahora las tres cosas las hace ESTA libreria, y las pantallas solo la llaman:
 *   · `soloHorometro` — lo que deja teclear el campo.
 *   · `horometroDeTexto` — el numero, o NaN si no hay.
 *   · `numeroDeTexto` — igual, pero distinguiendo «vacio» (borrar) de «malo».
 *
 * LA REGLA:
 *   · Coma o punto valen IGUAL como decimal: 720,2 = 720.2.
 *   · Si vienen los dos, el que agrupa de tres en tres es el de MILES y el otro
 *     el decimal: 7.919,5 = 7,919.5 = 7919,5.
 *   · Un separador con grupos de tres exactos es de MILES: «7.919» son 7919
 *     horas, no 7,919. Asi es como se escribe aca, y es el caso real que este
 *     mismo modal trae de ejemplo («tecleo 791,9 y era 7.919»).
 *   · Tolera lo que queda a medio escribir: «7919,» vale 7919.
 *
 * ⚠️ LO QUE NO SE ENTIENDE SE RECHAZA, no se adivina: «7.7.7» no es un numero y
 *    la pantalla lo dice. Un horometro mal leido se arrastra como inicial de la
 *    proxima jornada; es preferible que lo vuelvan a teclear. Por eso esta regla
 *    es MAS ESTRICTA que la del dinero (`leerNumero`, src/lib/numeros.ts), que
 *    nunca puede devolver NaN porque contagiaria un total.
 */

/** Lo que se deja TECLEAR en un campo de horometro: digitos y separadores. */
export const soloHorometro = (t: unknown): string => String(t ?? '').replace(/[^0-9.,]/g, '');

// Un numero corriente, con un solo separador decimal (o a medio escribir).
const SIMPLE = /^\d+(?:[.,]\d*)?$/;
// Miles agrupados de tres en tres, con su decimal opcional del OTRO signo.
const MILES_PUNTO = /^\d{1,3}(?:\.\d{3})+(?:,\d*)?$/;
const MILES_COMA = /^\d{1,3}(?:,\d{3})+(?:\.\d*)?$/;

/**
 * El horometro que dice un campo. NaN si esta vacio o no es un numero, para que
 * quien llama siga decidiendo con `isFinite()` —que es como ya lo decidian las
 * pantallas— y un campo vacio nunca se confunda con un cero.
 */
export function horometroDeTexto(t: unknown): number {
  const v = String(t ?? '').trim();
  let s: string;
  // ⚠️ Los MILES se prueban ANTES: «7.919» también encaja en el patrón simple
  //    (7 coma 919), y si ganara ese serían 7,919 horas en vez de 7919.
  if (MILES_PUNTO.test(v)) s = v.replace(/\./g, '').replace(',', '.');
  else if (MILES_COMA.test(v)) s = v.replace(/,/g, '');
  else if (SIMPLE.test(v)) s = v.replace(',', '.');
  else return NaN;
  if (s.endsWith('.')) s = s.slice(0, -1); // «7919,» a medio escribir
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : NaN;
}

/** Lo que se escribe en un campo de horometro: numero >= 0, '' = borrar (null),
 *  cualquier otra cosa = false (no es un numero). Coma o punto, da igual. */
export function numeroDeTexto(t: unknown): number | null | false {
  const v = String(t ?? '').trim();
  if (v === '') return null;
  const n = horometroDeTexto(v);
  return Number.isFinite(n) ? n : false;
}

export const MSG_MOTIVO_CORRECCION =
  'Escribe el motivo de la correccion: queda grabado junto al cambio, con tu nombre.';

/**
 * EL EDITOR DE CONTROL (24-sep-2026). Decision del cliente: solo admins corrigen,
 * y basta el motivo escrito (sin foto). Esta funcion valida LO ESCRITO antes de
 * mandarlo; el candado de verdad (sesion + modulo + motivo) vive en la base.
 */
export function validarCorreccionHorometro(d: { inicial: string; final: string; motivo: string }): string | null {
  if (!String(d.motivo ?? '').trim()) return MSG_MOTIVO_CORRECCION;
  const i = numeroDeTexto(d.inicial);
  if (i === false) return 'El horometro inicial no es un numero valido (0 o mas).';
  const f = numeroDeTexto(d.final);
  if (f === false) return 'El horometro final no es un numero valido (0 o mas).';
  if (i == null && f == null) return 'Escribe al menos un numero: borrar los dos dejaria la lectura vacia.';
  if (i != null && f != null && f < i) return 'El final (' + f + ') no puede ser menor al inicial (' + i + ').';
  return null;
}

/**
 * LA LECTURA QUE EL INSPECTOR PUEDE COMPLETAR TRAS EL CIERRE (24-sep-2026).
 *
 * Caso real del estreno (JUMBO 320): el inspector cerro la jornada sin escribir el
 * horometro final, y la pantalla ya solo le ofrecia INICIAR la siguiente - cuyo
 * campo precargado le mostraba el numero viejo. El final se pone el MISMO dia
 * mirando el tablero; un final puesto dias despues es un numero inventado, y eso
 * es correccion de Control (con motivo), no del inspector.
 *
 * Devuelve la lectura de `hoyISO` con inicial y SIN final (dia primero), o null.
 */
export function lecturaParaCompletarFinal(
  lecturas: readonly LecturaTrabajo[] | null | undefined,
  hoyISO: string,
): LecturaTrabajo | null {
  const abiertas = (lecturas ?? []).filter(
    (l) => !!l && String(l.roundDate).slice(0, 10) === hoyISO && l.inicial != null && l.final == null,
  );
  abiertas.sort((a, b) => (a.shift < b.shift ? -1 : a.shift > b.shift ? 1 : 0)); // day antes que night
  return abiertas[0] ?? null;
}

/** final − inicial, a 2 decimales. null si falta alguna lectura o la fila no es válida. */
export function horasDeLectura(l: LecturaTrabajo): number | null {
  if (!l || !l.valida || l.inicial == null || l.final == null) return null;
  return redondear(num(l.final) - num(l.inicial));
}

/**
 * Última lectura válida (final, o inicial si no hay final) ESTRICTAMENTE anterior al turno
 * dado. Orden: roundDate y, dentro del día, day < night. `lecturas` deben ser de UNA misma
 * máquina (acá no se filtra por máquina: quien llama ya las trajo así).
 */
export function ultimaLecturaValida(lecturas: readonly LecturaTrabajo[], antesDe: { roundDate: string; shift: Turno }): number | null {
  const rango = (l: { roundDate: string; shift: Turno }) => `${String(l.roundDate ?? '').slice(0, 10)}|${l.shift === 'night' ? '1' : '0'}`;
  const limite = rango(antesDe);
  const previas = (lecturas ?? [])
    .filter((l) => l && l.valida && (l.final != null || l.inicial != null) && rango(l) < limite)
    .sort((a, b) => (rango(a) < rango(b) ? -1 : rango(a) > rango(b) ? 1 : 0));
  const u = previas[previas.length - 1];
  if (!u) return null;
  return u.final != null ? num(u.final) : num(u.inicial);
}

// ── HORAS PAGABLES ───────────────────────────────────────────────────────────

export type ModoPago = 'jornada' | 'viaje' | 'horometro';
export type OrigenPago = 'jornada' | 'horometro' | 'sin_lectura' | 'invalida' | 'averiado' | 'sin_horometro_fisico';
export type RondaHoras = { dia: number; noche: number; parada: number; extras: number };

const turnoH = (h: unknown) => Math.max(0, num(h));

/** Misma fórmula que `workedFromShifts` (src/lib/hours.ts): max(0, día + noche − parada) + max(0, extras). */
export function horasJornada(r: RondaHoras): number {
  return Math.max(0, turnoH(r?.dia) + turnoH(r?.noche) - num(r?.parada)) + Math.max(0, num(r?.extras));
}

/**
 * Horas que se PAGAN ese día, y de dónde salen. Ver la cabecera del archivo.
 * `lecturas` son las de ESA máquina y ESE día (una por turno, si las hay).
 */
export function horasPagables(
  r: RondaHoras,
  lecturas: readonly LecturaTrabajo[],
  modo: ModoPago,
  op?: { sinHorometroFisico?: boolean; averiado?: boolean },
): { horas: number; dia: number; noche: number; origen: OrigenPago } {
  const ronda = r ?? { dia: 0, noche: 0, parada: 0, extras: 0 };
  const porJornada = (origen: OrigenPago) => ({ horas: horasJornada(ronda), dia: redondear(turnoH(ronda.dia)), noche: redondear(turnoH(ronda.noche)), origen });

  if (modo !== 'horometro') return porJornada('jornada');
  if (op?.sinHorometroFisico) return porJornada('sin_horometro_fisico');
  if (op?.averiado) return porJornada('averiado');

  // Modo horómetro: cada turno con su par de lecturas.
  const turnos: Turno[] = ['day', 'night'];
  const horasTurno: Record<Turno, number | null> = { day: null, night: null };
  let caida: OrigenPago | null = null;
  for (const t of turnos) {
    const lec = (lecturas ?? []).find((l) => l && l.shift === t);
    const h = lec ? horasDeLectura(lec) : null;
    if (h != null) { horasTurno[t] = h; continue; }
    const trabajoDeclarado = turnoH(t === 'day' ? ronda.dia : ronda.noche);
    if (trabajoDeclarado > 0) {
      // Una inválida pesa más que una ausente: hay algo que corregir, no solo que anotar.
      const motivo: OrigenPago = lec && !lec.valida ? 'invalida' : 'sin_lectura';
      if (caida == null || motivo === 'invalida') caida = motivo;
    }
  }
  if (caida) return porJornada(caida);

  const dia = horasTurno.day, noche = horasTurno.night;
  if (dia == null && noche == null) {
    // Día sin ronda y sin lecturas: no hay nada que pagar ni de dónde sacarlo.
    return { horas: 0, dia: 0, noche: 0, origen: 'sin_lectura' };
  }
  return { horas: redondear((dia ?? 0) + (noche ?? 0)), dia: dia ?? 0, noche: noche ?? 0, origen: 'horometro' };
}

// ── COMPARATIVO (reporte «jornada vs horómetro») ─────────────────────────────
//
// Antes de encender el modo horómetro en una máquina, el cliente quiere ver si lo que marca
// el aparato cuadra con lo que declara el inspector. Una fila por máquina y día que tenga
// ronda; el horómetro se compara contra ella. TOLERANCIA de media hora para «cuadra».

export type FilaComparativa = {
  machineryId: string;
  code: string;
  empresa: string;
  marca: string;
  modelo: string;
  placa: string;
  fecha: string;
  horasJornada: number;
  horasHorometro: number | null;
  diferencia: number | null;
  /**
   * `sin_ronda` (02-oct-2026): HAY lectura de horómetro ese día pero NO hay jornada
   * registrada. Antes esa fila ni existía —el comparador solo recorría rondas— y
   * el cliente lo vivió como «el reporte no toma el rango».
   */
  estado: 'cuadra' | 'horometro_mayor' | 'jornada_mayor' | 'sin_lectura' | 'invalida' | 'sin_ronda';

  // ── EL INICIO Y EL FIN (26-sep-2026) ──────────────────────────────────────
  // Pedido del cliente: «cuando el cambio sea manual que se refleje en el reporte
  // las horas, el inicio y el fin». Hasta hoy el papel traía SOLO las horas, así
  // que una corrección hecha en Control se veía como un número distinto sin poder
  // saber de dónde salía ni si alguien lo había tocado a mano.
  /** El horómetro con el que ARRANCÓ el día (el `inicial` del primer turno). */
  inicial: number | null;
  /** Con el que TERMINÓ (el `final` del último turno con final). */
  final: number | null;
  /** ✎ Alguien la corrigió a mano desde Control (o la marcó como reinicio). */
  corregida: boolean;
  /** Por qué se corrigió. Lo escribió quien corrigió; obligatorio en la base. */
  motivo: string;
  /**
   * EL ESTADO CON SU RAZÓN (27-sep-2026). Pedido del cliente: «en vez de decir
   * inválido, que diga la razón o el estado real». Para una inválida trae el
   * motivo que dejó la base («salto mayor a 12,5 h», «menor que la última
   * lectura válida»); para una incompleta dice QUÉ falta («falta el final» —
   * el caso de un número borrado). Vacío = se usa la etiqueta genérica.
   */
  estadoDetalle: string;
};

/**
 * ✎ ¿A estas lecturas las tocó alguien a mano, y por qué?
 *
 * Una corrección se reconoce por CUALQUIERA de las tres señales que deja la base:
 * `corregidoPor` (quién), el origen `control`/`reinicio` (desde dónde) o el motivo
 * escrito. Mirar una sola dejaría fuera las corregidas antes de que existiera el
 * resto de las columnas, y esas son justo las que hay que poder rastrear.
 */
export function marcaDeCorreccion(lecturas: readonly LecturaTrabajo[] | null | undefined): { corregida: boolean; motivo: string } {
  const ls = (lecturas ?? []).filter(Boolean);
  const tocada = (l: LecturaTrabajo) =>
    !!l.corregidoPor || l.origen === 'control' || l.origen === 'reinicio' || !!limpio(l.motivoCorreccion);
  const corregidas = ls.filter(tocada);
  if (corregidas.length === 0) return { corregida: false, motivo: '' };
  // Los motivos de los dos turnos, sin repetir: el papel los muestra juntos.
  const motivos: string[] = [];
  for (const l of corregidas) {
    const m = limpio(l.motivoCorreccion);
    if (m && !motivos.includes(m)) motivos.push(m);
  }
  return { corregida: true, motivo: motivos.join(' · ') };
}

/** Media hora de tolerancia para decir que jornada y horómetro cuadran. */
const TOLERANCIA_CUADRA = 0.5;
/** Hasta 3 h de diferencia todavía cuenta para «lista para encender» (criterio de salida del diseño). */
const TOLERANCIA_LISTA = 3;
/** Días seguidos que hacen falta para dar una máquina por lista. */
const DIAS_PARA_LISTA = 5;

/** La ficha mínima de una máquina, para las filas que NO traen ronda (02-oct-2026). */
export type FichaMaquinaComparativo = { code: string; empresa: string; marca?: string; modelo?: string; placa?: string };

/**
 * @param fichas (02-oct-2026) las máquinas que ENTRAN al papel, con su ficha. Sirve
 *   para las lecturas de días SIN ronda: la ronda trae su ficha, la lectura no.
 *   · Si se pasa, una lectura sin ronda de una máquina que NO está en el mapa se
 *     omite — es el mismo filtro de empresa/equipos que la pantalla ya aplicó a las
 *     rondas, para que las dos clases de fila respeten el mismo recorte.
 *   · Si NO se pasa (llamadas puras), la fila sale igual, con código «—».
 */
export function compararJornadaHorometro(
  rondas: readonly { machineryId: string; code: string; empresa: string; marca?: string; modelo?: string; placa?: string; fecha: string; ronda: RondaHoras }[],
  lecturas: readonly LecturaTrabajo[],
  fichas?: ReadonlyMap<string, FichaMaquinaComparativo> | null,
): FilaComparativa[] {
  const porClave = new Map<string, LecturaTrabajo[]>();
  for (const l of lecturas ?? []) {
    if (!l) continue;
    const k = `${l.machineryId}|${String(l.roundDate ?? '').slice(0, 10)}`;
    const arr = porClave.get(k); if (arr) arr.push(l); else porClave.set(k, [l]);
  }
  const filas: FilaComparativa[] = [];
  /** Las claves máquina|día que SÍ tienen ronda: lo que quede fuera va como «sin jornada». */
  const conRonda = new Set<string>();
  for (const r of rondas ?? []) {
    const fecha = String(r.fecha ?? '').slice(0, 10);
    const hj = redondear(horasJornada(r.ronda));
    conRonda.add(`${r.machineryId}|${fecha}`);
    const del = porClave.get(`${r.machineryId}|${fecha}`) ?? [];
    // ⭐ EL INICIO Y EL FIN DEL DÍA (26-sep-2026). Se toman de los turnos ORDENADOS
    //    (día antes que noche): el `inicial` del primero que lo tenga y el `final`
    //    del último que lo tenga. Con los dos turnos cargados, eso es el horómetro
    //    con el que la máquina arrancó la jornada y con el que la terminó.
    const ord = [...del].sort((a, b) => (a.shift === b.shift ? 0 : a.shift === 'day' ? -1 : 1));
    const marca = marcaDeCorreccion(ord);
    const base = {
      machineryId: r.machineryId, code: limpio(r.code), empresa: limpio(r.empresa),
      marca: limpio(r.marca), modelo: limpio(r.modelo), placa: limpio(r.placa), fecha, horasJornada: hj,
      inicial: ord.find((l) => l.inicial != null)?.inicial ?? null,
      final: [...ord].reverse().find((l) => l.final != null)?.final ?? null,
      corregida: marca.corregida, motivo: marca.motivo,
      estadoDetalle: '',
    };
    const vacia = { inicial: null, final: null, corregida: false, motivo: '' };
    if (del.length === 0) { filas.push({ ...base, ...vacia, horasHorometro: null, diferencia: null, estado: 'sin_lectura' }); continue; }
    // ⚠️ Una lectura MALA igual enseña sus números: el papel tiene que dejar ver QUÉ
    //    se tecleó mal, que es lo que se va a ir a corregir. Y el estado dice LA
    //    RAZÓN que dejó la base (27-sep-2026), no un «Inválida» a secas: «salto
    //    mayor a 12,5 h» manda a revisar un tecleo; «menor que la última lectura
    //    válida» manda a revisar un retroceso — no se corrigen igual.
    if (del.some((l) => !l.valida)) {
      const motivos: string[] = [];
      for (const l of del) {
        if (l.valida) continue;
        const m = limpio(l.motivoInvalida);
        if (m && !motivos.includes(m)) motivos.push(m);
      }
      filas.push({ ...base, horasHorometro: null, diferencia: null, estado: 'invalida', estadoDetalle: motivos.join(' · ') });
      continue;
    }
    const horas = del.map(horasDeLectura).filter((h): h is number => h != null);
    if (horas.length === 0) {
      // Solo lecturas incompletas: decir QUÉ falta distingue «nadie la tomó» de
      // «tiene inicial y el final quedó vacío» (por ejemplo, porque lo borraron
      // desde Control) — el pedido del 27-sep-2026.
      const tieneIni = del.some((l) => l.inicial != null);
      const tieneFin = del.some((l) => l.final != null);
      const detalle = tieneIni && !tieneFin ? 'Incompleta: falta el final'
        : !tieneIni && tieneFin ? 'Incompleta: falta el inicial' : '';
      filas.push({ ...base, horasHorometro: null, diferencia: null, estado: 'sin_lectura', estadoDetalle: detalle });
      continue;
    }
    const hh = redondear(horas.reduce((s, h) => s + h, 0));
    const dif = redondear(hh - hj);
    const estado: FilaComparativa['estado'] = Math.abs(dif) <= TOLERANCIA_CUADRA ? 'cuadra' : dif > 0 ? 'horometro_mayor' : 'jornada_mayor';
    filas.push({ ...base, horasHorometro: hh, diferencia: dif, estado });
  }

  // ⭐ LAS LECTURAS SIN JORNADA TAMBIÉN SALEN (02-oct-2026, reportado: «el reporte de
  //    horómetro no está tomando los rangos para traer información»).
  //
  //    Hasta hoy el comparador recorría SOLO las rondas: una lectura de un día sin
  //    jornada en `machine_rounds` no generaba fila y desaparecía del papel —y el
  //    papel hasta lo decía: «una fila por máquina y día con ronda». Control permite
  //    cargar o corregir el horómetro de un día sin jornada a propósito, así que ese
  //    dato existía y nadie podía verlo. Ahora sale como «Sin jornada»: con sus
  //    números de Inicio/Fin y sus horas de horómetro, con 0 h de jornada y SIN
  //    diferencia (no hay contra qué comparar), de modo que nunca cuenta para la
  //    racha de «lista para encender» ni para cuadrar.
  for (const [k, del] of porClave) {
    if (conRonda.has(k)) continue;
    const [machineryId, fecha] = k.split('|');
    if (!machineryId || !fecha) continue;
    // Con mapa de fichas, se respeta el recorte de la pantalla (empresa/equipos).
    if (fichas && !fichas.has(machineryId)) continue;
    const f = fichas?.get(machineryId);
    const ord = [...del].sort((a, b) => (a.shift === b.shift ? 0 : a.shift === 'day' ? -1 : 1));
    const marca = marcaDeCorreccion(ord);
    const invalidas = del.filter((l) => !l.valida);
    const horas = invalidas.length ? [] : del.map(horasDeLectura).filter((h): h is number => h != null);
    const hh = horas.length ? redondear(horas.reduce((s, h) => s + h, 0)) : null;
    const tieneIni = del.some((l) => l.inicial != null);
    const tieneFin = del.some((l) => l.final != null);
    // La razón, cuando la hay, se suma a «sin jornada» para que el estado diga las dos cosas.
    const motivos: string[] = [];
    for (const l of invalidas) { const m = limpio(l.motivoInvalida); if (m && !motivos.includes(m)) motivos.push(m); }
    const razon = motivos.length ? motivos.join(' · ')
      : hh == null ? (tieneIni && !tieneFin ? 'incompleta: falta el final' : !tieneIni && tieneFin ? 'incompleta: falta el inicial' : '') : '';
    filas.push({
      machineryId, code: limpio(f?.code) || '—', empresa: limpio(f?.empresa) || '—',
      marca: limpio(f?.marca), modelo: limpio(f?.modelo), placa: limpio(f?.placa), fecha,
      horasJornada: 0,
      inicial: ord.find((l) => l.inicial != null)?.inicial ?? null,
      final: [...ord].reverse().find((l) => l.final != null)?.final ?? null,
      corregida: marca.corregida, motivo: marca.motivo,
      horasHorometro: hh, diferencia: null, estado: 'sin_ronda',
      estadoDetalle: razon ? `sin jornada · ${razon}` : '',
    });
  }
  return filas.sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : cmp(a.code, b.code)));
}

// ── 🕒 EL HORÓMETRO EN EL INFORME POR JORNADA (26-sep-2026) ─────────────────
//
// Pedido del cliente, textual: «se esta modificando el horometro desde control
// pero en los reportes por jornada y por horometro no se refleja, sincroniza eso,
// cuando es cambio sea manual que se refleje en el reporte las horas el inicio y
// el fin».
//
// ⚠️ EL INFORME POR JORNADA NO LEÍA ESTA TABLA. Se arma con `machine_rounds`, que
//    es lo que PAGA; el horómetro de trabajo vive aparte (modo sombra) y por eso
//    una corrección hecha en Control no aparecía por ningún lado. Esto no cambia
//    lo que se paga: agrega el dato al lado, para poder compararlos.

/** Lo que el informe por jornada muestra de una máquina en todo el rango. */
export type HorometroDeMaquina = {
  /** Con el que arrancó el PRIMER día del rango. */
  inicial: number | null;
  /** Con el que terminó el ÚLTIMO día del rango. */
  final: number | null;
  /** La suma de las horas de cada día, NO `final − inicial`. */
  horas: number | null;
  /** Días con lectura completa. */
  dias: number;
  corregida: boolean;
  motivo: string;
};

/**
 * El horómetro de cada máquina en el rango, para el informe por jornada.
 *
 * ⚠️ LAS HORAS SE SUMAN DÍA POR DÍA, no se restan las puntas. Restar el último
 *    menos el primero contaría también las horas que la máquina trabajó para otro
 *    (o en un día que no entró al informe por un filtro), y el número no cuadraría
 *    con la suma de los días que el papel sí muestra.
 */
export function horometroPorMaquina(
  lecturas: readonly LecturaTrabajo[] | null | undefined,
): Map<string, HorometroDeMaquina> {
  const porMaquina = new Map<string, LecturaTrabajo[]>();
  for (const l of lecturas ?? []) {
    if (!l || !l.machineryId) continue;
    const a = porMaquina.get(l.machineryId);
    if (a) a.push(l); else porMaquina.set(l.machineryId, [l]);
  }
  const out = new Map<string, HorometroDeMaquina>();
  for (const [id, ls] of porMaquina) {
    // Orden real: por día y, dentro del día, el turno de día antes que el de noche.
    const clave = (l: LecturaTrabajo) => `${String(l.roundDate ?? '').slice(0, 10)}|${l.shift === 'night' ? '1' : '0'}`;
    const ord = [...ls].sort((a, b) => (clave(a) < clave(b) ? -1 : clave(a) > clave(b) ? 1 : 0));
    const horas = ord.map(horasDeLectura).filter((h): h is number => h != null);
    const marca = marcaDeCorreccion(ord);
    out.set(id, {
      inicial: ord.find((l) => l.inicial != null)?.inicial ?? null,
      final: [...ord].reverse().find((l) => l.final != null)?.final ?? null,
      horas: horas.length ? redondear(horas.reduce((s, h) => s + h, 0)) : null,
      dias: new Set(ord.filter((l) => horasDeLectura(l) != null).map((l) => String(l.roundDate).slice(0, 10))).size,
      corregida: marca.corregida,
      motivo: marca.motivo,
    });
  }
  return out;
}

/** La línea que sale bajo la máquina en el informe por jornada. '' si no hay nada que decir. */
export function lineaHorometroJornada(h: HorometroDeMaquina | null | undefined): string {
  if (!h) return '';
  if (h.inicial == null && h.final == null && h.horas == null) return '';
  const horas = h.horas == null ? '' : ` = ${fmtH(h.horas)} h`;
  const corr = h.corregida ? ` ✎ corregido a mano${h.motivo ? `: ${h.motivo}` : ''}` : '';
  return `🕒 Horómetro: ${fmtNum(h.inicial)} → ${fmtNum(h.final)}${horas}${corr}`;
}

export type ResumenComparativo = {
  filas: number; maquinas: number; conLectura: number;
  cuadran: number; horometroMayor: number; jornadaMayor: number; invalidas: number; sinLectura: number;
  /** Lecturas de días SIN jornada registrada (02-oct-2026). */
  sinRonda: number;
  /** ✎ Cuántas se corrigieron a mano desde Control (26-sep-2026). */
  corregidas: number;
  horasJornada: number; horasHorometro: number;
  listas: { code: string; dias: number }[];
};

/** Un día «bueno» para el criterio de salida: cuadra, o se va por 3 h o menos; nunca una inválida. */
// «sin_ronda» tampoco es bueno: sin jornada no hay contra qué cuadrar (02-oct-2026).
const diaBueno = (f: FilaComparativa) => f.estado !== 'invalida' && f.estado !== 'sin_ronda' && (f.estado === 'cuadra' || (f.diferencia != null && Math.abs(f.diferencia) <= TOLERANCIA_LISTA));

export function resumenComparativo(filas: readonly FilaComparativa[]): ResumenComparativo {
  const fs = filas ?? [];
  const r: ResumenComparativo = {
    filas: fs.length, maquinas: new Set(fs.map((f) => f.machineryId)).size, conLectura: 0,
    cuadran: 0, horometroMayor: 0, jornadaMayor: 0, invalidas: 0, sinLectura: 0, sinRonda: 0, corregidas: 0,
    horasJornada: 0, horasHorometro: 0, listas: [],
  };
  for (const f of fs) {
    r.horasJornada += num(f.horasJornada);
    if (f.corregida) r.corregidas++;
    if (f.horasHorometro != null) { r.conLectura++; r.horasHorometro += num(f.horasHorometro); }
    if (f.estado === 'cuadra') r.cuadran++;
    else if (f.estado === 'horometro_mayor') r.horometroMayor++;
    else if (f.estado === 'jornada_mayor') r.jornadaMayor++;
    else if (f.estado === 'invalida') r.invalidas++;
    else if (f.estado === 'sin_ronda') r.sinRonda++;
    else r.sinLectura++;
  }
  r.horasJornada = redondear(r.horasJornada);
  r.horasHorometro = redondear(r.horasHorometro);

  // «Listas»: la racha más larga de días SEGUIDOS buenos por máquina; entra con 5 o más.
  const porMaquina = new Map<string, FilaComparativa[]>();
  for (const f of fs) { const a = porMaquina.get(f.machineryId); if (a) a.push(f); else porMaquina.set(f.machineryId, [f]); }
  for (const [, dias] of porMaquina) {
    const orden = [...dias].sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0));
    let mejor = 0, racha = 0, anterior = '';
    for (const f of orden) {
      if (f.fecha === anterior) continue; // dos filas del mismo día no cuentan doble
      if (diaBueno(f)) racha = anterior && diaSiguiente(anterior) === f.fecha && racha > 0 ? racha + 1 : 1;
      else racha = 0;
      if (racha > mejor) mejor = racha;
      anterior = f.fecha;
    }
    if (mejor >= DIAS_PARA_LISTA) r.listas.push({ code: orden[0].code, dias: mejor });
  }
  r.listas.sort((a, b) => cmp(a.code, b.code));
  return r;
}

// ── PAPEL ────────────────────────────────────────────────────────────────────

export const CSS_COMPARATIVO = `
  .r{text-align:right}
  .hc table{table-layout:fixed;width:100%;font-size:9px}
  .hc th,.hc td{padding:3px 5px;word-break:break-word;overflow-wrap:anywhere;vertical-align:top}
  .hc th.r,.hc td.r{width:62px}
  .hc-res{display:flex;flex-wrap:wrap;gap:8px;margin:6px 0 10px}
  .hc-res div{background:#F1F5F9;border-radius:6px;padding:6px 10px;font-size:11px}
  .hc-res b{font-size:14px;display:block}
  .hc-ok td{background:#ECFDF5}
  .hc-ok .est{color:#047857;font-weight:700}
  .hc-mas td{background:#FFFBEB}
  .hc-mas .est{color:#92400E;font-weight:700}
  .hc-menos td{background:#FEF2F2}
  .hc-menos .est{color:#B91C1C;font-weight:700}
  .hc-sin td{color:#6B7280}
  .hc-sin .est{font-style:italic}
  .hc-corr{color:#1D4ED8;font-size:8px;font-weight:700}
  .hc h3.sect{margin:18px 0 6px;font-size:14px;color:#fff;background:#1E3A5F;padding:7px 12px;border-radius:6px}
  .hc h3.sect span{font-weight:400;color:#CFE0F2;font-size:11px}
  .hc .nota{font-size:10px;color:#555;margin:4px 0 8px}
  .hf{display:flex;flex-wrap:wrap;gap:8px;margin:6px 0 10px}
  .hf figure{margin:0;width:172px}
  .hf img{width:100%;height:130px;object-fit:cover;border-radius:6px;border:1px solid #E2E8F0;background:#F8FAFC}
  .hf figcaption{font-size:9px;color:#334155;margin-top:2px;word-break:break-word}
`;

const ETIQUETA_ESTADO: Record<FilaComparativa['estado'], string> = {
  cuadra: 'Cuadra', horometro_mayor: 'Horómetro mayor', jornada_mayor: 'Jornada mayor', sin_lectura: 'Sin lectura', invalida: 'Inválida',
  sin_ronda: 'Sin jornada',
};
/** El texto de la columna Estado: la RAZÓN cuando la hay (27-sep-2026), la
 *  etiqueta genérica cuando no. Con la primera letra en mayúscula, que los
 *  motivos de la base vienen en minúscula («salto mayor a 12,5 h»). */
export function etiquetaDeEstado(f: Pick<FilaComparativa, 'estado' | 'estadoDetalle'>): string {
  const d = limpio(f.estadoDetalle);
  if (!d) return ETIQUETA_ESTADO[f.estado];
  return d.charAt(0).toUpperCase() + d.slice(1);
}
const CLASE_ESTADO: Record<FilaComparativa['estado'], string> = {
  cuadra: 'hc-ok', horometro_mayor: 'hc-mas', jornada_mayor: 'hc-menos', sin_lectura: 'hc-sin', invalida: 'hc-menos',
  sin_ronda: 'hc-sin',
};

// ── QUÉ SE OCULTA (las pastillas del reporte, 25-sep-2026) ───────────────────────
// Pedido del cliente: el reporte de horómetros «igual de ajustable que los otros».
// ⭐ LO OCULTO NO DEJA RASTRO en el papel: ni columna en blanco, ni «(oculto)», ni un
//    derivado que lo delate. Por eso apagar la jornada tumba TAMBIÉN la diferencia, el
//    estado, los colores del cuadre y las «listas» (todos se calculan contra ella), y
//    hasta el título del papel cambia (tituloComparativo / subtituloComparativo).

export type OpcionesComparativo = {
  sinMarca: boolean; sinModelo: boolean; sinPlaca: boolean;
  sinEmpresa: boolean; sinJornada: boolean; sinResumen: boolean; sinListas: boolean; sinDetalle: boolean;
  /** 🚫 Las columnas Inicio y Fin del horómetro (26-sep-2026). */
  sinInicioFin: boolean;
};
export const OPCIONES_COMPARATIVO_COMPLETO: OpcionesComparativo = {
  sinMarca: false, sinModelo: false, sinPlaca: false,
  sinEmpresa: false, sinJornada: false, sinResumen: false, sinListas: false, sinDetalle: false,
  sinInicioFin: false,
};
export const PASTILLAS_COMPARATIVO: { key: keyof OpcionesComparativo; chip: string; largo: string; archivo: string }[] = [
  { key: 'sinMarca', chip: '🚫 Marca', largo: 'marca', archivo: 'sin marca' },
  { key: 'sinModelo', chip: '🚫 Modelo', largo: 'modelo', archivo: 'sin modelo' },
  { key: 'sinPlaca', chip: '🚫 Serial / Placa', largo: 'serial/placa', archivo: 'sin placa' },
  { key: 'sinEmpresa', chip: '🚫 Nombre de empresas', largo: 'nombre de empresas', archivo: 'sin empresas' },
  { key: 'sinJornada', chip: '🚫 Horas de jornada', largo: 'horas de jornada (con su diferencia, estado y «listas»)', archivo: 'solo horometro' },
  { key: 'sinInicioFin', chip: '🚫 Inicio / Fin', largo: 'el inicio y el fin del horómetro', archivo: 'sin inicio fin' },
  { key: 'sinResumen', chip: '🚫 Resumen', largo: 'cajas del resumen', archivo: 'sin resumen' },
  { key: 'sinListas', chip: '🚫 Máquinas listas', largo: 'máquinas listas para encender', archivo: 'sin listas' },
  { key: 'sinDetalle', chip: '🚫 Detalle por día', largo: 'detalle día por día', archivo: 'sin detalle' },
];
export function alternarComparativo(o: OpcionesComparativo, key: keyof OpcionesComparativo): OpcionesComparativo {
  return { ...o, [key]: !o[key] };
}
export function ocultosComparativoEnPalabras(o: OpcionesComparativo): string {
  const l = PASTILLAS_COMPARATIVO.filter((p) => o[p.key]).map((p) => p.largo);
  return l.length === 0 ? 'Sale completo.' : `No sale: ${l.join(', ')}.`;
}
export function sufijoArchivoComparativo(o: OpcionesComparativo): string {
  const l = PASTILLAS_COMPARATIVO.filter((p) => o[p.key]).map((p) => p.archivo);
  return l.length === 0 ? '' : ` - ${l.join(' - ')}`;
}
/** Sin jornada, el papel no puede seguir llamándose «vs jornada»: delataría lo oculto. */
export function tituloComparativo(o: OpcionesComparativo): string {
  return o.sinJornada ? 'HORÓMETRO DE TRABAJO (MODO SOMBRA)' : 'HORÓMETRO VS JORNADA (MODO SOMBRA)';
}
/** Marca / Modelo se funden en una columna, como en ubicaciones. */
export function tituloMarcaModeloComp(o: OpcionesComparativo): string {
  return !o.sinMarca && !o.sinModelo ? 'Marca / Modelo' : !o.sinMarca ? 'Marca' : 'Modelo';
}
export function subtituloComparativo(o: OpcionesComparativo): string {
  return o.sinJornada
    ? 'Horas del horómetro de trabajo, máquina por máquina y día por día'
    : 'Jornada declarada vs horómetro de trabajo, máquina por máquina y día por día';
}

/** Cuerpo HTML del comparativo: resumen, máquinas listas para encender y una tabla por día.
 *  `o` dice qué se oculta (pastillas de arriba); sin `o`, sale completo, como siempre. */
export function cuerpoComparativo(
  d: { desde: string; hasta: string; filas: FilaComparativa[] },
  o: OpcionesComparativo = OPCIONES_COMPARATIVO_COMPLETO,
): string {
  const filas = d.filas ?? [];
  const r = resumenComparativo(filas);
  const caja = (t: string, v: string | number) => `<div><b>${esc(v)}</b>${esc(t)}</div>`;
  let html = `<div class="hc">`;
  // La nota explica lo que cambió el 26-sep-2026: de dónde salen las horas (Inicio y
  // Fin, a la vista) y qué significa el ✎ azul.
  // ⚠️ NI UNA PALABRA QUE DELATE LO OCULTO. Con «🚫 Horas de jornada» encendida, el
  //    papel no puede ni nombrar la jornada: por eso acá se dice «el día».
  const notaIF = o.sinInicioFin ? '' : ' <b>Inicio</b> y <b>Fin</b> son los números del tablero con los que arrancó y terminó el día.';
  const notaCorr = r.corregidas > 0
    ? ` <span style="color:#1D4ED8"><b>✎ corregido a mano</b> marca las ${r.corregidas} lectura(s) que se arreglaron desde Control, con el motivo que escribió quien las corrigió.</span>`
    : '';
  // 02-oct-2026: ya no es «día con ronda» a secas — una lectura de un día sin jornada
  // también tiene su fila («Sin jornada»). Con 🚫 Horas de jornada encendida no se
  // puede ni nombrar la jornada, por eso la primera versión dice solo «día con datos».
  html += o.sinJornada
    ? `<p class="nota">Del ${dmy(d.desde)} al ${dmy(d.hasta)}. Una fila por máquina y día con datos; horas = final − inicial del horómetro de trabajo, por turno. «—» = sin lectura completa ese día.${notaIF}${notaCorr}</p>`
    : `<p class="nota">Del ${dmy(d.desde)} al ${dmy(d.hasta)}. Una fila por máquina y día con jornada o con lectura de horómetro; el horómetro se compara contra la jornada del inspector. Cuadra = diferencia de media hora o menos. «Sin jornada» = hubo lectura pero ese día no se registró jornada.${notaIF}${notaCorr}</p>`;
  if (!o.sinResumen) {
    // 02-oct-2026: `filas` ahora incluye las de «sin jornada»; «días con ronda» las resta.
    // Con 🚫 Horas de jornada encendida no se nombra la jornada: la caja dice solo «días».
    html += `<div class="hc-res">` + caja('máquinas', r.maquinas)
      + (o.sinJornada ? caja('días', r.filas) : caja('días con ronda', r.filas - r.sinRonda))
      + caja('con lectura', r.conLectura);
    if (!o.sinJornada) html += caja('cuadran', r.cuadran) + caja('horómetro mayor', r.horometroMayor) + caja('jornada mayor', r.jornadaMayor);
    html += caja('inválidas', r.invalidas) + caja('sin lectura', r.sinLectura);
    // «Sin jornada» (02-oct-2026): solo si hay alguna, como las corregidas — un cero
    // permanente es ruido. Y nunca con la jornada oculta: nombrarla la delataría.
    if (!o.sinJornada && r.sinRonda > 0) html += caja('sin jornada', r.sinRonda);
    // ✎ La caja solo sale si hubo correcciones: un cero permanente es ruido.
    if (r.corregidas > 0) html += caja('✎ corregidas a mano', r.corregidas);
    if (!o.sinJornada) html += caja('h jornada', fmtH(r.horasJornada));
    html += caja('h horómetro', fmtH(r.horasHorometro)) + `</div>`;
  }

  if (!o.sinListas && !o.sinJornada) {
    html += `<h3 class="sect">Máquinas listas para encender <span>${DIAS_PARA_LISTA} días seguidos cuadrando (±${TOLERANCIA_LISTA} h) sin lecturas inválidas</span></h3>`;
    if (r.listas.length === 0) html += `<p class="nota">Ninguna todavía.</p>`;
    else {
      html += `<table><thead><tr><th>Máquina</th><th class="r">Días seguidos</th></tr></thead><tbody>`;
      for (const m of r.listas) html += `<tr class="hc-ok"><td>${esc(m.code)}</td><td class="r">${m.dias}</td></tr>`;
      html += `</tbody></table>`;
    }
  }

  if (!o.sinDetalle) {
    const porDia = new Map<string, FilaComparativa[]>();
    for (const f of filas) { const a = porDia.get(f.fecha); if (a) a.push(f); else porDia.set(f.fecha, [f]); }
    const fechas = [...porDia.keys()].sort();
    if (fechas.length === 0) html += `<p class="nota">Sin datos en el rango.</p>`;
    for (const fecha of fechas) {
      const del = [...(porDia.get(fecha) ?? [])].sort((a, b) => cmp(a.code, b.code));
      html += `<h3 class="sect">${dmy(fecha)} <span>${del.length} máquina(s)</span></h3>`;
      // 🕒 INICIO / FIN (26-sep-2026): las dos columnas que faltaban. Sin ellas, una
      //    corrección hecha en Control se veía como un número de horas distinto sin
      //    poder saber de dónde salía ni si alguien lo había tocado a mano.
      const colsIF = o.sinInicioFin ? '' : '<th class="r">Inicio</th><th class="r">Fin</th>';
      html += `<table><thead><tr><th>Máquina</th>${o.sinMarca && o.sinModelo ? '' : `<th>${tituloMarcaModeloComp(o)}</th>`}${o.sinPlaca ? '' : '<th>Serial / Placa</th>'}${o.sinEmpresa ? '' : '<th>Empresa</th>'}${o.sinJornada ? '' : '<th class="r">Jornada h</th>'}${colsIF}<th class="r">Horómetro h</th>${o.sinJornada ? '' : '<th class="r">Diferencia</th><th>Estado</th>'}</tr></thead><tbody>`;
      for (const f of del) {
        // La identidad de la máquina (25-sep-2026: «falta marca y modelo, placa»), cada
        // pedazo con su pastilla. Lo apagado no deja ni la celda.
        const ident = (o.sinMarca && o.sinModelo ? '' : `<td>${esc([!o.sinMarca ? f.marca : '', !o.sinModelo ? f.modelo : ''].filter(Boolean).join(' / '))}</td>`)
          + (o.sinPlaca ? '' : `<td>${esc(f.placa)}</td>`)
          + (o.sinEmpresa ? '' : `<td>${esc(f.empresa)}</td>`);
        const celdasIF = o.sinInicioFin ? ''
          : `<td class="r">${fmtNum(f.inicial)}</td><td class="r">${fmtNum(f.final)}</td>`;
        // ✎ La marca de «lo corrigieron a mano», con su motivo debajo del código.
        const marca = f.corregida
          ? `<br/><span class="hc-corr">✎ corregido a mano${f.motivo ? `: ${esc(f.motivo)}` : ''}</span>`
          : '';
        if (o.sinJornada) {
          // Sin jornada tampoco hay clase de color: el verde/ámbar/rojo ES el cuadre.
          html += `<tr><td>${esc(f.code)}${marca}</td>${ident}${celdasIF}<td class="r">${fmtH(f.horasHorometro)}</td></tr>`;
        } else {
          const dif = f.diferencia == null ? '—' : (f.diferencia > 0 ? '+' : '') + fmtH(f.diferencia);
          // Sin jornada no se imprime un «0» que parezca una jornada de cero horas: va «—».
          const hj = f.estado === 'sin_ronda' ? '—' : fmtH(f.horasJornada);
          html += `<tr class="${CLASE_ESTADO[f.estado]}"><td>${esc(f.code)}${marca}</td>${ident}<td class="r">${hj}</td>${celdasIF}<td class="r">${fmtH(f.horasHorometro)}</td><td class="r">${dif}</td><td class="est">${esc(etiquetaDeEstado(f))}</td></tr>`;
        }
      }
      html += `</tbody></table>`;
    }
  }
  html += `</div>`;
  return html;
}

// ── LAS FOTOS DE LOS TABLEROS (26-sep-2026) ───────────────────────────
// Pedido del cliente (dos tandas del mismo día): un check que NUNCA viene
// predefinido, y la galería ORGANIZADA POR MAQUINARIA — cada máquina con sus
// fotos en orden (día antes que noche, Inicial antes que Final) y cada foto con
// su fecha, la HORA en que se subió y QUIÉN la subió. Apagado el check, el papel
// ni las menciona; los filtros de empresa/equipos se aplican ANTES de llamar acá.

/** Hora Caracas (UTC-4 fijo, sin horario de verano) en «7:12 a. m.»; '' si no hay instante. */
const horaCaracas = (iso: string | null | undefined): string => {
  const t = Date.parse(String(iso ?? ''));
  if (!Number.isFinite(t)) return '';
  const p = new Date(t - 4 * 3600000);
  const h24 = p.getUTCHours();
  const mm = String(p.getUTCMinutes()).padStart(2, '0');
  return `${h24 % 12 === 0 ? 12 : h24 % 12}:${mm} ${h24 < 12 ? 'a. m.' : 'p. m.'}`;
};

/**
 * Una foto ADICIONAL del histórico (tabla `horometro_fotos`, 26-sep-2026): el
 * inspector puede subir cuantas quiera, de cámara o de galería, y cada una
 * guarda quién y cuándo. Tipo estructural propio: este archivo no importa nada.
 */
export type FotoExtraComparativo = {
  machineryId: string;
  roundDate: string;
  shift: Turno;
  url: string;
  subidaAt: string | null;
  /** El nombre CONGELADO al subir (manda sobre `nombreDe`: es lo que se firmó). */
  subidaPorNombre: string | null;
};

export function seccionFotosComparativo(
  lecturas: readonly LecturaTrabajo[],
  fichaDe: (machineryId: string) => { code: string; empresa: string; placa?: string } | undefined,
  o: OpcionesComparativo = OPCIONES_COMPARATIVO_COMPLETO,
  nombreDe?: (userId: string) => string | undefined,
  extras: readonly FotoExtraComparativo[] = [],
): string {
  type Foto = { mkey: string; titulo: string; fecha: string; code: string; shift: Turno; etiqueta: string; valor: number | null; url: string; hora: string; autor: string; orden: number; sub: string };
  const fotos: Foto[] = [];
  const tituloDe = (m: { code: string; empresa: string; placa?: string }) => {
    const placa = limpio(m.placa);
    // El encabezado de la máquina respeta las pastillas: lo oculto no deja rastro.
    return esc(limpio(m.code)) + (o.sinPlaca || !placa ? '' : ' · ' + esc(placa)) + (o.sinEmpresa ? '' : ' · ' + esc(limpio(m.empresa)));
  };
  for (const l of lecturas ?? []) {
    if (!l) continue;
    const m = fichaDe(l.machineryId);
    if (!m) continue; // fuera del filtro del reporte: su foto tampoco sale
    const fecha = String(l.roundDate ?? '').slice(0, 10);
    const titulo = tituloDe(m);
    const quien = (id?: string | null) => limpio(nombreDe?.(String(id ?? '')) ?? '');
    if (l.fotoInicialUrl) fotos.push({ mkey: l.machineryId, titulo, fecha, code: limpio(m.code), shift: l.shift, etiqueta: 'Inicial', valor: l.inicial, url: l.fotoInicialUrl, hora: horaCaracas(l.createdAt), autor: quien(l.createdBy), orden: 0, sub: '' });
    if (l.fotoFinalUrl) fotos.push({ mkey: l.machineryId, titulo, fecha, code: limpio(m.code), shift: l.shift, etiqueta: 'Final', valor: l.final, url: l.fotoFinalUrl, hora: horaCaracas(l.updatedAt ?? l.createdAt), autor: quien(l.updatedBy ?? l.createdBy), orden: 1, sub: '' });
  }
  // Las ADICIONALES del histórico, detrás de Inicial/Final de su misma jornada
  // y turno, en el orden en que se subieron. Mismo filtro que las lecturas: una
  // máquina fuera del reporte tampoco enseña sus adicionales.
  for (const f of extras ?? []) {
    if (!f || !f.url) continue;
    const m = fichaDe(f.machineryId);
    if (!m) continue;
    fotos.push({
      mkey: f.machineryId, titulo: tituloDe(m), fecha: String(f.roundDate ?? '').slice(0, 10),
      code: limpio(m.code), shift: f.shift, etiqueta: 'Adicional', valor: null, url: f.url,
      hora: horaCaracas(f.subidaAt), autor: limpio(f.subidaPorNombre), orden: 2, sub: String(f.subidaAt ?? ''),
    });
  }
  // Por MÁQUINA y, dentro de cada una: fecha → día antes que noche → Inicial,
  // Final y después las adicionales por hora de subida. Sin adicionales, el
  // orden es EXACTAMENTE el de siempre (amarrado por test byte a byte).
  fotos.sort((a, b) => cmp(a.code, b.code) || cmp(a.titulo, b.titulo)
    || (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0)
    || (a.shift === b.shift ? 0 : a.shift === 'day' ? -1 : 1)
    || (a.orden - b.orden)
    || cmp(a.sub, b.sub));
  let html = `<div class="hc"><h3 class="sect">📷 Fotos de los horómetros <span>${fotos.length} foto(s), tal como las subió el inspector</span></h3>`;
  if (fotos.length === 0) return html + `<p class="nota">Sin fotos en el rango.</p></div>`;
  const porMaquina = new Map<string, Foto[]>();
  for (const f of fotos) { const a = porMaquina.get(f.mkey); if (a) a.push(f); else porMaquina.set(f.mkey, [f]); }
  for (const [, del] of porMaquina) {
    html += `<h3 class="sect">${del[0].titulo} <span>${del.length} foto(s)</span></h3><div class="hf">`;
    for (const f of del) {
      const cap = `${dmy(f.fecha)} · ${f.shift === 'night' ? '🌙 noche' : '☀️ día'} · ${esc(f.etiqueta)}${f.valor == null ? '' : ' ' + fmtH(f.valor)}${f.hora ? ` · subida ${f.hora}` : ''}${f.autor ? ` · ${esc(f.autor)}` : ''}`;
      html += `<figure><img src="${esc(f.url)}"/><figcaption>${cap}</figcaption></figure>`;
    }
    html += `</div>`;
  }
  return html + `</div>`;
}
