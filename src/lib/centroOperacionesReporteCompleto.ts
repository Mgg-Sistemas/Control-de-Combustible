// 🏭 CENTRO DE OPERACIONES — 📄 EL REPORTE COMPLETO (PD5a, 25-oct-2026).
//
// Lo pidió la encargada del sitio: UN papel que junte todo lo del 📅 Parte diario de un
// sitio en un período (un día o un rango de jornadas), en el orden de su hoja:
//   1) Reporte General desglosado (empresas y frentes, con su %; en un rango, la SUMA
//      de los días y las jornadas que no lo tienen),
//   2) Entrada por patio contra el total del Reporte General de ESAS jornadas,
//   3) Salida de agregados (por material y destino, con los km congelados y el vehículo),
//   4) Acero (quién se lo lleva, m³ y t o «pendiente de pesaje»),
//   5) Aluminio y plástico (t, empresa, destino),
//   6) Maquinaria: el estado del MOMENTO DE EMITIR, con su hora, con la regla única del bloque
//      🚜 (mesa de maquinaria, M5): Estado (sitio) + Inspección con «≠»; si inspección no se
//      pudo leer al emitir, el aviso arriba y las vinculadas sin marca en «Sin dato»,
//   7) Bloques (producción y ventas del período, disponibles al corte y en curado).
//
// Dos piezas, como los otros papeles del módulo:
//   · `modeloReporteCompleto(entrada)` → las 7 secciones ya calculadas (sin HTML);
//   · `cuerpoReporteCompleto(modelo, op)` → el HTML del CUERPO. La pestaña 📄 Reportes lo
//     arma con `armarPapelCop` (papel 'completo') y lo envuelve con su único
//     `pdfDocument` (membrete) y `CSS_COP`, como a los otros papeles (PD5b).
// ⭐ UNA SOLA FUENTE (PD5b): sus secciones (`SECCIONES_COP.completo`), su título y su
//    nombre de archivo viven en `centroOperacionesPapel.ts` con los de los otros papeles;
//    la tabla, la ficha, la sección y el CSS también son de allá. Acá no hay copias.
//
// ⭐ NO TIENE REGLAS PROPIAS: cada cuenta se IMPORTA de donde vive —totales, m³ y
//    pendientes de `centroOperaciones.ts`; de qué bloque es cada salida y el vehículo de
//    `salidasParteDiario.ts`; los patios de `parteDiario.ts`; maquinaria (`modeloMaquinariaPapel`)
//    y bloques de `centroOperacionesMaquinariaBloques.ts`; el inventario de
//    `centroOperacionesMateriales.ts`—. Acá solo se agrupa por período y se pinta.
// ⭐ LAS REGLAS DE LA CASA (diseño, sección 9):
//   · TODO texto variable pasa por `escaparHtml`: lo que ella escribe sale literal.
//   · LO OCULTO NO DEJA RASTRO: una sección apagada no se genera (ni título, ni hueco) y
//     la numeración se cuenta sobre las que se ven (nunca «1, 3, 4»).
//   · Las opciones NO se imprimen: van al nombre del archivo (`SECCIONES_COMPLETO[].enArchivo`).
//   · Una sección sin datos sale con su título y «Sin registros en el período.»; jamás NaN.
//   · Lo que falta es «sin dato» («—»), nunca un 0 que parezca cifra.
//   · La PRODUCCIÓN de bloques nunca suma a viajes ni toneladas, y las VENTAS de bloques
//     (salida «Bloques» con piezas y sin viajes) van en la sección 7, no en la 3.
//   · Jornada de 7am a 7am: el período son fechas de jornada (`enRango`).
//
// TODO ESTE ARCHIVO ES PURO: sin React ni Supabase (de la capa de datos solo se importa el
// TIPO de lo que carga). `scripts/test-centro-operaciones-reporte-completo.mjs` lo prueba.
import { conTope, enRango, fechaValida, m3De, textoViajes, totalesDe } from './centroOperaciones';
import type { Movimiento, ReporteGeneralGuardado, Unidad } from './centroOperaciones';
// Solo TIPOS de la capa de datos: lo de inspección le llega ya leído (`leerInspeccionAlEmitir`
// recibe el lector; quien lo llama es la pestaña).
import type { DatosReporteCompleto, EstadoInspeccion } from './centroOperacionesDb';
import { SECCIONES_COP, escaparHtml, fechaCop, ficha, periodoCop, seccion, tabla } from './centroOperacionesPapel';
import type { ColTablaCop, OcultableCop, SeccionCompleto } from './centroOperacionesPapel';
import { inventarioBloques, sumarDias } from './centroOperacionesMateriales';
import { entradaInventario, esDeBloques, materialDeBloques, modeloMaquinariaPapel, vinculadasParaInspeccion } from './centroOperacionesMaquinariaBloques';
import type { ModeloMaquinariaPapel, VinculadaParaLeer } from './centroOperacionesMaquinariaBloques';
import { NOSOTROS, esNosotros, salidasDeClase, vehiculoDe } from '../components/centroOperaciones/salidasParteDiario';
import { esRenglonDePatio, patiosGuardados, sumaPatios, textoPatiosVsReporte } from '../components/centroOperaciones/parteDiario';
import { cmpText, norm } from './text';

// ═══════════════════════════ Secciones y opciones ═══════════════════════════

export type { SeccionCompleto } from './centroOperacionesPapel';
/** El título de siempre del papel (en blanco en las opciones = este); vive con los de los otros papeles. */
export { TITULO_REPORTE_COMPLETO } from './centroOperacionesPapel';

/** ⭐ Las 7 secciones, en el orden de su hoja: ES `SECCIONES_COP.completo` (la misma lista,
 *  no una copia). La pestaña pinta sus interruptores de allá y el nombre del archivo nombra
 *  las apagadas con `enArchivo` (el papel no las anuncia). */
export const SECCIONES_COMPLETO = SECCIONES_COP.completo as OcultableCop<SeccionCompleto>[];

/**
 * Lo único que este papel decide con opciones: qué secciones se esconden. Recibe las
 * claves de `SeccionCompleto` (acepta el `ocultosSecciones` de `OpcionesPapelCop`, que es
 * `string[]`); lo que falte = todo a la vista.
 */
export type OpcionesReporteCompleto = { ocultosSecciones?: readonly string[] };

/** Lo que el modelo necesita: lo que carga `cargarDatosReporteCompleto` más el sitio, el
 *  período (fechas de JORNADA, ambas incluidas) y `hoy` (la jornada en curso,
 *  `caracasBusinessToday()`: dice si el estado de las máquinas es de otro día). */
export type EntradaReporteCompleto = DatosReporteCompleto & {
  sitio: string;
  desde: string;
  hasta: string;
  hoy: string;
  /**
   * 🚜 Lo que dice INSPECCIÓN de las unidades vinculadas, leído AL EMITIR
   * (`leerInspeccionAlEmitir` → `cargarEstadoInspeccion`). null o ausente = no se leyó (o
   * falló): las vinculadas sin marca salen «Sin dato» y, si hay vinculadas, el aviso arriba.
   * Nunca se supone «Disponible».
   */
  inspeccion?: EstadoInspeccion | null;
  /** El instante de emitir (ms): la hora del «Estado al emitir». Sin ella no se imprime hora. */
  emitidoMs?: number | null;
};

// ═══════════════════════════ El modelo ═══════════════════════════

/** Viajes (con sus pendientes, las palabras de `textoViajes`), m³ y toneladas de un
 *  grupo de salidas. m³ y toneladas en null = «sin dato» (ningún renglón los trae). */
export type CifrasCompleto = {
  viajes: number;
  pendientesSinNumero: number;
  porConfirmarViajes: number;
  m3: number | null;
  toneladas: number | null;
};

/** Una empresa o un frente del Reporte General, sumado en el período. `pct` = % de los viajes. */
export type FilaRgCompleto = { nombre: string; viajes: number; toneladas: number; pct: number };

export type ModeloReporteCompleto = {
  sitio: string;
  desde: string;
  hasta: string;
  /** El período en palabras (`periodoCop`): «06/10/2026» o «del 06/10/2026 al 08/10/2026». */
  periodo: string;
  /** Cuántas jornadas tiene el período (0 si las fechas no se entienden). */
  jornadas: number;
  reporteGeneral: {
    vacio: boolean;
    jornadasConReporte: number;
    /** Las jornadas del período SIN Reporte General («YYYY-MM-DD»). */
    jornadasSinReporte: string[];
    /** La suma de los totales que dice cada reporte (null si ninguno los trae). */
    viajesTotal: number | null;
    toneladasTotal: number | null;
    empresas: FilaRgCompleto[];
    frentes: FilaRgCompleto[];
    sumaEmpresas: { viajes: number; toneladas: number };
    sumaFrentes: { viajes: number; toneladas: number };
    /** Avisos neutros (texto plano): las filas no suman el total del reporte. */
    notas: string[];
  };
  patios: {
    vacio: boolean;
    /** Viajes del período por patio (A→Z), solo los que tienen algo anotado. */
    filas: { patio: string; viajes: number }[];
    /** Entradas sueltas cuyo destino no es un patio de la lista: se muestran, no suman. */
    otros: { destino: string; viajes: number }[];
    suma: number;
    /** «Patios 21 · Reporte 20 · diferencia +1» (las palabras de `textoPatiosVsReporte`);
     *  null si ninguna jornada con patios tiene el total del Reporte General. */
    comparacion: string | null;
    /** Jornadas con patios y sin Reporte General (no entran en la comparación). */
    jornadasSinReporte: string[];
    /** Jornadas con patios cuyo Reporte General no trae el total de viajes. */
    jornadasSinTotal: string[];
  };
  agregados: {
    vacio: boolean;
    filas: ({ material: string; destino: string; km: number | null; vehiculo: string } & CifrasCompleto)[];
    porVehiculo: ({ vehiculo: string } & CifrasCompleto)[];
    total: CifrasCompleto;
  };
  acero: {
    vacio: boolean;
    filas: {
      fecha: string;
      quien: string;
      /** El camión (unidad · placa); '' si no se escribió. */
      camion: string;
      viajes: number | null;
      porConfirmar: boolean;
      m3: number | null;
      /** Solo lo pesado (confirmado); null = pendiente o sin dato. */
      toneladas: number | null;
      /** Espera la nota de entrega con las toneladas. */
      pendiente: boolean;
    }[];
    porQuien: { quien: string; salidas: number; m3: number | null; toneladas: number | null; pendientes: number }[];
    total: CifrasCompleto & { salidas: number; pendientes: number };
  };
  aluminioPlastico: {
    vacio: boolean;
    filas: ({ material: string; empresa: string; destino: string } & CifrasCompleto)[];
    total: CifrasCompleto;
  };
  /** ⭐ El modelo de la sección 🚜 de la regla única (`modeloMaquinariaPapel`, mesa de
   *  maquinaria §4.3): estado al emitir, tarjetas por grupo, Estado (sitio) + Inspección con
   *  «≠», el aviso si inspección no se leyó. Más la nota A11. */
  maquinaria: ModeloMaquinariaPapel & {
    /** ⭐ SIEMPRE (auditoría del lote 5, A11): el estado es el del MOMENTO DE EMITIR, no el
     *  de cada jornada del período (y, si el período no termina hoy, de qué día no es). Texto plano. */
    notaAhora: string;
  };
  bloques: {
    vacio: boolean;
    /** El material de los bloques (el de la lista, o «Bloques»). */
    material: string;
    /** El corte del inventario: el `hasta` del período. */
    alDia: string;
    /** Del período; null = sin producción (o sin ventas) anotada. */
    producido: number | null;
    vendido: number | null;
    disponible: number;
    enCurado: number;
    proximos: { fecha: string; cantidad: number }[];
    avisos: string[];
  };
};

// ═══════════════════════════ Utilidades internas ═══════════════════════════

const esc = escaparHtml;
/** Texto limpio: sin espacios a los lados y con los dobles colapsados. */
const limpia = (s: unknown): string => String(s ?? '').replace(/\s+/g, ' ').trim();
/** La llave para juntar nombres: sin mayúsculas, tildes ni espacios de más. */
const llave = (s: unknown): string => norm(limpia(s));
const esNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const redondear = (n: number, dec: number): number => {
  const f = 10 ** dec;
  const r = Math.round((n + Number.EPSILON) * f) / f;
  return r === 0 ? 0 : r;
};
const r2 = (n: number): number => redondear(n, 2);
const plural = (n: number, uno: string, varios: string): string => (n === 1 ? uno : varios);

/** Las jornadas del período, de la primera a la última. Al revés o basura → ninguna. */
function jornadasDe(desde: string, hasta: string): string[] {
  if (!fechaValida(desde) || !fechaValida(hasta) || desde > hasta) return [];
  const dias: string[] = [];
  for (let d = desde; d && d <= hasta; d = sumarDias(d, 1)) dias.push(d);
  return dias;
}

/** «07/10/2026», «del 02/10/2026 al 09/10/2026, 11/10/2026»: los días seguidos, en tramos. */
function textoFechas(fechas: string[]): string {
  const tramos: [string, string][] = [];
  for (const f of [...new Set(fechas)].filter((x) => fechaValida(x)).sort()) {
    const ultimo = tramos[tramos.length - 1];
    if (ultimo && sumarDias(ultimo[1], 1) === f) ultimo[1] = f;
    else tramos.push([f, f]);
  }
  return tramos.map(([a, b]) => (a === b ? fechaCop(a) : `del ${fechaCop(a)} al ${fechaCop(b)}`)).join(', ');
}

/**
 * Las cifras de un grupo de salidas con LAS reglas de `totalesDe` (un por confirmar no
 * suma y se avisa; lo que espera pesaje suma viajes y m³, no toneladas). m³ y toneladas
 * son null si ningún renglón que cuenta las trae: «sin dato», no 0.
 */
function cifrasDe(movs: Movimiento[]): CifrasCompleto {
  const t = totalesDe(movs);
  const hayM3 = movs.some((m) => m.estado !== 'por_confirmar' && m3De(m) !== null);
  const hayT = movs.some((m) => m.estado === 'confirmado' && esNum(m.toneladas));
  return {
    viajes: t.viajes,
    pendientesSinNumero: t.pendientesSinNumero,
    porConfirmarViajes: t.porConfirmarViajes,
    m3: hayM3 ? t.m3 : null,
    toneladas: hayT ? t.toneladas : null,
  };
}

/** Junta los renglones por `llaveDe`, con la `base` (las formas escritas) del PRIMERO. */
function agrupar<B>(movs: Movimiento[], llaveDe: (m: Movimiento) => string, base: (m: Movimiento) => B): { base: B; movs: Movimiento[] }[] {
  const grupos = new Map<string, { base: B; movs: Movimiento[] }>();
  for (const m of movs) {
    const k = llaveDe(m);
    const g = grupos.get(k);
    if (g) g.movs.push(m); else grupos.set(k, { base: base(m), movs: [m] });
  }
  return [...grupos.values()];
}

/** Lo escrito, o el rótulo del blanco; y la llave con la que lo escrito «Sin destino» y el
 *  blanco son el MISMO grupo. */
const conRotulo = (s: unknown, rotulo: string): { texto: string; k: string } => {
  const texto = limpia(s) || rotulo;
  return { texto, k: llave(texto) };
};

/** null primero al final; los números de menor a mayor. */
const cmpNumNulo = (a: number | null, b: number | null): number => (a === b ? 0 : a === null ? 1 : b === null ? -1 : a - b);

// ═══════════════════════════ 1) Reporte General desglosado ═══════════════════════════

function seccionReporteGeneral(reportes: ReporteGeneralGuardado[], dias: string[]): ModeloReporteCompleto['reporteGeneral'] {
  // Uno por jornada (la base no deja dos; si llegaran, manda el primero).
  const porFecha = new Map<string, ReporteGeneralGuardado>();
  const enPeriodo = new Set(dias);
  for (const r of [...(reportes ?? [])].filter((x) => x && enPeriodo.has(x.fecha)).sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0))) {
    if (!porFecha.has(r.fecha)) porFecha.set(r.fecha, r);
  }
  const lista = [...porFecha.values()];

  // ⭐ El mismo nombre escrito distinto («Transportista Uno» y « transportista UNO ») es
  //    UNA fila, con la primera forma escrita (la del día más viejo).
  const juntar = (campo: 'empresas' | 'frentes'): FilaRgCompleto[] => {
    const g = new Map<string, { nombre: string; viajes: number; toneladas: number }>();
    for (const r of lista) {
      for (const f of r[campo] ?? []) {
        const nombre = limpia(f?.nombre);
        if (!nombre) continue;
        const k = llave(nombre);
        let x = g.get(k);
        if (!x) { x = { nombre, viajes: 0, toneladas: 0 }; g.set(k, x); }
        x.viajes += esNum(f.viajes) ? f.viajes : 0;
        x.toneladas += esNum(f.toneladas) ? f.toneladas : 0;
      }
    }
    const filas = [...g.values()];
    const total = filas.reduce((s, f) => s + f.viajes, 0);
    // Más viajes primero (como sus papeles), A→Z en el empate.
    return filas
      .map((f) => ({ nombre: f.nombre, viajes: f.viajes, toneladas: r2(f.toneladas), pct: total > 0 ? redondear((f.viajes / total) * 100, 1) : 0 }))
      .sort((a, b) => b.viajes - a.viajes || cmpText(a.nombre, b.nombre));
  };
  const empresas = juntar('empresas');
  const frentes = juntar('frentes');
  const suma = (filas: FilaRgCompleto[]) => ({ viajes: filas.reduce((s, f) => s + f.viajes, 0), toneladas: r2(filas.reduce((s, f) => s + f.toneladas, 0)) });
  const sumaEmpresas = suma(empresas);
  const sumaFrentes = suma(frentes);

  const conViajes = lista.filter((r) => esNum(r.viajesTotal));
  const conToneladas = lista.filter((r) => esNum(r.toneladasTotal));
  const viajesTotal = conViajes.length ? conViajes.reduce((s, r) => s + (r.viajesTotal as number), 0) : null;
  const toneladasTotal = conToneladas.length ? r2(conToneladas.reduce((s, r) => s + (r.toneladasTotal as number), 0)) : null;

  // Si TODOS los reportes traen sus totales y las filas no los suman, se dice (sin juzgar).
  const notas: string[] = [];
  const conTodo = lista.length > 0 && conViajes.length === lista.length && conToneladas.length === lista.length;
  if (conTodo && viajesTotal !== null && toneladasTotal !== null) {
    const fmtV = (n: number) => `${n.toLocaleString('es-VE', { maximumFractionDigits: 2 })} ${plural(n, 'viaje', 'viajes')}`;
    const fmtT = (n: number) => `${n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} t`;
    const revisar = (que: string, filas: FilaRgCompleto[], s: { viajes: number; toneladas: number }) => {
      if (!filas.length) return;
      if (s.viajes === viajesTotal && Math.abs(s.toneladas - toneladasTotal) <= 0.01 + 1e-9) return;
      notas.push(`La suma ${que} (${fmtV(s.viajes)} · ${fmtT(s.toneladas)}) no coincide con el total del Reporte General (${fmtV(viajesTotal)} · ${fmtT(toneladasTotal)}).`);
    };
    revisar('por empresa', empresas, sumaEmpresas);
    revisar('por frente', frentes, sumaFrentes);
  }

  return {
    vacio: lista.length === 0,
    jornadasConReporte: lista.length,
    jornadasSinReporte: dias.filter((d) => !porFecha.has(d)),
    viajesTotal,
    toneladasTotal,
    empresas,
    frentes,
    sumaEmpresas,
    sumaFrentes,
    notas,
  };
}

// ═══════════════════════════ 2) Entrada por patio ═══════════════════════════

function seccionPatios(
  movs: Movimiento[],
  listas: EntradaReporteCompleto['listas'],
  dias: string[],
  reportes: Map<string, ReporteGeneralGuardado>,
): ModeloReporteCompleto['patios'] {
  // Los patios de su lista, TAMBIÉN los desactivados: un patio que se quitó después
  // conserva su historia en el papel de un período viejo.
  const patios = (listas ?? [])
    .filter((i) => i && i.clase === 'terraza' && limpia(i.nombre))
    .sort((a, b) => cmpText(a.nombre, b.nombre));
  const deLaLista = (lista: Movimiento[]) => patiosGuardados(lista, patios);

  const delPeriodo = deLaLista(movs);
  const porNombre = new Map<string, { patio: string; viajes: number }>();
  for (const p of patios) {
    const v = delPeriodo.porPatio[p.id];
    if (v == null) continue;
    const k = llave(p.nombre);
    const x = porNombre.get(k);
    if (x) x.viajes += v; else porNombre.set(k, { patio: limpia(p.nombre), viajes: v });
  }
  const filas = [...porNombre.values()].sort((a, b) => cmpText(a.patio, b.patio));
  const suma = sumaPatios(filas.map((f) => f.viajes));

  // Por jornada: la suma de los patios de ese día (la misma regla que la pantalla).
  const porDia = new Map<string, Movimiento[]>();
  for (const m of movs) {
    if (!esRenglonDePatio(m)) continue;
    const l = porDia.get(m.fecha);
    if (l) l.push(m); else porDia.set(m.fecha, [m]);
  }
  const sumaDelDia = new Map<string, number>();
  for (const d of dias) {
    const g = deLaLista(porDia.get(d) ?? []);
    const valores = Object.values(g.porPatio);
    if (valores.some((v) => v != null)) sumaDelDia.set(d, sumaPatios(valores));
  }
  const conPatios = dias.filter((d) => sumaDelDia.has(d));

  let comparacion: string | null = null;
  let jornadasSinReporte: string[] = [];
  let jornadasSinTotal: string[] = [];
  if (conPatios.length && dias.length === 1) {
    // Un día: la línea de la pantalla, tal cual.
    const r = reportes.get(dias[0]);
    comparacion = textoPatiosVsReporte(suma, r?.viajesTotal ?? null, !!r);
  } else if (conPatios.length) {
    // ⭐ Un rango: contra el Reporte General de ESAS jornadas. Las que no lo tienen (o no
    //    traen el total) se nombran aparte: compararlas diría una diferencia que no es.
    const comparables = conPatios.filter((d) => esNum(reportes.get(d)?.viajesTotal));
    jornadasSinReporte = conPatios.filter((d) => !reportes.has(d));
    jornadasSinTotal = conPatios.filter((d) => reportes.has(d) && !esNum(reportes.get(d)?.viajesTotal));
    if (comparables.length) {
      const deEllas = comparables.reduce((s, d) => s + (sumaDelDia.get(d) ?? 0), 0);
      const delReporte = comparables.reduce((s, d) => s + (reportes.get(d)?.viajesTotal as number), 0);
      const n = comparables.length;
      comparacion = `${n.toLocaleString('es-VE')} ${plural(n, 'jornada con los dos datos', 'jornadas con los dos datos')}: ${textoPatiosVsReporte(deEllas, delReporte, true)}`;
    }
  }

  return {
    vacio: filas.length === 0 && delPeriodo.otros.length === 0,
    filas,
    otros: delPeriodo.otros,
    suma,
    comparacion,
    jornadasSinReporte,
    jornadasSinTotal,
  };
}

// ═══════════════════════════ 3) Salida de agregados ═══════════════════════════

/** El vehículo de una salida en el papel (`vehiculoDe` decide si es nuestro o externo). */
function vehiculoEnPapel(m: Movimiento): { k: string; texto: string; propio: boolean } {
  if (vehiculoDe(m) === 'propio') return { k: 'propio', texto: 'Propio', propio: true };
  const empresa = limpia(m.transportista);
  return { k: `externo|${llave(empresa)}`, texto: empresa ? `Externo: ${empresa}` : 'Externo', propio: false };
}
const cmpVehiculo = (a: { propio: boolean; vehiculo: string }, b: { propio: boolean; vehiculo: string }): number =>
  Number(b.propio) - Number(a.propio) || cmpText(a.vehiculo, b.vehiculo);

function seccionAgregados(movs: Movimiento[]): ModeloReporteCompleto['agregados'] {
  const salidas = salidasDeClase(movs, 'agregados');
  const filas = agrupar(
    salidas,
    (m) => `${conRotulo(m.material, 'Sin material').k}|${conRotulo(m.destino, 'Sin destino').k}|${esNum(m.km) ? m.km : ''}|${vehiculoEnPapel(m).k}`,
    (m) => {
      const v = vehiculoEnPapel(m);
      return { material: conRotulo(m.material, 'Sin material').texto, destino: conRotulo(m.destino, 'Sin destino').texto, km: esNum(m.km) ? m.km : null, vehiculo: v.texto, propio: v.propio };
    },
  )
    .sort((a, b) => cmpText(a.base.material, b.base.material) || cmpText(a.base.destino, b.base.destino)
      || cmpNumNulo(a.base.km, b.base.km) || cmpVehiculo(a.base, b.base))
    .map(({ base, movs: g }) => ({ material: base.material, destino: base.destino, km: base.km, vehiculo: base.vehiculo, ...cifrasDe(g) }));
  const porVehiculo = agrupar(salidas, (m) => vehiculoEnPapel(m).k, (m) => ({ vehiculo: vehiculoEnPapel(m).texto, propio: vehiculoEnPapel(m).propio }))
    .sort((a, b) => cmpVehiculo(a.base, b.base))
    .map(({ base, movs: g }) => ({ vehiculo: base.vehiculo, ...cifrasDe(g) }));
  return { vacio: salidas.length === 0, filas, porVehiculo, total: cifrasDe(salidas) };
}

// ═══════════════════════════ 4) Acero ═══════════════════════════

/** Quién se lleva el acero: lo escrito («Nosotros» se escribe siempre igual); sin nada
 *  escrito, «Nosotros» si fue un vehículo nuestro. */
function quienAcero(m: Movimiento): string {
  const t = limpia(m.transportista);
  if (t) return esNosotros(t) ? NOSOTROS : t;
  return vehiculoDe(m) === 'propio' ? NOSOTROS : 'Sin dato';
}

/** «U-2 · AB12CD», «Camión 7» o '' (la placa no se repite si es lo mismo que el nombre). */
function camionDe(m: Movimiento): string {
  const u = limpia(m.unidadTexto), p = limpia(m.placa);
  return u && p && llave(u) !== llave(p) ? `${u} · ${p}` : u || p;
}

function seccionAcero(movs: Movimiento[]): ModeloReporteCompleto['acero'] {
  const salidas = salidasDeClase(movs, 'acero'); // en el orden de la jornada
  const filas = salidas.map((m) => ({
    fecha: m.fecha,
    quien: quienAcero(m),
    camion: camionDe(m),
    viajes: esNum(m.viajes) ? m.viajes : null,
    porConfirmar: m.estado === 'por_confirmar',
    m3: m.estado === 'por_confirmar' ? null : m3De(m),
    toneladas: m.estado === 'confirmado' && esNum(m.toneladas) ? m.toneladas : null,
    pendiente: m.estado === 'esperando_pesaje',
  }));
  const porQuien = agrupar(salidas, (m) => llave(quienAcero(m)), (m) => quienAcero(m))
    .sort((a, b) => cmpText(a.base, b.base))
    .map(({ base, movs: g }) => {
      const c = cifrasDe(g);
      return { quien: base, salidas: g.length, m3: c.m3, toneladas: c.toneladas, pendientes: g.filter((m) => m.estado === 'esperando_pesaje').length };
    });
  return {
    vacio: salidas.length === 0,
    filas,
    porQuien,
    total: { ...cifrasDe(salidas), salidas: salidas.length, pendientes: salidas.filter((m) => m.estado === 'esperando_pesaje').length },
  };
}

// ═══════════════════════════ 5) Aluminio y plástico ═══════════════════════════

const empresaDe = (m: Movimiento): string => {
  const t = limpia(m.transportista);
  return t ? (esNosotros(t) ? NOSOTROS : t) : 'Sin empresa';
};

function seccionAluminioPlastico(movs: Movimiento[]): ModeloReporteCompleto['aluminioPlastico'] {
  const salidas = salidasDeClase(movs, 'aluminioPlastico');
  const filas = agrupar(
    salidas,
    (m) => `${conRotulo(m.material, 'Sin material').k}|${llave(empresaDe(m))}|${conRotulo(m.destino, 'Sin destino').k}`,
    (m) => ({ material: conRotulo(m.material, 'Sin material').texto, empresa: empresaDe(m), destino: conRotulo(m.destino, 'Sin destino').texto }),
  )
    .sort((a, b) => cmpText(a.base.material, b.base.material) || cmpText(a.base.empresa, b.base.empresa) || cmpText(a.base.destino, b.base.destino))
    .map(({ base, movs: g }) => ({ ...base, ...cifrasDe(g) }));
  return { vacio: salidas.length === 0, filas, total: cifrasDe(salidas) };
}

// ═══════════════════════════ 6) Maquinaria ═══════════════════════════

// 🚜 Qué vinculadas se le preguntan a inspección es la MISMA regla de la pantalla
//    (`vinculadasParaInspeccion`, en la librería pura; lote 6 A5/B15): se re-exporta para quien arma el papel.
export { vinculadasParaInspeccion };

/** Lo leído de inspección al emitir: nunca lanza. `consulto` = se fue a la base. */
export type LecturaInspeccion = { inspeccion: EstadoInspeccion | null; error: string | null; consulto: boolean; ms: number };

/** Cuánto espera el papel a inspección antes de emitirse igual, con su aviso. */
export const TOPE_INSPECCION_MS = 20000;

const NO_SE_PUDO_LEER = 'No se pudo leer el estado de inspección';

/**
 * ⭐ LA LECTURA DE INSPECCIÓN AL EMITIR el 📄 Reporte completo (mesa de maquinaria §4.3). Solo
 * si la sección 🚜 se ve y el sitio tiene vinculadas activas (si no, no consulta nada: lo oculto
 * ni se lee). `leer` es `cargarEstadoInspeccion` (lo pasa la pestaña: esta librería no habla con
 * la base). ⭐ NUNCA bloquea el papel: si la lectura falla o no responde en `topeMs`, devuelve
 * `inspeccion: null` con el error en español, y el papel sale igual con su aviso arriba y las
 * vinculadas sin marca en «Sin dato».
 */
export async function leerInspeccionAlEmitir(
  e: { unidades: Unidad[] | null | undefined; ocultosSecciones?: readonly string[] },
  leer: (vinculadas: VinculadaParaLeer[]) => Promise<EstadoInspeccion>,
  topeMs: number = TOPE_INSPECCION_MS,
): Promise<LecturaInspeccion> {
  const vinculadas = vinculadasParaInspeccion(e?.unidades);
  if (!vinculadas.length || (e?.ocultosSecciones ?? []).includes('maquinaria')) {
    return { inspeccion: null, error: null, consulto: false, ms: Date.now() };
  }
  try {
    // El mismo tope que usan el bloque 🚜 (R1) y la guardia (R2): `conTope`.
    const inspeccion = await conTope(Promise.resolve().then(() => leer(vinculadas)), topeMs, `${NO_SE_PUDO_LEER}: no respondió a tiempo.`);
    return { inspeccion: inspeccion ?? null, error: null, consulto: true, ms: Date.now() };
  } catch (err: any) {
    const msg = limpia(err?.message);
    return { inspeccion: null, error: msg.startsWith(NO_SE_PUDO_LEER) ? msg : `${NO_SE_PUDO_LEER}${msg ? `: ${msg}` : '.'}`, consulto: true, ms: Date.now() };
  }
}

function seccionMaquinaria(
  unidades: EntradaReporteCompleto['unidades'],
  inspeccion: EstadoInspeccion | null | undefined,
  emitidoMs: number | null | undefined,
  hasta: string,
  hoy: string,
  jornadas: number,
): ModeloReporteCompleto['maquinaria'] {
  // ⭐ LA regla única (la del bloque 🚜 de la pantalla): marca del sitio contra inspección. Sin
  //    inspección leída, una vinculada sin marca es «Sin dato» (nunca «Disponible»).
  const modelo = modeloMaquinariaPapel(unidades ?? [], inspeccion ?? null, esNum(emitidoMs) ? emitidoMs : NaN);
  // ⭐ El estado vive en la flota, sin historia por jornada: es el del MOMENTO DE EMITIR, y
  //    el papel lo dice SIEMPRE (auditoría del lote 5, A11): en un rango no es el de cada
  //    jornada, y si el período no termina hoy, de qué día es (como el bloque 🚜 de la
  //    pantalla al mirar otra jornada).
  const EMITIR = 'El estado de las máquinas es el del momento de emitir este papel';
  let notaAhora: string;
  if (!fechaValida(hoy)) notaAhora = `${EMITIR}.`;
  else if (hoy !== hasta) notaAhora = `${EMITIR} (jornada del ${fechaCop(hoy)}), no el del ${fechaCop(hasta)}.`;
  else if (jornadas > 1) notaAhora = `${EMITIR}, no el de cada jornada del período.`;
  else notaAhora = 'Estado de las máquinas al momento de emitir este papel.';
  return { ...modelo, notaAhora };
}

// ═══════════════════════════ 7) Bloques ═══════════════════════════

function seccionBloques(
  movs: Movimiento[],
  anteriores: Movimiento[] | null | undefined,
  listas: EntradaReporteCompleto['listas'],
  desde: string,
  hasta: string,
): ModeloReporteCompleto['bloques'] {
  const mat = materialDeBloques(listas);
  const delPeriodo = entradaInventario(movs, mat);
  const sumar = (l: { cantidad: number }[]) => l.reduce((s, x) => s + x.cantidad, 0);
  // ⭐ El inventario es un SALDO: lo de antes del período más lo del período, al `hasta`.
  //    Lo anterior se toma solo si es de verdad anterior (nunca se cuenta dos veces).
  const previos = (anteriores ?? []).filter((m) => m && fechaValida(m.fecha) && m.fecha < desde);
  const todo = entradaInventario([...previos, ...movs], mat);
  const inv = inventarioBloques(todo.producciones, todo.salidas, hasta, mat.dias);
  const hayEnPeriodo = movs.some((m) => (m.tipo === 'produccion' || m.tipo === 'salida') && esDeBloques(m, mat));
  return {
    vacio: !hayEnPeriodo && inv.disponible === 0 && inv.enCurado === 0,
    material: mat.nombre,
    alDia: hasta,
    producido: delPeriodo.producciones.length ? sumar(delPeriodo.producciones) : null,
    vendido: delPeriodo.salidas.length ? sumar(delPeriodo.salidas) : null,
    disponible: inv.disponible,
    enCurado: inv.enCurado,
    proximos: inv.proximos,
    avisos: [...todo.avisos, ...inv.avisos],
  };
}

// ═══════════════════════════ El modelo completo ═══════════════════════════

/**
 * ⭐ Las 7 secciones del Reporte completo de un sitio en un período (fechas de JORNADA,
 * ambas incluidas). Los renglones y reportes de fuera del período no cuentan (aunque
 * lleguen). Nunca lanza ni deja NaN: un período al revés o con basura sale vacío.
 */
export function modeloReporteCompleto(e: EntradaReporteCompleto): ModeloReporteCompleto {
  const desde = String(e?.desde ?? '');
  const hasta = String(e?.hasta ?? '');
  const dias = jornadasDe(desde, hasta);
  const rango = { desde, hasta };
  const movs = (e?.movimientos ?? []).filter((m) => m && dias.length > 0 && enRango(m, rango));
  const listas = e?.listas ?? [];
  const reporteGeneral = seccionReporteGeneral(e?.reportes ?? [], dias);
  const porFecha = new Map<string, ReporteGeneralGuardado>();
  for (const r of (e?.reportes ?? []).filter((x) => x && dias.includes(x.fecha))) if (!porFecha.has(r.fecha)) porFecha.set(r.fecha, r);
  return {
    sitio: limpia(e?.sitio),
    desde,
    hasta,
    periodo: periodoCop(rango),
    jornadas: dias.length,
    reporteGeneral,
    patios: seccionPatios(movs, listas, dias, porFecha),
    agregados: seccionAgregados(movs),
    acero: seccionAcero(movs),
    aluminioPlastico: seccionAluminioPlastico(movs),
    maquinaria: seccionMaquinaria(e?.unidades ?? [], e?.inspeccion, e?.emitidoMs, hasta, String(e?.hoy ?? ''), dias.length),
    bloques: seccionBloques(movs, dias.length ? e?.anteriores : [], listas, desde, hasta),
  };
}

// ═══════════════════════════ El papel (HTML) ═══════════════════════════

const SIN_DATO = '—';
const finito = (n: unknown): number => (esNum(n) ? n : 0);
const fmtViajes = (n: number): string => finito(n).toLocaleString('es-VE', { maximumFractionDigits: 2 });
const fmt2 = (n: number): string => finito(n).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtEntero = (n: number): string => finito(n).toLocaleString('es-VE', { maximumFractionDigits: 0 });
const fmtPct = (n: number): string => `${finito(n).toLocaleString('es-VE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;
const fmtKm = (n: number | null): string => (esNum(n) ? n.toLocaleString('es-VE', { maximumFractionDigits: 1 }) : SIN_DATO);
/** m³ o toneladas: con 2 decimales, o «—» si es «sin dato». */
const fmtDato = (n: number | null): string => (esNum(n) ? fmt2(n) : SIN_DATO);
/** Los viajes con sus avisos de pendientes (las palabras de `textoViajes`). */
const viajesDe = (c: CifrasCompleto): string => esc(textoViajes(c));

const LEYENDA_VACIO = '<p class="cop-vacio">Sin registros en el período.</p>';
const nota = (texto: string): string => `<p class="cop-nota">${esc(texto)}</p>`;

/**
 * La tabla del papel (`tabla` de `centroOperacionesPapel.ts`, la de todos los papeles del
 * módulo) cuando hay filas; sin filas, nada (aunque traiga totales: una fila «TOTALES» sola
 * no dice nada y taparía la nota de «no trae empresas»). Las celdas llegan YA ESCAPADAS.
 */
const tablaSiHay = <T,>(cols: ColTablaCop<T>[], filas: T[], etiquetaTotal?: string): string =>
  (filas.length ? tabla(cols, filas, etiquetaTotal) : '');

/** Las tarjetas (el dibujo de las de los frentes); la tercera pieza, si viene, va en chico abajo. */
const tarjetas = (pares: ([string, string] | [string, string, string | null])[]): string =>
  `<div class="fr-tj">${pares.map(([t, v, n]) => `<div><span>${esc(t)}</span><b>${esc(v)}</b>${n ? `<small>${esc(n)}</small>` : ''}</div>`).join('')}</div>`;

function htmlReporteGeneral(m: ModeloReporteCompleto): string {
  const r = m.reporteGeneral;
  const partes: string[] = [];
  const cards: [string, string][] = [
    ['Viajes totales', r.viajesTotal === null ? SIN_DATO : fmtViajes(r.viajesTotal)],
    ['Total neto', r.toneladasTotal === null ? SIN_DATO : `${fmt2(r.toneladasTotal)} t`],
  ];
  if (m.jornadas > 1) cards.push(['Jornadas con Reporte General', `${fmtEntero(r.jornadasConReporte)} de ${fmtEntero(m.jornadas)}`]);
  partes.push(tarjetas(cards));
  const tablaRg = (titulo: string, filas: FilaRgCompleto[], s: { viajes: number; toneladas: number }): string => tablaSiHay<FilaRgCompleto>([
    { titulo, celda: (f) => esc(f.nombre) },
    { titulo: 'Viajes', num: true, celda: (f) => fmtViajes(f.viajes), total: fmtViajes(s.viajes) },
    { titulo: 'Toneladas', num: true, celda: (f) => fmt2(f.toneladas), total: fmt2(s.toneladas) },
    { titulo: 'Participación', num: true, celda: (f) => fmtPct(f.pct), total: s.viajes > 0 ? '100 %' : fmtPct(0) },
  ], filas);
  partes.push(tablaRg('Empresa', r.empresas, r.sumaEmpresas) || nota('El Reporte General no trae empresas.'));
  partes.push(tablaRg('Frente', r.frentes, r.sumaFrentes) || nota('El Reporte General no trae frentes.'));
  for (const t of r.notas) partes.push(nota(t));
  if (m.jornadas > 1 && r.jornadasSinReporte.length) partes.push(nota(`Jornadas sin Reporte General: ${textoFechas(r.jornadasSinReporte)}.`));
  return partes.join('');
}

function htmlPatios(m: ModeloReporteCompleto): string {
  const p = m.patios;
  type Fila = ModeloReporteCompleto['patios']['filas'][number];
  const partes: string[] = [];
  partes.push(tablaSiHay<Fila>([
    { titulo: 'Patio', celda: (f) => esc(f.patio) },
    { titulo: 'Viajes', num: true, celda: (f) => fmtViajes(f.viajes), total: fmtViajes(p.suma) },
  ], p.filas, 'Suma de los patios'));
  if (p.otros.length) {
    const lista = p.otros.map((o) => `${o.destino} (${fmtViajes(o.viajes)} ${plural(o.viajes, 'viaje', 'viajes')})`).join(', ');
    partes.push(nota(`Entradas sueltas que no son de un patio de la lista (no suman): ${lista}.`));
  }
  if (p.comparacion) partes.push(`<p class="fr-tot">${esc(p.comparacion)}</p>`);
  if (p.jornadasSinReporte.length) partes.push(nota(`Jornadas con patios y sin Reporte General (no entran en la comparación): ${textoFechas(p.jornadasSinReporte)}.`));
  if (p.jornadasSinTotal.length) partes.push(nota(`Jornadas con patios cuyo Reporte General no trae el total de viajes (no entran en la comparación): ${textoFechas(p.jornadasSinTotal)}.`));
  return partes.join('');
}

function htmlAgregados(m: ModeloReporteCompleto): string {
  const a = m.agregados;
  type Fila = ModeloReporteCompleto['agregados']['filas'][number];
  type PorVehiculo = ModeloReporteCompleto['agregados']['porVehiculo'][number];
  const partes: string[] = [tablaSiHay<Fila>([
    { titulo: 'Material', celda: (f) => esc(f.material) },
    { titulo: 'Destino', celda: (f) => esc(f.destino) },
    { titulo: 'Km', num: true, celda: (f) => fmtKm(f.km) },
    { titulo: 'Vehículo', celda: (f) => esc(f.vehiculo) },
    { titulo: 'Viajes', num: true, celda: (f) => viajesDe(f), total: viajesDe(a.total) },
    { titulo: 'm³', num: true, celda: (f) => fmtDato(f.m3), total: fmtDato(a.total.m3) },
    { titulo: 'Toneladas', num: true, celda: (f) => fmtDato(f.toneladas), total: fmtDato(a.total.toneladas) },
  ], a.filas)];
  // Propio contra externo (cada empresa), solo si hay más de uno: con uno solo, es el total.
  if (a.porVehiculo.length > 1) {
    partes.push(tablaSiHay<PorVehiculo>([
      { titulo: 'Vehículo', celda: (v) => esc(v.vehiculo) },
      { titulo: 'Viajes', num: true, celda: (v) => viajesDe(v) },
      { titulo: 'm³', num: true, celda: (v) => fmtDato(v.m3) },
      { titulo: 'Toneladas', num: true, celda: (v) => fmtDato(v.toneladas) },
    ], a.porVehiculo));
  }
  return partes.join('');
}

const PENDIENTE_PESAJE = '<i class="cop-pdte">pendiente de pesaje</i>';
const avisoPendientes = (n: number): string =>
  (n > 0 ? `<small class="cop-pend">+${fmtEntero(n)} ${plural(n, 'pendiente de pesaje', 'pendientes de pesaje')}</small>` : '');

function htmlAcero(m: ModeloReporteCompleto): string {
  const a = m.acero;
  type Fila = ModeloReporteCompleto['acero']['filas'][number];
  type PorQuien = ModeloReporteCompleto['acero']['porQuien'][number];
  const conFecha = m.jornadas > 1;
  const cols: ColTablaCop<Fila>[] = [
    ...(conFecha ? [{ titulo: 'Jornada', celda: (f: Fila) => esc(fechaCop(f.fecha)) }] : []),
    { titulo: 'Se lo lleva', celda: (f) => esc(f.quien) },
    { titulo: 'Camión', celda: (f) => esc(f.camion || SIN_DATO) },
    {
      titulo: 'Viajes', num: true, total: viajesDe(a.total),
      celda: (f) => (f.porConfirmar ? (esNum(f.viajes) && f.viajes > 0 ? `${fmtViajes(f.viajes)} por confirmar` : 'Por confirmar') : (esNum(f.viajes) ? fmtViajes(f.viajes) : SIN_DATO)),
    },
    { titulo: 'm³', num: true, celda: (f) => fmtDato(f.m3), total: fmtDato(a.total.m3) },
    { titulo: 'Toneladas', num: true, celda: (f) => (f.pendiente ? PENDIENTE_PESAJE : fmtDato(f.toneladas)), total: `${fmtDato(a.total.toneladas)}${avisoPendientes(a.total.pendientes)}` },
  ];
  const partes = [tablaSiHay(cols, a.filas)];
  if (a.porQuien.length > 1) {
    partes.push(tablaSiHay<PorQuien>([
      { titulo: 'Se lo lleva', celda: (q) => esc(q.quien) },
      { titulo: 'Salidas', num: true, celda: (q) => fmtEntero(q.salidas) },
      { titulo: 'm³', num: true, celda: (q) => fmtDato(q.m3) },
      { titulo: 'Toneladas', num: true, celda: (q) => `${fmtDato(q.toneladas)}${avisoPendientes(q.pendientes)}` },
    ], a.porQuien));
  }
  return partes.join('');
}

function htmlAluminioPlastico(m: ModeloReporteCompleto): string {
  const a = m.aluminioPlastico;
  type Fila = ModeloReporteCompleto['aluminioPlastico']['filas'][number];
  return tablaSiHay<Fila>([
    { titulo: 'Material', celda: (f) => esc(f.material) },
    { titulo: 'Empresa', celda: (f) => esc(f.empresa) },
    { titulo: 'Destino', celda: (f) => esc(f.destino) },
    { titulo: 'Viajes', num: true, celda: (f) => viajesDe(f), total: viajesDe(a.total) },
    { titulo: 'Toneladas', num: true, celda: (f) => fmtDato(f.toneladas), total: fmtDato(a.total.toneladas) },
  ], a.filas);
}

/** La marca «≠» de una fila que no coincide con inspección. */
const DIFIERE = '<b class="cop-dif">≠</b>';

/**
 * 🚜 La sección 6 (mesa de maquinaria §4.3): la nota A11, el aviso si inspección no se leyó al
 * emitir, las tarjetas por grupo (solo las que tienen algo, con su subconteo) y la tabla
 * Unidad · Placa · Estado (sitio) · Inspección (solo si hay vinculadas) · Nota, con «≠» donde
 * la marca del sitio no coincide. La hora del «Estado al emitir» va en el título
 * (`cuerpoReporteCompleto`). Sin horas trabajadas ni nombres de inspectores: el modelo no los trae.
 */
function htmlMaquinaria(m: ModeloReporteCompleto): string {
  const q = m.maquinaria;
  type Fila = ModeloReporteCompleto['maquinaria']['filas'][number];
  const partes: string[] = [];
  // ⭐ A11: SIEMPRE se dice que el estado es el del momento de emitir.
  if (q.notaAhora) partes.push(nota(q.notaAhora));
  // ⭐ Si inspección no se pudo leer, se dice ARRIBA: lo impreso es lo marcado en el sitio.
  if (q.avisoLectura) partes.push(`<p class="cop-aviso">${esc(q.avisoLectura)}</p>`);
  partes.push(tarjetas([
    ...q.tarjetas.map((t): [string, string, string | null] => [t.titulo, fmtEntero(t.cantidad), t.detalle]),
    ['Total', fmtEntero(q.total)],
  ]));
  const unidad = (f: Fila): string => {
    const desc = f.descripcion && llave(f.descripcion) !== llave(f.codigo) ? ` · ${esc(f.descripcion)}` : '';
    return `${esc(f.codigo)}${desc}`;
  };
  const cols: ColTablaCop<Fila>[] = [
    { titulo: 'Unidad', celda: unidad },
    { titulo: 'Placa', celda: (f) => esc(f.placa && llave(f.placa) !== llave(f.codigo) ? f.placa : SIN_DATO) },
    {
      titulo: 'Estado (sitio)',
      celda: (f) => `${esc(f.estado)}${f.noCoincide ? ` ${DIFIERE}` : ''}${f.detalle ? `<small>${esc(f.detalle)}</small>` : ''}`,
    },
    ...(q.conInspeccion ? [{ titulo: 'Inspección', celda: (f: Fila) => esc(f.inspeccion) }] : []),
    { titulo: 'Nota', celda: (f) => esc(f.nota ?? SIN_DATO) },
  ];
  partes.push(tablaSiHay<Fila>(cols, q.filas));
  if (q.filas.some((f) => f.noCoincide)) partes.push(`<p class="cop-nota">${DIFIERE} ${esc('Lo marcado en el sitio no coincide con inspección.')}</p>`);
  return partes.join('');
}

function htmlBloques(m: ModeloReporteCompleto): string {
  const b = m.bloques;
  const partes: string[] = [];
  if (llave(b.material) !== llave('Bloques')) partes.push(nota(`Material: ${b.material}`));
  const corte = fechaCop(b.alDia);
  partes.push(tablaSiHay<[string, string]>([
    { titulo: 'Bloques', celda: ([que]) => esc(que) },
    { titulo: 'Cantidad', num: true, celda: ([, cuanto]) => cuanto },
  ], [
    ['Producción del período', b.producido === null ? SIN_DATO : fmtEntero(b.producido)],
    ['Ventas del período', b.vendido === null ? SIN_DATO : fmtEntero(b.vendido)],
    [`Disponibles para la venta al ${corte}`, fmtEntero(b.disponible)],
    [`En curado al ${corte}`, fmtEntero(b.enCurado)],
  ]));
  if (b.proximos.length) {
    partes.push(tablaSiHay<{ fecha: string; cantidad: number }>([
      { titulo: 'Se liberan el', celda: (x) => esc(fechaCop(x.fecha)) },
      { titulo: 'Bloques', num: true, celda: (x) => fmtEntero(x.cantidad) },
    ], b.proximos));
  }
  for (const a of b.avisos) partes.push(nota(a));
  return partes.join('');
}

const PINTORES: Record<SeccionCompleto, (m: ModeloReporteCompleto) => string> = {
  reporteGeneral: htmlReporteGeneral,
  patios: htmlPatios,
  agregados: htmlAgregados,
  acero: htmlAcero,
  aluminioPlastico: htmlAluminioPlastico,
  maquinaria: htmlMaquinaria,
  bloques: htmlBloques,
};

/**
 * ⭐ El CUERPO del Reporte completo (sin membrete: lo pone `pdfDocument`). Arriba, el
 * sitio y el período; luego las secciones visibles numeradas 1, 2, 3… (la numeración se
 * cuenta sobre lo que se ve: lo oculto no deja hueco). Una sección vacía sale con su
 * título y «Sin registros en el período.».
 */
export function cuerpoReporteCompleto(m: ModeloReporteCompleto, op: OpcionesReporteCompleto): string {
  const ocultos = new Set(op?.ocultosSecciones ?? []);
  const partes: string[] = [ficha([['Sitio', m.sitio], ['Período', m.periodo]])];
  let n = 0;
  for (const s of SECCIONES_COMPLETO) {
    if (ocultos.has(s.k)) continue;
    n++;
    // 🚜 El estado de las máquinas es el del momento de emitir: su hora va junto al título.
    const derecha = s.k === 'maquinaria' && !m.maquinaria.vacio && m.maquinaria.estadoAl ? `Estado al emitir: ${m.maquinaria.estadoAl}` : '';
    partes.push(seccion(`${n}. ${s.etiqueta}`, m[s.k].vacio ? LEYENDA_VACIO : PINTORES[s.k](m), derecha));
  }
  return `<div class="cop-completo">${partes.join('')}</div>`;
}
