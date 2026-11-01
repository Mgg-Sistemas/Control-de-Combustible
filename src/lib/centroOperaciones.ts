// 🏭 CENTRO DE OPERACIONES — LA LIBRERÍA DE CÁLCULO (23-oct-2026).
//
// Pedido del cliente: un mini sistema para operar un sitio (el primero es un CDT)
// donde ella anota lo que entra, se mueve y sale, y saca sus papeles. «Que pueda
// RECIBIR información pero no ENVIARLA»: el módulo vive aparte de Viajes.
//
// ⭐ ACÁ VIVEN TODAS LAS CUENTAS. Las pantallas y los papeles solo las pintan:
// así el consolidado, el corte y el listado no pueden contradecirse.
//
// LAS REGLAS (diseño, sección 7.6):
//   · La JORNADA va de 7am a 7am: una `hora` anterior a las 07:00 ocurrió el día
//     calendario SIGUIENTE a su `fecha`. Con un corte con hora se compara el
//     momento real; un renglón sin hora entra si su fecha está en el rango. Un CORTE
//     a las 07:00 en punto cierra la jornada (`momentoDelCorte`, R33); un renglón a
//     esa hora la abre (`momentoReal`).
//   · m³ = `m3` si lo escribió; si no, viajes × capacidad; si falta uno, no suma.
//   · Un renglón `por_confirmar` NUNCA suma a viajes, toneladas ni m³. Se avisa
//     aparte: sin número → «(+N pendiente)» (N = renglones); con número →
//     «(+V por confirmar)» (V = viajes). Si hay de los dos, salen los dos.
//   · `esperando_pesaje` SÍ suma sus viajes y sus m³, pero ni sus toneladas (aún
//     sin peso neto) ni el promedio.
//   · Promedio t/viaje: solo sobre ENTRADAS confirmadas con viajes y toneladas.
//   · Lo escrito igual pero con otras mayúsculas, tildes o espacios («Transportista
//     A» y « transportista a ») es UNA sola fila, con la primera forma escrita.
//   · Se redondea AL FINAL (toneladas y m³ a 2 decimales, % a 1), nunca por renglón.
//   · Lo que no se entiende jamás se vuelve NaN: o es «sin dato» (null) o es 0.
//   · La PRODUCCIÓN (tipo 'produccion': los bloques de la cantera, 24-oct-2026) se
//     cuenta en PIEZAS (`cantidad`) y NUNCA suma a viajes, toneladas ni m³: ni en los
//     totales, ni en las tablas, ni en el consolidado, ni en el corte. Sus renglones sí
//     salen en el listado (y cuentan como renglones).
//
// ⭐ Una unidad dada de baja, o un renglón que nunca se vinculó a una unidad,
//    SIGUEN SALIENDO con su texto congelado: esta librería no sabe de altas ni
//    bajas, solo de renglones.
// ⭐ De qué unidad es cada renglón lo decide UNA sola regla (`unidadDeLosRenglones`):
//    el listado, la tabla por unidad y el corte la comparten. Quien pinta los papeles
//    la arma UNA vez con la LISTA BASE (todo lo cargado del sitio, antes de filtrar) y
//    se la pasa a todos: armada con un subconjunto podría decir otra cosa.
// ⭐ Lo escrito en blanco y lo escrito «Sin destino» (o «Sin transportista»…) son el
//    MISMO grupo, también al filtrar: nunca salen dos filas o columnas iguales.
//
// TODO ESTE ARCHIVO ES PURO: sin React ni Supabase, y lo único que importa es
// `./text` (comparar y normalizar) y `./numeros` (leer cifras escritas a mano).
// `scripts/test-centro-operaciones.mjs` lo prueba solo.
import { cmpText, norm } from './text';
import { leerNumero } from './numeros';

// ═══════════════════════════ Tipos ═══════════════════════════

/** 'produccion' (Parte diario, 24-oct-2026): lo producido en el sitio (los bloques de la
 *  cantera), en piezas (`cantidad`). No es un viaje: no suma a viajes, toneladas ni m³. */
export type TipoMov = 'entrada' | 'interno' | 'salida' | 'otro' | 'produccion';
export type EstadoMov = 'confirmado' | 'por_confirmar' | 'esperando_pesaje';
export type ClaseLista = 'transportista' | 'origen' | 'destino' | 'material' | 'terraza';
/** Con qué salió una salida: un vehículo NUESTRO (placa y chofer) o uno EXTERNO (la empresa). */
export type VehiculoMov = 'propio' | 'externo';
/** La unidad en que ella ESCRIBIÓ la cantidad (las otras se calculan): m³, t, kg o piezas. */
export type UnidadIngresada = 'm3' | 't' | 'kg' | 'u';
/** La MARCA que el sitio le pone a una máquina. Vive SOLO en el módulo: no toca Control ni el
 *  catálogo. En una unidad vinculada al catálogo, «sin marca» (null) = manda inspección (mesa
 *  de maquinaria, P1); una unidad del sitio (sin vínculo) nunca queda sin marca (lo exige la base). */
export type EstadoUnidad = 'disponible' | 'averiada';

/** Un renglón de `cop_movimientos`: una anotación (una pesada o el total del día). */
export type Movimiento = {
  id: string;
  sitioId: string;
  /** Fecha de JORNADA (7am a 7am), «YYYY-MM-DD». */
  fecha: string;
  /** «HH:MM» (o «HH:MM:SS» tal como la devuelve Postgres). Opcional. */
  hora: string | null;
  tipo: TipoMov;
  unidadId: string | null;
  /** El texto congelado de la unidad: es el que MANDA en los papeles. */
  unidadTexto: string;
  placa: string | null;
  transportista: string | null;
  transportistaId: string | null;
  origen: string | null;
  origenId: string | null;
  destino: string | null;
  destinoId: string | null;
  material: string | null;
  materialId: string | null;
  capacidadM3: number | null;
  viajes: number | null;
  toneladas: number | null;
  m3: number | null;
  estado: EstadoMov;
  observacion: string | null;
  // ── Parte diario (24-oct-2026) ──
  /** El chofer del vehículo propio (sale de la unidad; congelado como texto). */
  chofer: string | null;
  /** Los km del destino CONGELADOS al anotar la salida (si luego cambian, este no). */
  km: number | null;
  vehiculo: VehiculoMov | null;
  /** Piezas (bloques producidos o vendidos). Con cantidad, los viajes pueden faltar. */
  cantidad: number | null;
  unidadIngresada: UnidadIngresada | null;
  /** Producción: desde qué día está disponible para la venta («YYYY-MM-DD»). */
  disponibleDesde: string | null;
  creadoPor: string | null;
  creadoAt: string | null;
  editadoPor: string | null;
  editadoAt: string | null;
};

/** Un camión o máquina de la flota del sitio (`cop_unidades`). */
export type Unidad = {
  id: string;
  sitioId: string;
  origen: 'catalogo' | 'propia';
  machineryId: string | null;
  codigo: string;
  descripcion: string | null;
  placa: string | null;
  serial: string | null;
  marca: string | null;
  modelo: string | null;
  dueno: string | null;
  capacidadM3: number | null;
  activo: boolean;
  nota: string | null;
  // ── Parte diario (24-oct-2026) ──
  /** La MARCA del sitio (26-oct-2026: puede faltar). null = «sin marca»: en una vinculada
   *  manda inspección; NUNCA se lee como «disponible». El estado que se muestra y se cuenta
   *  sale de `estadoDelSitio` (centroOperacionesMaquinariaBloques.ts), no de acá. */
  estado: EstadoUnidad | null;
  estadoNota: string | null;
  /** Cuándo se puso la marca (la base la sella en CADA marca, aunque repita el valor; null
   *  sin marca). Lo pone la BASE (un trigger): solo se lee, nunca se manda. */
  estadoAt: string | null;
  /** El chofer de la unidad: se copia solo en cada salida con vehículo propio. */
  chofer: string | null;
};

export type Sitio = {
  id: string;
  nombre: string;
  nota: string | null;
  activo: boolean;
  ubicacionId: string | null;
  /** GPS del sitio (para sugerir los km hasta cada destino). */
  lat: number | null;
  lng: number | null;
};

/** Un nombre de las listas de apoyo (`cop_listas`). */
export type ItemLista = {
  id: string;
  sitioId: string | null;
  clase: ClaseLista;
  nombre: string;
  activo: boolean;
  // ── Parte diario (24-oct-2026) ──
  /** GPS del destino. */
  lat: number | null;
  lng: number | null;
  /** Destinos: km POR CARRETERA desde el sitio, confirmados por ella (≥ 0). */
  km: number | null;
  /** Materiales: toneladas por m³ (> 0). Sin factor, las salidas de agregados usan 1,2; el
   *  aluminio y el plástico se anotan en t o kg y no lo necesitan (lote 5, B16). */
  factorTM3: number | null;
  /** Materiales: días hasta que lo producido está disponible para la venta (bloques: 7). */
  diasDisponible: number | null;
};

/** Una fila del Reporte General guardado: una empresa o un frente con sus viajes y toneladas. */
export type FilaReporteDia = { nombre: string; viajes: number; toneladas: number };

/**
 * El Reporte General de UNA jornada del sitio tal como quedó guardado
 * (`cop_reportes_generales`, Parte diario, 24-oct-2026). Hay uno por sitio y jornada:
 * pegarlo de nuevo ese día lo REEMPLAZA.
 *
 * ⚠️ `fecha` es la JORNADA del reporte leído (no la fecha escrita en el texto) y, por
 *    la R28, un corte a las 07:00 o antes ocurrió el día calendario SIGUIENTE a esa
 *    jornada. Ojo: `momentoReal` manda las 07:00 en punto al MISMO día (es la regla de
 *    los renglones); el instante real de un CORTE es `momentoDelCorte` (R33: la misma
 *    regla para los papeles).
 */
export type ReporteGeneralGuardado = {
  id: string;
  sitioId: string;
  fecha: string;
  /** «HH:MM» (24 h) o null si el reporte no la traía. */
  horaCorte: string | null;
  viajesTotal: number | null;
  toneladasTotal: number | null;
  empresas: FilaReporteDia[];
  frentes: FilaReporteDia[];
  avisos: string[];
  /** El texto tal como lo pegó (para volver a leerlo o revisarlo). */
  textoOriginal: string;
  creadoPor: string | null;
  creadoAt: string | null;
  editadoPor: string | null;
  editadoAt: string | null;
};

/** Lo que ella anota por patio en un día (el `patioListaId` es el de su lista «terraza», si salió de ahí). */
export type PatioDelDia = { patio: string; patioListaId: string | null; viajes: number };

/**
 * Desde–hasta por fecha de jornada. Con `corteHora` el último día se corta a esa hora.
 *
 * `corteHora` es una hora DENTRO DE LA JORNADA `hasta` (7am a 7am): «18:30» es el
 * `hasta` a las 18:30, pero «05:00» es el día calendario SIGUIENTE a las 05:00 (entra
 * toda la jornada del `hasta`), y «07:00» en punto también: la cierra (R33, como el
 * Reporte General). ⚠️ Por eso el rótulo del corte en un papel sale de
 * `momentoDelCorte(hasta, corteHora)` —el instante real—, nunca del `hasta` con la hora
 * pelada: un corte «05:00» se leería 24 horas antes de lo que se sumó.
 */
export type RangoCop = { desde: string; hasta: string; corteHora?: string | null };

/** Filtros del listado. Una lista vacía (o ausente) NO filtra: «todos». */
export type FiltrosCop = {
  tipos?: TipoMov[];
  /** Claves de unidad: las que da `unidadDeLosRenglones(base)` (la misma regla que el
   *  corte), NO las de `claveUnidadDe`: un renglón suelto con la placa de una unidad
   *  vinculada es de esa unidad, y su clave suelta ya no lo trae. Las claves para
   *  ofrecer en un selector: `new Set(base.map(unidadDeLosRenglones(base)))`. */
  unidadIds?: string[];
  transportistas?: string[];
  origenes?: string[];
  destinos?: string[];
  materiales?: string[];
  estados?: EstadoMov[];
  /** Busca en unidad, placa, transportista, origen, destino, material y observación. */
  texto?: string;
};

export type Totales = {
  viajes: number;
  toneladas: number;
  m3: number;
  /** Toneladas por viaje de las entradas confirmadas con ambos datos; null si no hay. */
  promedioTonViaje: number | null;
  /** Renglones por confirmar SIN número de viajes. */
  pendientesSinNumero: number;
  /** Suma de viajes de los renglones por confirmar que SÍ traen número. */
  porConfirmarViajes: number;
  /** Cuántos renglones se contaron (todos los recibidos, también los por confirmar). */
  renglones: number;
};

export type FilaTabla = { clave: string; viajes: number; pct: number; toneladas: number; m3: number };

export type ModeloConsolidado = {
  /** Totales de lo RECIBIDO (las entradas): las tarjetas del papel. */
  totales: Totales;
  porTransportista: FilaTabla[];
  porOrigen: FilaTabla[];
  internos: { origen: string; destino: string; capacidadM3: number | null; viajes: number; m3: number }[];
  salidas: { material: string; destino: string; capacidadM3: number | null; estado: EstadoMov; viajes: number; toneladas: number; m3: number }[];
  textoSalidas: string[];
  /** Los internos por confirmar: no suman a la tabla, se avisan aparte. */
  pendientesInternos: PendientesCop;
  /** Las salidas por confirmar: no suman a la tabla, se avisan aparte. */
  pendientesSalidas: PendientesCop;
  /** No hay ni una entrada, ni un movimiento interno, ni una salida. */
  vacio: boolean;
};

/** Lo que está por confirmar: renglones sin número de viajes y viajes que sí lo traen. */
export type PendientesCop = { pendientesSinNumero: number; porConfirmarViajes: number };

export type FilaDiaCorte = {
  fecha: string;
  internos: number;
  salidas: Record<string, number>;
  /** El día trae algún renglón por confirmar (interno o salida). */
  pendiente: boolean;
  /** Cuánto de los INTERNOS de ese día está por confirmar (va en la columna de internos). */
  pendienteInternos: PendientesCop;
  /** Cuánto de las SALIDAS de ese día está por confirmar (va en la columna de salidas). */
  pendienteSalidas: PendientesCop;
  observaciones: string[];
};

export type ModeloCorte = {
  /** El nombre de la hoja: el de la `ficha` si llegó; si no, el texto congelado de sus renglones. */
  unidad: string;
  placa: string | null;
  /** Columnas de salida: un destino cada una, o la sola columna «Salidas». */
  destinos: string[];
  /** ¿Las salidas van una columna por destino? (el `columnasPorDestino` con que se armó).
   *  El papel arma el encabezado con ESTO, no con su propio op: así nunca salen «Salidas»
   *  sobre «Salidas» ni columnas por destino sin su encabezado. */
  porDestino: boolean;
  dias: FilaDiaCorte[];
  /** Los pendientes son SOLO de las salidas (la tarjeta de externos: «N (+M pendiente)»).
   *  Un interno por confirmar no los cambia: solo marca su día (`pendienteInternos`). */
  totales: { internos: number; salidas: number; total: number; pendientesSinNumero: number; porConfirmarViajes: number };
  /** Días que el papel muestra (si se esconden los vacíos, esos no cuentan). */
  diasEvaluados: number;
  /** La unidad no tiene ni un renglón en el período. */
  vacio: boolean;
};

type Orden = 'cantidad' | 'az';
type EjeTabla = 'transportista' | 'origen' | 'destino' | 'material' | 'unidad';

// ═══════════════════════════ Utilidades internas ═══════════════════════════

/** La jornada empieza a las 7am: lo anotado antes de esa hora es del día siguiente. */
const HORA_CAMBIO_JORNADA = 7;

/** Nombre de la columna única cuando las salidas no se separan por destino. */
const COLUMNA_SALIDAS = 'Salidas';

/** Cómo se llama lo que quedó escrito en blanco. */
const SIN_DATO: Record<EjeTabla, string> = {
  transportista: 'Sin transportista',
  origen: 'Sin origen',
  destino: 'Sin destino',
  material: 'Sin material',
  unidad: 'Sin unidad',
};

/** La llave de un texto del eje: lo escrito en blanco y lo escrito «Sin destino» son la MISMA. */
const llaveDe = (texto: string, eje: EjeTabla): string => norm(texto || SIN_DATO[eje]);
/** ¿Es «sin dato»? En blanco, o escrito igual que el rótulo del blanco (con otras mayúsculas o tildes). */
const esSinDato = (texto: string, eje: EjeTabla): boolean => llaveDe(texto, eje) === norm(SIN_DATO[eje]);
/** Cómo se imprime: lo escrito, o el rótulo de siempre («Sin destino») si es «sin dato». */
const rotuloDe = (texto: string, eje: EjeTabla): string => (esSinDato(texto, eje) ? SIN_DATO[eje] : texto);

/** Un número de verdad o null: nunca NaN, nunca Infinity, nunca texto. */
const num = (v: unknown): number | null => (typeof v === 'number' && isFinite(v) ? v : null);

/** Redondea al decimal pedido. El EPSILON evita que 1.005 se quede en 1.00. */
const redondear = (n: number, decimales: number): number => {
  const f = Math.pow(10, decimales);
  return Math.round((n + Number.EPSILON) * f) / f;
};
const r2 = (n: number): number => redondear(n, 2);

/** Texto limpio: sin espacios a los lados y con los dobles colapsados. */
const limpia = (s: unknown): string => String(s ?? '').replace(/\s+/g, ' ').trim();

/** Cifra impresa (igual que los demás reportes): 1.234,5. */
const fmt = (n: number): string => n.toLocaleString('es-VE', { maximumFractionDigits: 2 });

const plural = (n: number, uno: string, varios: string): string => (n === 1 ? uno : varios);

const viajesDe = (m: Movimiento): number => num(m.viajes) ?? 0;
/** Las toneladas que SUMAN: solo las de un renglón confirmado. Lo que espera pesaje
 *  todavía no tiene su peso neto, así que cualquier cifra escrita ahí no cuenta. */
const toneladasDe = (m: Movimiento): number => (m.estado === 'confirmado' ? num(m.toneladas) ?? 0 : 0);
const esPorConfirmar = (m: Movimiento): boolean => m.estado === 'por_confirmar';
/** La producción va en piezas: no es un viaje y no suma a viajes, toneladas ni m³. */
const esProduccion = (m: Movimiento): boolean => m.tipo === 'produccion';
/** Un por confirmar «sin número»: no trae viajes (o trae 0, que tampoco dice nada). */
const sinNumero = (m: Movimiento): boolean => !(viajesDe(m) > 0);

/**
 * ⭐ Una VENTA EN PIEZAS (los bloques que se venden, 📅 Parte diario → 🧱 Bloques): una
 *    salida con `cantidad` —o escrita en piezas— y SIN viajes. No es un viaje: el
 *    consolidado del sitio no la mete en su tabla de viajes (ni en sus pendientes) y va en
 *    la sección 7 del 📄 Reporte completo (auditoría del lote 5, A4). Una salida que sí
 *    trae viajes sigue siendo un viaje, aunque traiga cantidad.
 */
export function esVentaEnPiezas(m: Movimiento): boolean {
  return !!m && m.tipo === 'salida' && num(m.viajes) === null && (num(m.cantidad) !== null || m.unidadIngresada === 'u');
}

const cmpCapacidad = (a: number | null, b: number | null): number =>
  a === b ? 0 : a === null ? 1 : b === null ? -1 : a - b;
const ORDEN_ESTADO: Record<EstadoMov, number> = { confirmado: 0, esperando_pesaje: 1, por_confirmar: 2 };
/** «Más viajes primero» cuando se pide por cantidad; en A→Z no desempata nada. */
const porCantidad = (orden: Orden, a: { viajes: number }, b: { viajes: number }): number =>
  orden === 'cantidad' ? b.viajes - a.viajes : 0;

// ═══════════════════════════ Fechas ═══════════════════════════

/** Los años que se entienden. Un «9999» (o un año mal tecleado) hacía recorrer millones
 *  de días y terminaba en un RangeError que tumbaba la pantalla. */
const ANIO_MIN = 2000;
const ANIO_MAX = 2100;

/** ¿«YYYY-MM-DD» de verdad y con el año entre 2000 y 2100? Es LA cota del módulo: la
 *  usan los rangos y también ✍️ Cargar al validar (un renglón con otro año no entraría en
 *  ningún rango y se perdería de vista). */
export function fechaValida(f: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(f))) return false;
  const [a, m, d] = f.split('-').map(Number);
  if (a < ANIO_MIN || a > ANIO_MAX) return false;
  const dt = new Date(Date.UTC(a, m - 1, d));
  return dt.getUTCFullYear() === a && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Suma (o resta) días a una fecha «YYYY-MM-DD» sin pasar por la zona horaria del equipo. */
function sumarDias(f: string, n: number): string {
  const [a, m, d] = f.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Todas las fechas del rango, de la primera a la última. Rango al revés o basura → ninguna. */
function diasEntre(desde: string, hasta: string): string[] {
  if (!fechaValida(desde) || !fechaValida(hasta) || desde > hasta) return [];
  const dias: string[] = [];
  for (let d = desde; d <= hasta; d = sumarDias(d, 1)) dias.push(d);
  return dias;
}

// ═══════════════════════════ Cifras escritas a mano ═══════════════════════════

/**
 * Lee la cifra de un campo de texto. Punto o coma valen igual («12,34» = 12.34) y
 * los miles se entienden («4.321,09» = 4321.09): las reglas son las de `leerNumero`.
 * Campo vacío —o sin ni un dígito— es «sin dato» (null), NO un cero: un cero es una
 * cifra que ella escribió.
 */
export function numeroDeCampo(txt: string): number | null {
  const t = String(txt ?? '').trim();
  if (!/\d/.test(t)) return null;
  return leerNumero(t);
}

// ═══════════════════════════ Rango y filtros ═══════════════════════════

/**
 * El instante REAL de un renglón: fecha + hora, sumando un día si la hora es
 * anterior a las 07:00 (la jornada de 7am a 7am). `'YYYY-MM-DDTHH:MM'`, que se
 * compara bien como texto. Sin hora —o con una fecha u hora que no se entiende—, null.
 */
export function momentoReal(fecha: string, hora: string | null): string | null {
  if (!hora || !fechaValida(fecha)) return null;
  const h = /^(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(String(hora).trim());
  if (!h) return null;
  const hh = Number(h[1]);
  const mm = Number(h[2]);
  if (hh > 23 || mm > 59) return null;
  const dia = hh < HORA_CAMBIO_JORNADA ? sumarDias(fecha, 1) : fecha;
  return `${dia}T${String(hh).padStart(2, '0')}:${h[2]}`;
}

/**
 * ⭐ EL INSTANTE REAL DE UN CORTE — el único de los papeles (Ruling R33, revisión final
 * A#2, 25-oct-2026). Un corte es el FIN de lo que se cuenta en la jornada `fecha`: con una
 * hora antes de las 07:00 —y con las 07:00 EN PUNTO— la CIERRA, así que ocurre el día
 * calendario SIGUIENTE. Es la regla del Reporte General (R28, `instanteDelCorte`): antes los
 * papeles dejaban las 07:00 en el mismo día y un minuto (06:59 contra 07:00) movía el papel
 * 24 horas. `'YYYY-MM-DDTHH:MM'`, como `momentoReal`; sin hora o con basura, null.
 *
 * ⚠️ Un RENGLÓN anotado a las 07:00 en punto, en cambio, ABRE su jornada: ese es
 *    `momentoReal`. Solo el corte se corre: lo usan `enRango`, `corteCop`, `avisoCorte`
 *    y el período y el nombre del archivo de los papeles (`corteReal`).
 */
export function momentoDelCorte(fecha: string, hora: string | null | undefined): string | null {
  const real = momentoReal(fecha, hora ?? null);
  if (!real) return null;
  return real === `${fecha}T07:00` ? `${sumarDias(fecha, 1)}T07:00` : real;
}

/**
 * ⭐ EL RÓTULO DEL CORTE (texto plano), para la «Corte:» del consolidado: el instante
 * REAL que suma `enRango` (`momentoDelCorte`), nunca el `hasta` con la hora pelada.
 * «19:00» del 09 → «09/10/2026, 07:00 p. m.»; «05:00» del 09 → «10/10/2026, 05:00 a. m.»
 * y «07:00» del 09 → «10/10/2026, 07:00 a. m.» (la jornada va de 7am a 7am: esa hora ya
 * es del día calendario siguiente; las 07:00 en punto la cierran, R33). Sin hora —o con
 * una que no se entiende, que tampoco corta nada— es la jornada `hasta`: «09/10/2026».
 */
export function corteCop(r: RangoCop): string {
  const fechaLegible = (f: string): string => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(f ?? ''));
    return m ? `${m[3]}/${m[2]}/${m[1]}` : String(f ?? '');
  };
  const real = r.corteHora ? momentoDelCorte(r.hasta, r.corteHora) : null;
  if (!real) return fechaLegible(r.hasta);
  const hh = Number(real.slice(11, 13));
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${fechaLegible(real.slice(0, 10))}, ${String(h12).padStart(2, '0')}:${real.slice(14, 16)} ${hh < 12 ? 'a. m.' : 'p. m.'}`;
}

/**
 * ⭐ El ORDEN de una lista de renglones según la JORNADA (7am a 7am; auditoría A11):
 * por fecha de jornada; dentro de ella por el momento real (la madrugada, antes de las
 * 07:00, va DESPUÉS de las 23:00 de su fecha); lo que no tiene hora va al final de su
 * jornada; y a igual momento, por cuándo se cargó y por id (orden total y estable).
 * ✍️ Cargar lo usa tal cual y 📋 Registros al revés (lo más reciente arriba). Para
 * `.sort(cmpMovimientoJornada)`.
 */
export function cmpMovimientoJornada(a: Movimiento, b: Movimiento): number {
  const cmp = (x: string, y: string): number => (x < y ? -1 : x > y ? 1 : 0);
  // '~' va después de cualquier «YYYY-MM-DDTHH:MM»: sin hora = al final de la jornada.
  const momento = (m: Movimiento): string => momentoReal(m.fecha, m.hora) ?? '~';
  return cmp(String(a.fecha ?? ''), String(b.fecha ?? ''))
    || cmp(momento(a), momento(b))
    || cmp(String(a.creadoAt ?? ''), String(b.creadoAt ?? ''))
    || cmp(String(a.id ?? ''), String(b.id ?? ''));
}

/**
 * ¿El renglón cae en el rango? `desde ≤ fecha ≤ hasta`. Con `corteHora`, además, su
 * momento real (`momentoReal`) no puede pasar del instante del corte
 * (`momentoDelCorte(hasta, corteHora)`: con 07:00 en punto, o antes, entra la jornada
 * `hasta` entera, R33); un renglón sin hora entra si su fecha está en el rango.
 *
 * Un renglón SIN fecha válida no entra en ningún rango (antes entraba en todos y se
 * contaba en cada mes). El rango en sí NO se valida: «desde» vacío o «hasta»
 * '9999-12-31' son centinelas de «sin principio» / «sin fin» que el listado usa.
 */
export function enRango(m: Movimiento, r: RangoCop): boolean {
  if (!fechaValida(m.fecha)) return false;
  if (m.fecha < r.desde || m.fecha > r.hasta) return false;
  const corte = r.corteHora ? momentoDelCorte(r.hasta, r.corteHora) : null;
  if (!corte) return true;
  const momento = momentoReal(m.fecha, m.hora);
  return momento === null || momento <= corte;
}

/** Los m³ de un renglón: el `m3` escrito, o viajes × capacidad; si falta uno, null. */
export function m3De(m: Movimiento): number | null {
  const escrito = num(m.m3);
  if (escrito !== null) return escrito;
  const v = num(m.viajes);
  const c = num(m.capacidadM3);
  return v !== null && c !== null ? v * c : null;
}

/**
 * ⭐ LA REGLA DE LA «FILA DE PATIO» — la única (lote 5, A1). Lo que el 📅 Parte diario anota
 * por patio es una ENTRADA pelada: el destino (el patio) y sus viajes, nada más. La usan
 * `guardarPatiosDelDia` (para encontrar QUÉ fila reemplaza), el bloque de patios (qué va en
 * cada campo) y el Reporte completo; antes eran dos reglas que solo miraban transportista,
 * origen, unidad y placa, y «Guardar patios» pisaba (y borraba) pesadas de ✍️ Carga libre.
 *
 * Es fila de patio una entrada SIN transportista, origen, unidad vinculada, unidad escrita
 * (en blanco o con espacios cuenta como sin unidad), placa, material, toneladas, m³, hora,
 * capacidad ni observación. Con cualquiera de esos datos es un renglón de ✍️ Carga libre:
 * se ve y se corrige allá, y «Guardar patios» no lo toca.
 */
export function esRenglonDePatio(m: Movimiento | null | undefined): boolean {
  if (!m || m.tipo !== 'entrada') return false;
  const vacio = (v: unknown): boolean => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
  return vacio(m.transportista) && vacio(m.origen) && vacio(m.unidadId) && vacio(m.unidadTexto) && vacio(m.placa)
    && vacio(m.material) && m.toneladas == null && m.m3 == null && vacio(m.hora) && m.capacidadM3 == null
    && vacio(m.observacion);
}

/**
 * ⭐ LA REGLA DE LA PLACA — la única del módulo (auditoría de pantallas, A3). Para
 * COMPARAR dos placas: sin tildes ni mayúsculas, y solo letras y números: «A12-BC»,
 * « a12 bc », «A12/BC» y «Á12.BC» son la misma placa («a12bc»). La usan la pertenencia a
 * una unidad (`claveUnidadDe`, `unidadDeLosRenglones`), la placa que se vincula sola al
 * cargar (`unidadPorPlaca`, en centroOperacionesCarga.ts) y la placa repetida de 🚛
 * Flota: antes eran tres reglas y el mismo camión podía salir como dos unidades.
 * Solo sirve para comparar: la placa se GUARDA como se escribió.
 */
export function clavePlaca(placa: string | null | undefined): string {
  return norm(placa).replace(/[^a-z0-9ñ]/g, '');
}

/**
 * La clave PROPIA de un renglón: su id si está vinculada; si no, su placa (con
 * `clavePlaca`) o, sin placa, su texto normalizado. Así un renglón anotado «a mano» se
 * corta y se agrupa igual que uno vinculado.
 *
 * ⚠️ NO es la clave de pertenencia: si un renglón suelto lleva la placa de una unidad
 * vinculada, `unidadDeLosRenglones` lo da a esa unidad y su clave propia ya no trae
 * nada. Para cortar, filtrar u ofrecer unidades en un selector, la clave es la de
 * `unidadDeLosRenglones(base)` (ver `cortePorUnidad` y `FiltrosCop.unidadIds`).
 */
export function claveUnidadDe(m: Movimiento): string {
  if (m.unidadId) return m.unidadId;
  return clavePlaca(m.placa) || norm(limpia(m.unidadTexto));
}

/** La placa de un renglón con LA regla de la placa ('' si no tiene). */
const placaDe = (m: Movimiento): string => clavePlaca(m.placa);

/**
 * ⭐ LA REGLA DE PERTENENCIA A UNA UNIDAD — la única. El listado (`filtrarMovimientos`),
 * la tabla por unidad (`tablaPor`) y el corte (`cortePorUnidad`) la usan las tres, así
 * que no pueden contarle cosas distintas a la misma unidad.
 *
 * ⭐ Se arma UNA vez con la LISTA BASE (todo lo cargado, antes de filtrar) y se pasa
 *    igual al listado, a la tabla por unidad y al corte: armada con un subconjunto
 *    (solo salidas, por ejemplo) puede no ver el renglón vinculado que dice de quién
 *    es una placa, y entonces el mismo renglón cambiaría de unidad según el papel.
 *    Las claves para ofrecer en un selector: `new Set(base.map(unidadDeLosRenglones(base)))`.
 *
 * Lee TODOS los renglones que recibe y devuelve la función que dice, para cada
 * renglón, la clave de la unidad a la que pertenece:
 *   · vinculado → su `unidadId`;
 *   · sin vincular, con la placa de UNA unidad vinculada → el id de esa unidad (si
 *     no, un renglón anotado a mano se quedaría sin corte);
 *   · si no → su `claveUnidadDe` (placa o texto). Una placa que llevan dos o más
 *     unidades vinculadas no se adivina: el renglón se queda con su propia clave.
 * Cada renglón es de UNA sola unidad: nunca se cuenta dos veces.
 */
export function unidadDeLosRenglones(movs: Movimiento[]): (m: Movimiento) => string {
  const duenos = new Map<string, Set<string>>();
  for (const m of movs) {
    const p = placaDe(m);
    if (!m.unidadId || !p) continue;
    const ids = duenos.get(p);
    if (ids) ids.add(m.unidadId); else duenos.set(p, new Set([m.unidadId]));
  }
  return (m) => {
    if (m.unidadId) return m.unidadId;
    const ids = duenos.get(placaDe(m));
    return ids && ids.size === 1 ? [...ids][0] : claveUnidadDe(m);
  };
}

/** ¿El renglón es de la unidad `claveUnidad`? `unidadDe` sale de `unidadDeLosRenglones`. */
export function perteneceAUnidad(m: Movimiento, claveUnidad: string, unidadDe: (m: Movimiento) => string): boolean {
  return unidadDe(m) === claveUnidad;
}

/** Los renglones del rango que cumplen TODOS los filtros, en el mismo orden en que llegan. */
export function filtrarMovimientos(movs: Movimiento[], r: RangoCop, f: FiltrosCop = {}): Movimiento[] {
  // «Sin destino» (o «Sin transportista»…) trae lo escrito en blanco y lo escrito así.
  const textos = (lista: string[] | undefined, eje: EjeTabla): Set<string> | null =>
    lista && lista.length ? new Set(lista.map((x) => llaveDe(limpia(x), eje))) : null;
  const tipos = f.tipos && f.tipos.length ? new Set<string>(f.tipos) : null;
  const estados = f.estados && f.estados.length ? new Set<string>(f.estados) : null;
  const unidades = f.unidadIds && f.unidadIds.length ? new Set<string>(f.unidadIds) : null;
  // La pertenencia se lee de TODOS los renglones recibidos (como en el corte), no solo de los del rango.
  const unidadDe = unidades ? unidadDeLosRenglones(movs) : null;
  const transportistas = textos(f.transportistas, 'transportista');
  const origenes = textos(f.origenes, 'origen');
  const destinos = textos(f.destinos, 'destino');
  const materiales = textos(f.materiales, 'material');
  const palabras = norm(limpia(f.texto)).split(' ').filter(Boolean);

  return movs.filter((m) => {
    if (!enRango(m, r)) return false;
    if (tipos && !tipos.has(m.tipo)) return false;
    if (estados && !estados.has(m.estado)) return false;
    if (unidades && unidadDe && !unidades.has(unidadDe(m))) return false;
    if (transportistas && !transportistas.has(llaveDe(limpia(m.transportista), 'transportista'))) return false;
    if (origenes && !origenes.has(llaveDe(limpia(m.origen), 'origen'))) return false;
    if (destinos && !destinos.has(llaveDe(limpia(m.destino), 'destino'))) return false;
    if (materiales && !materiales.has(llaveDe(limpia(m.material), 'material'))) return false;
    if (palabras.length) {
      const pajar = norm([m.unidadTexto, m.placa, m.transportista, m.origen, m.destino, m.material, m.observacion].map(limpia).join(' '));
      if (!palabras.every((p) => pajar.includes(p))) return false;
    }
    return true;
  });
}

// ═══════════════════════════ Totales y tablas ═══════════════════════════

/**
 * Los totales de un conjunto de renglones (ya filtrado). Un por confirmar no suma:
 * se cuenta aparte. La producción no suma nada (ni avisa pendientes): solo cuenta
 * como renglón. Se redondea al final.
 */
export function totalesDe(movs: Movimiento[]): Totales {
  let viajes = 0, toneladas = 0, m3 = 0;
  let pendientesSinNumero = 0, porConfirmarViajes = 0;
  let promTon = 0, promViajes = 0;
  for (const m of movs) {
    if (esProduccion(m)) continue;
    if (esPorConfirmar(m)) {
      if (sinNumero(m)) pendientesSinNumero++;
      else porConfirmarViajes += viajesDe(m);
      continue;
    }
    const v = viajesDe(m);
    const t = num(m.toneladas);
    viajes += v;
    toneladas += toneladasDe(m);
    m3 += m3De(m) ?? 0;
    // El promedio es de lo RECIBIDO y ya pesado: lo que espera pesaje no entra.
    if (m.tipo === 'entrada' && m.estado === 'confirmado' && v > 0 && t !== null) {
      promTon += t;
      promViajes += v;
    }
  }
  return {
    viajes,
    toneladas: r2(toneladas),
    m3: r2(m3),
    promedioTonViaje: promViajes > 0 ? r2(promTon / promViajes) : null,
    pendientesSinNumero,
    porConfirmarViajes,
    renglones: movs.length,
  };
}

/** Solo los avisos «(+N pendiente, +V por confirmar)» de un conjunto de renglones. */
function pendientesDe(movs: Movimiento[]): PendientesCop {
  const t = totalesDe(movs);
  return { pendientesSinNumero: t.pendientesSinNumero, porConfirmarViajes: t.porConfirmarViajes };
}

/**
 * «2», «2 (+1 pendiente)», «2 (+4 por confirmar)» o «2 (+1 pendiente, +4 por
 * confirmar)». Sirve para un `Totales` y para cualquier objeto con estos tres campos
 * (por ejemplo, las salidas de un corte).
 */
export function textoViajes(t: { viajes: number; pendientesSinNumero: number; porConfirmarViajes: number }): string {
  const avisos: string[] = [];
  if (t.pendientesSinNumero > 0) avisos.push(`+${fmt(t.pendientesSinNumero)} ${plural(t.pendientesSinNumero, 'pendiente', 'pendientes')}`);
  if (t.porConfirmarViajes > 0) avisos.push(`+${fmt(t.porConfirmarViajes)} por confirmar`);
  return avisos.length ? `${fmt(t.viajes)} (${avisos.join(', ')})` : fmt(t.viajes);
}

/** Cómo se llama el renglón en el eje pedido ('' si quedó en blanco). */
function textoDelEje(m: Movimiento, eje: EjeTabla): string {
  if (eje === 'unidad') return limpia(m.unidadTexto) || limpia(m.placa);
  return limpia(m[eje]);
}

/**
 * Viajes, participación, toneladas y m³ por transportista / origen / destino /
 * material / unidad. Los por confirmar y la producción no aparecen (no suman). Lo escrito en blanco
 * —o escrito «Sin …»— se junta en UNA fila «Sin …» que va al final.
 *
 * Por unidad, quién es de cuál lo decide `unidadDeLosRenglones` (la misma regla que
 * el listado y el corte). `unidadDe` es esa regla armada con la LISTA BASE: pásala
 * siempre que `movs` sea un subconjunto ya filtrado. Si no llega, se arma con `movs`.
 */
export function tablaPor(movs: Movimiento[], eje: EjeTabla, orden: Orden, unidadDe?: (m: Movimiento) => string): FilaTabla[] {
  type Acum = { clave: string; sinDato: boolean; viajes: number; toneladas: number; m3: number };
  const grupos = new Map<string, Acum>();
  const deUnidad = eje === 'unidad' ? unidadDe ?? unidadDeLosRenglones(movs) : null;
  for (const m of movs) {
    if (esPorConfirmar(m) || esProduccion(m)) continue;
    const texto = textoDelEje(m, eje);
    const sinDato = esSinDato(texto, eje);
    // Un renglón suelto sin texto ni placa tiene clave '': es la misma fila que «Sin unidad».
    const llave = deUnidad ? deUnidad(m) || llaveDe('', 'unidad') : llaveDe(texto, eje);
    let g = grupos.get(llave);
    if (!g) {
      g = { clave: rotuloDe(texto, eje), sinDato, viajes: 0, toneladas: 0, m3: 0 };
      grupos.set(llave, g);
    } else if (g.sinDato && !sinDato) {
      g.clave = texto; // una unidad vinculada cuyo primer renglón no traía texto
      g.sinDato = false;
    }
    g.viajes += viajesDe(m);
    g.toneladas += toneladasDe(m);
    g.m3 += m3De(m) ?? 0;
  }
  const filas = [...grupos.values()].sort((a, b) => {
    if (a.sinDato !== b.sinDato) return a.sinDato ? 1 : -1;
    return porCantidad(orden, a, b) || cmpText(a.clave, b.clave);
  });
  const totalViajes = filas.reduce((s, g) => s + g.viajes, 0);
  return filas.map((g) => ({
    clave: g.clave,
    viajes: g.viajes,
    pct: totalViajes > 0 ? redondear((g.viajes / totalViajes) * 100, 1) : 0,
    toneladas: r2(g.toneladas),
    m3: r2(g.m3),
  }));
}

// ═══════════════════════════ El consolidado del sitio (papel A) ═══════════════════════════

/** «a», «a y b», «a, b y c»: comas y una sola «y» al final. */
const enumerar = (partes: string[]): string =>
  partes.length <= 1 ? partes.join('') : `${partes.slice(0, -1).join(', ')} y ${partes[partes.length - 1]}`;

/**
 * Qué columnas del consolidado se ven (las que faltan, o en `true`, se ven). Con una
 * apagada, el papel pide el texto y las filas SIN ese dato: lo oculto no deja rastro.
 */
export type VerColumnasCop = { capacidad?: boolean; m3?: boolean; estado?: boolean };

/**
 * «Triturado → Destino X: 5 viajes (2 de 18 m³ y 3 de 24 m³) = 108 m³». La cuenta solo
 * se escribe si CUADRA: con m³ escritos a mano que no son viajes × capacidad, sale
 * «Arena → Destino W: 2 viajes · 50 m³» (sin desglose ni «=»), nunca una cuenta falsa.
 * Lo que `ver` apaga no se escribe: sin m³, ni «= 108 m³»; sin capacidad, ni el
 * desglose «de 18 m³» (los m³ van sin cuenta: «· 108 m³»); sin estado, ni «(esperando pesaje)».
 */
function lineaDeSalida(material: string, destino: string, grupos: ModeloConsolidado['salidas'], ver: VerColumnasCop = {}): string {
  const verM3 = ver.m3 !== false, verCap = ver.capacidad !== false, verEstado = ver.estado !== false;
  const viajes = grupos.reduce((s, g) => s + g.viajes, 0);
  const m3 = r2(grupos.reduce((s, g) => s + g.m3, 0));
  const esperando = grupos.filter((g) => g.estado === 'esperando_pesaje').reduce((s, g) => s + g.viajes, 0);
  const cuenta = r2(grupos.reduce((s, g) => s + (g.capacidadM3 === null ? 0 : g.viajes * g.capacidadM3), 0));
  const cuadra = Math.abs(cuenta - m3) < 0.005;

  let t = `${material} → ${destino}: ${fmt(viajes)} ${plural(viajes, 'viaje', 'viajes')}`;
  // El desglose por capacidad (sumando los estados), de la más chica a la más grande. Sin
  // m³ a la vista no hay cuenta que pueda no cuadrar: el desglose sale igual.
  if (verCap && (cuadra || !verM3)) {
    const porCap = new Map<number | null, number>();
    for (const g of grupos) porCap.set(g.capacidadM3, (porCap.get(g.capacidadM3) ?? 0) + g.viajes);
    const caps = [...porCap.entries()].sort((a, b) => cmpCapacidad(a[0], b[0]));
    if (caps.length > 1) {
      t += ` (${enumerar(caps.map(([c, v]) => (c === null ? `${fmt(v)} sin capacidad` : `${fmt(v)} de ${fmt(c)} m³`)))})`;
    } else if (caps.length === 1 && caps[0][0] !== null) {
      t += ` de ${fmt(caps[0][0])} m³`;
    }
  }
  if (verM3) {
    if (verCap && cuadra) { if (m3 > 0) t += ` = ${fmt(m3)} m³`; }
    else if (!cuadra || m3 > 0) t += ` · ${fmt(m3)} m³`;
  }
  if (verEstado && esperando > 0) t += esperando === viajes ? ' (esperando pesaje)' : ` (${fmt(esperando)} esperando pesaje)`;
  return t;
}

/**
 * ⭐ El resumen de salidas en texto: una línea por material y destino (ver
 * `lineaDeSalida`). `salidas` son las filas del modelo (`consolidadoSitio(…).salidas`,
 * SIN juntar: el desglose necesita cada capacidad). `ver` = las columnas a la vista
 * del papel; sin él, todo (es lo que `consolidadoSitio` deja en `textoSalidas`).
 */
export function textoSalidasDe(salidas: ModeloConsolidado['salidas'], orden: Orden, ver: VerColumnasCop = {}): string[] {
  const porPar = new Map<string, { material: string; destino: string; viajes: number; grupos: ModeloConsolidado['salidas'] }>();
  for (const s of salidas) {
    const llave = `${norm(s.material)}|${norm(s.destino)}`;
    let p = porPar.get(llave);
    if (!p) { p = { material: s.material, destino: s.destino, viajes: 0, grupos: [] }; porPar.set(llave, p); }
    p.viajes += s.viajes;
    p.grupos.push(s);
  }
  return [...porPar.values()]
    .sort((a, b) => porCantidad(orden, a, b) || cmpText(a.material, b.material) || cmpText(a.destino, b.destino))
    .map((p) => lineaDeSalida(p.material, p.destino, p.grupos, ver));
}

type FilaInterno = ModeloConsolidado['internos'][number];
type FilaSalida = ModeloConsolidado['salidas'][number];
const ordenInternos = (orden: Orden) => (a: FilaInterno, b: FilaInterno): number =>
  porCantidad(orden, a, b) || cmpText(a.origen, b.origen) || cmpText(a.destino, b.destino) || cmpCapacidad(a.capacidadM3, b.capacidadM3);
const ordenSalidas = (orden: Orden) => (a: FilaSalida, b: FilaSalida): number =>
  porCantidad(orden, a, b) || cmpText(a.material, b.material) || cmpText(a.destino, b.destino)
    || cmpCapacidad(a.capacidadM3, b.capacidadM3) || ORDEN_ESTADO[a.estado] - ORDEN_ESTADO[b.estado];

/**
 * ⭐ Las filas de internos y salidas JUNTADAS por lo que se ve (precedente:
 * `frentesReporte.resumenFrentes`, «cada cuadro sigue a su interruptor»). Con la
 * capacidad apagada, el mismo recorrido (o el mismo material y destino) es UNA fila;
 * con el estado apagado, la salida confirmada y la que espera pesaje también: si no,
 * salen dos filas iguales a la vista que parecen un viaje contado dos veces, y el
 * cociente m³/viajes delata la capacidad escondida.
 *
 * Lo juntado suma viajes, toneladas (que ya son solo las pesadas) y m³; su capacidad
 * queda si todas las partes la tienen igual (si no, null); su estado es «confirmado» si
 * alguna parte lo es. Se reordena con `orden`. Con todo a la vista, las filas quedan
 * como están. La llama el papel con el modelo de `consolidadoSitio`.
 */
export function juntarFilasVisibles(
  m: Pick<ModeloConsolidado, 'internos' | 'salidas'>,
  orden: Orden,
  ver: VerColumnasCop = {},
): Pick<ModeloConsolidado, 'internos' | 'salidas'> {
  const verCap = ver.capacidad !== false, verEstado = ver.estado !== false;

  const internos = new Map<string, FilaInterno>();
  for (const g of m.internos) {
    const llave = `${norm(g.origen)}|${norm(g.destino)}|${verCap ? g.capacidadM3 ?? '' : ''}`;
    const j = internos.get(llave);
    if (!j) { internos.set(llave, { ...g }); continue; }
    j.viajes += g.viajes;
    j.m3 += g.m3;
    if (j.capacidadM3 !== g.capacidadM3) j.capacidadM3 = null;
  }

  const salidas = new Map<string, FilaSalida>();
  for (const g of m.salidas) {
    const llave = `${norm(g.material)}|${norm(g.destino)}|${verCap ? g.capacidadM3 ?? '' : ''}|${verEstado ? g.estado : ''}`;
    const j = salidas.get(llave);
    if (!j) { salidas.set(llave, { ...g }); continue; }
    j.viajes += g.viajes;
    j.toneladas += g.toneladas;
    j.m3 += g.m3;
    if (j.capacidadM3 !== g.capacidadM3) j.capacidadM3 = null;
    if (ORDEN_ESTADO[g.estado] < ORDEN_ESTADO[j.estado]) j.estado = g.estado;
  }

  return {
    internos: [...internos.values()].sort(ordenInternos(orden)).map((g) => ({ ...g, m3: r2(g.m3) })),
    salidas: [...salidas.values()].sort(ordenSalidas(orden)).map((g) => ({ ...g, toneladas: r2(g.toneladas), m3: r2(g.m3) })),
  };
}

/**
 * Todo el papel A en un solo modelo. Recibe los renglones YA filtrados (rango, corte
 * con hora, filtros). Las tarjetas son de lo recibido; los movimientos internos se
 * cuentan por recorrido y capacidad del camión; las salidas, por material, destino,
 * capacidad y estado. Los por confirmar no aparecen en ninguna tabla (no suman): se
 * avisan aparte en `pendientesInternos` y `pendientesSalidas` (si hay de los dos,
 * salen los dos). Las ventas en piezas (`esVentaEnPiezas`: los bloques) no son viajes y
 * no salen acá: van en el 📄 Reporte completo.
 */
export function consolidadoSitio(movsRecibidos: Movimiento[], orden: Orden): ModeloConsolidado {
  // Las ventas en piezas (bloques) no son viajes: no entran a ninguna tabla ni aviso (A4).
  const movs = movsRecibidos.filter((m) => !esVentaEnPiezas(m));
  const entradas = movs.filter((m) => m.tipo === 'entrada');
  const confirmables = movs.filter((m) => !esPorConfirmar(m));

  // Internos: recorrido + capacidad.
  const mapInternos = new Map<string, ModeloConsolidado['internos'][number]>();
  for (const m of confirmables.filter((x) => x.tipo === 'interno')) {
    const origen = limpia(m.origen), destino = limpia(m.destino);
    const cap = num(m.capacidadM3);
    const llave = `${llaveDe(origen, 'origen')}|${llaveDe(destino, 'destino')}|${cap ?? ''}`;
    let g = mapInternos.get(llave);
    if (!g) {
      g = { origen: rotuloDe(origen, 'origen'), destino: rotuloDe(destino, 'destino'), capacidadM3: cap, viajes: 0, m3: 0 };
      mapInternos.set(llave, g);
    }
    g.viajes += viajesDe(m);
    g.m3 += m3De(m) ?? 0;
  }
  const internos = [...mapInternos.values()]
    .sort(ordenInternos(orden))
    .map((g) => ({ ...g, m3: r2(g.m3) }));

  // Salidas: material + destino + capacidad + estado.
  const mapSalidas = new Map<string, ModeloConsolidado['salidas'][number]>();
  for (const m of confirmables.filter((x) => x.tipo === 'salida')) {
    const material = limpia(m.material), destino = limpia(m.destino);
    const cap = num(m.capacidadM3);
    const llave = `${llaveDe(material, 'material')}|${llaveDe(destino, 'destino')}|${cap ?? ''}|${m.estado}`;
    let g = mapSalidas.get(llave);
    if (!g) {
      g = { material: rotuloDe(material, 'material'), destino: rotuloDe(destino, 'destino'), capacidadM3: cap, estado: m.estado, viajes: 0, toneladas: 0, m3: 0 };
      mapSalidas.set(llave, g);
    }
    g.viajes += viajesDe(m);
    g.toneladas += toneladasDe(m);
    g.m3 += m3De(m) ?? 0;
  }
  const salidas = [...mapSalidas.values()]
    .sort(ordenSalidas(orden))
    .map((g) => ({ ...g, toneladas: r2(g.toneladas), m3: r2(g.m3) }));

  // El resumen en texto: una línea por material y destino (con todo a la vista).
  const textoSalidas = textoSalidasDe(salidas, orden);

  return {
    totales: totalesDe(entradas),
    porTransportista: tablaPor(entradas, 'transportista', orden),
    porOrigen: tablaPor(entradas, 'origen', orden),
    internos,
    salidas,
    textoSalidas,
    pendientesInternos: pendientesDe(movs.filter((m) => m.tipo === 'interno')),
    pendientesSalidas: pendientesDe(movs.filter((m) => m.tipo === 'salida')),
    vacio: !movs.some((m) => m.tipo === 'entrada' || m.tipo === 'interno' || m.tipo === 'salida'),
  };
}

// ═══════════════════════════ El corte por unidad (papel B) ═══════════════════════════

/**
 * El corte de viajes de UNA unidad en un período: por día, los internos y las
 * salidas (una columna por destino, o la sola columna «Salidas»).
 *
 * `claveUnidad` es la clave de PERTENENCIA: la que da `unidadDeLosRenglones(base)`
 * (no la de `claveUnidadDe`, que para un renglón suelto con la placa de una unidad
 * vinculada daría una hoja vacía). Qué renglones son de ella lo decide esa misma
 * regla (la del listado y la tabla por unidad): los suyos y los que NUNCA se
 * vincularon pero llevan su placa. Las entradas y los «otro» no son del corte, y
 * las otras unidades tampoco. Las claves para elegir unidades en la pantalla:
 * `new Set(base.map(unidadDeLosRenglones(base)))`.
 *
 * ⭐ `op.unidadDe` (opcional) es esa regla armada UNA vez con la LISTA BASE (todo lo
 *    cargado, antes de filtrar), la MISMA que reciben `tablaPor` y `cuerpoListado`:
 *    pásala siempre que `movs` sea un subconjunto filtrado (por transportista, por
 *    material…), porque armada con el subconjunto puede no ver el renglón vinculado que
 *    dice de quién es una placa. Si no llega, se arma con `movs` (la lista base, entonces).
 *
 * `ficha` (opcional) es la de la flota (`cop_unidades`: código/descripción y placa):
 * si llega, es la PREFERIDA para el encabezado, y es la única que hay cuando la
 * unidad no trabajó en el período (sin ella saldría la clave cruda, un id). Lo que
 * venga en blanco se toma de los renglones. En cada renglón sigue mandando su texto
 * congelado; la ficha solo nombra la hoja.
 *
 * `diasSinAnotacion`: 'cero' deja cada día del rango con ceros; 'ocultar' esconde
 * los días que no tienen ni un renglón (uno anotado en 0 SÍ es una anotación).
 * Un día está `pendiente` si trae algún renglón por confirmar (interno o salida), y
 * `pendienteInternos` / `pendienteSalidas` dicen cuánto y de qué (para pintarlo en
 * su columna). En cambio, los pendientes de los totales son SOLO los de las salidas.
 */
export function cortePorUnidad(
  movs: Movimiento[],
  r: RangoCop,
  claveUnidad: string,
  op: { columnasPorDestino: boolean; diasSinAnotacion: 'cero' | 'ocultar'; unidadDe?: (m: Movimiento) => string },
  ficha?: { unidad: string; placa: string | null },
): ModeloCorte {
  const unidadDe = op.unidadDe ?? unidadDeLosRenglones(movs);
  const suyos = movs.filter((m) => perteneceAUnidad(m, claveUnidad, unidadDe));
  const delCorte = suyos.filter((m) => (m.tipo === 'interno' || m.tipo === 'salida') && enRango(m, r));
  const primero = (lista: Movimiento[], campo: (m: Movimiento) => string): string | undefined =>
    lista.map(campo).find((t) => t !== '');

  // Una columna por destino (A→Z, «Sin destino» al final) o la sola «Salidas». El
  // destino en blanco y el escrito «Sin destino» son UNA columna: si no, la misma
  // cifra salía dos veces y las columnas no sumaban el total.
  const nombreDestino = (m: Movimiento): string => limpia(m.destino);
  const llaveSinDestino = llaveDe('', 'destino');
  let destinos: string[];
  if (op.columnasPorDestino) {
    const vistos = new Map<string, string>();
    for (const m of delCorte) {
      if (m.tipo !== 'salida') continue;
      const t = nombreDestino(m);
      const k = llaveDe(t, 'destino');
      if (!vistos.has(k)) vistos.set(k, rotuloDe(t, 'destino'));
    }
    destinos = [...vistos.entries()]
      .sort((a, b) => (a[0] === llaveSinDestino ? 1 : b[0] === llaveSinDestino ? -1 : cmpText(a[1], b[1])))
      .map(([, t]) => t);
  } else {
    destinos = [COLUMNA_SALIDAS];
  }
  const columnaDe = (m: Movimiento): string => {
    if (!op.columnasPorDestino) return COLUMNA_SALIDAS;
    const k = llaveDe(nombreDestino(m), 'destino');
    return destinos.find((d) => llaveDe(d, 'destino') === k) ?? rotuloDe(nombreDestino(m), 'destino');
  };

  const porFecha = new Map<string, Movimiento[]>();
  for (const m of delCorte) {
    const dia = porFecha.get(m.fecha);
    if (dia) dia.push(m); else porFecha.set(m.fecha, [m]);
  }

  const dias: FilaDiaCorte[] = [];
  for (const fecha of diasEntre(r.desde, r.hasta)) {
    const delDia = porFecha.get(fecha) ?? [];
    if (!delDia.length && op.diasSinAnotacion === 'ocultar') continue;
    const salidas: Record<string, number> = {};
    for (const d of destinos) salidas[d] = 0;
    let internos = 0;
    const observaciones: string[] = [];
    for (const m of delDia) {
      if (!esPorConfirmar(m)) {
        if (m.tipo === 'interno') internos += viajesDe(m);
        else salidas[columnaDe(m)] += viajesDe(m);
      }
      const obs = limpia(m.observacion);
      if (obs && !observaciones.some((o) => norm(o) === norm(obs))) observaciones.push(obs);
    }
    dias.push({
      fecha,
      internos,
      salidas,
      pendiente: delDia.some(esPorConfirmar),
      pendienteInternos: pendientesDe(delDia.filter((m) => m.tipo === 'interno')),
      pendienteSalidas: pendientesDe(delDia.filter((m) => m.tipo === 'salida')),
      observaciones,
    });
  }

  // Los totales salen de los renglones (no de `dias`), para que esconder días no los cambie.
  // Los pendientes son los de la tarjeta de externos: solo las salidas.
  const t = pendientesDe(delCorte.filter((m) => m.tipo === 'salida'));
  const internosTotal = delCorte.filter((m) => m.tipo === 'interno' && !esPorConfirmar(m)).reduce((s, m) => s + viajesDe(m), 0);
  const salidasTotal = delCorte.filter((m) => m.tipo === 'salida' && !esPorConfirmar(m)).reduce((s, m) => s + viajesDe(m), 0);

  const placaEscrita = primero(delCorte, (m) => limpia(m.placa)) ?? primero(suyos, (m) => limpia(m.placa));
  return {
    // La ficha de la flota primero; si no llega (o viene en blanco), lo congelado en los renglones.
    // Una unidad suelta que solo trae placa se llama por la placa ESCRITA, no por su clave
    // normalizada (en minúsculas); la clave cruda queda solo si no hay nada escrito.
    unidad: limpia(ficha?.unidad) || (primero(delCorte, (m) => limpia(m.unidadTexto)) ?? primero(suyos, (m) => limpia(m.unidadTexto)) ?? placaEscrita ?? claveUnidad),
    placa: limpia(ficha?.placa) || (placaEscrita ?? null),
    destinos,
    porDestino: !!op.columnasPorDestino,
    dias,
    totales: {
      internos: internosTotal,
      salidas: salidasTotal,
      total: internosTotal + salidasTotal,
      pendientesSinNumero: t.pendientesSinNumero,
      porConfirmarViajes: t.porConfirmarViajes,
    },
    diasEvaluados: dias.length,
    vacio: delCorte.length === 0,
  };
}

// ═══════════════════════════ 🚜 Maquinaria ↔ inspección: la hora y el hecho ═══════════════════════════
//
// (Mesa de maquinaria, 26-oct-2026.) Dos piezas PURAS que comparten la capa de datos (el
// aviso «inspección registró algo después de que abriste la pantalla») y la librería de la
// maquinaria (el «quedó atrás», el WhatsApp, el papel): UNA sola manera de decir la hora de
// un hecho y el hecho mismo.

/** Un instante en hora de Caracas (UTC−4 todo el año, sin horario de verano), sea cual sea el
 *  huso del equipo: el día calendario, «dd/mm/aaaa», «dd/mm», «06:10 a. m.» y la JORNADA
 *  (7am a 7am: antes de las 07:00 es la del día anterior). Sin dato o ilegible → null. */
export function momentoCaracas(ms: number | null | undefined): { dia: string; fecha: string; diaMes: string; hora: string; jornada: string } | null {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return null;
  const c = new Date(ms - 4 * 3600 * 1000);
  if (!Number.isFinite(c.getTime())) return null;
  const p2 = (n: number) => String(n).padStart(2, '0');
  const dd = p2(c.getUTCDate());
  const mm = p2(c.getUTCMonth() + 1);
  const aaaa = String(c.getUTCFullYear());
  const h24 = c.getUTCHours();
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const dia = `${aaaa}-${mm}-${dd}`;
  return {
    dia,
    fecha: `${dd}/${mm}/${aaaa}`,
    diaMes: `${dd}/${mm}`,
    hora: `${p2(h12)}:${p2(c.getUTCMinutes())} ${h24 < 12 ? 'a. m.' : 'p. m.'}`,
    jornada: h24 < HORA_CAMBIO_JORNADA ? sumarDias(dia, -1) : dia,
  };
}

/** Lo que hizo que una marca del sitio quedara atrás (mesa de maquinaria, D1): una avería REAL
 *  creada o resuelta, una jornada iniciada por una persona, o la oficina que devolvió la
 *  máquina a servicio desde el Catálogo. */
export type QueHechoInspeccion = 'averia_creada' | 'averia_resuelta' | 'jornada' | 'reactivada';

/**
 * El hecho dicho en palabras, en minúscula, para meterlo en una frase: «inspección registró una
 * jornada a las 07:25 a. m.» (si fue el mismo día de `ahoraMs`) o «… el 20/10 a las 07:25 a. m.»
 * (otro día, o sin `ahoraMs`). La devolución a servicio va con su día: «la oficina la devolvió a
 * servicio el 20/10». Sin horas trabajadas ni nombres de inspectores.
 */
export function fraseHechoInspeccion(h: { ms: number; que: QueHechoInspeccion }, ahoraMs?: number | null): string {
  const m = momentoCaracas(h?.ms);
  if (h?.que === 'reactivada') return m ? `la oficina la devolvió a servicio el ${m.diaMes}` : 'la oficina la devolvió a servicio';
  const verbo = h?.que === 'averia_creada' ? 'inspección reportó una avería'
    : h?.que === 'averia_resuelta' ? 'inspección resolvió una avería'
      : 'inspección registró una jornada';
  if (!m) return verbo;
  const hoy = momentoCaracas(ahoraMs ?? null);
  return hoy && hoy.dia === m.dia ? `${verbo} a las ${m.hora}` : `${verbo} el ${m.diaMes} a las ${m.hora}`;
}

/** De dónde sale la hora de referencia de la guardia (lote 6, B1): la lectura de inspección en
 *  la pantalla ('pantalla'), la marca anterior de la unidad ('marca', nunca se leyó) o el último
 *  hecho que la guardia ya le mostró ('visto'). Solo cambia el texto del aviso de la capa de datos. */
export type MotivoGuardia = 'pantalla' | 'marca' | 'visto';

/**
 * Una promesa con TOPE de tiempo (lote 6, R1/R2): si no responde en `ms`, rechaza con
 * `new Error(mensaje)` y la respuesta tardía se descarta. El cliente de Supabase no tiene
 * tiempo máximo: sin esto, con mala señal (no cortada) una lectura puede quedarse colgada
 * minutos, y «Guardando…» o «Leyendo…» no tendrían salida.
 */
export function conTope<T>(promesa: PromiseLike<T>, ms: number, mensaje: string): Promise<T> {
  let reloj: ReturnType<typeof setTimeout> | undefined;
  const tope = new Promise<never>((_, no) => { reloj = setTimeout(() => no(new Error(mensaje)), Math.max(0, ms)); });
  return Promise.race([Promise.resolve(promesa), tope]).finally(() => { if (reloj !== undefined) clearTimeout(reloj); });
}
