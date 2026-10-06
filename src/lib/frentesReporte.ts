// ⛏️ EL PAPEL DE LOS FRENTES DEL DÍA (29-sep-2026).
//
// Pedido del cliente: «agrégame un reporte para los frentes, un PDF que me dé
// los frentes registrados para ese día» — y, explícito: «ese reporte no es
// necesario que tenga toneladas, ni nada de eso».
//
// ⭐ POR ESO ACÁ NO HAY UNA SOLA CIFRA DE OPERACIÓN: ni viajes, ni peso, ni m³.
//    Es la HOJA DE ASIGNACIÓN del día: qué camión recoge en qué frente. Quien
//    quiera cantidades tiene el reporte de la Lista completa, que agrupa por
//    frente.
//
// SEGUNDA VUELTA (29-sep-2026, mismo día): «falta que pueda quitar o colocar
// información con los checks, además de quitar y colocar los logos» y «me deben
// salir SOLO los frentes para ese día asignados». Las dos cosas viven acá:
//   · `OpcionesFrentes` — qué columnas y qué líneas lleva el papel.
//   · `LOGOS_FRENTES_POR_DEFECTO` — este reporte nace SIN membrete de logos.
//   · `sinCamiones: false` — los frentes que ese día no tienen camión NO salen.
//
// ⭐ Y LO QUE SE APAGA NO DEJA RASTRO (corregido el 29-sep-2026, a pedido: «si
//    activo o desactivo un check, no me salga esa información en el PDF»). El
//    papel sale como si ese dato no existiera: ni columna vacía, ni «(oculto)»,
//    ni una nota en el subtítulo.
//
// TODO ESTE ARCHIVO ES PURO: no toca Supabase ni React, así que
// `scripts/test-frentes-reporte.mjs` lo prueba solo.

/** Un camión asignado, tal como se imprime. */
export type CamionDelFrente = {
  code: string;
  /** Placa o serial: lo que identifica al camión en el patio. */
  placa?: string | null;
  empresa?: string | null;
  /** Marca y modelo ya juntos («VOLVO FM 440»). Columna opcional. */
  marcaModelo?: string | null;
  // ── Columnas del 03-oct-2026 (a pedido: «faltan las opciones» de la Lista
  //    completa). Todas opcionales y todas APAGADAS de entrada. ──
  /** Alto × largo × ancho ya escrito («2,40 × 6,00 × 2,50 m»). */
  medidas?: string | null;
  /** Clasificación por capacidad («🔸 Media capacidad») o la de la ficha. */
  clasificacion?: string | null;
  /** Obra / ubicación: dónde registró viajes ese día, o la ubicación de la ficha. */
  obra?: string | null;
  /** Chofer (camiones) u operador (máquinas) de ese día. */
  chofer?: string | null;
  /** «Día», «Noche» o «Día y noche». */
  turno?: string | null;
  /** Estado de la máquina ese día. */
  estado?: string | null;
  /** Viajes de ese día (solo camiones). Solo lo usa el resumen ejecutivo. */
  viajes?: number | null;
  /** Clave para no contar dos veces un equipo que está en dos frentes. */
  id?: string | null;
};

export type FrenteDelDia = {
  nombre: string;
  camiones: CamionDelFrente[];
};

/**
 * 🖨️ QUÉ SALE EN LA HOJA DE FRENTES (29-sep-2026, a pedido).
 *
 * Mismo criterio que los demás reportes del sistema: el usuario decide qué
 * columnas y qué líneas lleva el papel. Y lo que se apaga NO DEJA RASTRO: la
 * hoja se imprime como si ese dato no existiera — ni celda vacía, ni nota en el
 * subtítulo (pedido del 29-sep-2026).
 */
export type OpcionesFrentes = {
  /** Columna «Nº» (el orden dentro del frente). */
  numeracion: boolean;
  /** Columna «Placa / Serial». */
  placa: boolean;
  /** Columna «Empresa». */
  empresa: boolean;
  /** Columna «Marca / Modelo» (nace apagada: es dato de taller, no de patio). */
  marcaModelo: boolean;
  /** El «N camión(es)» a la derecha del nombre del frente. */
  contador: boolean;
  /** La línea de totales de arriba («12 camión(es) · 3 de 5 frente(s)…»). */
  totales: boolean;
  /**
   * ⭐ APAGADA A PEDIDO: «me deben salir SOLO los frentes para ese día
   * asignados». Encendida vuelve a listar los frentes activos que ese día no
   * tienen ningún camión, que es útil para ver qué quedó sin asignar.
   */
  sinCamiones: boolean;
  /**
   * 🏢 UNA SOLA EMPRESA PARA TODOS (03-oct-2026, a pedido: «que todas las
   * máquinas salgan para Golden Touch, como si todas fueran de Golden, o que yo
   * pueda elegir el nombre de la empresa que va a salir toda la maquinaria»).
   * Con texto, la columna «Empresa» lleva ESE nombre en cada fila, sea de quien
   * sea el equipo. Vacío = cada uno con la suya. Solo pinta: no cambia nada en
   * el catálogo. Sin la columna de empresa no se usa.
   */
  empresaUnica?: string;
  // ── 03-oct-2026: las opciones de la Lista completa, en esta hoja. ──
  /** Columna «Alto × largo × ancho». */
  medidas?: boolean;
  /** Columna «Clasificación». */
  clasificacion?: boolean;
  /** Columna «Obra / ubicación». */
  obra?: boolean;
  /** Columna «Frente» en cada fila (además del título del bloque). */
  frente?: boolean;
  /** Columna «Chofer» / «Operador». */
  chofer?: boolean;
  /** Columna «Turno». */
  turno?: boolean;
  /** Columna «Estado». */
  estado?: boolean;
  /** 📊 El resumen ejecutivo: el tablero de arriba. */
  resumen?: boolean;
  /**
   * ⭐ QUÉ FRENTES SALEN (06-oct-2026, a pedido: «hace falta la opción de poder
   * sacar el reporte por uno o varios frentes que yo seleccione o que quiera que
   * salgan en el reporte»).
   *
   * Los NOMBRES de los frentes elegidos. VACÍO O SIN PONER = TODOS, que es como
   * salía la hoja hasta ahora: encender esta opción no puede cambiarle el papel
   * a quien no la toca.
   *
   * ⚠️ DÓNDE SE DICE QUE VA FILTRADO: en el NOMBRE DEL ARCHIVO, no en el papel.
   *    Es la misma regla que el cliente pidió el 29-sep para los checks («si
   *    activo o desactivo un check, no me salga esa información en el PDF») y el
   *    mismo remate que ya usa el inventario: la hoja se lee limpia, y lo único
   *    que dice que está recortada es cómo se llama el archivo. Así dos hojas
   *    del mismo día —una completa y otra de dos frentes— no se pisan en la
   *    carpeta de descargas ni se confunden al abrirlas.
   *    (En el cuerpo se ve igual QUÉ frentes salieron: cada bloque va titulado
   *    con su nombre. Lo que no se ve es cuáles se dejaron fuera.)
   */
  soloFrentes?: string[];
};

export const FRENTES_POR_DEFECTO: OpcionesFrentes = {
  numeracion: true,
  placa: true,
  empresa: true,
  marcaModelo: false,
  contador: true,
  totales: true,
  sinCamiones: false,
  empresaUnica: '',
  // Lo nuevo entra apagado: la hoja sale igual que ayer hasta que se encienda algo.
  medidas: false,
  clasificacion: false,
  obra: false,
  frente: false,
  chofer: false,
  turno: false,
  estado: false,
  resumen: false,
  // Vacío = TODOS los frentes, que es como salía la hoja antes de que esto existiera.
  soloFrentes: [],
};

/** Un frente se reconoce por su nombre, sin distinguir mayúsculas ni espacios
 *  de sobra: lo que se elige en pantalla y lo que trae la asignación es el mismo
 *  texto, pero escrito por manos distintas en momentos distintos. */
export function claveFrente(nombre: unknown): string {
  return String(nombre ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Los frentes elegidos, listos para preguntar. Vacío = no hay filtro. */
export function frentesElegidos(op: OpcionesFrentes | null | undefined): Set<string> {
  const s = new Set<string>();
  (op?.soloFrentes ?? []).forEach((n) => { const k = claveFrente(n); if (k) s.add(k); });
  return s;
}

/** ¿Hace falta leer los datos DEL DÍA (viajes o jornadas) para este papel? Sin
 *  ninguna de estas encendida, la hoja no consulta nada más que la asignación. */
export function necesitaDatosDelDia(op: OpcionesFrentes): boolean {
  return !!(op.obra || op.chofer || op.turno || op.estado || op.resumen);
}

/** El nombre que se ofrece de entrada al encender la empresa única. */
export const EMPRESA_UNICA_SUGERIDA = 'Golden Touch';

/** La empresa que se imprime para un equipo: la única si está puesta; si no, la suya. */
export function empresaImpresa(c: { empresa?: string | null }, op: Pick<OpcionesFrentes, 'empresaUnica'>): string {
  const unica = String(op.empresaUnica ?? '').replace(/\s+/g, ' ').trim();
  return unica || String(c.empresa ?? '').trim() || '—';
}

/**
 * 🏷️ LOS LOGOS DEL MEMBRETE.
 *
 * ⭐ ESTE REPORTE NACE SIN NINGUNO, y sin la marca en texto del pie: el cliente
 *    pidió quitar «Banco Central de Venezuela / SOS La Guaira» de esta hoja
 *    («guarda en memoria que ya no va»). Los interruptores quedan para poder
 *    ponerle el que haga falta; no se borró nada del código.
 */
export type LogosFrentes = { bcv: boolean; sos: boolean; golden: boolean; renace: boolean; jhenzaen: boolean };
export const LOGOS_FRENTES_POR_DEFECTO: LogosFrentes = {
  bcv: false, sos: false, golden: false, renace: false, jhenzaen: false,
};

/**
 * Agrupa las asignaciones de un día por frente, en el orden en que se imprimen:
 * los frentes alfabéticamente y, dentro, los camiones por su código.
 *
 * `frentesActivos` son los frentes que hay que listar AUNQUE no tengan camiones
 * ese día. Normalmente va vacío (ver `frentesParaReporte`).
 */
export function frentesDelDia(
  asignaciones: { frenteNombre: string; camion: CamionDelFrente }[],
  frentesActivos: string[] = [],
): FrenteDelDia[] {
  const cmp = (a: string, b: string) => a.localeCompare(b, 'es', { sensitivity: 'base', numeric: true });
  const m = new Map<string, CamionDelFrente[]>();
  frentesActivos.forEach((f) => { const n = String(f ?? '').trim(); if (n) m.set(n, []); });
  (asignaciones ?? []).forEach((a) => {
    const n = String(a?.frenteNombre ?? '').trim() || 'Sin frente';
    const lista = m.get(n) ?? [];
    lista.push(a.camion);
    m.set(n, lista);
  });
  return Array.from(m, ([nombre, camiones]) => ({
    nombre,
    camiones: camiones.slice().sort((x, y) => cmp(x.code, y.code) || cmp(String(x.placa ?? ''), String(y.placa ?? ''))),
  })).sort((a, b) => cmp(a.nombre, b.nombre));
}

/**
 * ⭐ LO QUE DE VERDAD SALE EN EL PAPEL: solo los frentes ASIGNADOS ese día,
 *    salvo que se encienda `sinCamiones`. Es una función aparte para que la
 *    regla —la que el cliente pidió— se pueda probar sin abrir la pantalla.
 *
 * ⭐ Y SOLO LOS FRENTES ELEGIDOS, si se eligió alguno (06-oct-2026). El filtro
 *    se aplica ACÁ, en el único sitio por donde pasan la prevista del tablero y
 *    el PDF: si cada uno filtrara por su cuenta, la pantalla enseñaría un
 *    resumen de ocho frentes y el papel saldría con dos.
 *
 * ⚠️ El filtro tapa TAMBIÉN los frentes vacíos de `sinCamiones`: si pides «solo
 *    Frente norte», encender «incluir los frentes sin camiones» no puede colarte
 *    los otros siete en blanco.
 */
export function frentesParaReporte(
  asignaciones: { frenteNombre: string; camion: CamionDelFrente }[],
  frentesActivos: string[],
  op: OpcionesFrentes = FRENTES_POR_DEFECTO,
): FrenteDelDia[] {
  const solo = frentesElegidos(op);
  const pasa = (n: unknown) => solo.size === 0 || solo.has(claveFrente(n) || claveFrente('Sin frente'));
  const asigs = solo.size === 0
    ? asignaciones
    : (asignaciones ?? []).filter((a) => pasa(String(a?.frenteNombre ?? '').trim() || 'Sin frente'));
  const vacios = op.sinCamiones ? (frentesActivos ?? []).filter(pasa) : [];
  return frentesDelDia(asigs, vacios);
}

/**
 * Cómo se dice en el papel que la hoja va filtrada. `null` cuando salen todos
 * —y entonces el subtítulo no cambia ni una letra respecto de antes—.
 *
 * `disponibles` es cuántos frentes había para elegir, para poder decir «2 de 8»:
 * sin ese total, «solo 2 frentes» no distingue un día filtrado de un día que
 * solo tuvo dos.
 */
export function alcanceFrentesEnPalabras(
  op: OpcionesFrentes | null | undefined,
  disponibles: number,
  elegidosNombres?: string[],
): string | null {
  const solo = frentesElegidos(op);
  if (solo.size === 0) return null;
  const nombres = (elegidosNombres ?? op?.soloFrentes ?? [])
    .map((n) => String(n ?? '').replace(/\s+/g, ' ').trim()).filter(Boolean);
  const cuantos = solo.size;
  const deTotal = disponibles > 0 && disponibles !== cuantos ? ` de ${disponibles}` : '';
  // Con pocos se nombran: es lo que de verdad responde «¿cuáles salieron?».
  // Con muchos, la lista taparía el subtítulo y ya están todos en el cuerpo.
  const lista = nombres.length > 0 && nombres.length <= 4 ? `: ${nombres.join(' · ')}` : '';
  return `solo ${cuantos}${deTotal} frente${cuantos === 1 ? '' : 's'}${lista}`;
}

export type TotalesFrentes = { frentes: number; frentesConCamiones: number; camiones: number };

export function totalesFrentes(grupos: FrenteDelDia[]): TotalesFrentes {
  return {
    frentes: grupos.length,
    frentesConCamiones: grupos.filter((g) => g.camiones.length > 0).length,
    camiones: grupos.reduce((a, g) => a + g.camiones.length, 0),
  };
}

// ⛔ ACÁ HUBO UNA `etiquetaOpcionesFrentes` QUE ESCRIBÍA EN EL SUBTÍTULO LO QUE
//    SE HABÍA APAGADO («… · sin placa, empresa, numeración»). SE QUITÓ el
//    29-sep-2026 a pedido del cliente: «que no salga esa información, y guarda
//    en memoria que si activo o desactivo un check, no me salga esa información
//    en el PDF».
//
//    Es la regla de la casa desde el 25-sep-2026 y va para TODOS los reportes:
//    lo oculto NO aparece en NINGUNA parte del papel — ni columna en blanco, ni
//    «(oculto)», ni en el título o el subtítulo. El papel se imprime como si ese
//    dato no existiera. NO volver a agregarla (hay un candado en
//    `scripts/test-frentes-reporte.mjs` que lo impide).

const esc = (v: unknown): string =>
  String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const CSS_FRENTES = `
  .fr-tot{margin:2px 0 12px;font-size:13px;font-weight:800;color:#16324F}
  .fr-g{margin:0 0 12px;page-break-inside:avoid}
  .fr-h{font-size:13px;font-weight:800;color:#16324F;border-bottom:2px solid #16324F;
    padding-bottom:2px;margin:0 0 4px}
  .fr-h span{float:right;font-weight:700;color:#5B6B80;font-size:11px}
  table{width:100%;border-collapse:collapse;font-size:11px}
  th,td{border:1px solid #c9d2dc;padding:4px 7px;text-align:left}
  th{background:#16324F;color:#fff}
  tr:nth-child(even) td{background:#f4f7fb}
  .fr-vacio{font-size:11px;color:#7A8797;font-style:italic;padding:3px 0}
  .fr-tj{display:flex;flex-wrap:wrap;gap:8px;margin:4px 0 8px}
  .fr-tj div{flex:1 1 110px;border:1px solid #c9d2dc;border-radius:6px;padding:6px 9px}
  .fr-tj span{display:block;font-size:9px;color:#5B6B80;text-transform:uppercase;letter-spacing:.04em}
  .fr-tj b{display:block;font-size:16px;color:#16324F}
  .fr-tj small{font-size:9px;color:#7A8797}
  .fr-cq{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 14px}
  .fr-q{flex:1 1 150px;border:1px solid #c9d2dc;border-radius:6px;padding:6px 9px;page-break-inside:avoid}
  .fr-qt{font-size:10px;font-weight:800;color:#16324F;border-bottom:1px solid #c9d2dc;margin-bottom:3px;padding-bottom:2px}
  .fr-q p{display:flex;justify-content:space-between;gap:8px;font-size:10px;margin:1px 0}
  .fr-q i{font-style:normal;color:#333}`;

/**
 * El cuerpo del PDF: un bloque por frente con la lista de sus camiones.
 * Sin una sola cantidad de operación, a propósito (ver la cabecera).
 */
/** Cómo se llama el equipo en el papel. Para viajes, «camión»; para la hoja de
 *  frentes de maquinaria (02-oct-2026), «equipo». */
export type EtiquetaEquipo = { columna: string; singular: string; plural: string; unidad: string; chofer?: string };
export const ETIQUETA_CAMION: EtiquetaEquipo = { columna: 'Camión', singular: 'camión', plural: 'camiones', unidad: 'camión(es)', chofer: 'Chofer' };
export const ETIQUETA_EQUIPO: EtiquetaEquipo = { columna: 'Equipo', singular: 'equipo', plural: 'equipos', unidad: 'equipo(s)', chofer: 'Operador' };

// ── 📊 EL RESUMEN EJECUTIVO (03-oct-2026, a pedido: «resumen ejecutivo completo
//    de las máquinas o viajes, un dashboard informativo») ──────────────────────

/** `k` es la CLAVE ESTABLE de la tarjeta: con ella se la oculta, se le cambia el
 *  título o el valor, y se la reconoce aunque el papel se saque otro día. */
export type TarjetaFrentes = { k: string; titulo: string; valor: string; nota?: string };
export type CuadroFrentes = { k: string; titulo: string; filas: { clave: string; n: number }[] };
export type ResumenFrentes = { tarjetas: TarjetaFrentes[]; cuadros: CuadroFrentes[] };

// ── ✏️ EL TABLERO EDITABLE (03-oct-2026, a pedido: «que el resumen ejecutivo de
//    ese reporte sea editable») ─────────────────────────────────────────────────
//
// ⭐ EDITAR ES DEL PAPEL, NO DE LOS DATOS: nada de esto cambia una asignación, un
//    viaje ni una ficha. Y lo que se deja en blanco vuelve al automático, igual
//    que el operador escrito a mano: así una casilla vacía nunca borra un dato.

/** Una tarjeta escrita por el usuario, de cero. */
export type TarjetaPropia = { titulo: string; valor: string; nota?: string };

/**
 * 🔢 CÓMO SE ORDENA EL CUADRO «… por frente» (05-oct-2026, a pedido: «que se
 * organicen en vez de por cantidad, por el número de la ubicación»). Los
 * frentes llevan su número en el nombre («3) RESIDENCIAS…», «08) COSTA BRAVA»).
 */
export type OrdenFrentes = 'cantidad' | 'numero';

/** El número con el que empieza el nombre de un frente («08) COSTA BRAVA» → 8,
 *  «1 ) RESIDENCIAS» → 1). Sin número = al final (Infinity), y entre esos,
 *  alfabético. Así ordenar por número nunca pierde un frente. */
export function numeroDeFrente(nombre: unknown): number {
  const m = String(nombre ?? '').match(/^\s*(\d+)/);
  return m ? parseInt(m[1], 10) : Number.POSITIVE_INFINITY;
}

export type EdicionResumen = {
  /** Claves de tarjetas y cuadros que NO salen (lo oculto no deja rastro). */
  ocultos?: string[];
  /** clave → otro título. En blanco = el de siempre. */
  titulos?: Record<string, string>;
  /** clave → otro valor, escrito a mano. En blanco = el calculado. */
  valores?: Record<string, string>;
  /** clave → otra nota (la línea chica). En blanco = la automática. */
  notas?: Record<string, string>;
  /** Tarjetas propias, al final y en su orden. */
  propias?: TarjetaPropia[];
  /** 🔢 Orden del cuadro «… por frente»: por cantidad (de siempre) o por el
   *  número del frente. En blanco = cantidad. */
  ordenFrentes?: OrdenFrentes;
};

export const EDICION_RESUMEN_VACIA: EdicionResumen = {};

/**
 * ⚠️ AL CAMBIAR DE DÍA SE BORRAN LAS CIFRAS ESCRITAS A MANO (03-oct-2026).
 *
 * El título de una tarjeta, su nota y lo que se decidió esconder son FORMA del
 * papel y valen para cualquier día. Pero un VALOR escrito a mano —y una tarjeta
 * propia— son la cifra DE ESE DÍA: si sobrevivieran al cambiar la fecha, el papel
 * de hoy saldría con el número de ayer y nadie lo notaría. Eso es exactamente
 * mentir en un papel que puede ir a pago, así que se limpian.
 */
export function edicionAlCambiarDeDia(ed: EdicionResumen | null | undefined): EdicionResumen {
  return { ocultos: ed?.ocultos ?? [], titulos: ed?.titulos ?? {}, notas: ed?.notas ?? {}, ordenFrentes: ed?.ordenFrentes };
}

const limpioTxt = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();

/** ¿Se le cambió algo al tablero? Para avisarlo en la pantalla. */
export function resumenEditado(ed: EdicionResumen | null | undefined): boolean {
  if (!ed) return false;
  const algo = (r?: Record<string, string>) => Object.values(r ?? {}).some((v) => limpioTxt(v) !== '');
  return (ed.ocultos ?? []).length > 0 || algo(ed.titulos) || algo(ed.valores) || algo(ed.notas)
    || (ed.propias ?? []).some((x) => limpioTxt(x.titulo) !== '' || limpioTxt(x.valor) !== '');
}

/** Cuántos cambios lleva, para decirlo en una línea. */
export function cuentaEdicionResumen(ed: EdicionResumen | null | undefined): { ocultos: number; cambiados: number; propias: number } {
  const claves = new Set<string>();
  [ed?.titulos, ed?.valores, ed?.notas].forEach((r) => Object.entries(r ?? {}).forEach(([k, v]) => { if (limpioTxt(v) !== '') claves.add(k); }));
  return {
    ocultos: (ed?.ocultos ?? []).length,
    cambiados: claves.size,
    propias: (ed?.propias ?? []).filter((x) => limpioTxt(x.titulo) !== '' || limpioTxt(x.valor) !== '').length,
  };
}

/**
 * Aplica la edición al tablero calculado. ⭐ No recalcula nada: solo esconde,
 * renombra, reemplaza el texto que se ve y agrega las tarjetas propias.
 */
export function aplicarEdicionResumen(r: ResumenFrentes, ed: EdicionResumen | null | undefined): ResumenFrentes {
  const ocultos = new Set((ed?.ocultos ?? []).map((k) => String(k)));
  const texto = (mapa: Record<string, string> | undefined, k: string) => limpioTxt(mapa?.[k]);
  const tarjetas = r.tarjetas.filter((x) => !ocultos.has(x.k)).map((x) => {
    const nota = texto(ed?.notas, x.k);
    return {
      k: x.k,
      titulo: texto(ed?.titulos, x.k) || x.titulo,
      valor: texto(ed?.valores, x.k) || x.valor,
      nota: nota || x.nota,
    };
  });
  // Las propias van al final, con su clave propia para que no choquen con las de casa.
  (ed?.propias ?? []).forEach((x, i) => {
    const titulo = limpioTxt(x.titulo);
    const valor = limpioTxt(x.valor);
    // Una tarjeta sin título Y sin valor es una casilla que el usuario dejó vacía.
    if (!titulo && !valor) return;
    tarjetas.push({ k: `propia${i + 1}`, titulo: titulo || 'Dato', valor: valor || '—', nota: limpioTxt(x.nota) || undefined });
  });
  // Los cuadros también se renombran; valor y nota no les aplican (son listas).
  const cuadros = r.cuadros.filter((q) => !ocultos.has(q.k)).map((q) => ({ ...q, titulo: texto(ed?.titulos, q.k) || q.titulo }));
  return { tarjetas, cuadros };
}

/**
 * El tablero de arriba. Cuenta EQUIPOS, no filas: uno que está en dos frentes
 * es un equipo. ⭐ Cada cuadro sigue a su interruptor: con la columna apagada,
 * su cuadro tampoco sale (lo oculto no deja rastro).
 */
export function resumenFrentes(grupos: FrenteDelDia[], op: OpcionesFrentes = FRENTES_POR_DEFECTO, e: EtiquetaEquipo = ETIQUETA_CAMION, orden: OrdenFrentes = 'cantidad'): ResumenFrentes {
  const unicos = new Map<string, CamionDelFrente>();
  let filas = 0;
  grupos.forEach((g) => g.camiones.forEach((c) => {
    filas += 1;
    const k = String(c.id ?? '') || `${c.code}|${c.placa ?? ''}`;
    if (!unicos.has(k)) unicos.set(k, c);
  }));
  const equipos = Array.from(unicos.values());
  const conEquipos = grupos.filter((g) => g.camiones.length > 0);
  const contar = (de: (c: CamionDelFrente) => string): { clave: string; n: number }[] => {
    const m = new Map<string, number>();
    equipos.forEach((c) => { const k = de(c) || '—'; m.set(k, (m.get(k) ?? 0) + 1); });
    return Array.from(m, ([clave, n]) => ({ clave, n })).sort((a, b) => b.n - a.n || a.clave.localeCompare(b.clave, 'es', { numeric: true }));
  };
  const limpio = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
  const mayor = conEquipos.slice().sort((a, b) => b.camiones.length - a.camiones.length)[0];
  const tarjetas: TarjetaFrentes[] = [
    { k: 'equipos', titulo: `${e.plural[0].toUpperCase()}${e.plural.slice(1)} asignados`, valor: String(equipos.length), nota: filas > equipos.length ? `${filas} asignaciones (hay ${e.plural} en más de un frente)` : undefined },
    { k: 'frentes', titulo: 'Frentes en uso', valor: String(conEquipos.length), nota: grupos.length > conEquipos.length ? `de ${grupos.length} listados` : undefined },
    { k: 'promedio', titulo: 'Promedio por frente', valor: conEquipos.length ? (filas / conEquipos.length).toFixed(1).replace('.', ',') : '0' },
  ];
  if (mayor) tarjetas.push({ k: 'mayor', titulo: 'Frente con más carga', valor: mayor.nombre, nota: `${mayor.camiones.length} ${e.unidad}` });
  if (op.empresa) tarjetas.push({ k: 'empresas', titulo: 'Empresas', valor: String(new Set(equipos.map((c) => empresaImpresa(c, op))).size) });
  const viajes = equipos.reduce((a, c) => a + (Number(c.viajes) || 0), 0);
  const conViajes = equipos.filter((c) => (Number(c.viajes) || 0) > 0).length;
  if (equipos.some((c) => c.viajes != null)) {
    tarjetas.push({ k: 'viajes', titulo: 'Viajes del día', valor: String(viajes), nota: `${conViajes} de ${equipos.length} ${e.plural} con viajes` });
  }

  // El cuadro «por frente» se ordena por CANTIDAD (de siempre) o por el NÚMERO
  // del frente, según lo pedido. Los otros cuadros no tienen número, así que
  // siguen por cantidad.
  const filasFrente = conEquipos.map((g) => ({ clave: g.nombre, n: g.camiones.length })).sort((a, b) =>
    orden === 'numero'
      ? (numeroDeFrente(a.clave) - numeroDeFrente(b.clave)) || a.clave.localeCompare(b.clave, 'es', { numeric: true })
      : (b.n - a.n) || a.clave.localeCompare(b.clave, 'es', { numeric: true }));
  const cuadros: CuadroFrentes[] = [
    { k: 'porFrente', titulo: `${e.unidad[0].toUpperCase()}${e.unidad.slice(1)} por frente`, filas: filasFrente },
    { k: 'porTipo', titulo: 'Por tipo de equipo', filas: contar((c) => limpio(c.code)) },
  ];
  if (op.empresa) cuadros.push({ k: 'porEmpresa', titulo: 'Por empresa', filas: contar((c) => empresaImpresa(c, op)) });
  if (op.estado) cuadros.push({ k: 'porEstado', titulo: 'Por estado', filas: contar((c) => limpio(c.estado) || 'Sin dato') });
  if (op.clasificacion) cuadros.push({ k: 'porClasificacion', titulo: 'Por clasificación', filas: contar((c) => limpio(c.clasificacion) || 'Sin clasificar') });
  if (op.turno) cuadros.push({ k: 'porTurno', titulo: 'Por turno', filas: contar((c) => limpio(c.turno) || 'Sin dato') });
  if (op.obra) cuadros.push({ k: 'porObra', titulo: 'Por obra / ubicación', filas: contar((c) => limpio(c.obra) || 'Sin dato') });
  return { tarjetas, cuadros: cuadros.filter((q) => q.filas.length > 0) };
}

function htmlResumenFrentes(r: ResumenFrentes): string {
  // Sin tarjetas o sin cuadros, su fila no se escribe: un <div> vacío deja un
  // hueco en el papel y parece que algo no cargó.
  const tj = r.tarjetas.length === 0 ? '' : `<div class="fr-tj">${r.tarjetas.map((x) => `<div><span>${esc(x.titulo)}</span><b>${esc(x.valor)}</b>${x.nota ? `<small>${esc(x.nota)}</small>` : ''}</div>`).join('')}</div>`;
  const cq = r.cuadros.length === 0 ? '' : `<div class="fr-cq">${r.cuadros.map((q) => `<div class="fr-q"><div class="fr-qt">${esc(q.titulo)}</div>${q.filas.map((f) => `<p><i>${esc(f.clave)}</i><b>${f.n}</b></p>`).join('')}</div>`).join('')}</div>`;
  return tj + cq;
}

export function cuerpoFrentesDelDia(
  grupos: FrenteDelDia[], op: OpcionesFrentes = FRENTES_POR_DEFECTO, e: EtiquetaEquipo = ETIQUETA_CAMION,
  /** ✏️ Lo que el usuario le cambió al tablero (03-oct-2026). Sin esto, el tablero
   *  sale tal como lo calcula resumenFrentes(). */
  ed?: EdicionResumen | null,
): string {
  const t = totalesFrentes(grupos);
  if (t.frentes === 0) {
    return `<p class="fr-vacio">Ese día no hay ningún ${e.singular} asignado a un frente.</p>`;
  }
  const tablero = op.resumen ? htmlResumenFrentes(aplicarEdicionResumen(resumenFrentes(grupos, op, e, ed?.ordenFrentes ?? 'cantidad'), ed)) : '';
  const cabecera = tablero + (op.totales
    ? `<p class="fr-tot">${t.camiones} ${e.unidad} asignados · ${t.frentesConCamiones} de ${t.frentes} frente(s) con ${e.plural}</p>`
    : '');
  // Las columnas del 03-oct, en el orden de la Lista completa. Cada una sale
  // SOLO si está encendida: apagada no deja ni la celda.
  type ColExtra = { on: boolean | undefined; titulo: string; de: (c: CamionDelFrente, g: FrenteDelDia) => string };
  const todas: ColExtra[] = [
    { on: op.medidas, titulo: 'Alto × largo × ancho', de: (c) => String(c.medidas ?? '').trim() || '—' },
    { on: op.clasificacion, titulo: 'Clasificación', de: (c) => String(c.clasificacion ?? '').trim() || '—' },
    { on: op.obra, titulo: 'Obra / ubicación', de: (c) => String(c.obra ?? '').trim() || '—' },
    { on: op.frente, titulo: 'Frente', de: (_c, g) => g.nombre },
    { on: op.chofer, titulo: e.chofer ?? 'Chofer', de: (c) => String(c.chofer ?? '').trim() || '—' },
    { on: op.turno, titulo: 'Turno', de: (c) => String(c.turno ?? '').trim() || '—' },
    { on: op.estado, titulo: 'Estado', de: (c) => String(c.estado ?? '').trim() || '—' },
  ];
  const extras = todas.filter((x) => x.on);
  const bloques = grupos.map((g) => {
    const filas = g.camiones.map((c, i) => `<tr>
      ${op.numeracion ? `<td>${i + 1}</td>` : ''}
      <td>${esc(c.code)}</td>
      ${op.placa ? `<td>${esc(c.placa || '—')}</td>` : ''}
      ${op.empresa ? `<td>${esc(empresaImpresa(c, op))}</td>` : ''}
      ${op.marcaModelo ? `<td>${esc(c.marcaModelo || '—')}</td>` : ''}
      ${extras.map((x) => `<td>${esc(x.de(c, g))}</td>`).join('')}
    </tr>`).join('');
    const cabeceras = `${op.numeracion ? '<th style="width:34px">Nº</th>' : ''}<th>${e.columna}</th>${op.placa ? '<th>Placa / Serial</th>' : ''}${op.empresa ? '<th>Empresa</th>' : ''}${op.marcaModelo ? '<th>Marca / Modelo</th>' : ''}${extras.map((x) => `<th>${x.titulo}</th>`).join('')}`;
    const tabla = g.camiones.length
      ? `<table><thead><tr>${cabeceras}</tr></thead><tbody>${filas}</tbody></table>`
      : `<p class="fr-vacio">Sin ${e.plural} asignados este día.</p>`;
    const conteo = op.contador ? `<span>${g.camiones.length} ${e.unidad}</span>` : '';
    return `<div class="fr-g"><div class="fr-h">⛏️ ${esc(g.nombre)}${conteo}</div>${tabla}</div>`;
  }).join('');
  return cabecera + bloques;
}

/**
 * «Frentes de trabajo 2026-09-29» — el nombre del archivo.
 *
 * ⭐ Con frentes elegidos, el nombre lo DICE (06-oct-2026): dos hojas del mismo
 *    día —una completa y otra de dos frentes— se pisarían en la carpeta de
 *    descargas, y la segunda se abriría creyendo que es la del día entero.
 */
export function nombreArchivoFrentes(jornadaISO: string, op?: OpcionesFrentes | null): string {
  const base = `Frentes de trabajo ${String(jornadaISO ?? '').slice(0, 10)}`;
  const nombres = (op?.soloFrentes ?? [])
    .map((n) => String(n ?? '').replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  if (nombres.length === 0) return base;
  return nombres.length <= 3
    ? `${base} - solo ${nombres.join(', ')}`
    : `${base} - solo ${nombres.length} frentes`;
}

// ── 🕘 EL HISTORIAL (29-sep-2026, a pedido: «que haya un historial de frentes
//    de trabajo ahí mismo en ese apartado») ────────────────────────────────────

/** Un día del historial: qué frentes se usaron y con cuántos camiones. */
export type DiaHistorialFrentes = {
  jornada: string;
  camiones: number;
  frentes: { nombre: string; camiones: number }[];
};

/**
 * Agrupa las asignaciones de VARIOS días por jornada, de la más reciente a la
 * más vieja (que es como se lee un historial). Dentro de cada día, los frentes
 * van del que más camiones tuvo al que menos, y a igualdad, alfabético.
 */
export function historialFrentes(
  asignaciones: { jornada: string; frenteNombre: string; machineryId?: string | null }[],
): DiaHistorialFrentes[] {
  const cmp = (a: string, b: string) => a.localeCompare(b, 'es', { sensitivity: 'base', numeric: true });
  // ⭐ SE CUENTAN CAMIONES DISTINTOS, NO FILAS (30-sep-2026). Desde que un
  //    camión puede tener VARIOS frentes el mismo día, contar filas haría que
  //    el día dijera «14 camiones» teniendo 9: uno con tres frentes sumaría
  //    tres. Dentro de cada frente igual: un camión cuenta una vez.
  //    Sin `machineryId` (datos viejos) cada fila cuenta como un camión, que es
  //    exactamente lo que valía antes.
  const dias = new Map<string, { total: Set<string>; porFrente: Map<string, Set<string>> }>();
  (asignaciones ?? []).forEach((a, i) => {
    const j = String(a?.jornada ?? '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(j)) return;
    const n = String(a?.frenteNombre ?? '').trim() || 'Sin frente';
    const cam = String(a?.machineryId ?? '').trim() || `#${i}`; // sin id, cada fila es uno
    const d = dias.get(j) ?? { total: new Set<string>(), porFrente: new Map<string, Set<string>>() };
    d.total.add(cam);
    const set = d.porFrente.get(n) ?? new Set<string>();
    set.add(cam);
    d.porFrente.set(n, set);
    dias.set(j, d);
  });
  return Array.from(dias, ([jornada, d]) => ({
    jornada,
    camiones: d.total.size,
    frentes: Array.from(d.porFrente, ([nombre, set]) => ({ nombre, camiones: set.size }))
      .sort((a, b) => b.camiones - a.camiones || cmp(a.nombre, b.nombre)),
  })).sort((a, b) => b.jornada.localeCompare(a.jornada));
}

// ── 📋 REPETIR LOS FRENTES DE OTRO DÍA (03-oct-2026, a pedido: «dame la opción
//    de repetir los frentes de días anteriores, por si quiero repetir los
//    frentes para otro día») ───────────────────────────────────────────────────

export type ParFrente = { machineryId: string; frenteId: string; frenteNombre?: string | null };

export type PlanRepetirFrentes = {
  /** Lo que hay que crear, agrupado por frente (así se reusa `asignarFrente`). */
  porFrente: { frenteId: string; machineryIds: string[] }[];
  /** Cuántas asignaciones se van a crear. */
  copiar: number;
  /** Cuántas del día viejo YA están puestas en el día destino. */
  yaEstaban: number;
  /** Equipos del día viejo que hoy no están en la lista (de baja, fuera del catálogo). */
  equiposFuera: string[];
  /** Frentes del día viejo que ya no se pueden usar (borrados o apagados), por su NOMBRE. */
  frentesFuera: string[];
  /** Equipos que quedarían con MÁS DE UN frente ese día (ver el aviso de los viajes). */
  conVariosFrentes: string[];
};

/**
 * Qué pasaría al repetir en `destino` los frentes de un día anterior. Es una
 * función PURA: no escribe nada, solo dice qué se crearía — para poder
 * enseñárselo al usuario ANTES de tocar la base.
 *
 * ⭐ COPIAR SUMA, NO PISA (misma regla que asignar desde el 30-sep-2026): lo que
 *    el día destino ya tenga se queda, y lo que ya estaba igual no se duplica.
 * ⭐ NO SE INVENTA NADA: un equipo que ya no está en la lista o un frente que ya
 *    no se puede usar NO se copian y se dicen por su nombre, en vez de fallar a
 *    medias o copiar menos de lo que el usuario cree.
 */
export function planRepetirFrentes(opts: {
  origen: ParFrente[] | null | undefined;
  destino: ParFrente[] | null | undefined;
  /** Equipos que hoy están en la lista de la pantalla. */
  equipos: Iterable<string>;
  /** Frentes que hoy se pueden usar (los activos del catálogo). */
  frentes: Iterable<string>;
}): PlanRepetirFrentes {
  const hayEquipo = new Set(Array.from(opts.equipos ?? [], (x) => String(x)));
  const hayFrente = new Set(Array.from(opts.frentes ?? [], (x) => String(x)));
  const clave = (p: ParFrente) => `${p.machineryId}|${p.frenteId}`;
  const ya = new Set((opts.destino ?? []).map(clave));
  // Lo que el día destino YA tiene, para saber quién termina con varios frentes.
  const frentesPorEquipo = new Map<string, Set<string>>();
  (opts.destino ?? []).forEach((p) => {
    const s = frentesPorEquipo.get(p.machineryId) ?? new Set<string>();
    s.add(p.frenteId);
    frentesPorEquipo.set(p.machineryId, s);
  });

  const equiposFuera = new Set<string>();
  const frentesFuera = new Map<string, string>();
  const porFrente = new Map<string, Set<string>>();
  let yaEstaban = 0;
  const vistos = new Set<string>();

  (opts.origen ?? []).forEach((p) => {
    const machineryId = String(p?.machineryId ?? '');
    const frenteId = String(p?.frenteId ?? '');
    if (!machineryId || !frenteId) return;
    const k = `${machineryId}|${frenteId}`;
    if (vistos.has(k)) return; // el mismo par repetido en el origen es uno
    vistos.add(k);
    // Primero lo que falta: así un equipo de baja se dice aunque además su
    // frente esté apagado (los dos motivos se cuentan).
    let fuera = false;
    if (!hayEquipo.has(machineryId)) { equiposFuera.add(machineryId); fuera = true; }
    if (!hayFrente.has(frenteId)) {
      frentesFuera.set(frenteId, String(p?.frenteNombre ?? '').trim() || frenteId);
      fuera = true;
    }
    if (fuera) return;
    if (ya.has(k)) { yaEstaban += 1; return; }
    const s = porFrente.get(frenteId) ?? new Set<string>();
    s.add(machineryId);
    porFrente.set(frenteId, s);
    const fe = frentesPorEquipo.get(machineryId) ?? new Set<string>();
    fe.add(frenteId);
    frentesPorEquipo.set(machineryId, fe);
  });

  const lista = Array.from(porFrente, ([frenteId, s]) => ({ frenteId, machineryIds: Array.from(s).sort() }))
    .sort((a, b) => a.frenteId.localeCompare(b.frenteId));
  const conVarios = Array.from(frentesPorEquipo).filter(([, s]) => s.size > 1).map(([id]) => id).sort();
  return {
    porFrente: lista,
    copiar: lista.reduce((a, x) => a + x.machineryIds.length, 0),
    yaEstaban,
    equiposFuera: Array.from(equiposFuera).sort(),
    frentesFuera: Array.from(frentesFuera.values()).sort((a, b) => a.localeCompare(b, 'es', { numeric: true })),
    conVariosFrentes: conVarios,
  };
}

/** Lo que el plan va a hacer, en una frase, para la confirmación. */
export function textoPlanRepetir(plan: PlanRepetirFrentes, unidad = 'camión(es)'): string {
  if (plan.copiar === 0) {
    if (plan.yaEstaban > 0) return `Ese día no agrega nada: las ${plan.yaEstaban} asignación(es) ya están puestas.`;
    return 'Ese día no tiene nada que se pueda repetir.';
  }
  const partes = [`Va a crear ${plan.copiar} asignación(es) en ${plan.porFrente.length} frente(s).`];
  if (plan.yaEstaban > 0) partes.push(`${plan.yaEstaban} ya estaban y no se repiten.`);
  if (plan.equiposFuera.length) partes.push(`${plan.equiposFuera.length} ${unidad} de ese día ya no están en la lista: no se copian.`);
  if (plan.frentesFuera.length) partes.push(`No se pueden usar estos frentes: ${plan.frentesFuera.join(', ')}.`);
  return partes.join(' ');
}
