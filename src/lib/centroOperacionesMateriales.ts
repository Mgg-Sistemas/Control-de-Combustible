// 🏭 CENTRO DE OPERACIONES — CANTIDADES DE MATERIAL E INVENTARIO DE BLOQUES (24-oct-2026).
//
// Pedido de la clienta:
//   · Lo que sale del sitio (agregados: «Triturado mixto», «Arrocillo», «Polvillo» y
//     los que ella agregue) se anota en m³ O en toneladas O en kg: ella escribe UNA
//     cifra y el sistema saca las otras dos.
//   · Los bloques de concreto de la cantera curan 7 días antes de venderse: cuántos
//     hay para la venta un día dado, cuántos curan y cuándo se liberan (más abajo).
//   · Cada destino tiene su GPS: los km desde el sitio (más abajo).
//
// LAS REGLAS DE LA CONVERSIÓN:
//   · Cada material tiene su FACTOR (t por m³), editable. Los agregados usan 1,2:
//       t = m³ × 1,2      m³ = t ÷ 1,2      kg = t × 1.000
//   · Un material SIN factor fijo (acero, aluminio…) solo convierte t ↔ kg; el m³
//     queda como se escribió o vacío. El acero sale con su m³ y sus toneladas reales
//     llegan días después en la nota de entrega: hasta entonces t y kg van vacíos.
//   · Un factor 0, negativo o que no es número cuenta como «sin factor».
//   · Se redondea AL FINAL, desde la cifra escrita (nunca en cadena): m³ y t a 2
//     decimales, kg en entero. ⭐ Lo escrito EN KG lleva las t con 3 decimales (1 kg =
//     0,001 t): así 1.234 kg son 1,234 t y no 1,23 (lote 5 A3: no se pierden kilos).
//     ⚠️ Si la columna de la base tuviera 2 decimales, la base redondearía igual que antes.
//   · Lo que no se entiende (vacío, negativo, NaN, infinito, texto colado, unidad
//     desconocida) da las tres cantidades vacías (null). Jamás NaN, jamás lanza.
//
// TODO ESTE ARCHIVO ES PURO: sin React, sin Supabase y SIN IMPORTS. La pantalla lee
// lo escrito a mano con `leerNumero` (`./numeros`) ANTES de llamar a estas funciones.
// `scripts/test-centro-operaciones-materiales.mjs` lo prueba solo.

export type UnidadCantidad = 'm3' | 't' | 'kg';

/** Toneladas por m³ de los agregados (triturado, arrocillo, polvillo…). */
export const FACTOR_AGREGADOS = 1.2;

export type Cantidades = { m3: number | null; t: number | null; kg: number | null };

const VACIO = (): Cantidades => ({ m3: null, t: null, kg: null });

const esNumero = (n: unknown): n is number => typeof n === 'number' && isFinite(n);

/** Redondea a `dec` decimales, mitad hacia arriba, sin el error del flotante
 *  (1,005 → 1,01 y no 1,00). Nunca devuelve -0. */
function redondear(n: number, dec: number): number {
  const f = 10 ** dec;
  const r = Math.round(Number((n * f).toPrecision(15))) / f;
  return r === 0 ? 0 : r;
}

/**
 * Convierte la cifra escrita en una unidad a las otras dos.
 * `factorTPorM3` = toneladas por m³ del material (1,2 en agregados); null, 0 o
 * negativo = el material no tiene factor fijo (solo t ↔ kg).
 */
export function convertirCantidad(valor: number | null, unidad: UnidadCantidad, factorTPorM3: number | null): Cantidades {
  if (!esNumero(valor) || valor < 0) return VACIO();
  const factor = esNumero(factorTPorM3) && factorTPorM3 > 0 ? factorTPorM3 : null;
  let m3: number | null;
  let t: number | null;
  if (unidad === 'm3') {
    m3 = valor;
    t = factor === null ? null : valor * factor;
  } else if (unidad === 't') {
    t = valor;
    m3 = factor === null ? null : valor / factor;
  } else if (unidad === 'kg') {
    t = valor / 1000;
    m3 = factor === null ? null : t / factor;
  } else {
    return VACIO();
  }
  const kg = unidad === 'kg' ? valor : t === null ? null : t * 1000;
  return {
    m3: m3 === null ? null : redondear(m3, 2),
    t: t === null ? null : redondear(t, unidad === 'kg' ? 3 : 2),
    kg: kg === null ? null : redondear(kg, 0),
  };
}

const fmt2 = (n: number): string => n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtEntero = (n: number): string => Math.round(n).toLocaleString('es-VE', { maximumFractionDigits: 0 });

/** «12,00 m³ · 14,40 t · 14.400 kg». Lo vacío se omite; todo vacío → ''. */
export function textoCantidades(c: Cantidades): string {
  if (!c || typeof c !== 'object') return '';
  const partes: string[] = [];
  if (esNumero(c.m3)) partes.push(`${fmt2(c.m3)} m³`);
  if (esNumero(c.t)) partes.push(`${fmt2(c.t)} t`);
  if (esNumero(c.kg)) partes.push(`${fmtEntero(c.kg)} kg`);
  return partes.join(' · ');
}

// ═══════════════════════════ FECHAS ═══════════════════════════
//
// Fechas como texto 'AAAA-MM-DD' (como las guarda la base). Las cuentas se hacen en
// UTC para que ni el huso horario ni el cambio de mes/año/bisiesto muevan el día.

const RE_FECHA = /^(\d{4})-(\d{2})-(\d{2})$/;

/** La fecha como Date UTC a medianoche, o null si no existe (30-feb, mes 13…). */
function fechaUTC(f: unknown): Date | null {
  if (typeof f !== 'string') return null;
  const m = RE_FECHA.exec(f.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mes = Number(m[2]) - 1;
  const dia = Number(m[3]);
  const dt = new Date(0);
  // setUTCFullYear y no Date.UTC: Date.UTC convierte los años 0–99 en 1900–1999.
  dt.setUTCFullYear(y, mes, dia);
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mes || dt.getUTCDate() !== dia) return null;
  return dt;
}

function isoDe(dt: Date): string {
  if (isNaN(dt.getTime())) return '';
  const y = dt.getUTCFullYear();
  if (y < 0 || y > 9999) return '';
  const dd = (n: number) => String(n).padStart(2, '0');
  return `${String(y).padStart(4, '0')}-${dd(dt.getUTCMonth() + 1)}-${dd(dt.getUTCDate())}`;
}

/** La fecha válida y sin espacios, o null. */
function fechaValida(f: unknown): string | null {
  const dt = fechaUTC(f);
  return dt ? isoDe(dt) || null : null;
}

/** 'AAAA-MM-DD' → 'DD/MM/AAAA' (para los avisos). */
function dmy(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

/**
 * Suma (o resta, si es negativo) `dias` días enteros a una fecha 'AAAA-MM-DD'.
 * Respeta meses, años y bisiestos. Fecha inválida o días no enteros → ''.
 */
export function sumarDias(fechaISO: string, dias: number): string {
  const dt = fechaUTC(fechaISO);
  if (!dt || typeof dias !== 'number' || !Number.isInteger(dias)) return '';
  dt.setUTCDate(dt.getUTCDate() + dias);
  return isoDe(dt);
}

// ═══════════════════════ INVENTARIO DE BLOQUES ═══════════════════════
//
// Los bloques de concreto se producen en la cantera y CURAN antes de venderse.
//
// LAS REGLAS:
//   · Lo producido el día D se puede vender DESDE D + diasCurado, ese día incluido
//     (7 por defecto: lo del 20-oct se vende desde el 27-oct).
//   · Solo cuentan los movimientos con fecha ≤ `alDia`; lo anotado a futuro espera.
//   · disponible = Σ producción ya curada − Σ salidas. Nunca baja de 0.
//   · Si en algún día de venta lo vendido (acumulado) superó lo curado (acumulado)
//     de ese momento, sale un aviso con la fecha y cuánto faltaba ESE día. Una venta
//     antes de que termine el curado es eso: o se vendió bloque verde o la fecha
//     está mal escrita. El aviso queda a la vista aunque después se haya cubierto.
//   · ⭐ Lo vendido de más a `alDia` sale de los lotes que AÚN curan, empezando por el
//     que se libera primero: así «en curado» y «próximos» cuentan los bloques que de
//     verdad quedan en el patio, y producido = disponible + en curado + vendido
//     (salvo que se haya vendido más de lo producido: eso tiene su propio aviso).
//   · Un renglón con fecha imposible o cantidad que no es un entero ≥ 0 se ignora
//     con un aviso que dice cuál era. Jamás NaN, jamás lanza.
//   · ⭐ Una producción puede traer SU fecha de liberación (`libera`: la «disponible
//     desde» que se congeló al anotarla, lote 5 A6). Si la trae y es válida (no antes
//     de la producción), manda ella: cambiar después los días del material no vuelve a
//     poner en curado lo que ya estaba disponible. Sin ella (o ilegible): fecha + días.

export type MovBloques = { fecha: string; cantidad: number; libera?: string | null };

export type InventarioBloques = {
  /** Bloques producidos hasta `alDia` (curados o no). */
  producido: number;
  /** Bloques vendidos (salidas) hasta `alDia`. */
  vendido: number;
  /** Curados y sin vender: lo que se puede vender ese día. */
  disponible: number;
  /** Producidos que todavía no cumplen el curado. */
  enCurado: number;
  /** Cuándo se libera lo que cura, por fecha ascendente (fechas posteriores a `alDia`). */
  proximos: { fecha: string; cantidad: number }[];
  /** Avisos en español: renglones ignorados, ventas sin bloques disponibles… */
  avisos: string[];
};

export const DIAS_CURADO_BLOQUES = 7;

/** Cómo se muestra en un aviso lo que se escribió mal. */
function mostrar(x: unknown): string {
  if (x === null || x === undefined || x === '') return '(vacío)';
  const s = String(x);
  return s.length > 40 ? `${s.slice(0, 40)}…` : s;
}

/** Deja solo los renglones que se entienden; por cada uno ignorado, un aviso. */
function limpiarMovimientos(lista: unknown, nombre: string, avisos: string[]): MovBloques[] {
  if (!Array.isArray(lista)) return [];
  const buenos: MovBloques[] = [];
  lista.forEach((mov: unknown, i: number) => {
    const cual = `${nombre} n.º ${i + 1} ignorada`;
    if (!mov || typeof mov !== 'object') {
      avisos.push(`${cual}: el renglón está vacío.`);
      return;
    }
    const { fecha, cantidad } = mov as { fecha?: unknown; cantidad?: unknown };
    const f = fechaValida(fecha);
    if (!f) {
      avisos.push(`${cual}: la fecha «${mostrar(fecha)}» no es válida (va como AAAA-MM-DD).`);
      return;
    }
    if (typeof cantidad !== 'number' || !Number.isInteger(cantidad) || cantidad < 0) {
      avisos.push(`${cual}: la cantidad «${mostrar(cantidad)}» no es válida (va un número entero de bloques, 0 o más).`);
      return;
    }
    // La liberación congelada solo si es una fecha válida y no anterior a la producción.
    const lib = fechaValida((mov as { libera?: unknown }).libera);
    buenos.push(lib && lib >= f ? { fecha: f, cantidad, libera: lib } : { fecha: f, cantidad });
  });
  return buenos;
}

const sumar = (l: { cantidad: number }[]): number => l.reduce((s, x) => s + x.cantidad, 0);

/** Fecha que ordena después de cualquier 'AAAA-MM-DD': lo que nunca se libera. */
const NUNCA = '~';

/**
 * El inventario de bloques a la fecha `alDia`: cuántos se pueden vender, cuántos
 * curan todavía y cuándo se liberan, y los avisos de lo que no cuadra.
 */
export function inventarioBloques(
  producciones: MovBloques[],
  salidas: MovBloques[],
  alDia: string,
  diasCurado: number = DIAS_CURADO_BLOQUES,
): InventarioBloques {
  const avisos: string[] = [];
  const hoy = fechaValida(alDia);
  if (!hoy) {
    return {
      producido: 0, vendido: 0, disponible: 0, enCurado: 0, proximos: [],
      avisos: [`La fecha de consulta «${mostrar(alDia)}» no es válida (va como AAAA-MM-DD): el inventario sale en cero.`],
    };
  }
  let curado = diasCurado;
  if (typeof curado !== 'number' || !Number.isInteger(curado) || curado < 0) {
    avisos.push(`Los días de curado «${mostrar(diasCurado)}» no son válidos: se usaron ${DIAS_CURADO_BLOQUES}.`);
    curado = DIAS_CURADO_BLOQUES;
  }

  // Solo en el año 9999 no habría fecha de liberación: esos bloques no se liberan.
  const prods = limpiarMovimientos(producciones, 'Producción', avisos)
    .filter((p) => p.fecha <= hoy)
    .map((p) => ({ ...p, libera: p.libera || sumarDias(p.fecha, curado) || NUNCA }));
  const sals = limpiarMovimientos(salidas, 'Salida', avisos).filter((s) => s.fecha <= hoy);

  const curadoAl = (f: string) => sumar(prods.filter((p) => p.libera <= f));
  const vendidoAl = (f: string) => sumar(sals.filter((s) => s.fecha <= f));

  // Cada día de venta: ¿lo vendido hasta ese día superó lo curado hasta ese día?
  const diasDeVenta = [...new Set(sals.filter((s) => s.cantidad > 0).map((s) => s.fecha))].sort();
  for (const f of diasDeVenta) {
    const falta = vendidoAl(f) - curadoAl(f);
    if (falta > 0) {
      avisos.push(
        `El ${dmy(f)} salieron más bloques de los disponibles para la venta: faltaron ${fmtEntero(falta)} ` +
        '(¿se vendieron bloques aún en curado o hay una fecha mal escrita?).',
      );
    }
  }

  const producido = sumar(prods);
  const vendido = sumar(sals);
  const curadoHoy = curadoAl(hoy);

  // Lotes que aún curan, agrupados por día de liberación y en orden.
  const porLiberar = new Map<string, number>();
  for (const p of prods) {
    if (p.libera > hoy) porLiberar.set(p.libera, (porLiberar.get(p.libera) ?? 0) + p.cantidad);
  }
  const lotes = [...porLiberar.keys()].sort().map((fecha) => ({ fecha, cantidad: porLiberar.get(fecha) ?? 0 }));

  // Lo vendido de más sale de lo que cura, empezando por lo que se libera primero.
  let deMas = Math.max(0, vendido - curadoHoy);
  for (const lote of lotes) {
    const quita = Math.min(deMas, lote.cantidad);
    lote.cantidad -= quita;
    deMas -= quita;
  }
  if (vendido > producido) {
    avisos.push(`Hasta el ${dmy(hoy)} se vendieron ${fmtEntero(vendido - producido)} bloques más de lo producido.`);
  }

  const proximos = lotes.filter((l) => l.cantidad > 0 && l.fecha !== NUNCA);
  return {
    producido,
    vendido,
    disponible: Math.max(0, curadoHoy - vendido),
    enCurado: sumar(lotes),
    proximos,
    avisos,
  };
}

// ═══════════════════════ DISTANCIA A LOS DESTINOS ═══════════════════════
//
// Cada destino tiene su ubicación GPS; ella quiere saber a cuántos km queda de su
// sitio. Es la distancia EN LÍNEA RECTA sobre la Tierra (fórmula de haversine,
// radio medio 6.371 km), no la de la carretera: la ruta real siempre es más larga.

const RADIO_TIERRA_KM = 6371;

type PuntoGps = { lat: number; lng: number };

function puntoValido(p: unknown): p is PuntoGps {
  if (!p || typeof p !== 'object') return false;
  const { lat, lng } = p as { lat?: unknown; lng?: unknown };
  return esNumero(lat) && esNumero(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

/**
 * Km en línea recta entre dos puntos GPS, con 1 decimal.
 * Una coordenada que falta o está fuera de rango → null («sin dato»), nunca NaN.
 */
export function kmLineaRecta(a: PuntoGps, b: PuntoGps): number | null {
  if (!puntoValido(a) || !puntoValido(b)) return null;
  const rad = (g: number) => (g * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return redondear(2 * RADIO_TIERRA_KM * Math.asin(Math.min(1, Math.sqrt(h))), 1);
}
