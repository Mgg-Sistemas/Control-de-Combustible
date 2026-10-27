// 💰 REPORTE CONSOLIDADO DE PAGOS (19-oct-2026) — pestaña de Reportes.
//
// Pedido del cliente: «un reporte en el cual yo pueda ver horómetros, pagos por
// viajes, pagos por pesos y jornada… sumamente versátil: que si no quiero que
// salga algo no salga, que no me salga una maquinaria si no quiero, un monto
// total por cada cosa y un total también, que si no necesito que sume algo lo
// pueda quitar, por empresa o por maquinaria o por cualquier opción… para el
// jefe, con su resumen ejecutivo con todo».
//
// ⭐ ESTE ARCHIVO NO CALCULA PLATA NI TOCA LA BASE («ese reporte no inventa
//    nada, solo reutiliza la información ya existente»): recibe el monto por
//    máquina que ya calcularon los CUATRO motores de siempre —
//    jornadas (Control de pagos), pago por horómetro (filasPagoHorometro),
//    pago por viajes (calcularPagoViajes) y pago por peso (calcularPagoPeso) —
//    y solo agrupa, suma, arma el resumen ejecutivo y pinta el PDF.
//    Probado solo en `scripts/test-reporte-consolidado.mjs`.
//
// LAS TRES POSICIONES DE CADA FUENTE: 'suma' (sale y suma), 'muestra' (sale en
// gris como referencia, NO entra en ningún total) y 'oculta' (ni sale ni suma,
// sin dejar rastro — regla de la casa).
//
// ⚠️ SOLAPES: una máquina puede cobrar por jornada Y por horómetro a la vez
//    (los dos controles existen en paralelo), o un camión por viaje Y por peso
//    (peso no filtra por modo de pago). Sumar ambos puede ser pagar doble: el
//    resumen lo marca por máquina con su monto, para que el jefe lo vea sin
//    buscarlo. El reporte NO decide cuál va: eso es del que arma el papel.
import type { ResumenFrentes, EdicionResumen } from './frentesReporte';
import { aplicarEdicionResumen } from './frentesReporte';
// 🚛 La regla compartida de «qué es un camión» (el código de texto manda): para
//    que el costo por tonelada no cuente como maquinaria a un camión a jornada.
import { esCamionDeViajes } from './equipos';
// Los FRENTES viven en DOS catálogos (viajes y maquinaria) y, además, cada
// viaje lleva CONGELADO el nombre con el que se registró: «RES. CORAL» en el
// viaje y «RESIDENCIAS CORAL» en el catálogo son el mismo sitio. Cruzarlos
// perdonando solo mayúsculas y acentos partía el frente en dos renglones (uno
// con las toneladas y otro con la plata). `indiceFrentes` los junta sin tocar
// un dato — y sin juntar los que de verdad son distintos (21-oct-2026).
import { indiceFrentes, type IndiceFrentes } from './frentesNombre';
// Para empresa y categoría basta el normalizador de siempre (mayúsculas y acentos).
import { norm } from './text';

export type FuenteKey = 'jornadas' | 'horometros' | 'viajes' | 'peso';
export type ModoFuente = 'suma' | 'muestra' | 'oculta';

export const FUENTES_META: Record<FuenteKey, { icon: string; label: string }> = {
  jornadas: { icon: '🕐', label: 'Jornadas' },
  horometros: { icon: '⚙️', label: 'Horómetros' },
  viajes: { icon: '🚛', label: 'Viajes' },
  peso: { icon: '⚖️', label: 'Peso' },
};
export const FUENTES_ORDEN: FuenteKey[] = ['jornadas', 'horometros', 'viajes', 'peso'];

// ── 🏗️🚛 LAS DOS COLUMNAS DEL PAPEL: MAQUINARIA Y ACARREO (22-oct-2026) ──────
//
// Pedido textual: «a la hora de imprimir o generar el reporte me salgan dos
// columnas, una acarreo y una maquinaria… la jornada y horómetro responden a
// maquinaria, y peso y viajes responden a acarreo; necesito que esas 4
// opciones sigan estando pero que a la hora de sacar el reporte solo estén las
// columnas de maquinaria y acarreo, y aun así que yo pueda activar y
// desactivar las subopciones como está ahorita».
//
// ⭐ LAS CUATRO FUENTES SIGUEN MANDANDO: cada una con sus tres posiciones
//    (suma / sin sumar / oculta). La columna del grupo suma SOLO las fuentes
//    del grupo que están en «suma»; si el grupo solo tiene fuentes «sin sumar»,
//    la columna sale como referencia (ref) igual que antes una fuente sola; y
//    si todas sus fuentes están ocultas, la columna no sale. Una fuente «sin
//    sumar» dentro de un grupo que sí suma se dice debajo del monto, en gris.
//    El TOTAL no cambia ni un centavo: es la misma suma, agrupada distinto.
export type GrupoKey = 'maquinaria' | 'acarreo';
export const GRUPOS_META: Record<GrupoKey, { icon: string; label: string; fuentes: readonly FuenteKey[] }> = {
  maquinaria: { icon: '🏗️', label: 'Maquinaria', fuentes: ['jornadas', 'horometros'] },
  acarreo: { icon: '🚛', label: 'Acarreo', fuentes: ['viajes', 'peso'] },
};
export const GRUPOS_ORDEN: GrupoKey[] = ['maquinaria', 'acarreo'];

/** Una máquina con su monto por fuente (solo las fuentes donde cobró algo). */
export type FilaConsolidada = {
  id: string;
  code: string;
  placa: string;
  /** NOMBRE de la empresa (los motores de viajes dan id: la pantalla lo traduce antes). */
  empresa: string;
  marca?: string | null;
  modelo?: string | null;
  /** La clasificación del catálogo (20-oct-2026): para filtrar y agrupar por categoría. */
  categoria?: string | null;
  /** El frente de trabajo VIGENTE a la fecha final del rango (20-oct-2026):
   *  el de Reportes → ⛏️ Frentes, que desde el 19-oct se queda hasta reasignarse. */
  frente?: string | null;
  /** 👤 El responsable / encargado asignado a la máquina o vehículo (22-oct-2026, a pedido). */
  encargado?: string | null;
  /** ⚙️ Estado de la máquina (Operativa, En espera, Inoperativa / Parada, Inactiva). */
  estado?: string | null;
  montos: Partial<Record<FuenteKey, number>>;
  /** ⚖️ Lo que la selección automática descartó PORQUE EL PESO MANDA en el
   *  camión (21-oct-2026, tarde): montos de viajes/jornada/horómetro que no se
   *  sumaron porque ese camión facturó por peso. Lo pone `filasElegidas`. */
  descartadoPorPeso?: Partial<Record<FuenteKey, number>>;
  /** 🕐 Lo descartado porque el usuario eligió que ESE camión con peso facture
   *  POR JORNADA (22-oct-2026): su peso y sus viajes no se suman. Lo pone
   *  `filasElegidas` cuando el id está en `camionesPorJornada`. */
  descartadoPorJornada?: Partial<Record<FuenteKey, number>>;
  /** 🤖 Monto de JORNADA descartado por la selección automática (21-oct-2026):
   *  cuando la máquina trae jornada Y horómetro sumando, manda el horómetro y
   *  la jornada no se suma — acá queda CUÁNTO era, para decirlo en el papel.
   *  Lo pone `filasElegidas`; una fila cruda no lo trae. */
  jornadaDescartada?: number;
  /**
   * LO QUE RESPALDA cada monto, en la unidad natural de su fuente:
   * jornadas y horómetros en HORAS, viajes en VIAJES CON TARIFA, peso en KG.
   * Opcional: una fila vieja sin cantidades sigue valiendo (salen solo montos).
   */
  cant?: Partial<Record<FuenteKey, number>>;
};

/** La cantidad en palabras del jefe: «36 h», «12 viajes», «48,50 t». */
export function cantTexto(k: FuenteKey, v: number | null | undefined): string {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n) || n === 0) return '';
  if (k === 'viajes') return `${Math.round(n)} viaje${Math.round(n) === 1 ? '' : 's'}`;
  if (k === 'peso') return `${(n / 1000).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} t`;
  return `${n.toLocaleString('es-VE', { maximumFractionDigits: 1 })} h`;
}

/** Cómo se parte el cuerpo del papel (20-oct-2026: + categoría y frente; 22-oct-2026: + encargado). */
export type AgruparConsolidado = 'empresa' | 'maquina' | 'global' | 'categoria' | 'frente' | 'encargado';

export const SIN_CATEGORIA = 'Sin clasificación';
export const SIN_FRENTE = 'Sin frente';
export const SIN_ENCARGADO = 'Sin encargado';
export const categoriaDe = (f: Pick<FilaConsolidada, 'categoria'>): string => String(f.categoria ?? '').trim() || SIN_CATEGORIA;
export const frenteDe = (f: Pick<FilaConsolidada, 'frente'>): string => String(f.frente ?? '').trim() || SIN_FRENTE;
export const encargadoDe = (f: Pick<FilaConsolidada, 'encargado'>): string => String(f.encargado ?? '').trim() || SIN_ENCARGADO;

/**
 * Todos los nombres de frente que aparecen en el papel: los de las máquinas y
 * los CONGELADOS en cada viaje. Con esa lista se decide qué nombres son el
 * mismo frente. «Sin frente» queda fuera a propósito: es una etiqueta nuestra,
 * no un sitio, y no debe fundirse con nada.
 */
function nombresDeFrente(
  filas: readonly FilaConsolidada[] | null | undefined,
  viajes?: readonly ViajeToneladas[] | null,
): string[] {
  const s = new Set<string>();
  for (const f of filas ?? []) {
    const n = String(f?.frente ?? '').trim();
    if (n) s.add(n);
  }
  for (const v of viajes ?? []) {
    const n = String(v?.frente_nombre ?? '').trim();
    if (n) s.add(n);
  }
  return Array.from(s);
}

/** El índice de frentes del papel (nombres de máquinas + nombres de viajes). */
export function indiceFrentesConsolidado(
  filas: readonly FilaConsolidada[] | null | undefined,
  viajes: readonly ViajeToneladas[] | null | undefined,
  op: Pick<OpcionesConsolidado, 'soloFrentes' | 'catalogoFrentes'>,
): IndiceFrentes {
  // Lo MARCADO en el filtro también entra: así marcar «RESIDENCIAS CORAL»
  // alcanza a los viajes que decían «RES. CORAL», aunque esa fila ya no esté.
  const marcados = (op.soloFrentes ?? []).map((m) => String(m ?? '').trim()).filter(Boolean);
  const catalogo = (op.catalogoFrentes ?? []).map((m) => String(m ?? '').trim()).filter(Boolean);
  return indiceFrentes([...nombresDeFrente(filas, viajes), ...marcados, ...catalogo], catalogo);
}

export type OpcionesConsolidado = {
  fuentes: Record<FuenteKey, ModoFuente>;
  /** Cómo se parte el cuerpo del papel. */
  agruparPor: AgruparConsolidado;
  sinMarcaModelo: boolean;
  sinPlaca: boolean;
  /** Sin el respaldo de cada monto (horas, viajes, toneladas). Nace mostrándolo. */
  sinCantidades: boolean;
  /** Sin nombres de empresa EN NINGUNA PARTE (tabla, resumen y cuadros). */
  sinEmpresas: boolean;
  // ── El resumen ejecutivo, pieza por pieza ──
  resumen: boolean;
  tarjetasFuente: boolean;
  cuadroEmpresas: boolean;
  top5: boolean;
  solapes: boolean;
  comparacion: boolean;
  promedioDia: boolean;
  /** 🤖 SELECCIÓN AUTOMÁTICA EN TODO EL PAPEL (21-oct-2026, decisión del jefe:
   *  «la idea es que haga la selección automática en ese reporte»): si una
   *  máquina trae jornada Y horómetro SUMANDO, manda el horómetro (el exacto) y
   *  su jornada NO se suma — en el total, las tarjetas por fuente y todos los
   *  cuadros. Lo descartado se dice en el resumen (este papel no inventa nada).
   *  Nace prendida; apagarla va al nombre del archivo. */
  seleccionAutomatica: boolean;
  /** 🤖 El DESGLOSE de la selección automática (21-oct-2026, a pedido: «que
   *  tome lo del horómetro domina pero que no me salga esa información si no
   *  quiero»): el cuadro «Mandó el horómetro» y la cola de «fuera del cuadro:
   *  … sin toneladas» del ⚖️. Apagado, la regla SIGUE aplicando — solo deja de
   *  imprimirse el detalle. Nace prendido. */
  desgloseAutomatico: boolean;
  /** ⚖️ Costo maquinaria ÷ toneladas del acarreo, global y por frente
   *  (21-oct-2026, a pedido del jefe: «$25.000 entre 2.000 t = $12,5 la
   *  tonelada»). Nace prendida: es el corazón del pedido. */
  costoTonelada: boolean;
  /** 🕐 Costo maquinaria ÷ horas facturadas («la hora me salió a 89, no a 100»). */
  horaPromedio: boolean;
  /** 📅 LA TABLA OPERATIVA DIARIA (21-oct-2026, a pedido: «que tenga una tabla
   *  operativa diaria con un desglose del estilo del de viajes de camiones»):
   *  día por día, fuente por fuente, con su fila TOTAL/PROM. Nace prendida. */
  tablaDiaria: boolean;
  /** 📈 El gráfico del día por día (barras = lo facturado, línea = toneladas
   *  del acarreo, o máquinas si no hubo acarreo). Nace prendido. */
  graficoDiario: boolean;
  /** 🏗️🚛 El papel en DOS columnas, Maquinaria (jornadas + horómetros) y
   *  Acarreo (viajes + peso), en vez de una por fuente (22-oct-2026, a pedido).
   *  Las cuatro fuentes siguen con sus tres posiciones: deciden QUÉ entra en
   *  cada columna. Nace prendido; apagarlo vuelve a una columna por fuente. */
  columnasPorGrupo: boolean;
  /** ⚖️ El cuadro «costo por tonelada sobre TODO el acarreo» (22-oct-2026, a
   *  pedido): la maquinaria de cada frente ÷ las toneladas de TODO el rango
   *  (no las de su frente), con su fila TOTAL. Nace prendido. */
  costoTonAcarreoTotal: boolean;
  /** Columnas de la tabla diaria, una por una (igual que el informe operativo). */
  sinDiaSemana: boolean;
  sinMaquinasDia: boolean;
  sinToneladasDia: boolean;
  sinCostoTonDia: boolean;
  /** Ids marcados en el selector; vacío = todas. Esto SÍ cambia el total (va FILTRADO). */
  soloMaquinas?: string[];
  /** NOMBRES de empresa marcados; vacío = todas (19-oct-2026, a pedido: «poder
   *  sacarlo para una sola empresa»). También cambia el total: va FILTRADO. */
  soloEmpresas?: string[];
  /** CLASIFICACIONES marcadas; vacío = todas (20-oct-2026, a pedido: «para solo
   *  una categoría en específico»). También cambia el total: va FILTRADO. */
  soloCategorias?: string[];
  /** ⛏️ LOS FRENTES QUE EXISTEN (los dos catálogos, viajes y maquinaria), para
   *  juntar bien los nombres (21-oct-2026). Con esta lista, un frente de verdad
   *  NUNCA se absorbe dentro de otro parecido y solo se adoptan las etiquetas
   *  congeladas en viajes viejos. Sin ella la lib se pone prudente y junta
   *  menos — nunca de más. La pantalla la llena; no es una opción del usuario. */
  catalogoFrentes?: readonly string[];
  /** FRENTES marcados (por nombre, el vigente al final del rango); vacío = todos
   *  (20-oct-2026, a pedido: «poder seleccionar un frente o varios»). «Sin
   *  frente» también se puede marcar. Cambia el total: va FILTRADO. */
  soloFrentes?: string[];
  /** 🚛⚖️🕐 CAMIONES CON PESO QUE FACTURAN POR JORNADA (22-oct-2026, a pedido:
   *  «que si quiero que esos camiones que tienen peso los quiero en jornada o
   *  peso, pueda seleccionar todos o uno por uno»). Ids de los camiones que,
   *  aun teniendo peso, se facturan por su JORNADA: su peso y sus viajes no se
   *  suman. Vacío = todos por peso (lo de siempre). Cambia la plata: va al
   *  nombre del archivo. Solo aplica con la 🤖 selección automática. */
  camionesPorJornada?: string[];
  /** 👤 ENCARGADOS marcados (por nombre); vacío = todos (22-oct-2026, a pedido:
   *  «poder agrupar o sacarlo por encargado»). «Sin encargado» también se
   *  puede marcar. Cambia el total: va FILTRADO. */
  soloEncargados?: string[];
  /** ⚙️ ESTADOS marcados (Operativa, En espera, Inoperativa / Parada, Inactiva); vacío = todos. Cambia el total: va FILTRADO. */
  soloEstados?: string[];
  /** ⚠️ AVISA LOS DÍAS SIN HORÓMETRO QUE LA JORNADA SÍ CUBRIRÍA (22-oct-2026,
   *  a pedido: «ese cambio tiene sentido y debería ser así, correcto?»). La
   *  selección automática decide por MÁQUINA en todo el rango: si una máquina
   *  factura por horómetro, su jornada se descarta ENTERA — así que un día
   *  puntual sin lectura (el aparato se dañó, se olvidó) se pierde en silencio,
   *  aunque esa jornada sí tenga horas. Este cuadro lo hace VISIBLE para
   *  corregirlo con 🔁 Cambio de horómetro, en vez de que nadie lo note. No
   *  cambia ni un centavo del papel. Nace prendido: es seguridad, no cuesta
   *  nada dejarlo encendido. */
  avisoHuecosHorometro: boolean;
  /** 🔁 RELLENA ESOS DÍAS AUTOMÁTICAMENTE CON SU JORNADA (22-oct-2026, a
   *  pedido, con la aclaración del cliente: «el horómetro manda, pero si para
   *  días no hay horómetro y sí jornada, ¿la toma para esa maquinaria?»). Con
   *  esto PRENDIDO, el día sin horómetro usa la jornada de ESE día — el resto
   *  de la máquina sigue por horómetro, nunca se suman los dos el MISMO día.
   *  Es la única excepción a «uno u otro por máquina, nunca mezclado»: pasa a
   *  ser por máquina-Y-día. CAMBIA LA PLATA: va al nombre del archivo. Nace
   *  APAGADO — la corrección de la casa sigue siendo el 🔁 Cambio de
   *  horómetro, con motivo y revisada por una persona (recomendado: un día
   *  sin lectura no siempre significa que la jornada de ese día sea la cifra
   *  correcta — por eso esto se ofrece aparte, no como lo único). */
  rellenoAutomaticoDia: boolean;
};

export const OPCIONES_CONSOLIDADO_POR_DEFECTO: OpcionesConsolidado = {
  fuentes: { jornadas: 'suma', horometros: 'suma', viajes: 'suma', peso: 'suma' },
  agruparPor: 'empresa',
  sinMarcaModelo: true, // el papel del jefe nace limpio: marca/modelo se enciende
  sinPlaca: false,
  sinCantidades: false, // el jefe pidió el papel COMPLETO: el respaldo sale salvo que lo apague

  sinEmpresas: false,
  resumen: true,
  tarjetasFuente: true,
  cuadroEmpresas: true,
  top5: true,
  solapes: true,
  comparacion: true,
  promedioDia: true,
  seleccionAutomatica: true,
  desgloseAutomatico: true,
  costoTonelada: true,
  horaPromedio: true,
  // 📅📈 Lo pedido el 21-oct nace PRENDIDO (es el pedido mismo), con todas sus
  //      columnas a la vista; cada una tiene su pastilla para apagarla.
  tablaDiaria: true,
  graficoDiario: true,
  // 🏗️🚛⚖️ Lo pedido el 22-oct nace PRENDIDO (es el pedido mismo).
  columnasPorGrupo: true,
  costoTonAcarreoTotal: true,
  sinDiaSemana: false,
  sinMaquinasDia: false,
  sinToneladasDia: false,
  sinCostoTonDia: false,
  // ⚠️🔁 22-oct-2026: el aviso nace prendido (no cuesta nada, es seguridad); el
  //      relleno automático nace apagado (cambia la plata, es una elección).
  avisoHuecosHorometro: true,
  rellenoAutomaticoDia: false,
};

export const usd = (n: number) => `$${Number(n || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export function esc(t: unknown): string {
  return String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}
const dmy = (iso: string) => String(iso ?? '').slice(0, 10).split('-').reverse().join('/');
const r2 = (n: number) => Math.round(n * 100) / 100;
const cmpTx = (a: string, b: string) => a.localeCompare(b, 'es', { sensitivity: 'base', numeric: true });

export const fuentesQueSuman = (op: OpcionesConsolidado): FuenteKey[] => FUENTES_ORDEN.filter((f) => op.fuentes[f] === 'suma');
export const fuentesVisibles = (op: OpcionesConsolidado): FuenteKey[] => FUENTES_ORDEN.filter((f) => op.fuentes[f] !== 'oculta');

/**
 * 🏗️🚛 Una COLUMNA de plata del papel (22-oct-2026). Con `columnasPorGrupo`
 * son dos (Maquinaria y Acarreo); sin él, una por fuente visible, exactamente
 * como antes. Encabezado, celdas, subtotales, cuadro por empresa, tabla diaria
 * y tarjetas salen de ESTA lista: así nunca se descuadran.
 */
export type ColumnaPapel = {
  k: string;
  icon: string;
  /** Sin el «(ref)»: para tarjetas y rótulos. */
  titulo: string;
  /** El encabezado de la tabla (con «(ref)» si no suma). */
  th: string;
  /** true = la columna no suma (gris, como una fuente «sin sumar»). */
  ref: boolean;
  /** Las fuentes que entran a ESTE monto. */
  fuentes: readonly FuenteKey[];
  /** Las fuentes del grupo en «sin sumar» cuando el grupo SÍ suma (se dicen aparte). */
  fuentesRef: readonly FuenteKey[];
};

export function columnasPapel(op: OpcionesConsolidado): ColumnaPapel[] {
  if (!op.columnasPorGrupo) {
    return fuentesVisibles(op).map((k) => {
      const ref = op.fuentes[k] !== 'suma';
      const titulo = `${FUENTES_META[k].icon} ${FUENTES_META[k].label}`;
      return { k, icon: FUENTES_META[k].icon, titulo, th: `${titulo}${ref ? ' (ref)' : ''}`, ref, fuentes: [k], fuentesRef: [] };
    });
  }
  const cols: ColumnaPapel[] = [];
  for (const g of GRUPOS_ORDEN) {
    const meta = GRUPOS_META[g];
    const suman = meta.fuentes.filter((k) => op.fuentes[k] === 'suma');
    const muestran = meta.fuentes.filter((k) => op.fuentes[k] === 'muestra');
    if (!suman.length && !muestran.length) continue; // todo oculto: la columna no sale
    const ref = suman.length === 0;
    const titulo = `${meta.icon} ${meta.label}`;
    cols.push({
      k: g, icon: meta.icon, titulo, th: `${titulo}${ref ? ' (ref)' : ''}`, ref,
      fuentes: ref ? muestran : suman,
      fuentesRef: ref ? [] : muestran,
    });
  }
  return cols;
}

type MontosF = Partial<Record<FuenteKey, number>> | null | undefined;
/** El monto de la columna: la suma de SUS fuentes. */
export const montoColumna = (c: ColumnaPapel, m: MontosF): number =>
  r2(c.fuentes.reduce((s, k) => s + (m?.[k] ?? 0), 0));
/** El respaldo de la columna: identifica con ícono la fuente (horómetro vs jornada, viajes vs peso) cuando la columna agrupa. */
export function cantColumna(c: ColumnaPapel, q: MontosF): string {
  if (c.fuentes.length === 1) return cantTexto(c.fuentes[0], q?.[c.fuentes[0]] ?? 0);
  const partes: string[] = [];
  for (const k of c.fuentes) {
    const v = q?.[k] ?? 0;
    if (v > 0) partes.push(`${FUENTES_META[k].icon} ${cantTexto(k, v)}`);
  }
  return partes.join(' · ');
}
/** Lo «sin sumar» dentro de un grupo que suma: se dice, en gris, sin entrar al monto. */
export function notaRefColumna(c: ColumnaPapel, m: MontosF): string {
  const partes = c.fuentesRef.filter((k) => (m?.[k] ?? 0) !== 0).map((k) => `${FUENTES_META[k].icon} ${usd(m?.[k] ?? 0)}`);
  return partes.length ? `ref, no suma: ${partes.join(' + ')}` : '';
}
/**
 * La celda de una columna. `siempre` = fila de totales (sale el $0,00). Con una
 * columna por fuente produce EXACTAMENTE el HTML de antes del 22-oct.
 */
function celdaColumna(c: ColumnaPapel, m: MontosF, q: MontosF, conCant: boolean, siempre = false): string {
  const v = montoColumna(c, m);
  const tx = cantColumna(c, q);
  const nota = notaRefColumna(c, m);
  if (!siempre && v === 0 && !nota) return '—';
  const verMonto = siempre || v !== 0;
  let sub = conCant && tx ? tx : '';
  if (!sub && verMonto && v !== 0 && c.fuentes.length > 1) {
    const activas = c.fuentes.filter((k) => (m?.[k] ?? 0) !== 0);
    if (activas.length) {
      sub = activas.map((k) => `${FUENTES_META[k].icon} ${FUENTES_META[k].label.toLowerCase()}`).join(' · ');
    }
  }
  return `${verMonto ? usd(v) : '—'}${sub ? `<div class="q">${esc(sub)}</div>` : ''}${nota ? `<div class="q">${esc(nota)}</div>` : ''}`;
}

/**
 * ⚠️🔁 LOS HUECOS DEL HORÓMETRO, de UNA máquina (22-oct-2026, a pedido: «si
 * para días no hay horómetro pero sí jornada, ¿la toma en cuenta?»). Mira los
 * datos CRUDOS de cada día (antes de cualquier selección, que es lo único que
 * distingue «este día SÍ tuvo horómetro» de «este día no») y suma la jornada
 * de los días donde el horómetro de ESE día quedó en $0 — el hueco que una
 * máquina que factura por horómetro deja sin que nadie lo note.
 *
 * Un día sin horómetro Y sin jornada (la máquina de verdad no trabajó) no es
 * un hueco: no hay nada que avisar ni rellenar.
 */
function huecosDeMaquina(
  id: string,
  dias: readonly DiaCrudoConsolidado[] | null | undefined,
): { horas: number; monto: number; porDia: { jornada: string; horas: number; monto: number }[] } {
  const porDia: { jornada: string; horas: number; monto: number }[] = [];
  let horas = 0, monto = 0;
  for (const d of dias ?? []) {
    const f = (d?.filas ?? []).find((x) => x.id === id);
    if (!f) continue;
    if ((f.montos.horometros ?? 0) !== 0) continue; // ese día SÍ tiene horómetro: no es hueco
    const mJ = f.montos.jornadas ?? 0;
    const hJ = f.cant?.jornadas ?? 0;
    if (mJ === 0 && hJ === 0) continue; // tampoco hay jornada ese día: no hay nada que rellenar
    horas = r2(horas + hJ);
    monto = r2(monto + mJ);
    porDia.push({ jornada: String(d.jornada ?? '').slice(0, 10), horas: r2(hJ), monto: r2(mJ) });
  }
  return { horas, monto, porDia };
}

/**
 * ⚠️ La lista de huecos para el cuadro del resumen: una fila por máquina y día
 * donde faltó el horómetro pero la jornada sí tiene algo que decir. Solo mira
 * máquinas que FACTURAN por horómetro en el rango (si no, su jornada ya se
 * suma normal — no hay «hueco» que avisar).
 */
export type HuecoHorometro = { id: string; code: string; placa: string; jornada: string; horas: number; monto: number };
export function huecosHorometro(
  filas: readonly FilaConsolidada[],
  op: OpcionesConsolidado,
  dias: readonly DiaCrudoConsolidado[] | null | undefined,
): HuecoHorometro[] {
  if (!op.seleccionAutomatica || op.fuentes.horometros !== 'suma' || !dias?.length) return [];
  const out: HuecoHorometro[] = [];
  for (const f of filas ?? []) {
    if ((f.montos.horometros ?? 0) === 0) continue; // no factura por horómetro: nada que avisar
    for (const d of huecosDeMaquina(f.id, dias).porDia) {
      out.push({ id: f.id, code: f.code, placa: f.placa, jornada: d.jornada, horas: d.horas, monto: d.monto });
    }
  }
  return out.sort((a, b) => a.jornada.localeCompare(b.jornada) || cmpTx(a.code, b.code));
}

/**
 * 🤖 LA SELECCIÓN AUTOMÁTICA (21-oct-2026, decisión del jefe): jornada y
 * horómetro son UNO U OTRO por máquina — si la máquina trae horómetro SUMANDO,
 * manda el horómetro y su jornada se pone en 0 (monto y horas), dejando en
 * `jornadaDescartada` cuánto era para decirlo en el papel.
 *
 * ⭐ Solo descarta cuando el horómetro está EN «SUMA»: si el horómetro está de
 *    referencia u oculto, nadie está facturando por él y la jornada se queda —
 *    descartar la jornada ahí dejaría a la máquina facturando CERO sin que
 *    nadie lo pidiera.
 *
 * 🔁 CON `rellenoAutomaticoDia` (22-oct-2026): en vez de descartar TODA la
 *    jornada, se queda solo la de los días donde ESE día no tuvo horómetro —
 *    el resto (donde sí hay horómetro) sigue siendo horómetro. Nunca se suman
 *    los dos para el MISMO día; `jornadaDescartada` queda con lo que sí se
 *    solapaba de verdad (si el relleno cubre todo, no queda nada que descartar
 *    y el campo no se pone).
 */
function conSeleccionAutomatica(
  filas: readonly FilaConsolidada[],
  op: OpcionesConsolidado,
  dias?: readonly DiaCrudoConsolidado[] | null,
): readonly FilaConsolidada[] {
  if (!op.seleccionAutomatica) return filas;
  return filas.map((f) => {
    // ⚖️ EL PESO MANDA EN EL CAMIÓN (21-oct-2026, tarde, a pedido: «si tiene
    //    peso, se toma como prioridad el peso — eso es para la categoría de
    //    remoción de escombros, que serían los camiones; y hay varios de esa
    //    categoría que solo trabajarían por jornada»). Si el camión facturó por
    //    PESO (con plata y sumando), sus viajes, su jornada y su horómetro NO
    //    se suman: sería cobrar dos veces el mismo acarreo. El camión SIN peso
    //    sigue igual que siempre (por viajes, o su jornada de acarreo).
    //    Camión = la regla compartida del código (esCamionDeViajes).
    if (op.fuentes.peso === 'suma' && (f.montos.peso ?? 0) !== 0 && esCamionDeViajes(f.code)) {
      // 🕐 Este camión se eligió POR JORNADA (22-oct-2026): al revés — su peso
      //    y sus viajes no se suman, y su jornada sigue la regla de siempre
      //    (si trae horómetro con plata, manda el horómetro).
      if ((op.camionesPorJornada ?? []).includes(f.id)) {
        const montosJ = { ...f.montos };
        const cantJ = f.cant ? { ...f.cant } : f.cant;
        const descJ: Partial<Record<FuenteKey, number>> = {};
        for (const k of ['peso', 'viajes'] as FuenteKey[]) {
          if ((montosJ[k] ?? 0) !== 0) descJ[k] = r2(montosJ[k] as number);
          montosJ[k] = 0;
          if (cantJ) cantJ[k] = 0;
        }
        f = { ...f, montos: montosJ, cant: cantJ, descartadoPorJornada: descJ };
      } else {
        const sobran: FuenteKey[] = (['viajes', 'jornadas', 'horometros'] as FuenteKey[])
          .filter((k) => (f.montos[k] ?? 0) !== 0 || (f.cant?.[k] ?? 0) !== 0);
        if (!sobran.length) return f;
        const montos = { ...f.montos };
        const cant = f.cant ? { ...f.cant } : f.cant;
        const descartado: Partial<Record<FuenteKey, number>> = {};
        for (const k of sobran) {
          if ((montos[k] ?? 0) !== 0) descartado[k] = r2(montos[k] as number);
          montos[k] = 0;
          if (cant) cant[k] = 0;
        }
        return { ...f, montos, cant, descartadoPorPeso: descartado };
      }
    }
    if (op.fuentes.horometros !== 'suma') return f;
    const mJor = f.montos.jornadas ?? 0;
    // Solo cuando el horómetro trae PLATA: un horómetro con horas pero $0 (sin
    // precio) no puede dejar la máquina facturando cero en silencio.
    const tieneHoro = (f.montos.horometros ?? 0) !== 0;
    if (!tieneHoro || (mJor === 0 && (f.cant?.jornadas ?? 0) === 0)) return f;
    if (op.rellenoAutomaticoDia && dias?.length) {
      const hueco = huecosDeMaquina(f.id, dias);
      const descartado = r2(mJor - hueco.monto);
      return {
        ...f,
        montos: { ...f.montos, jornadas: hueco.monto },
        cant: f.cant ? { ...f.cant, jornadas: hueco.horas } : f.cant,
        ...(descartado > 0 ? { jornadaDescartada: descartado } : {}),
      };
    }
    return {
      ...f,
      montos: { ...f.montos, jornadas: 0 },
      cant: f.cant ? { ...f.cant, jornadas: 0 } : f.cant,
      jornadaDescartada: r2(mJor),
    };
  });
}

/**
 * 🚛⚖️ Los camiones que FACTURAN POR PESO en estas filas (22-oct-2026): los que
 * la pantalla ofrece para pasar a jornada, uno por uno o todos. Camión = la
 * regla compartida (esCamionDeViajes); con peso = monto de peso distinto de 0.
 */
export function camionesConPeso(filas: readonly FilaConsolidada[] | null | undefined): FilaConsolidada[] {
  return (filas ?? [])
    .filter((f) => (f.montos.peso ?? 0) !== 0 && esCamionDeViajes(f.code))
    .slice()
    .sort((a, b) => cmpTx(a.code, b.code) || cmpTx(a.placa, b.placa));
}

/** Aplica el selector de máquinas y bota las filas que quedaron sin NINGÚN monto visible. */
export function filasElegidas(filas: readonly FilaConsolidada[], op: OpcionesConsolidado, dias?: readonly DiaCrudoConsolidado[] | null): FilaConsolidada[] {
  filas = conSeleccionAutomatica(filas, op, dias);
  const marcadas = new Set(op.soloMaquinas ?? []);
  const empresas = new Set((op.soloEmpresas ?? []).map((e) => e.trim().toLowerCase()).filter(Boolean));
  const categorias = new Set((op.soloCategorias ?? []).map((e) => e.trim().toLowerCase()).filter(Boolean));
  const encargados = new Set((op.soloEncargados ?? []).map((e) => e.trim().toLowerCase()).filter(Boolean));
  const estados = new Set((op.soloEstados ?? []).map((e) => e.trim().toLowerCase()).filter(Boolean));
  // Los frentes vienen de DOS catálogos escritos a mano: el filtro no distingue
  // mayúsculas NI acentos («Túnel» marca también a «TUNEL»).
  const idxF = indiceFrentesConsolidado(filas, null, op);
  const frentes = new Set((op.soloFrentes ?? []).map((e) => idxF.clave(e)).filter(Boolean));
  const visibles = fuentesVisibles(op);
  return (filas ?? [])
    .filter((f) => marcadas.size === 0 || marcadas.has(f.id))
    .filter((f) => empresas.size === 0 || empresas.has(f.empresa.trim().toLowerCase()))
    .filter((f) => categorias.size === 0 || categorias.has(categoriaDe(f).toLowerCase()))
    .filter((f) => frentes.size === 0 || frentes.has(idxF.clave(frenteDe(f))))
    .filter((f) => encargados.size === 0 || encargados.has(encargadoDe(f).toLowerCase()))
    .filter((f) => estados.size === 0 || estados.has(String(f.estado ?? 'Operativa').trim().toLowerCase()))
    .filter((f) => visibles.some((k) => (f.montos[k] ?? 0) !== 0)
      // 🕐 El camión pasado a jornada SIN jornada en el rango queda en $0, pero
      //    NO desaparece: el papel dice que se eligió así y cuánto se descartó.
      || (f.descartadoPorJornada != null && Object.values(f.descartadoPorJornada).some((v) => (v ?? 0) !== 0)))
    .slice()
    // ⭐ ORDEN ALFABÉTICO por máquina (20-oct-2026, a pedido): el listado va A→Z
    //    por código esté agrupado como esté; los bloques ordenan aparte.
    .sort((a, b) => cmpTx(a.code, b.code) || cmpTx(a.placa, b.placa) || cmpTx(a.empresa, b.empresa));
}

/** El total de la FILA: solo las fuentes en 'suma'. */
export const totalFila = (f: FilaConsolidada, op: OpcionesConsolidado): number =>
  r2(fuentesQueSuman(op).reduce((s, k) => s + (f.montos[k] ?? 0), 0));

export type TotalesConsolidado = {
  porFuente: Record<FuenteKey, number>;
  /** El respaldo sumado por fuente (horas / viajes / kg), para las tarjetas y los pies. */
  cantPorFuente: Record<FuenteKey, number>;
  total: number;
  maquinas: number;
  empresas: number;
};

export function totalesConsolidado(filas: readonly FilaConsolidada[], op: OpcionesConsolidado, dias?: readonly DiaCrudoConsolidado[] | null): TotalesConsolidado {
  const elegidas = filasElegidas(filas, op, dias);
  const porFuente = { jornadas: 0, horometros: 0, viajes: 0, peso: 0 } as Record<FuenteKey, number>;
  const cantPorFuente = { jornadas: 0, horometros: 0, viajes: 0, peso: 0 } as Record<FuenteKey, number>;
  for (const f of elegidas) for (const k of FUENTES_ORDEN) {
    porFuente[k] = r2(porFuente[k] + (f.montos[k] ?? 0));
    cantPorFuente[k] = r2(cantPorFuente[k] + (f.cant?.[k] ?? 0));
  }
  const total = r2(fuentesQueSuman(op).reduce((s, k) => s + porFuente[k], 0));
  return { porFuente, cantPorFuente, total, maquinas: elegidas.length, empresas: new Set(elegidas.map((f) => f.empresa)).size };
}

/** ⚠️ Máquinas cobrando por DOS O MÁS fuentes que suman: posible pago doble. */
export type SolapeConsolidado = { fila: FilaConsolidada; fuentes: FuenteKey[]; monto: number };
export function solapesConsolidado(filas: readonly FilaConsolidada[], op: OpcionesConsolidado, dias?: readonly DiaCrudoConsolidado[] | null): SolapeConsolidado[] {
  const suman = fuentesQueSuman(op);
  return filasElegidas(filas, op, dias)
    .map((f) => ({
      fila: f,
      // La selección automática ya resolvió jornada+horómetro (descartada
      // entera, o rellenada día por día — nunca el MISMO día dos veces): no
      // es pago doble aunque las dos sigan con plata (22-oct-2026).
      fuentes: suman.filter((k) => (f.montos[k] ?? 0) > 0 && !(k === 'jornadas' && f.jornadaDescartada != null)),
      monto: totalFila(f, op),
    }))
    .filter((x) => x.fuentes.length >= 2)
    .sort((a, b) => b.monto - a.monto);
}

export type EmpresaConsolidada = { empresa: string; porFuente: Record<FuenteKey, number>; cantPorFuente: Record<FuenteKey, number>; total: number; maquinas: number };
export function porEmpresaConsolidado(filas: readonly FilaConsolidada[], op: OpcionesConsolidado, dias?: readonly DiaCrudoConsolidado[] | null): EmpresaConsolidada[] {
  const m = new Map<string, EmpresaConsolidada>();
  for (const f of filasElegidas(filas, op, dias)) {
    const e = m.get(f.empresa) ?? { empresa: f.empresa, porFuente: { jornadas: 0, horometros: 0, viajes: 0, peso: 0 }, cantPorFuente: { jornadas: 0, horometros: 0, viajes: 0, peso: 0 }, total: 0, maquinas: 0 };
    for (const k of FUENTES_ORDEN) {
      e.porFuente[k] = r2(e.porFuente[k] + (f.montos[k] ?? 0));
      e.cantPorFuente[k] = r2(e.cantPorFuente[k] + (f.cant?.[k] ?? 0));
    }
    e.total = r2(e.total + totalFila(f, op));
    e.maquinas += 1;
    m.set(f.empresa, e);
  }
  return Array.from(m.values()).sort((a, b) => b.total - a.total || cmpTx(a.empresa, b.empresa));
}

export function topMaquinas(filas: readonly FilaConsolidada[], op: OpcionesConsolidado, n = 5, dias?: readonly DiaCrudoConsolidado[] | null): { fila: FilaConsolidada; total: number; principal: FuenteKey | null }[] {
  return filasElegidas(filas, op, dias)
    .map((f) => {
      const suman = fuentesQueSuman(op);
      const principal = suman.length ? suman.slice().sort((a, b) => (f.montos[b] ?? 0) - (f.montos[a] ?? 0))[0] : null;
      return { fila: f, total: totalFila(f, op), principal: principal && (f.montos[principal] ?? 0) > 0 ? principal : null };
    })
    .filter((x) => x.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, n);
}

// ── ⚖️ COSTO DE MAQUINARIA POR TONELADA (21-oct-2026, a pedido del jefe) ──────
//
// Pedido, con su ejemplo textual: «yo agarro 25 máquinas que tuve en los cinco
// frentes… $25.000 entre 2.000 toneladas que movió el acarreo, me salió a $12,5
// la tonelada puesta en el CET». Y la otra punta: «divido las horas totales
// facturadas… la hora me salió a 89, no a 100».
//
// LA REGLA, PIEZA POR PIEZA:
//  · El COSTO es lo que factura la MAQUINARIA. Jornada y horómetro son UNA u
//    OTRA por máquina, nunca la suma (aclaración del 21-oct, textual: «no es
//    que puedo sumar la jornada y el horómetro, es uno u otro»; «el sistema
//    tomaría el horómetro, que es el confiable, y si no tiene horómetro tomaría
//    la jornada»). Regla por máquina: CON horómetro manda el horómetro; SIN
//    horómetro vale la jornada. Una fuente OCULTA no existe (regla de la casa).
//  · LOS CAMIONES NO SON MAQUINARIA: viajes y peso son el acarreo, y el camión
//    que cobra POR JORNADA (no lo llevan ni por viaje ni por peso) es «jornada
//    de acarreo»: su monto NO entra al costo de maquinaria — se dice aparte.
//    Camión = la regla compartida del código (esCamionDeViajes, la misma de
//    las 4 pantallas de viajes).
//  · Las TONELADAS son las del peso de romana congelado de CADA viaje del
//    rango — la MISMA regla del informe operativo: entran TODOS los viajes,
//    el que no se pesó cuenta como viaje, suma 0 t, y el papel dice cuántos.
//  · POR FRENTE (los «frentes vinculantes» del jefe): el costo se agrupa por el
//    frente vigente de cada máquina y las toneladas por el frente congelado de
//    cada viaje — los dos lados ya quedaron sincronizados el 20-oct. El cruce
//    de nombres no distingue mayúsculas.
//  · Si el papel está FILTRADO por frentes, las toneladas se cortan por esos
//    mismos frentes. Los demás filtros (empresa, categoría, máquinas) cortan el
//    costo pero NO las toneladas (un viaje no es de una empresa de maquinaria):
//    la tarjeta lo advierte para que el número no se lea como lo que no es.
/** Las fuentes que son MAQUINARIA (el costo); viajes y peso son el acarreo. */
export const FUENTES_MAQUINARIA: readonly FuenteKey[] = ['jornadas', 'horometros'];

/** Lo que hace falta de cada viaje del rango: su frente congelado y su peso. */
export type ViajeToneladas = { frente_nombre?: string | null; peso_neto_kg?: number | string | null };

export type FrenteTonelada = { frente: string; costo: number; horas: number; toneladas: number; usdPorTon: number | null };
export type CostoTonelada = {
  costo: number;            // $ maquinaria (por máquina: horómetro si lo hay, si no jornada)
  horas: number;            // horas que respaldan ese costo (misma regla uno-u-otro)
  /** $ de los CAMIONES que cobran por jornada (jornada de ACARREO): no entra
   *  al costo de maquinaria, pero se dice — es plata del acarreo. */
  acarreoJornada: number;
  camionesJornada: number;  // cuántos camiones cobraron así
  toneladas: number;        // t del acarreo (peso romana / 1000)
  viajes: number;           // viajes que entraron al conteo
  sinPeso: number;          // de esos, cuántos sin pesar (suman 0 t)
  usdPorTon: number | null; // costo/toneladas — null si no hay toneladas
  usdPorHora: number | null;// costo/horas — null si no hay horas
  porFrente: FrenteTonelada[];
};

export const tons = (n: number) => `${Number(n || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} t`;

export function costoPorTonelada(
  filas: readonly FilaConsolidada[],
  op: OpcionesConsolidado,
  viajes: readonly ViajeToneladas[] | null | undefined,
  dias?: readonly DiaCrudoConsolidado[] | null,
): CostoTonelada {
  const idxF = indiceFrentesConsolidado(filas, viajes, op);
  const soloFrentes = new Set((op.soloFrentes ?? []).map((e) => idxF.clave(e)).filter(Boolean));
  // El cruce por frente es por NOMBRE sin distinguir mayúsculas NI acentos: el de
  // la máquina viene del catálogo de frentes y el del viaje quedó congelado como
  // texto — si se llaman igual, es el MISMO frente.
  const pf = new Map<string, FrenteTonelada>();
  const fr = (nombre: string): FrenteTonelada => {
    const k = idxF.clave(nombre);
    let x = pf.get(k);
    // El renglón se imprime con el nombre MÁS COMPLETO del grupo (el del
    // catálogo, no la abreviatura que quedó congelada en un viaje).
    if (!x) { x = { frente: idxF.nombre(nombre), costo: 0, horas: 0, toneladas: 0, usdPorTon: null }; pf.set(k, x); }
    return x;
  };
  const hayHoro = op.fuentes.horometros !== 'oculta';
  const hayJor = op.fuentes.jornadas !== 'oculta';
  let costo = 0;
  let horas = 0;
  let acarreoJornada = 0;
  let camionesJornada = 0;
  for (const f of filasElegidas(filas, op, dias)) {
    const mHoro = hayHoro ? (f.montos.horometros ?? 0) : 0;
    const mJor = hayJor ? (f.montos.jornadas ?? 0) : 0;
    // 🚛 Un CAMIÓN que cobra por jornada (u horómetro) es ACARREO, no maquinaria:
    //    su plata se cuenta aparte y no infla el costo por tonelada.
    if (esCamionDeViajes(f.code)) {
      if (mHoro !== 0 || mJor !== 0) {
        acarreoJornada = r2(acarreoJornada + mHoro + mJor);
        camionesJornada += 1;
      }
      continue;
    }
    // ⭐ UNO U OTRO, nunca la suma: con horómetro manda el horómetro (el exacto,
    //    el confiable — «jornada dice 12, horómetro dice 11,5: se toma 11,5»);
    //    sin horómetro, vale la jornada.
    const usaHoro = mHoro !== 0 || (hayHoro && (f.cant?.horometros ?? 0) > 0);
    const c = usaHoro ? mHoro : mJor;
    const h = usaHoro ? (hayHoro ? (f.cant?.horometros ?? 0) : 0) : (hayJor ? (f.cant?.jornadas ?? 0) : 0);
    if (c === 0 && h === 0) continue;
    costo = r2(costo + c);
    horas = r2(horas + h);
    const x = fr(frenteDe(f));
    x.costo = r2(x.costo + c);
    x.horas = r2(x.horas + h);
  }
  let toneladas = 0;
  let nViajes = 0;
  let sinPeso = 0;
  for (const v of viajes ?? []) {
    const fnom = String(v.frente_nombre ?? '').trim() || SIN_FRENTE;
    if (soloFrentes.size > 0 && !soloFrentes.has(idxF.clave(fnom))) continue;
    nViajes += 1;
    const kg = Number(v.peso_neto_kg);
    if (Number.isFinite(kg) && kg > 0) {
      toneladas += kg / 1000;
      const x = fr(fnom);
      x.toneladas += kg / 1000;
    } else {
      sinPeso += 1; // el viaje cuenta, su carga no se inventa (regla del informe operativo)
    }
  }
  toneladas = r2(toneladas);
  const porFrente = Array.from(pf.values())
    .map((x) => ({ ...x, toneladas: r2(x.toneladas), usdPorTon: x.toneladas > 0 ? r2(x.costo / x.toneladas) : null }))
    .sort((a, b) => cmpTx(a.frente, b.frente));
  return {
    costo, horas, acarreoJornada, camionesJornada, toneladas, viajes: nViajes, sinPeso,
    usdPorTon: toneladas > 0 ? r2(costo / toneladas) : null,
    usdPorHora: horas > 0 ? r2(costo / horas) : null,
    porFrente,
  };
}

// ── 📅 LA OPERACIÓN DÍA POR DÍA (21-oct-2026, a pedido) ──────────────────────
//
// Pedido textual: «para ese reporte consolidado, que tenga una tabla operativa
// diaria con un desglose o del estilo del viajes de camiones, y la gráfica
// también». El molde es el del 📊 Informe operativo de Viajes de camiones
// (informeOperativo.ts): tabla con su fila TOTAL/PROM. y gráfico SVG a mano
// (barras + línea), porque los PDF de la casa son HTML impreso y ahí no hay
// librerías de gráficos.
//
// ⭐ ESTE ARCHIVO SIGUE SIN CALCULAR PLATA: el día por día llega ya armado
//    desde la pantalla, que corre LOS MISMOS CUATRO MOTORES con el rango de un
//    solo día. Acá se junta, se suma y se pinta — igual que el resto del papel.
//    Por eso cada día pasa por `filasElegidas` (filtros + 🤖 selección
//    automática) y por `costoPorTonelada`: el día por día obedece las mismas
//    reglas que el total, no una copia aparte.
//
// ⚠️ EL CUADRE SE DICE, NO SE MAQUILLA: sumar los días puede dar unos centavos
//    distinto del TOTAL GENERAL (el rango acumula sin redondear y redondea una
//    vez; el día por día redondea cada día), y el horómetro de una máquina que
//    solo tuvo lecturas dos veces en la semana no se puede repartir por día sin
//    inventar. Cuando la suma no cuadra, el papel lo DICE con la diferencia
//    exacta y el TOTAL GENERAL del reporte sigue siendo el de arriba.

/** Lo que la pantalla entrega por cada día: las filas de ESE día y sus viajes. */
export type DiaCrudoConsolidado = {
  /** La jornada (7am–7am) en ISO: el «día» de toda la app. */
  jornada: string;
  filas: readonly FilaConsolidada[];
  viajes?: readonly ViajeToneladas[] | null;
};

export type DiaConsolidado = {
  jornada: string;
  diaSemana: string;
  /** Fichas que facturaron ese día (de las elegidas). */
  maquinas: number;
  montos: Record<FuenteKey, number>;
  cant: Record<FuenteKey, number>;
  /** Solo las fuentes en 'suma' (el mismo total del papel, pero del día). */
  total: number;
  /** $ y horas de MAQUINARIA del día con la regla uno-u-otro (para el $/t). */
  costoMaq: number;
  horasMaq: number;
  toneladas: number;
  viajes: number;
  sinPeso: number;
  usdPorTon: number | null;
};

const DIAS_SEMANA = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
/** «Lunes», «Martes»… de una jornada ISO (mediodía UTC: el huso no corre el día). */
export function diaSemanaConsolidado(jornadaIso: string): string {
  const t = Date.parse(`${String(jornadaIso ?? '').slice(0, 10)}T12:00:00Z`);
  if (!Number.isFinite(t)) return '';
  return DIAS_SEMANA[new Date(t).getUTCDay()];
}

/**
 * Los días CON actividad, en orden. Un domingo sin nada no sale (igual que el
 * informe operativo: un papel de un mes no arrastra filas de ceros).
 *
 * ⭐ `filasRango` son las filas del RANGO COMPLETO, y no es un adorno: con
 *    ellas se CONGELA la decisión de la 🤖 selección automática. La regla es
 *    por máquina y por rango («esta máquina factura por horómetro»), así que
 *    aplicarla otra vez día por día daría otra respuesta — una máquina con
 *    horómetro solo el martes volvería a cobrar jornada el lunes y el día por
 *    día no sumaría el TOTAL del papel. Se decide una vez arriba y los días
 *    obedecen esa misma decisión.
 */
export function diasConsolidados(
  dias: readonly DiaCrudoConsolidado[] | null | undefined,
  op: OpcionesConsolidado,
  filasRango?: readonly FilaConsolidada[] | null,
): DiaConsolidado[] {
  // Qué fuentes quedaron EN CERO por máquina (decidido con el rango completo):
  // la jornada donde mandó el horómetro, y viajes/jornada/horómetro del camión
  // donde mandó el peso. Los días obedecen esa misma decisión.
  const aCero = new Map<string, FuenteKey[]>();
  if (op.seleccionAutomatica) {
    for (const f of filasElegidas(filasRango ?? [], op, dias)) {
      const ks: FuenteKey[] = [];
      if ((f.jornadaDescartada ?? 0) !== 0) ks.push('jornadas');
      if (f.descartadoPorPeso && Object.values(f.descartadoPorPeso).some((v) => (v ?? 0) !== 0)) {
        for (const k of ['viajes', 'jornadas', 'horometros'] as FuenteKey[]) if (!ks.includes(k)) ks.push(k);
      }
      // 🕐 El camión elegido POR JORNADA: su peso y sus viajes en cero todos los días.
      if (f.descartadoPorJornada && Object.values(f.descartadoPorJornada).some((v) => (v ?? 0) !== 0)) {
        for (const k of ['peso', 'viajes'] as FuenteKey[]) if (!ks.includes(k)) ks.push(k);
      }
      if (ks.length) aCero.set(f.id, ks);
    }
  }
  // Los días NO vuelven a decidir: ya se decidió arriba.
  const opDia: OpcionesConsolidado = { ...op, seleccionAutomatica: false };
  const comoElPapel = (filas: readonly FilaConsolidada[]): readonly FilaConsolidada[] =>
    aCero.size === 0 ? filas : filas.map((f) => {
      const ks = aCero.get(f.id);
      if (!ks) return f;
      // 🔁 RELLENO POR DÍA (22-oct-2026): si lo único que hay que poner en cero
      // es la jornada (el caso horómetro-vs-jornada, no el de peso-camión) y el
      // relleno automático está prendido, la jornada de ESTE día SOLO se
      // descarta si ESTE día SÍ tuvo horómetro — un día sin horómetro es un
      // hueco y la jornada de ese día se queda tal cual llegó.
      if (op.rellenoAutomaticoDia && ks.length === 1 && ks[0] === 'jornadas' && (f.montos.horometros ?? 0) === 0) return f;
      const montos = { ...f.montos };
      const cant = f.cant ? { ...f.cant } : f.cant;
      for (const k of ks) { montos[k] = 0; if (cant) cant[k] = 0; }
      return { ...f, montos, cant };
    });
  return (dias ?? [])
    .map((d) => {
      const jornada = String(d?.jornada ?? '').slice(0, 10);
      const filas = comoElPapel(d?.filas ?? []);
      const t = totalesConsolidado(filas, opDia);
      const ct = costoPorTonelada(filas, opDia, d?.viajes ?? []);
      return {
        jornada,
        diaSemana: diaSemanaConsolidado(jornada),
        maquinas: t.maquinas,
        montos: t.porFuente,
        cant: t.cantPorFuente,
        total: t.total,
        costoMaq: ct.costo,
        horasMaq: ct.horas,
        toneladas: ct.toneladas,
        viajes: ct.viajes,
        sinPeso: ct.sinPeso,
        usdPorTon: ct.usdPorTon,
      };
    })
    .filter((d) => d.jornada && (d.maquinas > 0 || d.viajes > 0))
    .sort((a, b) => a.jornada.localeCompare(b.jornada));
}

/** Hasta cuántos días cabe el gráfico sin volverse una pulpa ilegible (mismo tope del informe operativo). */
export const MAX_DIAS_GRAFICO_CONSOLIDADO = 62;

/**
 * El gráfico del día por día: barras con lo facturado y una línea encima con
 * lo que movió el acarreo (toneladas) — y si en el rango no hubo ni una
 * tonelada, la línea cuenta las máquinas que facturaron. SVG a mano.
 */
export function graficoDiarioConsolidadoSvg(dias: readonly DiaConsolidado[], op: OpcionesConsolidado): string {
  if (!dias.length || dias.length > MAX_DIAS_GRAFICO_CONSOLIDADO) return '';
  // La línea cuenta toneladas cuando hay; si el papel las apagó o no hubo
  // acarreo, cuenta máquinas (nunca se dibuja una línea en cero inventada).
  const conTon = !op.sinToneladasDia && dias.some((d) => d.toneladas > 0);
  const valLinea = (d: DiaConsolidado) => (conTon ? d.toneladas : d.maquinas);
  const rotulo = (d: DiaConsolidado) => (conTon ? `${Math.round(d.toneladas)}t` : `${d.maquinas}`);
  const W = 900, H = 260;
  const m = { izq: 62, der: 16, arr: 26, aba: 34 };
  const aw = W - m.izq - m.der;
  const ah = H - m.arr - m.aba;
  const maxM = Math.max(1, ...dias.map((d) => d.total));
  const maxL = Math.max(1, ...dias.map(valLinea));
  const paso = aw / dias.length;
  const barW = Math.min(26, Math.max(3, paso * 0.5));
  const xDe = (i: number) => m.izq + paso * i + paso / 2;
  const yM = (v: number) => m.arr + ah - (v / maxM) * ah;
  const yL = (v: number) => m.arr + ah - (v / maxL) * ah * 0.9; // la línea no pisa el techo

  const miles = (n: number) => `$${Math.round(n).toLocaleString('es-VE')}`;
  const grid = [0, 0.5, 1].map((p) => {
    const y = m.arr + ah - ah * p;
    return `<line x1="${m.izq}" y1="${y}" x2="${W - m.der}" y2="${y}" stroke="#d8dee9" stroke-width="1"/>`
      + `<text x="${m.izq - 6}" y="${y + 4}" text-anchor="end" font-size="10" fill="#5b6472">${miles(maxM * p)}</text>`;
  }).join('');

  const barras = dias.map((d, i) =>
    `<rect x="${(xDe(i) - barW / 2).toFixed(1)}" y="${yM(d.total).toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(0, m.arr + ah - yM(d.total)).toFixed(1)}" rx="2" fill="#2E86C1"/>`,
  ).join('');

  const puntosLinea = dias.map((d, i) => `${xDe(i).toFixed(1)},${yL(valLinea(d)).toFixed(1)}`).join(' ');
  // Con muchos días, rotular cada punto se vuelve una nube: se rotula salteado
  // para que nunca haya más de ~15 rótulos (y siempre el último).
  const cada = Math.max(1, Math.ceil(dias.length / 15));
  const puntos = dias.map((d, i) =>
    `<circle cx="${xDe(i).toFixed(1)}" cy="${yL(valLinea(d)).toFixed(1)}" r="2.6" fill="#17202A"/>`
    + (i % cada === 0 || i === dias.length - 1
      ? `<text x="${xDe(i).toFixed(1)}" y="${(yL(valLinea(d)) - 7).toFixed(1)}" text-anchor="middle" font-size="9" font-weight="700" fill="#17202A">${rotulo(d)}</text>`
      : ''),
  ).join('');

  const fechas = dias.map((d, i) => {
    if (i % cada !== 0 && i !== dias.length - 1) return '';
    const [, mm, dd] = d.jornada.split('-');
    return `<text x="${xDe(i).toFixed(1)}" y="${H - 14}" text-anchor="middle" font-size="9" fill="#5b6472">${dd}/${mm}</text>`;
  }).join('');

  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;background:#fff">`
    + grid + barras
    + `<polyline points="${puntosLinea}" fill="none" stroke="#17202A" stroke-width="2"/>`
    + puntos + fechas
    + `<text x="${m.izq}" y="${H - 2}" font-size="9" fill="#5b6472">■ Barra: lo facturado del día · ● Línea: ${conTon ? 'toneladas del acarreo' : 'máquinas que facturaron'}</text>`
    + '</svg>';
}

/** Días del rango, ambos inclusive (para el promedio por día). */
export function diasDelPeriodo(desde: string, hasta: string): number {
  const a = Date.parse(`${desde}T00:00:00Z`), b = Date.parse(`${hasta}T00:00:00Z`);
  if (!isFinite(a) || !isFinite(b) || b < a) return 0;
  return Math.round((b - a) / 86400000) + 1;
}

const pct = (parte: number, todo: number) => (todo > 0 ? `${Math.round((parte / todo) * 100)}%` : '—');
const varPct = (ahora: number, antes: number) =>
  antes > 0 ? `${ahora >= antes ? '+' : ''}${Math.round(((ahora - antes) / antes) * 100)}%` : ahora > 0 ? 'nuevo' : '—';

/**
 * El resumen ejecutivo, con la MISMA forma del de frentes ({tarjetas, cuadros})
 * para reusar `aplicarEdicionResumen` tal cual (ocultar, renombrar, corregir a
 * mano y tarjetas propias). `filasAnterior` es el período inmediatamente
 * anterior del mismo largo, para la comparación.
 */
export function resumenConsolidado(d: {
  filas: readonly FilaConsolidada[];
  filasAnterior?: readonly FilaConsolidada[] | null;
  desde: string;
  hasta: string;
  /** Los viajes del rango (frente + peso), para el ⚖️ costo por tonelada. */
  viajesTon?: readonly ViajeToneladas[] | null;
  /** 📅 El día por día (si llega): para el 🔁 relleno automático y el cuadro
   *  ⚠️ de huecos de horómetro. Sin esto, los dos se portan como si no
   *  hubiera huecos que avisar (no hay cómo distinguir el día). */
  dias?: readonly DiaCrudoConsolidado[] | null;
}, op: OpcionesConsolidado): ResumenFrentes {
  const t = totalesConsolidado(d.filas, op, d.dias);
  const tarjetas: ResumenFrentes['tarjetas'] = [];
  const cuadros: ResumenFrentes['cuadros'] = [];

  tarjetas.push({ k: 'total', titulo: '💰 TOTAL GENERAL', valor: usd(t.total), nota: `Del ${dmy(d.desde)} al ${dmy(d.hasta)}` });
  if (op.tarjetasFuente) {
    if (op.columnasPorGrupo) {
      // 🏗️🚛 Una tarjeta por COLUMNA del papel (Maquinaria y Acarreo), no por fuente.
      for (const c of columnasPapel(op)) {
        const v = montoColumna(c, t.porFuente);
        const respaldo = op.sinCantidades ? '' : cantColumna(c, t.cantPorFuente);
        const ref = notaRefColumna(c, t.porFuente);
        tarjetas.push({
          k: `grupo_${c.k}`,
          titulo: c.titulo,
          valor: usd(v),
          nota: `${c.ref ? 'referencia · no suma' : `${pct(v, t.total)} del total`}${respaldo ? ` · ${respaldo}` : ''}${ref ? ` · ${ref}` : ''}`,
        });
      }
    } else {
      for (const k of fuentesVisibles(op)) {
        const suma = op.fuentes[k] === 'suma';
        const respaldo = op.sinCantidades ? '' : cantTexto(k, t.cantPorFuente[k]);
        tarjetas.push({
          k: `fuente_${k}`,
          titulo: `${FUENTES_META[k].icon} ${FUENTES_META[k].label}`,
          valor: usd(t.porFuente[k]),
          nota: `${suma ? `${pct(t.porFuente[k], t.total)} del total` : 'referencia · no suma'}${respaldo ? ` · ${respaldo}` : ''}`,
        });
      }
    }
  }
  tarjetas.push({ k: 'maquinas', titulo: '🚜 Máquinas', valor: String(t.maquinas), nota: op.sinEmpresas ? undefined : `${t.empresas} empresa(s)` });
  if (op.promedioDia) {
    const dias = diasDelPeriodo(d.desde, d.hasta);
    tarjetas.push({ k: 'promedio_dia', titulo: '📅 Promedio por día', valor: dias > 0 ? usd(t.total / dias) : '—', nota: dias > 0 ? `${dias} día(s)` : undefined });
  }
  // ⚖️🕐 Lo que el jefe calcula a mano todos los días (21-oct-2026, a pedido):
  // cuánto le cuesta la MAQUINARIA por cada tonelada que mueve el acarreo, y a
  // cuánto le está saliendo la hora facturada en promedio. Redactado completo en
  // la nota, como el informe operativo: la cifra sin su cuento no le sirve.
  if (op.costoTonelada || op.horaPromedio || op.costoTonAcarreoTotal) {
    const ct = costoPorTonelada(d.filas, op, d.viajesTon ?? [], d.dias);
    // Filtros que cortan el COSTO pero no las toneladas: hay que decirlo.
    const filtroSoloCosto = (op.soloMaquinas ?? []).length > 0 || (op.soloEmpresas ?? []).length > 0 || (op.soloCategorias ?? []).length > 0;
    if (op.costoTonelada) {
      tarjetas.push({
        k: 'costo_ton',
        titulo: '⚖️ Costo maquinaria por tonelada',
        valor: ct.usdPorTon != null ? `${usd(ct.usdPorTon)} /t` : '—',
        nota: `${usd(ct.costo)} de maquinaria (por máquina: horómetro si lo hay, si no jornada — nunca la suma) ÷ ${tons(ct.toneladas)} movidas por el acarreo en ${ct.viajes} viaje(s)${ct.sinPeso > 0 ? ` (${ct.sinPeso} sin pesar, suman 0 t)` : ''}${ct.camionesJornada > 0 ? ` · ${ct.camionesJornada} camión(es) a jornada (${usd(ct.acarreoJornada)}) van del lado del ACARREO, no de la maquinaria` : ''}${ct.usdPorTon == null ? ' · sin toneladas en el rango: no hay división' : ''}${filtroSoloCosto ? ' · ⚠️ papel filtrado: el costo es solo de lo elegido; las toneladas son de todos los viajes del rango (solo el filtro de frentes las corta)' : ''}`,
      });
      // El cuadro por frente lleva SOLO los frentes donde la división existe
      // (hay toneladas); los cojos se dicen aparte para no imprimir un «$0,00»
      // al lado de un «no divide» que lo contradiga.
      const divisibles = ct.porFrente.filter((x) => x.usdPorTon != null);
      // La cola «fuera del cuadro: …» es parte del DESGLOSE: apagado, no sale.
      const cojos = op.desgloseAutomatico
        ? ct.porFrente.filter((x) => x.usdPorTon == null && x.costo > 0).map((x) => `${x.frente} (${usd(x.costo)} sin toneladas)`)
        : [];
      if (divisibles.length >= 1 && ct.porFrente.length >= 2) {
        cuadros.push({
          k: 'ton_frente',
          titulo: `⚖️ Costo por tonelada, frente por frente${cojos.length ? ` · fuera del cuadro: ${cojos.join(' · ')}` : ''}`,
          filas: divisibles.map((x) => ({
            clave: `${x.frente} — ${usd(x.costo)} de maquinaria ÷ ${tons(x.toneladas)}`,
            n: x.usdPorTon as number,
          })),
        });
      }
    }
    // ⚖️ COSTO POR TONELADA SOBRE TODO EL ACARREO (22-oct-2026, a pedido: «un
    //    cuadro abajo de ese que, en vez de darme el desglose con el cálculo por
    //    lo que acarreó cada frente, en base a la sumatoria de lo acarreado en
    //    todo el rango haga las cuentas: la maquinaria entre el acarreo total»).
    //    Cada frente pone SU maquinaria y la divide entre las toneladas de TODO
    //    el rango; los renglones suman el costo por tonelada global (la fila
    //    TOTAL, que es la misma cifra de la tarjeta ⚖️). Aquí sí entra el frente
    //    con maquinaria y sin toneladas propias: el divisor es el de todos.
    if (op.costoTonAcarreoTotal && ct.toneladas > 0) {
      const conCosto = ct.porFrente.filter((x) => x.costo !== 0);
      if (conCosto.length >= 1) {
        cuadros.push({
          k: 'ton_acarreo_total',
          titulo: `⚖️ Costo por tonelada sobre todo el acarreo del rango (${tons(ct.toneladas)})`,
          filas: [
            ...conCosto.map((x) => ({
              clave: `${x.frente} — ${usd(x.costo)} de maquinaria ÷ ${tons(ct.toneladas)}`,
              n: r2(x.costo / ct.toneladas),
            })),
            {
              clave: `TOTAL — ${usd(ct.costo)} de maquinaria ÷ ${tons(ct.toneladas)}`,
              n: ct.usdPorTon as number,
            },
          ],
        });
      }
    }
    if (op.horaPromedio) {
      tarjetas.push({
        k: 'hora_prom',
        titulo: '🕐 Hora promedio de maquinaria',
        valor: ct.usdPorHora != null ? `${usd(ct.usdPorHora)} /h` : '—',
        nota: `${ct.horas.toLocaleString('es-VE', { maximumFractionDigits: 1 })} h facturadas de maquinaria (por máquina: horómetro si lo hay, si no jornada) por ${usd(ct.costo)}${ct.usdPorHora == null ? ' · sin horas en el rango' : ''}`,
      });
    }
  }
  if (op.comparacion && d.filasAnterior) {
    // 🔁 Sin día por día del período ANTERIOR (la pantalla solo carga el del
    // rango actual): la comparación sigue con la regla de siempre (toda la
    // jornada, no por día) — no hay cómo distinguir sus huecos.
    const ant = totalesConsolidado(d.filasAnterior, op);
    const detalle = op.columnasPorGrupo
      ? columnasPapel(op).filter((c) => !c.ref).map((c) => `${c.icon} ${varPct(montoColumna(c, t.porFuente), montoColumna(c, ant.porFuente))}`).join(' · ')
      : fuentesQueSuman(op).map((k) => `${FUENTES_META[k].icon} ${varPct(t.porFuente[k], ant.porFuente[k])}`).join(' · ');
    tarjetas.push({ k: 'comparacion', titulo: '📊 vs período anterior', valor: varPct(t.total, ant.total), nota: `antes ${usd(ant.total)}${detalle ? ` · ${detalle}` : ''}` });
  }

  if (op.cuadroEmpresas && !op.sinEmpresas) {
    cuadros.push({
      k: 'por_empresa',
      titulo: '🏢 Cuánto se le paga a cada empresa',
      filas: porEmpresaConsolidado(d.filas, op, d.dias).map((e) => ({ clave: `${e.empresa} (${e.maquinas})`, n: e.total })),
    });
  }
  // 🏗️🚛 Con columnas agrupadas, el top 5 dice el GRUPO (no la fuente suelta).
  const etiquetaPrincipal = (k: FuenteKey): string => {
    const g = op.columnasPorGrupo ? GRUPOS_ORDEN.find((x) => GRUPOS_META[x].fuentes.includes(k)) : undefined;
    return g ? `${GRUPOS_META[g].icon} ${GRUPOS_META[g].label.toLowerCase()}` : `${FUENTES_META[k].icon} ${FUENTES_META[k].label.toLowerCase()}`;
  };
  if (op.top5) {
    cuadros.push({
      k: 'top5',
      titulo: '🏆 Las 5 máquinas más costosas',
      filas: topMaquinas(d.filas, op, 5, d.dias).map((x) => ({
        clave: `${x.fila.code}${x.fila.placa ? ` · ${x.fila.placa}` : ''}${x.principal ? ` (${etiquetaPrincipal(x.principal)})` : ''} — ${pct(x.total, t.total)} del total`,
        n: x.total,
      })),
    });
  }
  // 🤖 Lo que la selección automática DESCARTÓ (la jornada de las máquinas donde
  // mandó el horómetro): el papel factura distinto de los controles de origen,
  // así que tiene que decir exactamente dónde y cuánto — no inventa ni esconde.
  if (op.seleccionAutomatica && op.desgloseAutomatico) {
    // ⚖️ Los camiones donde mandó el peso: qué se facturó y qué quedó fuera.
    const porPeso = filasElegidas(d.filas, op, d.dias).filter((f) => f.descartadoPorPeso && Object.values(f.descartadoPorPeso).some((v) => (v ?? 0) !== 0));
    if (porPeso.length > 0) {
      cuadros.push({
        k: 'auto_peso',
        titulo: `⚖️ Mandó el peso (${porPeso.length}): el camión facturó por romana y el resto no se sumó`,
        filas: porPeso.map((f) => {
          const partes = FUENTES_ORDEN.filter((k) => (f.descartadoPorPeso?.[k] ?? 0) !== 0)
            .map((k) => `${FUENTES_META[k].icon} ${usd(f.descartadoPorPeso?.[k] ?? 0)}`);
          const total = r2(FUENTES_ORDEN.reduce((a, k) => a + (f.descartadoPorPeso?.[k] ?? 0), 0));
          return {
            clave: `${f.code}${f.placa ? ` · ${f.placa}` : ''} — se facturó ⚖️ ${usd(f.montos.peso ?? 0)}; descartado: ${partes.join(' + ')}`,
            n: total,
          };
        }),
      });
    }
    // 🕐 Los camiones con peso que se eligieron POR JORNADA (22-oct-2026).
    const porJornada = filasElegidas(d.filas, op, d.dias).filter((f) => f.descartadoPorJornada && Object.values(f.descartadoPorJornada).some((v) => (v ?? 0) !== 0));
    if (porJornada.length > 0) {
      cuadros.push({
        k: 'auto_jornada_camion',
        titulo: `🕐 Por jornada (${porJornada.length}): el camión se facturó por su jornada y su peso no se sumó`,
        filas: porJornada.map((f) => {
          const partes = FUENTES_ORDEN.filter((k) => (f.descartadoPorJornada?.[k] ?? 0) !== 0)
            .map((k) => `${FUENTES_META[k].icon} ${usd(f.descartadoPorJornada?.[k] ?? 0)}`);
          const total = r2(FUENTES_ORDEN.reduce((a, k) => a + (f.descartadoPorJornada?.[k] ?? 0), 0));
          const fact = totalFila(f, op);
          return {
            clave: `${f.code}${f.placa ? ` · ${f.placa}` : ''} — ${fact !== 0 ? `se facturó ${usd(fact)} por jornada` : 'sin jornada en el rango: queda en $0,00'}; descartado: ${partes.join(' + ')}`,
            n: total,
          };
        }),
      });
    }
    const descartadas = filasElegidas(d.filas, op, d.dias).filter((f) => (f.jornadaDescartada ?? 0) !== 0);
    if (descartadas.length > 0) {
      cuadros.push({
        k: 'auto_horometro',
        titulo: `🤖 Mandó el horómetro (${descartadas.length}): la jornada no se sumó`,
        filas: descartadas.map((f) => ({
          clave: `${f.code}${f.placa ? ` · ${f.placa}` : ''} — se facturó ⚙️ ${usd(f.montos.horometros ?? 0)}; su jornada descartada:`,
          n: f.jornadaDescartada as number,
        })),
      });
    }
  }
  // ⚠️🔁 LOS DÍAS SIN HORÓMETRO QUE LA JORNADA SÍ CUBRIRÍA (22-oct-2026, a
  // pedido: «ese cambio tiene sentido y debería ser así, correcto?»). Un
  // toggle APARTE del 🧾 desglose de arriba (ese es solo del horómetro vs
  // jornada POR MÁQUINA; esto es el hueco POR DÍA, pase lo que pase con el
  // relleno automático). Con el relleno apagado, avisa (⚠️) para corregirlo a
  // mano con 🔁 Cambio de horómetro; con el relleno prendido, confirma (✅) lo
  // que YA se rellenó solo — nunca los dos a la vez en el mismo papel.
  if (op.avisoHuecosHorometro && op.seleccionAutomatica && d.dias?.length) {
    const huecos = huecosHorometro(filasElegidas(d.filas, op, d.dias), op, d.dias);
    if (huecos.length > 0) {
      cuadros.push({
        k: 'huecos_horometro',
        titulo: op.rellenoAutomaticoDia
          ? `✅ Días sin horómetro, rellenados con su jornada (${huecos.length})`
          : `⚠️ Días sin horómetro que la jornada sí cubriría (${huecos.length}) — revisa con 🔁 Cambio de horómetro`,
        filas: huecos.map((h) => ({
          clave: `${h.code}${h.placa ? ` · ${h.placa}` : ''} — ${dmy(h.jornada)}${op.rellenoAutomaticoDia ? ': se le sumó su jornada' : ': sin horómetro ese día; su jornada no se sumó'}`,
          n: h.monto,
        })),
      });
    }
  }
  if (op.solapes) {
    const s = solapesConsolidado(d.filas, op, d.dias);
    cuadros.push({
      k: 'solapes',
      titulo: `⚠️ Cobran por dos fuentes a la vez (${s.length})`,
      // Con el DESGLOSE de cuánto cobra por cada fuente: así el jefe decide sin buscar.
      filas: s.map((x) => ({
        clave: `${x.fila.code}${x.fila.placa ? ` · ${x.fila.placa}` : ''} — ${x.fuentes.map((k) => `${FUENTES_META[k].icon} ${usd(x.fila.montos[k] ?? 0)}`).join(' + ')}`,
        n: x.monto,
      })),
    });
  }
  return { tarjetas, cuadros };
}

export const CSS_CONSOLIDADO = `
  .cj .tjs{display:flex;flex-wrap:wrap;gap:8px;margin:4px 0 12px}
  .cj .tj{flex:1 1 150px;border:1px solid #D4DCE5;border-top:3px solid #1E3A5F;border-radius:4px;padding:9px 8px;background:#FAFBFD}
  .cj .tj .v{font-size:17px;font-weight:800;color:#1E3A5F;line-height:1.1}
  .cj .tj .t{margin-top:4px;font-size:8.5px;font-weight:700;color:#68757F;letter-spacing:.3px;text-transform:uppercase}
  .cj .tj .n{margin-top:2px;font-size:8.5px;color:#6B7280}
  .cj h2{font-size:14px;color:#16324F;margin:14px 0 4px;border-bottom:2px solid #16324F;padding-bottom:2px}
  .cj h3{font-size:13px;color:#16324F;margin:12px 0 4px}
  .cj .q{font-size:8px;color:#6B7280;font-weight:400}
  .cj tr.sub .q{color:#5b6773}
  .cj tr.tot .q{color:#cfd8e3}
  .cj table{width:100%;border-collapse:collapse;font-size:10px;margin-bottom:6px}
  .cj th,.cj td{border:1px solid #c9d2dc;padding:4px 6px;text-align:left}
  .cj th{background:#16324F;color:#fff;font-size:8.5px;letter-spacing:.3px}
  .cj .r{text-align:right}
  .cj td.c{text-align:center}
  .cj .marco{border:1px solid #c9d2dc;border-radius:6px;padding:8px;margin:4px 0 10px}
  .cj tr.tot td{background:#16324F;color:#fff;font-weight:800}
  .cj tr.sub td{background:#E8EEF5;font-weight:800}
  .cj td.ref{color:#8a8f98;font-style:italic}
  .cj td.warn{color:#9A3412;font-weight:700}
  .cj .nota{font-size:9.5px;color:#555;margin:4px 0 8px}
`;

/** El cuerpo del PDF (sin membrete). */
export function cuerpoConsolidado(d: {
  filas: readonly FilaConsolidada[];
  filasAnterior?: readonly FilaConsolidada[] | null;
  desde: string;
  hasta: string;
  /** Los viajes del rango (frente + peso) para el ⚖️ costo por tonelada; llega
   *  tal cual a resumenConsolidado. Sin ellos la tarjeta dice «—». */
  viajesTon?: readonly ViajeToneladas[] | null;
  /** 📅 El día por día, ya armado por la pantalla con los mismos motores
   *  (rango de un solo día). Sin esto, la sección simplemente no sale. */
  dias?: readonly DiaCrudoConsolidado[] | null;
}, op: OpcionesConsolidado, edicion?: EdicionResumen): string {
  const elegidas = filasElegidas(d.filas, op, d.dias);
  // 🏗️🚛 Las columnas de plata (Maquinaria/Acarreo, o una por fuente): UNA lista
  //    para todas las tablas del papel.
  const colsP = columnasPapel(op);
  const t = totalesConsolidado(d.filas, op, d.dias);
  const solapeIds = new Set(solapesConsolidado(d.filas, op, d.dias).map((x) => x.fila.id));
  let html = `<div class="cj">`;
  // 🧹 SIN NOTA INTRODUCTORIA (21-oct-2026, a pedido: «eso no hace falta»): el
  // papel arranca directo. La fecha ya va en el subtítulo del membrete, el
  // «(ref)» ya se marca en la cabecera de su columna, y la regla del horómetro
  // no se anuncia (regla de la casa: las opciones no se anuncian en el papel) —
  // su desglose, si se quiere, está en el cuadro 🤖 del resumen.
  if (elegidas.length === 0) return `${html}<p class="nota">Sin montos en el rango con las fuentes elegidas.</p></div>`;

  const conCant = !op.sinCantidades;
  const clsCol = (c: ColumnaPapel) => `r${c.ref ? ' ref' : ''}`;
  /** Suma fuente por fuente (montos o cantidades) de una lista. */
  const sumaRec = <T,>(lista: readonly T[], get: (x: T) => MontosF): Record<FuenteKey, number> => {
    const o = { jornadas: 0, horometros: 0, viajes: 0, peso: 0 } as Record<FuenteKey, number>;
    for (const x of lista) for (const k of FUENTES_ORDEN) o[k] = r2(o[k] + (get(x)?.[k] ?? 0));
    return o;
  };

  // ── 📊 Resumen ejecutivo (editable) ──
  if (op.resumen) {
    const r = aplicarEdicionResumen(resumenConsolidado(d, op), edicion ?? {});
    html += `<h2>📊 Resumen ejecutivo</h2>`;
    html += `<div class="tjs">${r.tarjetas.map((x) => `<div class="tj"><div class="v">${esc(x.valor)}</div><div class="t">${esc(x.titulo)}</div>${x.nota ? `<div class="n">${esc(x.nota)}</div>` : ''}</div>`).join('')}</div>`;
    for (const c of r.cuadros) {
      if (!c.filas.length) continue;
      if (c.k === 'por_empresa') {
        // El cuadro por empresa COMPLETO: desglose por fuente, % del total y máquinas.
        const empresas = porEmpresaConsolidado(d.filas, op, d.dias);
        html += `<h3>${esc(c.titulo)}</h3><table><thead><tr><th>Empresa</th><th class="r">Máquinas</th>${colsP.map((col) => `<th class="r">${col.th}</th>`).join('')}<th class="r">TOTAL</th><th class="r">% del total</th></tr></thead><tbody>${empresas.map((e) => `<tr><td>${esc(e.empresa)}</td><td class="r">${e.maquinas}</td>${colsP.map((col) => `<td class="${clsCol(col)}">${celdaColumna(col, e.porFuente, e.cantPorFuente, conCant)}</td>`).join('')}<td class="r b">${usd(e.total)}</td><td class="r">${t.total > 0 ? `${Math.round((e.total / t.total) * 100)}%` : '—'}</td></tr>`).join('')}</tbody></table>`;
        continue;
      }
      // ⚖️ El cuadro sobre todo el acarreo cierra con su fila TOTAL resaltada.
      const ultimaEsTotal = c.k === 'ton_acarreo_total';
      html += `<h3>${esc(c.titulo)}</h3><table><tbody>${c.filas.map((f, i) => `<tr${ultimaEsTotal && i === c.filas.length - 1 ? ' class="tot"' : ''}><td>${esc(f.clave)}</td><td class="r b">${usd(f.n)}</td></tr>`).join('')}</tbody></table>`;
    }
  }

  // ── 📅 La operación día por día (21-oct-2026, a pedido) ──
  //    Molde del 📊 Informe operativo de Viajes de camiones: el gráfico arriba
  //    (se lee de un golpe) y debajo la tabla con su fila TOTAL / PROM.
  if (op.tablaDiaria || op.graficoDiario) {
    const ds = diasConsolidados(d.dias, op, d.filas);
    if (ds.length > 0) {
      html += `<h2>📅 Operación día por día</h2>`;
      if (op.graficoDiario) {
        const svg = graficoDiarioConsolidadoSvg(ds, op);
        if (svg) html += `<div class="marco">${svg}</div>`;
        else if (ds.length > MAX_DIAS_GRAFICO_CONSOLIDADO) {
          html += `<p class="nota">El gráfico no sale con más de ${MAX_DIAS_GRAFICO_CONSOLIDADO} días (serían barras ilegibles). Acorta el rango para verlo.</p>`;
        }
      }
      if (op.tablaDiaria) {
        // Mismo patrón del informe operativo: un descriptor por columna, las
        // opcionales entran con spread condicional y el pie se arma con la
        // MISMA lista (así nunca se descuadran encabezado, celda y total).
        type ColDia = { k: string; th: string; cls: string; celda: (x: DiaConsolidado) => string };
        const montoCelda = (col: ColumnaPapel, m: MontosF, q: MontosF): string => {
          const v = montoColumna(col, m);
          const tx = cantColumna(col, q);
          const nota = notaRefColumna(col, m);
          if (v === 0 && !tx && !nota) return '—';
          return `${usd(v)}${conCant && tx ? `<div class="q">${esc(tx)}</div>` : ''}${nota ? `<div class="q">${esc(nota)}</div>` : ''}`;
        };
        const cols: ColDia[] = [
          { k: 'fecha', th: 'Fecha', cls: '', celda: (x) => dmy(x.jornada) },
          ...(!op.sinDiaSemana ? [{ k: 'dia', th: 'Día', cls: '', celda: (x: DiaConsolidado) => esc(x.diaSemana) }] : []),
          ...(!op.sinMaquinasDia ? [{ k: 'maq', th: '🚜 Máquinas', cls: 'r', celda: (x: DiaConsolidado) => String(x.maquinas) }] : []),
          ...colsP.map((col) => ({
            k: `f_${col.k}`,
            th: col.th,
            cls: clsCol(col),
            celda: (x: DiaConsolidado) => montoCelda(col, x.montos, x.cant),
          })),
          { k: 'total', th: 'TOTAL', cls: 'r', celda: (x) => usd(x.total) },
          ...(!op.sinToneladasDia ? [{ k: 'ton', th: '⚖️ Toneladas', cls: 'r', celda: (x: DiaConsolidado) => (x.toneladas > 0 ? tons(x.toneladas) : '—') }] : []),
          ...(!op.sinCostoTonDia ? [{ k: 'ut', th: '$/t del día', cls: 'r', celda: (x: DiaConsolidado) => (x.usdPorTon != null ? `${usd(x.usdPorTon)} /t` : '—') }] : []),
        ];
        const sum = (f: (x: DiaConsolidado) => number) => r2(ds.reduce((s, x) => s + f(x), 0));
        const sumaDias = sum((x) => x.total);
        const totTon = sum((x) => x.toneladas);
        const totCosto = sum((x) => x.costoMaq);
        const totSinPeso = sum((x) => x.sinPeso);
        const totalCelda = (k: string): string => {
          if (k === 'fecha') return `TOTAL / PROM. · ${ds.length} día(s) con operación`;
          if (k === 'dia') return '—';
          // Las máquinas del rango no se suman (la misma ficha trabaja varios
          // días): se dice el MÁXIMO del día más cargado, como la flota del
          // informe operativo.
          if (k === 'maq') return `${Math.max(0, ...ds.map((x) => x.maquinas))} (máx)`;
          if (k === 'total') return usd(sumaDias);
          if (k === 'ton') return totTon > 0 ? tons(totTon) : '—';
          if (k === 'ut') return totTon > 0 ? `${usd(r2(totCosto / totTon))} /t` : '—';
          const col = colsP.find((c) => `f_${c.k}` === k);
          return col ? montoCelda(col, sumaRec(ds, (x) => x.montos), sumaRec(ds, (x) => x.cant)) : '';
        };
        html += `<table><thead><tr>${cols.map((c) => `<th${c.cls ? ` class="${c.cls}"` : ''}>${c.th}</th>`).join('')}</tr></thead><tbody>`
          + ds.map((x) => `<tr>${cols.map((c) => `<td${c.cls ? ` class="${c.cls}"` : ''}>${c.celda(x)}</td>`).join('')}</tr>`).join('')
          + `<tr class="tot">${cols.map((c) => `<td${c.cls ? ` class="${c.cls}"` : ''}>${totalCelda(c.k)}</td>`).join('')}</tr></tbody></table>`;
        if (totSinPeso > 0 && !op.sinToneladasDia) {
          html += `<p class="nota">${Math.round(totSinPeso)} viaje(s) del rango no tienen peso de romana: cuentan como viajes pero no suman toneladas. Nada se inventa.</p>`;
        }
        // ⚠️ EL CUADRE SE DICE, NO SE MAQUILLA: el que manda es el TOTAL GENERAL.
        if (sumaDias !== t.total) {
          const dif = r2(t.total - sumaDias);
          html += `<p class="nota">El día por día suma ${usd(sumaDias)} y el TOTAL GENERAL del papel es ${usd(t.total)} (${dif > 0 ? 'faltan' : 'sobran'} ${usd(Math.abs(dif))}): la jornada se cobra con el precio de la semana completa y se redondea una sola vez al final, así que repartirla día por día deja diferencias de centavos. Manda el TOTAL GENERAL.</p>`;
        }
      }
    }
  }

  // ── La matriz máquina × columna (Maquinaria/Acarreo, o una por fuente) ──
  const cab = `<tr><th>Máquina</th>${op.sinPlaca ? '' : '<th>Placa / serial</th>'}${op.sinMarcaModelo ? '' : '<th>Marca / modelo</th>'}${op.sinEmpresas || op.agruparPor === 'empresa' ? '' : '<th>Empresa</th>'}${colsP.map((c) => `<th class="r">${c.th}</th>`).join('')}<th class="r">TOTAL</th></tr>`;
  const filaTd = (f: FilaConsolidada) => {
    const celdas = colsP.map((c) => `<td class="${clsCol(c)}">${celdaColumna(c, f.montos, f.cant, conCant)}</td>`).join('');
    const warn = solapeIds.has(f.id) && op.solapes;
    return `<tr><td>${warn ? '⚠️ ' : ''}${esc(f.code)}</td>${op.sinPlaca ? '' : `<td>${esc(f.placa || '—')}</td>`}${op.sinMarcaModelo ? '' : `<td>${esc([f.marca, f.modelo].filter(Boolean).join(' ') || '—')}</td>`}${op.sinEmpresas || op.agruparPor === 'empresa' ? '' : `<td>${esc(f.empresa)}</td>`}${celdas}<td class="r b">${usd(totalFila(f, op))}</td></tr>`;
  };
  const filaTotales = (lista: FilaConsolidada[], etiqueta: string, clase: string) => {
    const cols = 1 + (op.sinPlaca ? 0 : 1) + (op.sinMarcaModelo ? 0 : 1) + (op.sinEmpresas || op.agruparPor === 'empresa' ? 0 : 1);
    const sM = sumaRec(lista, (f) => f.montos);
    const sQ = sumaRec(lista, (f) => f.cant);
    const porF = colsP.map((c) => `<td class="${clsCol(c)}">${celdaColumna(c, sM, sQ, conCant, true)}</td>`).join('');
    const tot = r2(lista.reduce((s, f) => s + totalFila(f, op), 0));
    return `<tr class="${clase}"><td colspan="${cols}">${esc(etiqueta)}</td>${porF}<td class="r">${usd(tot)}</td></tr>`;
  };

  // ── El detalle, partido según «Agrupar» (20-oct-2026: + categoría y frente).
  //    Los BLOQUES van en ORDEN ALFABÉTICO (a pedido), y dentro, las máquinas
  //    A→Z por código (ya vienen así de filasElegidas). Agrupar por empresa con
  //    los nombres apagados no tiene sentido: cae al listado corrido.
  const porBloques: { titulo: string; icon: string; clave: (f: FilaConsolidada) => string } | null =
    op.agruparPor === 'empresa' && !op.sinEmpresas ? { titulo: 'por empresa', icon: '🏢', clave: (f) => f.empresa }
    : op.agruparPor === 'categoria' ? { titulo: 'por categoría', icon: '🏷️', clave: categoriaDe }
    : op.agruparPor === 'frente' ? { titulo: 'por frente de trabajo', icon: '⛏️', clave: frenteDe }
    : op.agruparPor === 'encargado' ? { titulo: 'por encargado', icon: '👤', clave: encargadoDe }
    : null;
  html += `<h2>📑 Detalle ${porBloques ? porBloques.titulo : 'por máquina'}</h2>`;
  if (porBloques) {
    // Los bloques se juntan por nombre NORMALIZADO (sin mayúsculas ni acentos).
    // Y si se agrupa POR FRENTE, con el índice de frentes: «RES. CORAL» (como
    // quedó congelado en los viajes) y «RESIDENCIAS CORAL» (el catálogo) son
    // UN bloque, y se imprime con el nombre más completo (21-oct-2026).
    const idxB = op.agruparPor === 'frente' ? indiceFrentesConsolidado(elegidas, d.viajesTon, op) : null;
    const claveB = (nombre: string) => (idxB ? idxB.clave(nombre) : norm(nombre));
    const nombreB = (nombre: string) => (idxB ? idxB.nombre(nombre) : nombre);
    const bloques = new Map<string, { nombre: string; lista: FilaConsolidada[] }>();
    for (const f of elegidas) {
      const nombre = porBloques.clave(f);
      const k = claveB(nombre);
      let b = bloques.get(k);
      if (!b) { b = { nombre: nombreB(nombre), lista: [] }; bloques.set(k, b); }
      b.lista.push(f);
    }
    for (const b of Array.from(bloques.values()).sort((a, z) => cmpTx(a.nombre, z.nombre))) {
      html += `<h3>${porBloques.icon} ${esc(b.nombre)}</h3><table><thead>${cab}</thead><tbody>${b.lista.map(filaTd).join('')}${filaTotales(b.lista, `Subtotal ${b.nombre}`, 'sub')}</tbody></table>`;
    }
    html += `<table><tbody>${filaTotales(elegidas, 'TOTAL GENERAL', 'tot')}</tbody></table>`;
  } else {
    html += `<h3>${op.agruparPor === 'maquina' ? '🚜 Por máquina' : '📋 Todas las máquinas'}</h3><table><thead>${cab}</thead><tbody>${elegidas.map(filaTd).join('')}${filaTotales(elegidas, 'TOTAL GENERAL', 'tot')}</tbody></table>`;
  }

  return `${html}</div>`;
}

export function subtituloConsolidado(d: { desde: string; hasta: string }, op: OpcionesConsolidado, filtrado: boolean): string {
  // 🏗️🚛 Con columnas agrupadas, el membrete habla de maquinaria y acarreo.
  const fuentes = (op.columnasPorGrupo
    ? columnasPapel(op).filter((c) => !c.ref).map((c) => GRUPOS_META[c.k as GrupoKey].label.toLowerCase())
    : fuentesQueSuman(op).map((k) => FUENTES_META[k].label.toLowerCase())).join(' + ') || 'sin fuentes que sumen';
  return `Del ${dmy(d.desde)} al ${dmy(d.hasta)} · ${fuentes}${filtrado ? ' · FILTRADO' : ''}`;
}

/** Lo cambiado va en el NOMBRE del archivo, nunca en el papel (regla de la casa). */
export function sufijoArchivoConsolidado(op: OpcionesConsolidado): string {
  const partes: string[] = [];
  for (const k of FUENTES_ORDEN) {
    if (op.fuentes[k] === 'oculta') partes.push(`sin ${FUENTES_META[k].label.toLowerCase()}`);
    else if (op.fuentes[k] === 'muestra') partes.push(`${FUENTES_META[k].label.toLowerCase()} sin sumar`);
  }
  if (op.agruparPor !== 'empresa') {
    partes.push({ maquina: 'por máquina', global: 'global', categoria: 'por categoría', frente: 'por frente', encargado: 'por encargado' }[op.agruparPor]);
  }
  if (op.sinEmpresas) partes.push('sin empresas');
  // 🏗️🚛 Las columnas nacen agrupadas (22-oct): volver a una por fuente va al NOMBRE.
  if (!op.columnasPorGrupo) partes.push('columnas por fuente');
  // 🤖 Apagar la selección automática cambia la PLATA del papel: va al nombre.
  //    (21-oct-2026, tarde: ahora también re-suma lo que el peso descartaba.)
  if (!op.seleccionAutomatica) partes.push('sumando todas las fuentes');
  if ((op.soloMaquinas ?? []).length) partes.push(`solo ${(op.soloMaquinas ?? []).length} máquina(s)`);
  const emps = (op.soloEmpresas ?? []).map((e) => e.trim()).filter(Boolean);
  // Con UNA empresa el archivo dice CUÁL — ese es el papel que se le manda a esa empresa.
  if (emps.length === 1) partes.push(`solo ${emps[0]}`);
  else if (emps.length > 1) partes.push(`solo ${emps.length} empresas`);
  const cats = (op.soloCategorias ?? []).map((e) => e.trim()).filter(Boolean);
  if (cats.length === 1) partes.push(`solo ${cats[0].toLowerCase()}`);
  else if (cats.length > 1) partes.push(`solo ${cats.length} categorías`);
  const fts = (op.soloFrentes ?? []).map((e) => e.trim()).filter(Boolean);
  if (fts.length === 1) partes.push(`solo ${fts[0]}`);
  else if (fts.length > 1) partes.push(`solo ${fts.length} frentes`);
  const encs = (op.soloEncargados ?? []).map((e) => e.trim()).filter(Boolean);
  if (encs.length === 1) partes.push(`solo ${encs[0].toLowerCase()}`);
  else if (encs.length > 1) partes.push(`solo ${encs.length} encargados`);
  const ests = (op.soloEstados ?? []).map((e) => e.trim()).filter(Boolean);
  if (ests.length === 1) partes.push(`solo ${ests[0].toLowerCase()}`);
  else if (ests.length > 1) partes.push(`solo ${ests.length} estados`);
  // 🕐 Camiones con peso pasados a jornada: cambia la PLATA, va al nombre.
  const nJor = (op.camionesPorJornada ?? []).length;
  if (op.seleccionAutomatica && nJor > 0) partes.push(`${nJor} camión(es) con peso por jornada`);
  // 🔁 El relleno por día CAMBIA LA PLATA (22-oct-2026): va al nombre. El aviso
  // de huecos no suma ni descuenta nada — apagarlo no se anuncia en el papel,
  // pero sí en el nombre (regla de la casa: lo cambiado se dice ahí).
  if (op.seleccionAutomatica && op.rellenoAutomaticoDia) partes.push('con relleno automático por día');
  if (!op.avisoHuecosHorometro) partes.push('sin aviso de huecos');
  if (!op.resumen) partes.push('sin resumen');
  // 📅 El día por día y sus columnas: lo apagado va al NOMBRE, no al papel.
  if (!op.tablaDiaria) partes.push('sin tabla diaria');
  if (!op.graficoDiario) partes.push('sin gráfico');
  if (op.tablaDiaria) {
    if (op.sinDiaSemana) partes.push('sin día de la semana');
    if (op.sinMaquinasDia) partes.push('sin columna de máquinas');
    if (op.sinToneladasDia) partes.push('sin toneladas por día');
    if (op.sinCostoTonDia) partes.push('sin $/t por día');
  }
  if (op.sinCantidades) partes.push('sin cantidades');
  return partes.length ? ` (${partes.join(', ')})` : '';
}

export function nombreArchivoConsolidado(desde: string, hasta: string, op: OpcionesConsolidado): string {
  return `Reporte consolidado de pagos ${dmy(desde).replace(/\//g, '-')} a ${dmy(hasta).replace(/\//g, '-')}${sufijoArchivoConsolidado(op)}`;
}
