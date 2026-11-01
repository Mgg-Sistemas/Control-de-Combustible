// 🏭 CENTRO DE OPERACIONES — LA LIBRERÍA DE 📄 REPORTES (24-oct-2026).
//
// Lo que la pestaña 📄 Reportes decide y se puede probar sin pantalla:
//   · el RANGO y la HORA DE CORTE validados (fechas reales, desde ≤ hasta, nada de
//     años enteros ni centinelas «sin fin», hora de 00:00 a 23:59);
//   · el aviso del corte en la pantalla (el instante de `corteCop`: la jornada va de
//     7am a 7am, así que un corte «05:00» del día 8 es el 9 a las 05:00, y uno a las
//     «07:00» en punto también es el 9: cierra la jornada del 8, R33);
//   · lo que «Guardar como texto fijo» tiene que escribir y cómo se ponen al día los
//     tres papeles cuando cambian los fijos del sitio (`rebasarTextosFijos`);
//   · la MEMORIA DEL EQUIPO de cada papel (lo oculto, el orden, la agrupación y, solo en
//     el mismo sitio, lo escondido y los títulos del resumen; nunca los textos, las
//     notas ni las cifras escritas a mano);
//   · cuándo se limpian los valores a mano (`edicionesAlCambiar`, `firmaFiltros`);
//   · el AVISO DE LO APAGADO, que es SOLO DE LA PANTALLA: el papel no lo dice;
//   · las unidades que se pueden elegir para el corte, con su ficha de la flota y si
//     tienen viajes del corte;
//   · y el ARMADO COMPLETO de los cuatro papeles (`armarPapelCop`, también sin el cuerpo
//     HTML para la pantalla, y `claveDelModelo`).
//
// ⭐ EL 📄 REPORTE COMPLETO (PD5b) es el primer papel: todo el 📅 Parte diario del sitio en
//    JORNADAS enteras (7am a 7am). No usa la hora de corte, los filtros, el buscador, el
//    orden ni el resumen editable (`filtrosDelPapel` → nada); sí las secciones, los logos y
//    los textos. Sus datos llegan aparte (`EntradaPapelCop.completo`, de
//    `cargarDatosReporteCompleto`) y su modelo y cuerpo son de
//    `centroOperacionesReporteCompleto.ts`: acá solo se juntan, con el mismo patrón L4 (en
//    pantalla el modelo sin HTML; el cuerpo al tocar 📄 PDF).
//
// ⭐ UNA SOLA REGLA DE PERTENENCIA: `armarPapelCop` arma `unidadDeLosRenglones` UNA
//    vez con la LISTA BASE (todo lo cargado del período, antes de filtrar) y la
//    misma función va al listado, a la tabla por unidad y al corte (dentro de su op).
// ⭐ UNA SOLA FUENTE DE CADA REGLA (auditoría del lote 4, A3 = B7): el rótulo del corte
//    (`corteCop`), el período y el subtítulo (`periodoCop`, `subtituloCop`), la emisión
//    escapada (`emitidaCop`), los textos fijos y logos (`textosDe`, `logosDe`) y el orden
//    de la jornada (`cmpMovimientoJornada`, dentro del listado) son de
//    `centroOperaciones.ts` y `centroOperacionesPapel.ts`. Acá no hay copias.
// ⭐ EL MISMO `op` PARA EL MODELO Y PARA EL PAPEL: el orden del modelo, las columnas
//    del corte y lo que se esconde salen de las mismas opciones.
// ⭐ NO TIENE REGLAS PROPIAS DE CÁLCULO: las cuentas son de `centroOperaciones.ts` y
//    el dibujo de `centroOperacionesPapel.ts`; acá solo se juntan.
//
// PURA: sin React, sin Supabase y sin el almacenamiento del equipo (la pestaña lo
// usa). `scripts/test-centro-operaciones-reportes.mjs` la prueba sola.
import { consolidadoSitio, corteCop, cortePorUnidad, esVentaEnPiezas, fechaValida, filtrarMovimientos, momentoDelCorte, tablaPor, unidadDeLosRenglones } from './centroOperaciones';
import type { EstadoMov, FilaTabla, FiltrosCop, Movimiento, RangoCop, TipoMov, Unidad } from './centroOperaciones';
import {
  COLUMNAS_COP,
  OPCIONES_PAPEL_POR_DEFECTO,
  SECCIONES_COP,
  cuerpoConsolidado,
  cuerpoCorte,
  cuerpoListado,
  emitidaCop,
  escaparHtml,
  fechaCop,
  logosDe,
  periodoCop,
  resumenConsolidado,
  resumenCorte,
  subtituloCop,
  textosDe,
  tituloCop,
} from './centroOperacionesPapel';
import type { ClaveTextoCop, ColumnaCop, LogosCop, OpcionesPapelCop, PapelCop, SeccionCompleto, TextosCop } from './centroOperacionesPapel';
import { ESTADOS_MOV, TIPOS_MOV, horaDeCampo, opcionesUnidad, textoDeUnidad } from './centroOperacionesCarga';
import { cuerpoReporteCompleto, modeloReporteCompleto } from './centroOperacionesReporteCompleto';
import type { EntradaReporteCompleto, ModeloReporteCompleto } from './centroOperacionesReporteCompleto';
import { edicionAlCambiarDeDia } from './frentesReporte';
import type { EdicionResumen, ResumenFrentes, TarjetaPropia } from './frentesReporte';
import { cmpText, norm } from './text';

// ═══════════════════════════ Los papeles ═══════════════════════════

export const PAPELES_COP: { k: PapelCop; label: string; ayuda: string }[] = [
  { k: 'completo', label: '📄 Reporte completo', ayuda: 'Todo el 📅 Parte diario del sitio en el período, por jornadas enteras (7am a 7am): Reporte General, patios, salidas, maquinaria y bloques.' },
  { k: 'consolidado', label: '📊 Consolidado', ayuda: 'El sitio a una fecha de corte: lo recibido, lo movido y lo despachado.' },
  { k: 'corte', label: '🚛 Corte por unidad', ayuda: 'Los viajes de una o varias unidades en el período, día por día (una hoja cada una).' },
  { k: 'listado', label: '📋 Listado', ayuda: 'Renglón por renglón, agrupado por día, unidad o tipo.' },
];

/** Más tarjetas propias no caben en la fila del papel (el mismo tope de los frentes). */
export const MAX_TARJETAS_PROPIAS_COP = 6;

/** Más de un año no se arma: el corte saldría de cientos de hojas y la pantalla se congela. */
export const MAX_DIAS_REPORTE = 366;
/** Pasado esto, se avisa que el papel puede salir largo. */
export const AVISO_DIAS_REPORTE = 62;

// ═══════════════════════════ Utilidades internas ═══════════════════════════

/** Texto limpio: sin espacios a los lados y con los dobles colapsados. */
const limpia = (s: unknown): string => String(s ?? '').replace(/\s+/g, ' ').trim();

const plural = (n: number, uno: string, varios: string): string => (n === 1 ? uno : varios);

/** Días del rango, contando los dos extremos. Fechas que no se entienden o al revés → 0. */
export function diasDelRango(desde: string, hasta: string): number {
  if (!fechaValida(desde) || !fechaValida(hasta) || desde > hasta) return 0;
  const ms = (f: string): number => { const [a, m, d] = f.split('-').map(Number); return Date.UTC(a, m - 1, d); };
  return Math.round((ms(hasta) - ms(desde)) / 86400000) + 1;
}

// ═══════════════════════════ Rango y hora de corte ═══════════════════════════

/**
 * Revisa lo que se eligió en la pantalla y arma el `RangoCop` de los papeles.
 * Con errores, `rango` es null y no se arma nada:
 *   · las dos fechas tienen que ser reales (y de 2000 a 2100: un «9999-12-31» de
 *     «sin fin» no entra en un papel);
 *   · «desde» no puede ir después de «hasta»;
 *   · más de `MAX_DIAS_REPORTE` días no se arma; más de `AVISO_DIAS_REPORTE`, se avisa;
 *   · la hora de corte es opcional; escrita, de 00:00 a 23:59 («7:05» = 07:05).
 */
export function validarRango(e: { desde: string; hasta: string; corte: string }): { rango: RangoCop | null; errores: string[]; aviso: string | null } {
  const errores: string[] = [];
  const desdeOk = fechaValida(e.desde);
  const hastaOk = fechaValida(e.hasta);
  if (!desdeOk) errores.push('La fecha «desde» no se entiende: elígela en el calendario.');
  if (!hastaOk) errores.push('La fecha «hasta» no se entiende: elígela en el calendario.');
  let aviso: string | null = null;
  if (desdeOk && hastaOk) {
    if (e.desde > e.hasta) {
      errores.push('La fecha «desde» va antes que «hasta».');
    } else {
      const dias = diasDelRango(e.desde, e.hasta);
      if (dias > MAX_DIAS_REPORTE) errores.push(`El rango es de ${dias.toLocaleString('es-VE')} días: el máximo es ${MAX_DIAS_REPORTE} (un año). Acórtalo o saca el papel por partes.`);
      else if (dias > AVISO_DIAS_REPORTE) aviso = `Rango largo (${dias.toLocaleString('es-VE')} días): el papel puede salir de muchas hojas y tardar en armarse.`;
    }
  }
  const hora = horaDeCampo(e.corte);
  if (hora.error) errores.push(`Hora de corte: ${hora.error}`);
  if (errores.length) return { rango: null, errores, aviso: null };
  return { rango: { desde: e.desde, hasta: e.hasta, corteHora: hora.valor }, errores, aviso };
}

/**
 * Lo que la pantalla explica del corte (null sin hora). El instante es el de
 * `corteCop` (el REAL, de `momentoDelCorte`); si es de madrugada —o las 07:00 en punto,
 * que cierran la jornada (R33)— se aclara por qué ya es el día siguiente.
 */
export function avisoCorte(r: RangoCop): string | null {
  const real = r.corteHora ? momentoDelCorte(r.hasta, r.corteHora) : null;
  if (!real) return null;
  if (real.slice(0, 10) === r.hasta) return `Corte: ${corteCop(r)}.`;
  return `Corte: ${corteCop(r)}. La jornada del ${fechaCop(r.hasta)} va de 7am a 7am, así que esa hora ya es del día siguiente.`;
}

// ═══════════════════════════ Textos fijos y logos (ajustes del sitio) ═══════════════════════════
//
// Se leen con `textosDe` / `logosDe` de la librería de papeles: el MISMO lector que usa
// ⚙️ Ajustes (con dos, uno podía tomar por «no guardado» lo que el otro guardó).

/** Qué texto fijo es el título de cada papel (el listado no tiene). */
const CLAVE_TITULO: Record<PapelCop, ClaveTextoCop | null> = { completo: null, consolidado: 'titulo_consolidado', corte: 'titulo_corte', listado: null };

/** Lo de los textos fijos que le toca a ese papel. */
function textosDelPapel(papel: PapelCop, fijos: TextosCop | null | undefined): Pick<OpcionesPapelCop, 'titulo' | 'presentacion' | 'consideraciones' | 'logos'> {
  const f = fijos ?? textosDe({});
  const claveTitulo = CLAVE_TITULO[papel];
  return {
    titulo: claveTitulo ? f[claveTitulo] : '',
    presentacion: papel === 'consolidado' ? f.presentacion : '',
    consideraciones: papel === 'corte' ? f.consideraciones : '',
    logos: { ...f.logos },
  };
}

/**
 * Las opciones con las que nace un papel: las de siempre, encima lo que recuerda el
 * equipo (lo oculto, el orden…) y encima los textos fijos y logos del sitio.
 */
export function opcionesIniciales(papel: PapelCop, fijos: TextosCop | null | undefined, recordadas: Partial<OpcionesPapelCop> | null | undefined): OpcionesPapelCop {
  const d = OPCIONES_PAPEL_POR_DEFECTO;
  const r = recordadas ?? {};
  return {
    ...d,
    ocultosSecciones: [...(r.ocultosSecciones ?? d.ocultosSecciones)],
    ocultosColumnas: [...(r.ocultosColumnas ?? d.ocultosColumnas)],
    orden: r.orden ?? d.orden,
    columnasPorDestino: r.columnasPorDestino ?? d.columnasPorDestino,
    diasSinAnotacion: r.diasSinAnotacion ?? d.diasSinAnotacion,
    agruparListado: r.agruparListado ?? d.agruparListado,
    ...textosDelPapel(papel, fijos),
  };
}

const CLAVES_LOGO = Object.keys(OPCIONES_PAPEL_POR_DEFECTO.logos) as (keyof LogosCop)[];
const mismosLogos = (a: LogosCop, b: LogosCop): boolean => CLAVES_LOGO.every((k) => !!a[k] === !!b[k]);

/**
 * Lo que «Guardar como texto fijo» tiene que escribir para ESE papel: su título,
 * la presentación (consolidado) o las consideraciones (corte), y los logos; solo lo
 * que cambió. Los textos van sin espacios a los lados (los saltos de línea quedan).
 */
export function cambiosTextosFijos(papel: PapelCop, op: OpcionesPapelCop, fijos: TextosCop): [string, unknown][] {
  const cambios: [string, unknown][] = [];
  const texto = (clave: ClaveTextoCop, valor: string): void => {
    const v = String(valor ?? '').trim();
    if (v !== String(fijos[clave] ?? '').trim()) cambios.push([clave, v]);
  };
  const claveTitulo = CLAVE_TITULO[papel];
  if (claveTitulo) texto(claveTitulo, op.titulo);
  if (papel === 'consolidado') texto('presentacion', op.presentacion);
  if (papel === 'corte') texto('consideraciones', op.consideraciones);
  const logos = logosDe(op.logos);
  if (!mismosLogos(logos, fijos.logos)) cambios.push(['logos', logos]);
  return cambios;
}

/**
 * ⭐ Los textos fijos y los logos son del SITIO y valen para los tres papeles (auditoría
 *    del lote 4, A7 = B2). Cuando los fijos cambian —al cargar, con 🔄 (quizá los guardó
 *    otro equipo) o después de un 💾 bueno desde CUALQUIER papel—, cada campo de este
 *    papel que todavía era IGUAL al fijo viejo pasa al fijo nuevo; lo que ella tecleó no
 *    se toca. Sin esto, guardar los logos en el consolidado dejaba al corte con los de
 *    antes («con cambios sin guardar» sin tocar nada) y su siguiente 💾 los revertía.
 *    Se aplica a los TRES papeles; el primer «viejo» es `textosDe({})`.
 */
export function rebasarTextosFijos(papel: PapelCop, op: OpcionesPapelCop, viejos: TextosCop, nuevos: TextosCop): OpcionesPapelCop {
  const igual = (a: unknown, b: unknown): boolean => String(a ?? '').trim() === String(b ?? '').trim();
  const r: OpcionesPapelCop = { ...op };
  const claveTitulo = CLAVE_TITULO[papel];
  if (claveTitulo && igual(op.titulo, viejos[claveTitulo])) r.titulo = nuevos[claveTitulo];
  if (papel === 'consolidado' && igual(op.presentacion, viejos.presentacion)) r.presentacion = nuevos.presentacion;
  if (papel === 'corte' && igual(op.consideraciones, viejos.consideraciones)) r.consideraciones = nuevos.consideraciones;
  if (mismosLogos(logosDe(op.logos), viejos.logos)) r.logos = { ...nuevos.logos };
  return r;
}

// ═══════════════════════════ La memoria del equipo ═══════════════════════════

/** Lo que el equipo recuerda de las opciones (los textos y logos NO: vienen del sitio). */
export type OpcionesRecordadas = Partial<Pick<OpcionesPapelCop, 'ocultosSecciones' | 'ocultosColumnas' | 'orden' | 'columnasPorDestino' | 'diasSinAnotacion' | 'agruparListado'>>;

/**
 * El texto que se guarda en el equipo para ese papel. Del resumen se guarda solo la
 * FORMA que no habla de cifras: lo escondido y los títulos. NO se guardan:
 *   · un valor escrito a mano ni una tarjeta propia (cifras de ESE día);
 *   · las NOTAS (auditoría del lote 4, R1): hablan de las cifras de ese período y
 *     reaparecían semanas después, con el editor plegado, en un papel para terceros.
 * ⭐ Va con el SITIO (auditoría del lote 4, B3): las claves de las tarjetas son las mismas
 *    en todos los sitios, así que la forma solo vuelve en el sitio donde se escribió.
 *    La clave del equipo (una por papel, la de la pestaña) no cambia: el sitio va adentro.
 */
export function memoriaParaGuardar(papel: PapelCop, op: OpcionesPapelCop, ed: EdicionResumen | null | undefined, sitioId?: string | null): string {
  const opciones: OpcionesRecordadas = {
    ocultosSecciones: [...(op.ocultosSecciones ?? [])],
    ocultosColumnas: [...(op.ocultosColumnas ?? [])],
    orden: op.orden,
    columnasPorDestino: op.columnasPorDestino,
    diasSinAnotacion: op.diasSinAnotacion,
    agruparListado: op.agruparListado,
  };
  const forma = edicionAlCambiarDeDia(ed);
  const edicion: EdicionResumen = { ocultos: forma.ocultos ?? [], titulos: forma.titulos ?? {} };
  return JSON.stringify({ v: VERSION_MEMORIA, papel, sitioId: sitioId ?? null, opciones, edicion });
}

/** La versión de lo que se guarda en el equipo (2 = con el sitio y sin las notas). */
const VERSION_MEMORIA = 2;

const esTextoPlano = (v: unknown): v is string => typeof v === 'string';
const mapaDeTextos = (v: unknown): Record<string, string> | undefined => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const r: Record<string, string> = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) if (esTextoPlano(x)) r[k] = x;
  return r;
};

/**
 * Lo que recordaba el equipo, SANEADO: lo que no es de ese papel, no se entiende o
 * viene de una versión que no se conoce se descarta. Nunca revienta: nada o basura → vacío.
 * Lo oculto, el orden y la agrupación son del EQUIPO (§9) y vuelven en cualquier sitio;
 * la forma del resumen (lo escondido y los títulos) solo en el MISMO sitio (`sitioId`).
 * Las notas, los valores y las propias jamás vuelven.
 */
export function memoriaLeida(papel: PapelCop, crudo: string | null | undefined, sitioId?: string | null): { opciones: OpcionesRecordadas; edicion: EdicionResumen } {
  const vacio = { opciones: {}, edicion: {} };
  if (!crudo) return vacio;
  let datos: any;
  try { datos = JSON.parse(crudo); } catch { return vacio; }
  if (!datos || typeof datos !== 'object') return vacio;
  if (datos.v !== 1 && datos.v !== VERSION_MEMORIA) return vacio;

  const o = datos.opciones && typeof datos.opciones === 'object' ? datos.opciones : {};
  const secciones = new Set(SECCIONES_COP[papel].map((s) => s.k));
  const columnas = new Set<string>(COLUMNAS_COP[papel].map((c) => c.k));
  const opciones: OpcionesRecordadas = {};
  if (Array.isArray(o.ocultosSecciones)) opciones.ocultosSecciones = o.ocultosSecciones.filter((x: unknown) => esTextoPlano(x) && secciones.has(x));
  if (Array.isArray(o.ocultosColumnas)) opciones.ocultosColumnas = o.ocultosColumnas.filter((x: unknown) => esTextoPlano(x) && columnas.has(x)) as ColumnaCop[];
  if (o.orden === 'cantidad' || o.orden === 'az') opciones.orden = o.orden;
  if (typeof o.columnasPorDestino === 'boolean') opciones.columnasPorDestino = o.columnasPorDestino;
  if (o.diasSinAnotacion === 'cero' || o.diasSinAnotacion === 'ocultar') opciones.diasSinAnotacion = o.diasSinAnotacion;
  if (o.agruparListado === 'dia' || o.agruparListado === 'unidad' || o.agruparListado === 'tipo') opciones.agruparListado = o.agruparListado;

  // La forma del resumen, solo en el sitio donde se escribió (una memoria vieja, sin sitio, no la trae).
  const delSitio = !!sitioId && typeof datos.sitioId === 'string' && datos.sitioId === sitioId;
  const e = delSitio && datos.edicion && typeof datos.edicion === 'object' ? datos.edicion : {};
  const edicion: EdicionResumen = {};
  if (Array.isArray(e.ocultos)) edicion.ocultos = [...new Set<string>(e.ocultos.filter(esTextoPlano))];
  const titulos = mapaDeTextos(e.titulos);
  if (titulos) edicion.titulos = titulos;
  // Notas, valores y propias jamás vuelven de la memoria (ver memoriaParaGuardar).
  return { opciones, edicion };
}

// ═══════════════════════════ El aviso de lo apagado (pantalla) ═══════════════════════════

/**
 * Lo apagado y lo filtrado, en palabras, para decirlo EN LA PANTALLA antes de bajar
 * el PDF. ⭐ El papel no lo dice (lo oculto no deja rastro); el nombre del archivo,
 * sí (`nombreArchivoCop`). Solo se nombra lo que ESE papel tiene.
 */
export function apagadoEnPalabras(papel: PapelCop, op: OpcionesPapelCop, filtros: FiltrosCop, ed?: EdicionResumen | null): string[] {
  const r: string[] = [];
  const ocS = new Set(op.ocultosSecciones ?? []);
  const ocC = new Set<string>(op.ocultosColumnas ?? []);
  for (const s of SECCIONES_COP[papel]) if (ocS.has(s.k)) r.push(`Sin «${s.etiqueta}»`);
  for (const c of COLUMNAS_COP[papel]) if (ocC.has(c.k)) r.push(`Sin la columna «${c.etiqueta}»`);
  if (papel === 'corte' && op.diasSinAnotacion === 'ocultar') r.push('Días sin anotación escondidos');
  const tarjetas = (ed?.ocultos ?? []).length;
  if (tarjetas && papel !== 'listado' && papel !== 'completo' && !ocS.has('tarjetas')) r.push(`${tarjetas} ${plural(tarjetas, 'tarjeta escondida', 'tarjetas escondidas')} del resumen`);

  const f = filtrosDelPapel(papel, filtros ?? {});
  const etiquetas = <K extends string>(lista: K[] | undefined, de: { key: K; label: string }[]): string =>
    (lista ?? []).map((k) => de.find((x) => x.key === k)?.label ?? k).join(', ');
  if (f.tipos?.length) r.push(`Solo tipo: ${etiquetas<TipoMov>(f.tipos, TIPOS_MOV)}`);
  if (f.estados?.length) r.push(`Solo estado: ${etiquetas<EstadoMov>(f.estados, ESTADOS_MOV)}`);
  if (f.unidadIds?.length) r.push(`Solo ${f.unidadIds.length} ${plural(f.unidadIds.length, 'unidad', 'unidades')}`);
  const nombres = (lista: string[] | undefined, que: string): void => {
    const n = (lista ?? []).map(limpia).filter(Boolean);
    if (n.length) r.push(`Solo ${que}: ${n.join(', ')}`);
  };
  nombres(f.transportistas, 'transportista');
  nombres(f.origenes, 'origen');
  nombres(f.destinos, 'destino');
  nombres(f.materiales, 'material');
  if (limpia(f.texto)) r.push(`Con «${limpia(f.texto)}»`);
  return r;
}

/**
 * Los filtros que valen para ese papel: el corte no filtra por unidad (sus unidades son sus
 * hojas) y el Reporte completo no filtra nada (es TODO el Parte diario del período: ni la
 * pantalla ni el nombre del archivo dicen un filtro que no lo tocó).
 */
export function filtrosDelPapel(papel: PapelCop, filtros: FiltrosCop): FiltrosCop {
  if (papel === 'completo') return {};
  if (papel !== 'corte') return filtros;
  const { unidadIds: _hojas, ...resto } = filtros ?? {};
  return resto;
}

/**
 * Las opciones que van al CUERPO del papel con el filtro de TIPO (auditoría del lote 4,
 * B6): en el consolidado, la sección de un tipo que el filtro deja fuera por completo se
 * esconde como lo apagado (sin rastro), porque si no el papel afirmaría «Sin entradas en
 * el período» o «Viajes recibidos 0» de un sitio que sí recibió:
 *   · sin «entrada» → tarjetas (son de lo recibido), transportistas y orígenes;
 *   · sin «interno» → internos;
 *   · sin «salida»  → salidas y su resumen en texto.
 * Solo el filtro de TIPO: ✍️ Cargar pide transportista en todos los tipos, así que un
 * filtro de transportista no deja fuera a los internos ni a las salidas. El corte no
 * cambia (sus hojas no cuentan entradas). No toca el op de la pantalla ni el del nombre
 * del archivo (que ya dice «solo salidas»).
 */
export function opDelCuerpo(papel: PapelCop, op: OpcionesPapelCop, filtros: FiltrosCop | null | undefined): OpcionesPapelCop {
  const tipos = filtros?.tipos ?? [];
  if (papel !== 'consolidado' || !tipos.length) return op;
  const fuera: string[] = [];
  if (!tipos.includes('entrada')) fuera.push('tarjetas', 'transportistas', 'origenes');
  if (!tipos.includes('interno')) fuera.push('internos');
  if (!tipos.includes('salida')) fuera.push('salidas', 'textoSalidas');
  if (!fuera.length) return op;
  return { ...op, ocultosSecciones: [...new Set([...(op.ocultosSecciones ?? []), ...fuera])] };
}

/**
 * ¿El ORDEN («más viajes primero» / «A→Z») cambia algo en ese papel? Solo en el
 * consolidado y en el listado agrupado por unidad. En el corte las hojas van en el orden
 * en que se eligieron y en el listado por día o por tipo el orden es el de la jornada:
 * ahí el control no se muestra (un control que no hace nada confunde; auditoría del
 * lote 4, A6). Ordenar las hojas desalinearía el resumen de la primera hoja.
 */
export function ordenActua(papel: PapelCop, op: Pick<OpcionesPapelCop, 'agruparListado'>): boolean {
  return papel === 'consolidado' || (papel === 'listado' && op.agruparListado === 'unidad');
}

// ═══════════════════════════ Los valores a mano no pasan de un papel a otro (L4 B1) ═══════════════════════════

/**
 * ⭐ Los valores escritos a mano y las tarjetas propias son cifras de LO QUE SE VEÍA:
 *    si cambia lo que el papel cuenta, se limpian (`edicionAlCambiarDeDia`; la forma
 *    —lo escondido, los títulos, las notas— se queda). Sin esto, sacar el corte de U-1
 *    con «Salidas: 45», desmarcarla y marcar U-2 daba el papel de U-2 con la cifra de U-1.
 *   · 'unidades': cambiaron las hojas del corte → solo el corte;
 *   · 'rango' o 'filtros' (o el buscador): cambió lo que cuentan los tres papeles.
 */
export function edicionesAlCambiar(ediciones: Record<PapelCop, EdicionResumen>, que: 'unidades' | 'rango' | 'filtros'): Record<PapelCop, EdicionResumen> {
  if (que === 'unidades') return { ...ediciones, corte: edicionAlCambiarDeDia(ediciones.corte) };
  return {
    completo: edicionAlCambiarDeDia(ediciones.completo),
    consolidado: edicionAlCambiarDeDia(ediciones.consolidado),
    corte: edicionAlCambiarDeDia(ediciones.corte),
    listado: edicionAlCambiarDeDia(ediciones.listado),
  };
}

/**
 * La firma de los filtros y del buscador, para saber si CAMBIÓ lo que se cuenta: una
 * lista vacía es «sin filtro», el orden en que se tocaron no importa y el buscador va
 * recortado (las letras intermedias de una búsqueda no son cambios: se usa el diferido).
 */
export function firmaFiltros(filtros: FiltrosCop | null | undefined, texto?: string | null): string {
  const f = filtros ?? {};
  const listas: Record<string, string[]> = {};
  for (const k of ['tipos', 'estados', 'unidadIds', 'transportistas', 'origenes', 'destinos', 'materiales'] as const) {
    const l = ((f[k] as string[] | undefined) ?? []).map((x) => limpia(x)).filter(Boolean).sort();
    if (l.length) listas[k] = l;
  }
  return JSON.stringify({ ...listas, texto: limpia(texto ?? f.texto ?? '') });
}

// ═══════════════════════════ Las unidades del corte ═══════════════════════════

/** La ficha de la flota para el encabezado de la hoja: «código · descripción» y la placa. */
export type FichaUnidadCop = { unidad: string; placa: string | null };
export type OpcionUnidadCorte = { clave: string; etiqueta: string; ficha?: FichaUnidadCop; conRenglones: boolean };

function fichaDe(u: Unidad): FichaUnidadCop {
  const codigo = limpia(u.codigo);
  const desc = limpia(u.descripcion);
  const partes = [codigo, desc && norm(desc) !== norm(codigo) ? desc : ''].filter(Boolean);
  return { unidad: partes.join(' · ') || textoDeUnidad(u), placa: limpia(u.placa) || null };
}

/**
 * Las unidades que se pueden elegir para el corte: las que tienen renglones en el
 * período (claves de `unidadDeLosRenglones(base)`, la misma regla del papel) y las
 * ACTIVAS de la flota aunque no hayan trabajado (su hoja sale con su nombre y en
 * cero). Cada una con la ficha de la flota si es de ella. A→Z.
 *
 * ⭐ `conRenglones` (lo que cuenta «Las que trabajaron»; auditoría del lote 4, A5) es
 *    tener algún viaje DEL CORTE —interno o salida— en el rango (con su hora de corte):
 *    el corte no cuenta entradas, y en el CDT casi todas las placas del período son
 *    camiones que TRAEN material; antes el atajo armaba decenas de hojas «Sin registros».
 *    Las demás se siguen ofreciendo (quitarlas se llevaría su hoja sin aviso). La
 *    pertenencia es la misma regla del papel (`unidadDeLosRenglones(base)`).
 */
export function opcionesUnidadCorte(base: Movimiento[], unidades: Unidad[], rango?: RangoCop | null): OpcionUnidadCorte[] {
  const flota = new Map((unidades ?? []).map((u) => [u.id, u]));
  const unidadDe = unidadDeLosRenglones(base ?? []);
  const delCorte = rango
    ? filtrarMovimientos(base ?? [], rango, { tipos: ['interno', 'salida'] })
    : (base ?? []).filter((m) => m.tipo === 'interno' || m.tipo === 'salida');
  const trabajaron = new Set(delCorte.map(unidadDe).filter(Boolean));
  const r: OpcionUnidadCorte[] = opcionesUnidad(base, unidades).map((o) => {
    const u = flota.get(o.clave);
    return { clave: o.clave, etiqueta: o.etiqueta, ficha: u ? fichaDe(u) : undefined, conRenglones: trabajaron.has(o.clave) };
  });
  const ya = new Set(r.map((o) => o.clave));
  for (const u of unidades ?? []) {
    if (!u.activo || ya.has(u.id)) continue;
    const texto = textoDeUnidad(u);
    const placa = limpia(u.placa);
    const etiqueta = [texto, placa && norm(placa) !== norm(texto) ? placa : ''].filter(Boolean).join(' · ') || u.id;
    r.push({ clave: u.id, etiqueta, ficha: fichaDe(u), conRenglones: false });
  }
  return r.sort((a, b) => cmpText(a.etiqueta, b.etiqueta));
}

// ═══════════════════════════ El armado completo ═══════════════════════════

export type EntradaPapelCop = {
  papel: PapelCop;
  sitio: string;
  /** TODO lo cargado del período (antes de filtrar): de acá sale la regla de pertenencia. */
  base: Movimiento[];
  rango: RangoCop;
  filtros: FiltrosCop;
  op: OpcionesPapelCop;
  edicion: EdicionResumen | null;
  /** Solo el corte: las unidades elegidas, una hoja cada una, en este orden. */
  unidadesCorte?: { clave: string; ficha?: FichaUnidadCop }[];
  /**
   * La fecha y hora REALES para cuando la emisión va en blanco (la pone la pantalla con
   * `nowStamp()` al tocar 📄 PDF: esta librería es pura y no mira el reloj). Así el
   * membrete y cada hoja del corte dicen la MISMA emisión (auditoría del lote 4, A1).
   */
  ahora?: string;
  /**
   * Solo el 📄 Reporte completo: lo que carga `cargarDatosReporteCompleto` y `hoy` (la
   * jornada en curso, `caracasBusinessToday()`, que pone la pantalla: dice si el estado de
   * las máquinas es de otro día). Sin datos (todavía cargando) sale con sus 7 secciones
   * vacías, nunca revienta.
   * 🚜 `inspeccion` y `emitidoMs` (M5): lo que dijo inspección AL EMITIR y la hora de ese
   * momento (la pantalla los trae de `leerInspeccionAlEmitir`). Sin ellos, las vinculadas sin
   * marca salen «Sin dato» y no se imprime la hora.
   */
  completo?: {
    datos: DatosDelCompleto;
    hoy: string;
    inspeccion?: EntradaReporteCompleto['inspeccion'];
    emitidoMs?: EntradaReporteCompleto['emitidoMs'];
  } | null;
};

/** Lo que el Reporte completo necesita de la base (= `DatosReporteCompleto` de la capa de datos). */
export type DatosDelCompleto = Pick<EntradaReporteCompleto, 'reportes' | 'movimientos' | 'anteriores' | 'unidades' | 'listas'>;

export type PapelArmadoCop = {
  /** Ya escapados (pdfDocument los pega tal cual). */
  titulo: string;
  subtitulo: string;
  /** La línea «Emitida:», YA ESCAPADA (`emitidaCop`); undefined = la fecha y hora reales de pdfDocument. */
  emitida: string | undefined;
  cuerpo: string;
  /** Renglones que entraron al papel (filtrados). */
  renglones: number;
  /** Hojas del corte (una por unidad); 1 en los otros papeles. */
  hojas: number;
  /** El resumen AUTOMÁTICO (sin la edición), para el editor de la pantalla; null en el listado. */
  resumen: ResumenFrentes | null;
  /** Viajes por unidad de lo filtrado (`tablaPor` con la MISMA regla), para la pantalla. */
  porUnidad: FilaTabla[];
  /** Solo el corte: el nombre IMPRESO de cada hoja (el de su ficha), para `nombreArchivoCop`. */
  nombresHojas: string[];
  /** Solo el Reporte completo: su modelo (las 7 secciones, sin HTML), para la pantalla; null en los otros. */
  completo: ModeloReporteCompleto | null;
};

/**
 * ⭐ Lib → modelo → papel, en un solo lugar y con UNA regla de pertenencia:
 *   1. `unidadDe` = `unidadDeLosRenglones(base)`, armada UNA vez;
 *   2. los renglones del papel = `filtrarMovimientos(base, rango, filtros del papel)`;
 *   3. el modelo con el MISMO `op` que el papel (orden, columnas del corte, días, y
 *      el resumen del consolidado, que sigue a las columnas apagadas);
 *   4. el cuerpo HTML de `centroOperacionesPapel`.
 * El corte de VARIAS unidades descarta los valores escritos a mano del resumen: la
 * misma cifra saldría en todas las hojas. Títulos, notas y tarjetas propias sí van.
 *
 * `conCuerpo: false` (auditoría del lote 4, A2 = B4): todo igual MENOS el cuerpo HTML,
 * que es lo caro (el listado de un mes, más de medio segundo). La pantalla lo arma así
 * con cada cambio; el cuerpo se arma completo solo al tocar 📄 PDF o en la hoja abierta.
 * Sin la opción, el armado es el completo.
 */
export function armarPapelCop(e: EntradaPapelCop, opciones?: { conCuerpo?: boolean }): PapelArmadoCop {
  const { papel, op, rango } = e;
  const conCuerpo = opciones?.conCuerpo !== false;
  const titulo = tituloCop(papel, op);
  // UNA sola emisión, escapada UNA vez: la escrita (`emitidaCop`) o la hora real que trae la pantalla.
  const emitida = emitidaCop(op) ?? (limpia(e.ahora) ? escaparHtml(limpia(e.ahora)) : undefined);

  if (papel === 'completo') {
    // ⭐ JORNADAS ENTERAS (7am a 7am): la hora de corte de los otros papeles no lo toca, ni
    //    en el subtítulo ni en lo que cuenta; los filtros tampoco (`filtrosDelPapel` → nada).
    const jornadas: RangoCop = { desde: rango.desde, hasta: rango.hasta, corteHora: null };
    const d = e.completo?.datos;
    const datos: DatosDelCompleto = { reportes: d?.reportes ?? [], movimientos: d?.movimientos ?? [], anteriores: d?.anteriores ?? [], unidades: d?.unidades ?? [], listas: d?.listas ?? [] };
    const modelo = modeloReporteCompleto({
      ...datos, sitio: e.sitio, desde: jornadas.desde, hasta: jornadas.hasta, hoy: e.completo?.hoy ?? '',
      inspeccion: e.completo?.inspeccion ?? null, emitidoMs: e.completo?.emitidoMs ?? null,
    });
    return {
      titulo, subtitulo: subtituloCop(papel, e.sitio, jornadas, op), emitida,
      renglones: filtrarMovimientos(datos.movimientos, jornadas).length,
      hojas: 1, porUnidad: [], nombresHojas: [], resumen: null, completo: modelo,
      // Solo las secciones del papel (`ocultosSecciones`): lo apagado no deja rastro.
      cuerpo: conCuerpo ? cuerpoReporteCompleto(modelo, op) : '',
    };
  }

  const unidadDe = unidadDeLosRenglones(e.base);
  const movs = filtrarMovimientos(e.base, rango, filtrosDelPapel(papel, e.filtros ?? {}));
  const subtitulo = subtituloCop(papel, e.sitio, rango, op);
  // Las ventas en piezas (bloques) no son viajes: no salen en «viajes por unidad» (A4).
  const porUnidad = tablaPor(movs.filter((m) => !esVentaEnPiezas(m)), 'unidad', op.orden, unidadDe);

  if (papel === 'consolidado') {
    const m = consolidadoSitio(movs, op.orden);
    return {
      titulo, subtitulo, emitida, renglones: movs.length, hojas: 1, porUnidad, nombresHojas: [], completo: null,
      // Lo que el filtro de tipo deja fuera por completo no deja rastro (B6).
      cuerpo: conCuerpo ? cuerpoConsolidado(m, opDelCuerpo(papel, op, e.filtros), e.edicion, { sitio: e.sitio, corte: corteCop(rango) }) : '',
      resumen: resumenConsolidado(m, op),
    };
  }

  if (papel === 'corte') {
    const hojas = e.unidadesCorte ?? [];
    const modelos = hojas.map((u) => cortePorUnidad(movs, rango, u.clave,
      { columnasPorDestino: op.columnasPorDestino, diasSinAnotacion: op.diasSinAnotacion, unidadDe }, u.ficha));
    const ed = hojas.length > 1 && e.edicion ? { ...e.edicion, valores: {} } : e.edicion;
    const periodo = periodoCop(rango);
    return {
      titulo, subtitulo, emitida, renglones: movs.length, hojas: modelos.length, porUnidad, completo: null,
      nombresHojas: modelos.map((c) => c.unidad),
      // ⭐ Desde la 2.ª hoja, título y emisión (la 1.ª los tiene en el membrete): cada hoja
      //    se puede entregar suelta a su dueño (auditoría del lote 4, A1).
      cuerpo: conCuerpo ? modelos.map((c, i) => cuerpoCorte(c, op, ed, periodo, i > 0 ? { titulo, emitida } : undefined)).join('') : '',
      resumen: modelos.length ? resumenCorte(modelos[0]) : null,
    };
  }

  return {
    titulo, subtitulo, emitida, renglones: movs.length, hojas: 1, porUnidad, nombresHojas: [], completo: null,
    cuerpo: conCuerpo ? cuerpoListado(movs, op, unidadDe) : '',
    resumen: null,
  };
}

/**
 * Lo que la PANTALLA dice del Reporte completo antes de bajarlo: sus secciones VISIBLES,
 * numeradas como en el papel (lo apagado no cuenta), y cuáles saldrán «Sin registros en
 * el período». Sin modelo (todavía cargando), ninguna.
 */
export function seccionesEnPantalla(m: ModeloReporteCompleto | null | undefined, op: Pick<OpcionesPapelCop, 'ocultosSecciones'>): { k: string; n: number; etiqueta: string; vacia: boolean }[] {
  if (!m) return [];
  const ocultas = new Set(op.ocultosSecciones ?? []);
  return SECCIONES_COP.completo
    .filter((s) => !ocultas.has(s.k))
    .map((s, i) => ({ k: s.k, n: i + 1, etiqueta: s.etiqueta, vacia: !!m[s.k as SeccionCompleto]?.vacio }));
}

/**
 * La CLAVE de lo que mueve el modelo de la pantalla (A2 = B4): el orden, las columnas
 * del corte, los días vacíos y las columnas apagadas (el resumen las sigue). Los
 * textos, los logos, la emisión, las secciones y la edición del resumen NO mueven el
 * modelo (solo el cuerpo HTML): con esta clave, teclear un título no lo rearma.
 */
export function claveDelModelo(op: OpcionesPapelCop): string {
  return JSON.stringify([op.orden, op.columnasPorDestino, op.diasSinAnotacion, [...(op.ocultosColumnas ?? [])].sort()]);
}

// ═══════════════════════════ Los interruptores (puros) ═══════════════════════════

const alternar = <T>(lista: T[] | undefined, v: T): T[] => {
  const l = lista ?? [];
  return l.includes(v) ? l.filter((x) => x !== v) : [...l, v];
};

/** Apaga o prende una sección del papel (`ocultosSecciones`). */
export function alternarSeccion(op: OpcionesPapelCop, k: string): OpcionesPapelCop {
  return { ...op, ocultosSecciones: alternar(op.ocultosSecciones, k) };
}

/** Apaga o prende una columna del papel (`ocultosColumnas`). */
export function alternarColumna(op: OpcionesPapelCop, k: ColumnaCop): OpcionesPapelCop {
  return { ...op, ocultosColumnas: alternar(op.ocultosColumnas, k) };
}

// ═══════════════════════════ El editor del resumen (contrato EdicionResumen) ═══════════════════════════

/** Esconde o muestra una tarjeta por su clave estable. */
export function alternarOcultoResumen(ed: EdicionResumen, k: string): EdicionResumen {
  return { ...ed, ocultos: alternar(ed.ocultos, k) };
}

/** Escribe el título, el valor o la nota de una tarjeta. En blanco = el automático. */
export function escribirEnResumen(ed: EdicionResumen, campo: 'titulos' | 'valores' | 'notas', k: string, v: string): EdicionResumen {
  return { ...ed, [campo]: { ...(ed[campo] ?? {}), [k]: v } };
}

/** Agrega una tarjeta propia en blanco (hasta `MAX_TARJETAS_PROPIAS_COP`). */
export function agregarTarjetaPropia(ed: EdicionResumen): EdicionResumen {
  const l = ed.propias ?? [];
  if (l.length >= MAX_TARJETAS_PROPIAS_COP) return ed;
  return { ...ed, propias: [...l, { titulo: '', valor: '', nota: '' }] };
}

export function cambiarTarjetaPropia(ed: EdicionResumen, i: number, campo: keyof TarjetaPropia, v: string): EdicionResumen {
  return { ...ed, propias: (ed.propias ?? []).map((x, j) => (j === i ? { ...x, [campo]: v } : x)) };
}

export function quitarTarjetaPropia(ed: EdicionResumen, i: number): EdicionResumen {
  return { ...ed, propias: (ed.propias ?? []).filter((_, j) => j !== i) };
}
