// 🏭 CENTRO DE OPERACIONES — MAQUINARIA, BLOQUES Y KM DEL 📅 PARTE DIARIO (24-oct-2026).
//
// Las cuentas de tres bloques del Parte diario, para que las pantallas solo pinten:
//
//   · 🚜 MAQUINARIA: qué estado tiene cada unidad activa del sitio y cuántas hay en cada
//     grupo (mesa de maquinaria, 26-oct-2026): la MARCA del sitio (`cop_unidades.estado`)
//     y, en las vinculadas al catálogo, lo que dice INSPECCIÓN (lo lee la capa de datos con
//     la regla única del sistema). ⭐ La marca vive SOLO en el módulo: no toca Control ni el
//     catálogo del sistema, y los inspectores no ven nada nuevo.
//   · 🧱 BLOQUES (en la cantera): de qué material son (el «Bloques» de la lista, o el
//     material marcado con «días hasta estar disponible»), desde qué día se venden
//     (fecha + días; 7 por defecto), qué renglones entran al inventario y los avisos
//     de lo que no entra. El inventario lo calcula `inventarioBloques`
//     (`./centroOperacionesMateriales`); acá solo se le arma la entrada.
//   · 📍 KM: la sugerencia en LÍNEA RECTA del sitio al destino, dicha como tal (por
//     carretera siempre es más: ella confirma los km de verdad).
//
// TODO ESTE ARCHIVO ES PURO: sin React ni Supabase. De la capa de datos y de la librería del
// sistema (`machineLiveStatus.ts`) solo toma TIPOS: lo que dice inspección le llega ya leído.
// `scripts/test-centro-operaciones-maquinaria-bloques.mjs` lo prueba solo.
import type { EstadoUnidad, ItemLista, Movimiento, QueHechoInspeccion, Unidad } from './centroOperaciones';
import { fraseHechoInspeccion, momentoCaracas, numeroDeCampo } from './centroOperaciones';
// Solo TIPOS: esta librería no habla con la base (lo que dice inspección le llega ya leído).
import type { EstadoInspeccion, InspeccionMaquina } from './centroOperacionesDb';
import type { EstadoConteo } from './machineLiveStatus';
import type { MovBloques } from './centroOperacionesMateriales';
import { DIAS_CURADO_BLOQUES, kmLineaRecta, sumarDias } from './centroOperacionesMateriales';
import { cmpText, norm } from './text';

// ═══════════════════════════ 🚜 Maquinaria ═══════════════════════════
//
// ⭐ QUÉ ESTADO TIENE CADA UNIDAD DEL SITIO (mesa de maquinaria, 26-oct-2026). UNA sola regla,
//    `estadoDelSitio`, para el bloque 🚜 del Parte diario, su encabezado plegado, el selector
//    de unidad de las salidas y el papel:
//   · unidad DEL SITIO (sin vínculo): manda su marca (✅/🔧), «✍️ solo del sitio»;
//   · unidad VINCULADA sin marca: manda INSPECCIÓN (lo que lee `cargarEstadoInspeccion` con la
//     regla única del sistema: los 6 estados del Catálogo);
//   · vinculada CON marca: manda la marca desde que se puso (`estadoAt`, la sella la base)
//     HASTA el primer hecho de inspección posterior (`ultimoHecho`: avería real creada o
//     resuelta, jornada iniciada por una persona, o la oficina la devolvió a servicio desde el
//     Catálogo). Después vuelve a mandar inspección, sola, sin escribir nada;
//   · En espera / Retirada / Transferida: manda SIEMPRE la oficina. Una marca vieja queda «en
//     pausa» y no se puede marcar encima (`puedeMarcar` = false);
//   · inspección SIN LEER (cargando, sin señal): vinculada sin marca → ❔ Sin dato, NUNCA
//     Disponible; con marca → su marca, «sin verificar»;
//   · ya no está en el catálogo del sistema: como una del sitio (su marca, o ❔ sin dato).
// GRUPOS (excluyentes, suman las unidades activas): 🔧 Averiadas · ✅ Disponibles (las
// PARADAS van dentro, con su subconteo 🟡, como en las tarjetas del Catálogo) · ⛔ No
// disponibles (oficina), con la palabra del sistema de subconteo · ❔ Sin dato.
// «No coincide» = manda la marca del sitio y su grupo no es el de inspección.

/** Texto limpio: sin espacios a los lados y con los dobles colapsados. */
const limpia = (v: unknown): string => String(v ?? '').replace(/\s+/g, ' ').trim();
/** La frase con su punto final, sin repetirlo («… a. m.» ya lo trae). */
const conPunto = (t: string): string => (/[.!?]$/.test(t) ? t : `${t}.`);

/** El grupo en que cuenta una unidad: lo que el sitio PUEDE hacer con ella. */
export type GrupoSitio = 'averiada' | 'disponible' | 'oficina' | 'sin_dato';
/** El orden del bloque y del papel: averiadas, disponibles, no disponibles y sin dato. */
export const ORDEN_GRUPOS_SITIO: readonly GrupoSitio[] = ['averiada', 'disponible', 'oficina', 'sin_dato'];
export const GRUPO_SITIO_INFO: Record<GrupoSitio, { icono: string; titulo: string; uno: string; varios: string }> = {
  averiada: { icono: '🔧', titulo: 'Averiadas', uno: 'averiada', varios: 'averiadas' },
  disponible: { icono: '✅', titulo: 'Disponibles', uno: 'disponible', varios: 'disponibles' },
  oficina: { icono: '⛔', titulo: 'No disponibles (oficina)', uno: 'no disponible', varios: 'no disponibles' },
  sin_dato: { icono: '❔', titulo: 'Sin dato', uno: 'sin dato', varios: 'sin dato' },
};

/** La palabra del sistema que se cuenta DENTRO de un grupo: las paradas dentro de las
 *  disponibles; en espera, retiradas y transferidas dentro de las no disponibles. */
export type SubSitio = 'parada' | 'espera' | 'retirada' | 'transferida';
/** Los íconos son los de `ESTADO_CONTEO_INFO` (la prueba de datos lo vigila). */
export const SUB_SITIO_INFO: Record<SubSitio, { icono: string; uno: string; varios: string }> = {
  parada: { icono: '🟡', uno: 'parada', varios: 'paradas' },
  espera: { icono: '⏳', uno: 'en espera', varios: 'en espera' },
  retirada: { icono: '⬛', uno: 'retirada', varios: 'retiradas' },
  transferida: { icono: '🔁', uno: 'transferida', varios: 'transferidas' },
};

/** Cómo se dice cada marca del sitio. */
export const MARCA_INFO: Record<EstadoUnidad, { icono: string; etiqueta: string }> = {
  disponible: { icono: '✅', etiqueta: 'Disponible' },
  averiada: { icono: '🔧', etiqueta: 'Averiada' },
};

/** Lo que manda: inspección, la marca del sitio sobre una vinculada, o una unidad del sitio. */
export type FuenteEstado = 'inspeccion' | 'sitio' | 'propia';
/** Cómo está la marca del sitio: manda, quedó atrás por un hecho de inspección, o en pausa
 *  mientras la oficina tenga la máquina en espera, retirada o transferida. */
export type EstadoDeLaMarca = 'vigente' | 'superada' | 'pausa';

/** Un hecho de inspección con su frase lista («inspección registró una jornada a las 07:25 a. m.»). */
export type HechoInspeccion = { ms: number; que: QueHechoInspeccion; motivo: string | null; texto: string };

/** El estado de una unidad en el sitio (`estadoDelSitio`). */
export type EstadoDelSitio = {
  grupo: GrupoSitio;
  /** La palabra del sistema dentro del grupo (parada / espera / retirada / transferida). */
  sub: SubSitio | null;
  fuente: FuenteEstado;
  /** La marca guardada (puede no mandar: ver `marcaEstado`). */
  marca: EstadoUnidad | null;
  marcaEstado: EstadoDeLaMarca | null;
  /** El hecho que la dejó atrás (solo si `marcaEstado` = 'superada'). */
  superadaPor: HechoInspeccion | null;
  /** Manda la marca del sitio y su grupo no es el de inspección (⚠️, «≠», 📲). */
  noCoincide: boolean;
  /** Manda la marca del sitio pero no se pudo comparar con inspección (sin leer o sin fecha). */
  sinVerificar: boolean;
  /** ¿Se le pueden poner ✅/🔧? No en espera, retirada ni transferida (lo maneja la oficina). */
  puedeMarcar: boolean;
  porQueNo: string | null;
  /** ¿Hay «↩️ Que mande inspección»? Siempre que una vinculada tenga marca (también vieja). */
  puedeSoltar: boolean;
  /** La pastilla encendida: la marca, solo si MANDA (o en una unidad del sitio). */
  encendida: EstadoUnidad | null;
  vinculada: boolean;
  /** Vinculada a una máquina que ya no está (activa) en el catálogo del sistema. */
  fueraDelCatalogo: boolean;
  /** Lo que dice inspección (null: unidad del sitio o inspección sin leer). */
  inspeccion: InspeccionMaquina | null;
  /** El grupo según inspección (null: unidad del sitio, sin leer o fuera del catálogo). */
  grupoInspeccion: GrupoSitio | null;
  /** La línea de la marca que no manda: «↪️ … quedó atrás: …» (solo durante la jornada en que
   *  pasó el hecho) o «🏭 … está en pausa…». null si no hay nada que decir. */
  avisoMarca: string | null;
};

const POR_QUE_NO_OFICINA = 'Lo maneja la oficina (Control de Maquinaria).';

const esOficina = (e: EstadoConteo | null | undefined): boolean => e === 'espera' || e === 'retirada' || e === 'transferida';

/** El grupo de un estado del sistema: Operativa y Parada son disponibles. */
function grupoDeConteo(e: EstadoConteo | null | undefined): GrupoSitio | null {
  if (e === 'operativa' || e === 'parada') return 'disponible';
  if (e === 'averiada') return 'averiada';
  if (esOficina(e)) return 'oficina';
  return null;
}

const subDeConteo = (e: EstadoConteo | null | undefined): SubSitio | null =>
  (e === 'parada' || e === 'espera' || e === 'retirada' || e === 'transferida' ? e : null);

/** La marca válida de la unidad (lo demás no es una marca). */
const marcaDe = (u: Unidad | null | undefined): EstadoUnidad | null =>
  (u?.estado === 'disponible' || u?.estado === 'averiada' ? u.estado : null);

/** El instante de la marca (ms) o NaN si no tiene una fecha que se entienda. */
const msDeLaMarca = (u: Unidad | null | undefined): number => {
  const t = Date.parse(String(u?.estadoAt ?? '').trim());
  return Number.isFinite(t) ? t : NaN;
};

/** «de hoy 06:10 a. m.» (el mismo día de `ahoraMs`) o «del 15/10». Sin fecha → ''. */
function deCuando(ms: number, ahoraMs: number | null | undefined): string {
  const m = momentoCaracas(ms);
  if (!m) return '';
  const hoy = momentoCaracas(ahoraMs ?? null);
  return hoy && hoy.dia === m.dia ? `de hoy ${m.hora}` : `del ${m.diaMes}`;
}

/** «desde hoy 06:10 a. m.» o «desde el 20/10 06:10 a. m.». Sin fecha → ''. */
function desdeCuando(ms: number, ahoraMs: number | null | undefined): string {
  const m = momentoCaracas(ms);
  if (!m) return '';
  const hoy = momentoCaracas(ahoraMs ?? null);
  return hoy && hoy.dia === m.dia ? `desde hoy ${m.hora}` : `desde el ${m.diaMes} ${m.hora}`;
}

/**
 * ⭐ EL ÚLTIMO HECHO DE INSPECCIÓN de una máquina: el más reciente entre la novedad que leyó la
 * capa de datos (avería real creada o resuelta, jornada iniciada por una persona) y la
 * devolución a servicio desde el Catálogo (`reactivadaMs`). Con su frase: «inspección registró
 * una jornada a las 07:25 a. m.» / «la oficina la devolvió a servicio el 20/10». Sin ninguno → null.
 * A igual hora gana la novedad.
 */
export function ultimoHecho(insp: InspeccionMaquina | null | undefined, ahoraMs?: number | null): HechoInspeccion | null {
  if (!insp) return null;
  let h: { ms: number; que: QueHechoInspeccion; motivo: string | null } | null = null;
  const nov = insp.novedad;
  if (nov && typeof nov.ms === 'number' && Number.isFinite(nov.ms)) h = { ms: nov.ms, que: nov.que, motivo: nov.motivo ?? null };
  const r = insp.reactivadaMs;
  if (typeof r === 'number' && Number.isFinite(r) && (!h || r > h.ms)) h = { ms: r, que: 'reactivada', motivo: null };
  return h ? { ...h, texto: fraseHechoInspeccion(h, ahoraMs) } : null;
}

/**
 * ⭐ EL ESTADO DE UNA UNIDAD EN EL SITIO — LA regla (ver arriba). `insp` es lo leído por
 * `cargarEstadoInspeccion` (null = todavía no se leyó o falló: nunca se supone «Disponible»);
 * `ahoraMs`, la hora de la pantalla (solo para decir «hoy» y para mostrar el «quedó atrás»
 * durante la jornada —7am a 7am— en que pasó el hecho). Pura: no lee nada.
 */
export function estadoDelSitio(u: Unidad, insp: EstadoInspeccion | null | undefined, ahoraMs: number): EstadoDelSitio {
  const marca = marcaDe(u);
  const machineryId = String(u?.machineryId ?? '').trim();
  const base: EstadoDelSitio = {
    grupo: marca ?? 'sin_dato', sub: null, fuente: 'propia', marca, marcaEstado: marca ? 'vigente' : null, superadaPor: null,
    noCoincide: false, sinVerificar: false, puedeMarcar: true, porQueNo: null, puedeSoltar: false, encendida: marca,
    vinculada: !!machineryId, fueraDelCatalogo: false, inspeccion: null, grupoInspeccion: null, avisoMarca: null,
  };
  // Unidad del sitio: manda su marca (sin marca, que la base no deja, ❔: nunca Disponible).
  if (!machineryId) return base;

  const leida = insp?.porMaquina?.[machineryId] ?? null;
  // Inspección sin leer: su marca «sin verificar», o ❔ Sin dato.
  if (!leida) return { ...base, fuente: marca ? 'sitio' : 'inspeccion', sinVerificar: !!marca, puedeSoltar: !!marca };
  // Ya no está en el catálogo: como una del sitio, con su aviso.
  if (!leida.encontrada || !leida.estado) {
    return { ...base, fuente: marca ? 'sitio' : 'inspeccion', puedeSoltar: !!marca, fueraDelCatalogo: true, inspeccion: leida };
  }

  const grupoInspeccion = grupoDeConteo(leida.estado) ?? 'sin_dato';
  const oficina = esOficina(leida.estado);
  const marcaMs = msDeLaMarca(u);
  const hecho = ultimoHecho(leida, ahoraMs);
  let marcaEstado: EstadoDeLaMarca | null = null;
  let superadaPor: HechoInspeccion | null = null;
  if (marca) {
    // Un hecho no desaparece: una marca superada lo sigue estando aunque después la oficina la
    // ponga en espera. Si no hay hecho posterior y la oficina la tiene, queda en pausa.
    if (Number.isFinite(marcaMs) && hecho && hecho.ms > marcaMs) { marcaEstado = 'superada'; superadaPor = hecho; }
    else marcaEstado = oficina ? 'pausa' : 'vigente';
  }
  const manda = marcaEstado === 'vigente' && marca ? marca : null;
  // Una marca sin fecha no se puede comparar con los hechos: manda, pero «sin verificar».
  const sinVerificar = !!manda && !Number.isFinite(marcaMs);
  const grupo: GrupoSitio = manda ?? grupoInspeccion;

  let avisoMarca: string | null = null;
  if (marca && marcaEstado === 'superada' && superadaPor) {
    const h = momentoCaracas(superadaPor.ms);
    const ahora = momentoCaracas(ahoraMs);
    if (h && ahora && h.jornada === ahora.jornada) {
      avisoMarca = conPunto(`↪️ Tu marca ${MARCA_INFO[marca].icono} ${MARCA_INFO[marca].etiqueta} ${deCuando(marcaMs, ahoraMs)} quedó atrás: ${superadaPor.texto}`);
    }
  } else if (marca && marcaEstado === 'pausa') {
    const cuando = Number.isFinite(marcaMs) ? ` ${deCuando(marcaMs, ahoraMs)}` : '';
    avisoMarca = `🏭 Tu marca ${MARCA_INFO[marca].icono}${cuando} está en pausa mientras la oficina la tenga así.`;
  }

  return {
    ...base,
    grupo,
    sub: manda ? null : subDeConteo(leida.estado),
    fuente: manda ? 'sitio' : 'inspeccion',
    marcaEstado,
    superadaPor,
    noCoincide: !!manda && !sinVerificar && grupo !== grupoInspeccion,
    sinVerificar,
    puedeMarcar: !oficina,
    porQueNo: oficina ? POR_QUE_NO_OFICINA : null,
    puedeSoltar: !!marca,
    encendida: manda,
    inspeccion: leida,
    grupoInspeccion,
    avisoMarca,
  };
}

/** Una máquina que se le pregunta a inspección (lo que pide `cargarEstadoInspeccion`). */
export type VinculadaParaLeer = { machineryId: string; estadoAt: string | null; conMarca: boolean };

/**
 * ⭐ QUÉ SE LE PREGUNTA A INSPECCIÓN (la ÚNICA definición, para la pantalla y el papel; lote 6
 * A5/B15): las unidades ACTIVAS vinculadas al catálogo, sin repetir máquina, con su marca y su
 * hora (la ventana de hechos de cada una arranca en SU marca). Si tiene marca lo dice la regla
 * (`estadoDelSitio`), no una comparación a mano. Sin vinculadas → []: no se consulta nada. Las de
 * baja y las del sitio no se preguntan.
 */
export function vinculadasParaInspeccion(unidades: Unidad[] | null | undefined): VinculadaParaLeer[] {
  const out: VinculadaParaLeer[] = [];
  const vistas = new Set<string>();
  for (const u of unidades ?? []) {
    if (!u || u.activo === false) continue;
    const id = limpia(u.machineryId);
    if (!id || vistas.has(id)) continue;
    vistas.add(id);
    out.push({ machineryId: id, estadoAt: limpia(u.estadoAt) || null, conMarca: estadoDelSitio(u, null, 0).marca !== null });
  }
  return out;
}

/**
 * ⭐ ¿TOCAR ESTA PASTILLA EDITA LA NOTA O PONE UNA MARCA NUEVA? (reserva del Analista 3) Se
 * decide por la marca VIGENTE, nunca por la guardada:
 *   · la misma pastilla, con la marca vigente y verificada (o en una unidad del sitio) → 'nota'
 *     (`guardarNotaMarca`: no sella, no revive);
 *   · la misma pastilla con la marca superada o sin verificar, otra pastilla, o una vinculada
 *     sin marca → 'marca' (`guardarMarcaUnidad`: sella desde ahora; el editor lo dice);
 *   · si no se puede marcar (en espera, retirada, transferida) → null: pastillas apagadas.
 * `soloNota` (lote 6, B1): el enlace «📝 nota» pide EXPLÍCITAMENTE editar solo la nota de la
 * marca que manda (`encendida`), también cuando está «sin verificar» (no se pudo comparar con
 * inspección): la nota no sella ni revive nada, así que no hace falta volver a marcar para
 * escribirla. La PASTILLA sigue siendo marca nueva (P1); el enlace es otro control.
 */
export function modoAlTocar(fila: EstadoDelSitio, estadoTocado: EstadoUnidad, soloNota = false): 'nota' | 'marca' | null {
  if (!fila || !fila.puedeMarcar) return null;
  if (fila.marca === estadoTocado && fila.marcaEstado === 'vigente' && !fila.sinVerificar) return 'nota';
  if (soloNota && fila.encendida !== null && fila.encendida === estadoTocado) return 'nota';
  return 'marca';
}

/** Una unidad activa con su estado en el sitio. */
export type FilaDelSitio = { unidad: Unidad; estado: EstadoDelSitio };

/**
 * Las unidades ACTIVAS del sitio con su estado (`estadoDelSitio`), en el orden del bloque y del
 * papel: por grupo (🔧 averiadas, ✅ disponibles, ⛔ no disponibles, ❔ sin dato), dentro de cada
 * uno las ⚠️ que no coinciden primero, y después A→Z por código. Las dadas de baja no están.
 */
export function filasDelSitio(unidades: Unidad[], insp: EstadoInspeccion | null | undefined, ahoraMs: number): FilaDelSitio[] {
  const orden = (g: GrupoSitio) => ORDEN_GRUPOS_SITIO.indexOf(g);
  return (unidades ?? [])
    .filter((u) => u && u.activo !== false)
    .map((u) => ({ unidad: u, estado: estadoDelSitio(u, insp, ahoraMs) }))
    .sort((a, b) => orden(a.estado.grupo) - orden(b.estado.grupo)
      || Number(b.estado.noCoincide) - Number(a.estado.noCoincide)
      || cmpText(a.unidad.codigo, b.unidad.codigo));
}

/** Las unidades activas en el orden de `filasDelSitio`. Sin `insp` (sin leer), las vinculadas
 *  sin marca van al final, en ❔ Sin dato. */
export function unidadesDelBloque(unidades: Unidad[], insp: EstadoInspeccion | null = null, ahoraMs = 0): Unidad[] {
  return filasDelSitio(unidades, insp, ahoraMs).map((f) => f.unidad);
}

/** Cuántas unidades activas hay en cada grupo (suman `total`), con los subconteos. */
export type ConteoDelSitio = {
  total: number;
  disponibles: number;
  averiadas: number;
  /** ⛔ No disponibles (oficina): en espera + retiradas + transferidas. */
  oficina: number;
  sinDato: number;
  /** 🟡 dentro de las disponibles. */
  paradas: number;
  espera: number;
  retiradas: number;
  transferidas: number;
  /** ⚠️ las que no coinciden con inspección. */
  noCoinciden: number;
  sinVerificar: number;
};

/** ⭐ Los conteos del sitio, de las filas de `filasDelSitio` (las de baja no cuentan). */
export function conteoDelSitio(filas: FilaDelSitio[]): ConteoDelSitio {
  const c: ConteoDelSitio = {
    total: 0, disponibles: 0, averiadas: 0, oficina: 0, sinDato: 0,
    paradas: 0, espera: 0, retiradas: 0, transferidas: 0, noCoinciden: 0, sinVerificar: 0,
  };
  for (const f of filas ?? []) {
    if (!f?.estado || f.unidad?.activo === false) continue;
    const e = f.estado;
    c.total++;
    if (e.grupo === 'disponible') c.disponibles++;
    else if (e.grupo === 'averiada') c.averiadas++;
    else if (e.grupo === 'oficina') c.oficina++;
    else c.sinDato++;
    if (e.sub === 'parada') c.paradas++;
    else if (e.sub === 'espera') c.espera++;
    else if (e.sub === 'retirada') c.retiradas++;
    else if (e.sub === 'transferida') c.transferidas++;
    if (e.noCoincide) c.noCoinciden++;
    if (e.sinVerificar) c.sinVerificar++;
  }
  return c;
}

/**
 * Los conteos en una línea.
 *  · 'largo' (el bloque): solo los grupos con algo, y los subconteos entre paréntesis:
 *    «✅ 8 disponibles (🟡 1 parada) · 🔧 2 averiadas · ⛔ 1 no disponible (⏳ 1 en espera)».
 *    Sin unidades → ''. Con `leyendo` (inspección leyéndose por primera vez, lote 6 B3) las
 *    vinculadas sin marca no son «sin dato» (eso significa «falló»): «🔎 N leyendo inspección».
 *  · 'corto' (el encabezado plegado): «✅ n · 🔧 m» siempre y, solo si hay, «· ⛔ k · ❔ j · ⚠️ d
 *    · 🔎 v sin verificar» (B9: que se vea, aun plegado, que nada se comparó con inspección).
 */
export function textoConteoDelSitio(c: ConteoDelSitio, forma: 'largo' | 'corto' = 'largo', op: { leyendo?: boolean } = {}): string {
  if (forma === 'corto') {
    const partes = [`✅ ${c.disponibles}`, `🔧 ${c.averiadas}`];
    if (c.oficina > 0) partes.push(`⛔ ${c.oficina}`);
    if (c.sinDato > 0) partes.push(`❔ ${c.sinDato}`);
    if (c.noCoinciden > 0) partes.push(`⚠️ ${c.noCoinciden}`);
    if (c.sinVerificar > 0) partes.push(`🔎 ${c.sinVerificar} sin verificar`);
    return partes.join(' · ');
  }
  const cuenta = (n: number, info: { uno: string; varios: string }) => `${n} ${n === 1 ? info.uno : info.varios}`;
  const subs = (pares: [number, SubSitio][]) => {
    const t = pares.filter(([n]) => n > 0).map(([n, s]) => `${SUB_SITIO_INFO[s].icono} ${cuenta(n, SUB_SITIO_INFO[s])}`);
    return t.length ? ` (${t.join(' · ')})` : '';
  };
  const partes: string[] = [];
  if (c.disponibles > 0) partes.push(`✅ ${cuenta(c.disponibles, GRUPO_SITIO_INFO.disponible)}${subs([[c.paradas, 'parada']])}`);
  if (c.averiadas > 0) partes.push(`🔧 ${cuenta(c.averiadas, GRUPO_SITIO_INFO.averiada)}`);
  if (c.oficina > 0) {
    partes.push(`⛔ ${cuenta(c.oficina, GRUPO_SITIO_INFO.oficina)}${subs([[c.espera, 'espera'], [c.retiradas, 'retirada'], [c.transferidas, 'transferida']])}`);
  }
  if (c.sinDato > 0) partes.push(op.leyendo ? `🔎 ${c.sinDato} leyendo inspección` : `❔ ${c.sinDato} sin dato`);
  return partes.join(' · ');
}

/**
 * @deprecated TODO-M4/M5: reemplazar por `conteoDelSitio(filasDelSitio(…))` en el bloque y en
 * el papel, y borrar. Mientras tanto, la misma regla SIN inspección leída: cuenta las
 * disponibles y averiadas por su marca (una vinculada sin marca NO es disponible: queda fuera
 * de las dos), y `total` son todas las activas.
 */
export function conteoMaquinaria(unidades: Unidad[]): { disponibles: number; averiadas: number; total: number } {
  const c = conteoDelSitio(filasDelSitio(unidades, null, 0));
  return { disponibles: c.disponibles, averiadas: c.averiadas, total: c.total };
}

/**
 * 📲 El texto para avisarle a inspección por WhatsApp lo que DICE EL SITIO y no coincide (una
 * fila o varias: solo entran las ⚠️). Lleva código, placa, la marca con su «desde», la nota y lo
 * que dice inspección; sin horas trabajadas ni nombres de inspectores. Ella elige el chat; no se
 * guarda nada. Sin ninguna que no coincida → ''.
 */
export function textoAvisoInspeccion(filas: FilaDelSitio[], ahoraMs: number, sitio?: string | null): string {
  const lineas: string[] = [];
  for (const f of filas ?? []) {
    const e = f?.estado;
    const marca = e?.encendida;
    if (!e || !e.noCoincide || !marca) continue;
    const u = f.unidad;
    const codigo = limpia(u.codigo) || 'Sin código';
    const placa = limpia(u.placa);
    const quien = placa && norm(placa) !== norm(codigo) ? `${codigo} (placa ${placa})` : codigo;
    const desde = desdeCuando(msDeLaMarca(u), ahoraMs);
    const nota = limpia(u.estadoNota);
    const insp = e.inspeccion;
    const dice = insp?.etiqueta ? `${insp.icono ? `${insp.icono} ` : ''}${insp.etiqueta}` : 'sin dato';
    const enElSitio = `en el sitio ${MARCA_INFO[marca].icono} ${MARCA_INFO[marca].etiqueta.toUpperCase()}${desde ? ` ${desde}` : ''}${nota ? ` — ${nota}` : ''}`;
    lineas.push(`• ${quien}: ${conPunto(enElSitio)} Inspección: ${dice}.`);
  }
  if (lineas.length === 0) return '';
  const m = momentoCaracas(ahoraMs);
  const nombre = limpia(sitio);
  return [
    `🏭 Maquinaria ${nombre ? `de ${nombre}` : 'del sitio'}${m ? ` · ${m.fecha}, ${m.hora}` : ''}`,
    'Lo que DICE EL SITIO y no coincide con inspección:',
    ...lineas,
  ].join('\n');
}

/**
 * Lo que se le manda a la base al REACTIVAR una unidad dada de baja (D7):
 *   · vinculada → `{ activo: true, estado: null, estadoNota: null }`: vuelve a mandar inspección
 *     (una marca de antes de la baja no revive);
 *   · del sitio → `{ activo: true }`: conserva su marca con su «desde» viejo (la base no la deja
 *     sin estado, e inventar «Disponible» con fecha de hoy sería un dato que nadie dijo).
 * El aviso sale de `avisoAlReactivar`.
 */
export function cambioAlReactivar(u: Unidad): Partial<Unidad> {
  return String(u?.machineryId ?? '').trim() ? { activo: true, estado: null, estadoNota: null } : { activo: true };
}

/** El aviso al reactivar: «UNI-07 reactivada · su último estado: 🔧 Averiada desde el 12/09/2026,
 *  … — cámbialo en el Parte diario si ya no es así» (del sitio) o que vuelve a seguir a
 *  inspección (vinculada). */
export function avisoAlReactivar(u: Unidad): string {
  const codigo = limpia(u?.codigo) || 'La unidad';
  const cambio = cambioAlReactivar(u);
  if (cambio.estado === null) return `${codigo} reactivada: su estado vuelve a ser el de inspección.`;
  const marca = marcaDe(u);
  if (!marca) return `${codigo} reactivada.`;
  const desde = textoDesde(u.estadoAt);
  return `${codigo} reactivada · su último estado: ${MARCA_INFO[marca].icono} ${MARCA_INFO[marca].etiqueta}${desde ? ` ${desde}` : ''}`
    + ' — cámbialo en el Parte diario si ya no es así.';
}

/** Una fila de la sección 🚜 del papel. Texto plano (quien pinta escapa). */
export type FilaMaquinariaPapel = {
  codigo: string;
  descripcion: string | null;
  placa: string | null;
  grupo: GrupoSitio;
  /** «Estado (sitio)»: «Averiada», «Disponible», «Esperando instrucciones», «Sin dato»… */
  estado: string;
  /** Debajo, en chico: «según inspección», «marcado en el sitio, 25/10 06:10 a. m.» (con
   *  «· sin verificar» si no se pudo comparar) o, en una del sitio, «desde 22/10». */
  detalle: string;
  /** «Inspección»: el rótulo del sistema con su motivo y desde; «— solo del sitio»; «Sin dato»
   *  (sin leer); «Ya no está en el catálogo del sistema». */
  inspeccion: string;
  /** La nota de la marca que MANDA (la de una marca superada o en pausa no sale). */
  nota: string | null;
  /** «≠»: manda la marca del sitio y no coincide con inspección. */
  noCoincide: boolean;
};

/** El modelo de la sección 🚜 Maquinaria del papel (el HTML lo arma quien pinta). */
export type ModeloMaquinariaPapel = {
  vacio: boolean;
  /** «25/10/2026, 06:45 a. m.»: el estado es el del momento de emitir. */
  estadoAl: string;
  /** Las tarjetas: solo los grupos con algo, con su subconteo («1 parada», «1 en espera»). */
  tarjetas: { grupo: GrupoSitio; titulo: string; cantidad: number; detalle: string | null }[];
  total: number;
  conteo: ConteoDelSitio;
  /** ¿Va la columna «Inspección»? Solo si hay alguna unidad vinculada activa. */
  conInspeccion: boolean;
  /** Si inspección no se pudo leer al emitir (y hay vinculadas): el aviso de arriba. */
  avisoLectura: string | null;
  filas: FilaMaquinariaPapel[];
};

/**
 * ⭐ LA SECCIÓN 🚜 DEL PAPEL (P5), con la MISMA regla que la pantalla: el estado AL EMITIR
 * (`emitidoMs`), columnas Estado (sitio) + Inspección (solo si hay vinculadas) con «≠», las
 * tarjetas por grupo, y el aviso si inspección no se leyó («se imprime lo marcado en el sitio»;
 * las vinculadas sin marca salen «Sin dato»: nunca un estado supuesto). Una marca superada no se
 * imprime como vigente. Sin horas trabajadas, sin nombres de inspectores, sin «trabajando ahora».
 */
export function modeloMaquinariaPapel(unidades: Unidad[], insp: EstadoInspeccion | null | undefined, emitidoMs: number): ModeloMaquinariaPapel {
  const filas = filasDelSitio(unidades, insp, emitidoMs);
  const conteo = conteoDelSitio(filas);
  const conInspeccion = filas.some((f) => f.estado.vinculada);
  const sinLeer = filas.some((f) => f.estado.vinculada && !(insp?.porMaquina?.[String(f.unidad.machineryId ?? '').trim()]));
  const m = momentoCaracas(emitidoMs);
  const cuenta = (n: number, s: SubSitio) => `${n} ${n === 1 ? SUB_SITIO_INFO[s].uno : SUB_SITIO_INFO[s].varios}`;
  const subs = (pares: [number, SubSitio][]) => pares.filter(([n]) => n > 0).map(([n, s]) => cuenta(n, s)).join(' · ') || null;
  const tarjetas: ModeloMaquinariaPapel['tarjetas'] = [];
  const tarjeta = (grupo: GrupoSitio, cantidad: number, detalle: string | null) => {
    if (cantidad > 0) tarjetas.push({ grupo, titulo: GRUPO_SITIO_INFO[grupo].titulo, cantidad, detalle });
  };
  tarjeta('disponible', conteo.disponibles, subs([[conteo.paradas, 'parada']]));
  tarjeta('averiada', conteo.averiadas, null);
  tarjeta('oficina', conteo.oficina, subs([[conteo.espera, 'espera'], [conteo.retiradas, 'retirada'], [conteo.transferidas, 'transferida']]));
  tarjeta('sin_dato', conteo.sinDato, null);

  const filasPapel = filas.map(({ unidad: u, estado: e }): FilaMaquinariaPapel => {
    const insp1 = e.inspeccion;
    const manda = e.encendida;
    let estado: string;
    if (manda) estado = MARCA_INFO[manda].etiqueta;
    else if (insp1?.encontrada && insp1.estado) estado = e.grupo === 'disponible' ? 'Disponible' : e.grupo === 'averiada' ? 'Averiada' : (insp1.etiqueta ?? 'Sin dato');
    else estado = 'Sin dato';
    const marcaM = momentoCaracas(msDeLaMarca(u));
    let detalle = '';
    if (!e.vinculada) detalle = marcaM ? `desde ${marcaM.diaMes}` : '';
    else if (manda) detalle = `marcado en el sitio${marcaM ? `, ${marcaM.diaMes} ${marcaM.hora}` : ''}${e.sinVerificar ? ' · sin verificar' : ''}`;
    else if (e.grupo === 'averiada' || e.grupo === 'disponible') detalle = 'según inspección';
    let inspeccion: string;
    if (!e.vinculada) inspeccion = '— solo del sitio';
    else if (e.fueraDelCatalogo) inspeccion = 'Ya no está en el catálogo del sistema';
    else if (!insp1?.encontrada || !insp1.etiqueta) inspeccion = 'Sin dato';
    else {
      const desde = (insp1.estado === 'averiada' || insp1.estado === 'parada') ? momentoCaracas(insp1.desdeMs) : null;
      inspeccion = `${insp1.etiqueta}${insp1.motivo ? ` — ${limpia(insp1.motivo)}` : ''}${desde ? ` · desde ${desde.diaMes}` : ''}`;
    }
    return {
      codigo: limpia(u.codigo) || 'Sin código',
      descripcion: limpia(u.descripcion) || null,
      placa: limpia(u.placa) || null,
      grupo: e.grupo,
      estado,
      detalle,
      inspeccion,
      nota: manda ? limpia(u.estadoNota) || null : null,
      noCoincide: e.noCoincide,
    };
  });

  return {
    vacio: filas.length === 0,
    estadoAl: m ? `${m.fecha}, ${m.hora}` : '',
    tarjetas,
    total: conteo.total,
    conteo,
    conInspeccion,
    avisoLectura: conInspeccion && sinLeer ? 'No se pudo leer el estado de inspección al emitir: se imprime lo marcado en el sitio.' : null,
    filas: filasPapel,
  };
}

const dd = (n: number): string => String(n).padStart(2, '0');

/**
 * «desde el 20/10/2026, 03:15 p. m.» con la hora de Caracas (UTC−4, sin horario de
 * verano), sea cual sea el huso del equipo. Sin dato o ilegible → ''.
 */
export function textoDesde(estadoAt: string | null | undefined): string {
  const s = String(estadoAt ?? '').trim();
  if (!s) return '';
  const t = Date.parse(s);
  if (!Number.isFinite(t)) return '';
  const c = new Date(t - 4 * 3600 * 1000); // Caracas: UTC−4 todo el año.
  const h24 = c.getUTCHours();
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const ampm = h24 < 12 ? 'a. m.' : 'p. m.';
  return `desde el ${dd(c.getUTCDate())}/${dd(c.getUTCMonth() + 1)}/${c.getUTCFullYear()}, ${dd(h12)}:${dd(c.getUTCMinutes())} ${ampm}`;
}

/** Lo que se está cambiando en el bloque 🚜 Maquinaria: la unidad, el estado elegido y la nota
 *  escrita. Y mientras el editor esté abierto (lote 6):
 *   · `soloNota` (B1): se abrió con «📝 nota» → solo la nota de la marca que manda, aunque esté
 *     «sin verificar»;
 *   · `vistoHasta` (B1): la hora del ÚLTIMO HECHO que la guardia ya le mostró (ISO): la guardia
 *     no la vuelve a frenar por ese mismo hecho (sí por uno más nuevo). Se va al cerrar el editor;
 *   · `grupo` (B7): el grupo en que estaba la fila al abrir: se queda ahí mientras escribe (si
 *     inspección la mueve de grupo, el campo no se desmonta ni pierde el foco). */
export type EdicionEstado = { id: string; estado: EstadoUnidad; nota: string; soloNota?: boolean; vistoHasta?: string | null; grupo?: GrupoSitio };

/**
 * ¿El editor abierto tiene algo que guardar? (revisión final B-M7: el Parte diario dice
 * «✏️ sin guardar» y pregunta antes de salir). Sí si eligió OTRO estado, o si la nota
 * escrita no es la guardada (sin contar espacios). Abrir «Agregar nota» y no escribir no
 * cuenta; una unidad que ya no está tampoco (no hay dónde guardarlo).
 */
export function edicionSinGuardar(edicion: EdicionEstado | null | undefined, unidades: Unidad[]): boolean {
  if (!edicion) return false;
  const u = (unidades ?? []).find((x) => x && x.id === edicion.id);
  if (!u) return false;
  if (edicion.estado !== u.estado) return true;
  return String(edicion.nota ?? '').trim() !== String(u.estadoNota ?? '').trim();
}

// ═══════════════════════════ 🧱 Bloques ═══════════════════════════

/** Cómo se llama el material de los bloques si la lista no dice otro. */
export const MATERIAL_BLOQUES = 'Bloques';

export type MaterialBloques = {
  /** El nombre que se guarda en el renglón (congelado). */
  nombre: string;
  /** El id de la lista, si salió de ella. */
  listaId: string | null;
  /** Días hasta que lo producido está disponible para la venta. */
  dias: number;
  /** ¿Los días vienen de la lista (true) o son los 7 por defecto (false)? */
  diasDeLaLista: boolean;
};

/** Días válidos (entero ≥ 0, como pide la base) o null. */
const diasValidos = (d: unknown): number | null =>
  typeof d === 'number' && Number.isInteger(d) && d >= 0 ? d : null;

/**
 * El material de los bloques del sitio, de su lista de materiales ACTIVOS:
 *   1. el que se llama «Bloques» (sin mayúsculas, tildes ni espacios de más);
 *   2. si no hay, el primero A→Z marcado con «días hasta estar disponible»;
 *   3. si tampoco, «Bloques» sin lista y 7 días.
 * Los días son los del material; sin días (o inválidos), 7.
 */
export function materialDeBloques(listas: ItemLista[]): MaterialBloques {
  const materiales = (listas ?? [])
    .filter((i) => i && i.clase === 'material' && i.activo !== false && String(i.nombre ?? '').trim())
    .sort((a, b) => cmpText(a.nombre, b.nombre));
  const porNombre = materiales.find((i) => norm(i.nombre.trim()) === norm(MATERIAL_BLOQUES));
  const marcado = materiales.find((i) => diasValidos(i.diasDisponible) !== null);
  const elegido = porNombre ?? marcado ?? null;
  if (!elegido) return { nombre: MATERIAL_BLOQUES, listaId: null, dias: DIAS_CURADO_BLOQUES, diasDeLaLista: false };
  const dias = diasValidos(elegido.diasDisponible);
  return {
    nombre: elegido.nombre.trim().replace(/\s+/g, ' '),
    listaId: elegido.id || null,
    dias: dias ?? DIAS_CURADO_BLOQUES,
    diasDeLaLista: dias !== null,
  };
}

/** Desde qué día se vende lo producido el `fecha` («YYYY-MM-DD»): fecha + días (7 por
 *  defecto; días inválidos → 7). Fecha inválida → ''. */
export function disponibleDesde(fecha: string, dias?: number | null): string {
  return sumarDias(fecha, diasValidos(dias) ?? DIAS_CURADO_BLOQUES);
}

/** ¿El renglón es de bloques? Por el id de la lista o, si no, por el nombre (el del
 *  material elegido o «Bloques»): un renglón viejo conserva su texto congelado. */
export function esDeBloques(m: Pick<Movimiento, 'material' | 'materialId'>, mat: MaterialBloques): boolean {
  if (!m) return false;
  if (mat.listaId && m.materialId === mat.listaId) return true;
  const n = norm(String(m.material ?? '').trim());
  return !!n && (n === norm(mat.nombre) || n === norm(MATERIAL_BLOQUES));
}

/** 'AAAA-MM-DD' → 'DD/MM/AAAA'. */
const dmy = (f: string): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(f ?? ''));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(f ?? '');
};

const esPiezas = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0;

/** La «disponible desde» guardada en el renglón, si es una fecha que existe y no es
 *  anterior a la producción; si no, null (se calcula con los días de ahora). */
function fechaGuardada(f: string | null | undefined, fechaProduccion: string): string | null {
  const t = String(f ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t) || sumarDias(t, 0) !== t) return null;
  return t >= fechaProduccion ? t : null;
}

export type EntradaInventario = {
  producciones: MovBloques[];
  salidas: MovBloques[];
  /** Lo que no entra al inventario y por qué (con su fecha), en español. */
  avisos: string[];
};

/**
 * Los renglones de bloques del sitio → la entrada de `inventarioBloques`.
 *   · Producción = tipo 'produccion' del material; venta = tipo 'salida' del material.
 *   · Un renglón sin cantidad (o que no es un entero ≥ 0) NO entra y se avisa con su fecha.
 *   · ⭐ Cada producción entra con SU fecha de liberación (`libera`): la «disponible desde»
 *     que se congeló al anotarla, si es válida; si no, fecha + los días de ahora (lote 5
 *     A6). Así cambiar los días del material vale para lo nuevo y no vuelve a poner en
 *     curado lo viejo. Si alguna quedó con otros días, se avisa (solo informa).
 */
export function entradaInventario(movs: Movimiento[], mat: MaterialBloques): EntradaInventario {
  const producciones: MovBloques[] = [];
  const salidas: MovBloques[] = [];
  const avisos: string[] = [];
  let otrosDias = 0;
  for (const m of movs ?? []) {
    if (!m || (m.tipo !== 'produccion' && m.tipo !== 'salida') || !esDeBloques(m, mat)) continue;
    const que = m.tipo === 'produccion' ? 'La producción' : 'La venta';
    if (!esPiezas(m.cantidad)) {
      avisos.push(`${que} del ${dmy(m.fecha)} no tiene una cantidad de bloques válida: no cuenta en el inventario.`);
      continue;
    }
    if (m.tipo === 'produccion') {
      const conLosDiasDeAhora = disponibleDesde(m.fecha, mat.dias);
      const guardada = fechaGuardada(m.disponibleDesde, m.fecha);
      producciones.push({ fecha: m.fecha, cantidad: m.cantidad, libera: guardada ?? conLosDiasDeAhora });
      if (guardada && guardada !== conLosDiasDeAhora) otrosDias++;
    } else {
      salidas.push({ fecha: m.fecha, cantidad: m.cantidad });
    }
  }
  if (otrosDias > 0) {
    avisos.push(`${otrosDias === 1 ? 'Una producción se anotó' : `${otrosDias} producciones se anotaron`} con otros días hasta estar disponible: `
      + `${otrosDias === 1 ? 'se libera' : 'cada una se libera'} en la fecha que se le puso al anotarla (los ${mat.dias} ${mat.dias === 1 ? 'día' : 'días'} de ahora valen para lo nuevo).`);
  }
  return { producciones, salidas, avisos };
}

/**
 * La cantidad de bloques escrita a mano: un entero MAYOR que cero. Se lee con la regla
 * de la casa (`leerNumero`): UN solo punto es el DECIMAL, así que «1.200» se lee 1,2 y
 * se avisa mostrando lo leído; los miles van sin signo («1200») o con los dos signos
 * («1.300,0»). Vacío = sin dato (sin error).
 */
export function cantidadDeCampo(txt: string): { valor: number | null; error: string | null } {
  const n = numeroDeCampo(txt);
  if (n === null) return { valor: null, error: null };
  if (n < 0) return { valor: null, error: 'La cantidad no puede ser negativa.' };
  if (!Number.isInteger(n)) return { valor: null, error: `Los bloques van en número entero (se leyó ${n.toLocaleString('es-VE')}).` };
  if (n === 0) return { valor: null, error: 'Tiene que ser mayor que cero.' };
  return { valor: n, error: null };
}

/** «Días hasta estar disponible» escritos a mano: un entero ≥ 0 (0 = el mismo día), como
 *  pide la base. Vacío = sin dato (el material usa los 7 por defecto). */
export function diasDeCampo(txt: string): { valor: number | null; error: string | null } {
  const n = numeroDeCampo(txt);
  if (n === null) return { valor: null, error: null };
  if (n < 0) return { valor: null, error: 'Los días no pueden ser negativos.' };
  if (!Number.isInteger(n)) return { valor: null, error: `Los días van en número entero (se leyó ${n.toLocaleString('es-VE')}).` };
  return { valor: n, error: null };
}

/** Antes de anotar una venta: si se venden más bloques de los disponibles ese día, el
 *  aviso (para confirmar); si alcanzan, null. */
export function avisoVenta(disponibles: number, cantidad: number, fecha: string): string | null {
  if (!(cantidad > disponibles)) return null;
  const fmt = (n: number) => n.toLocaleString('es-VE', { maximumFractionDigits: 0 });
  return `El ${dmy(fecha)} hay ${fmt(Math.max(0, disponibles))} bloques disponibles para la venta y se van a anotar ${fmt(cantidad)}: `
    + `faltan ${fmt(cantidad - Math.max(0, disponibles))} (¿son bloques aún en curado o la fecha está mal?).`;
}

// ═══════════════════════════ 📍 Km en línea recta ═══════════════════════════

type ConGps = { lat: number | null; lng: number | null };

/** ¿Tiene las dos coordenadas? */
export const tieneGps = (p: ConGps | null | undefined): boolean =>
  !!p && typeof p.lat === 'number' && Number.isFinite(p.lat) && typeof p.lng === 'number' && Number.isFinite(p.lng);

/** Los km en línea recta del sitio al destino, o null si a alguno le falta el GPS. */
export function kmSugerido(sitio: ConGps | null | undefined, destino: ConGps | null | undefined): number | null {
  if (!tieneGps(sitio) || !tieneGps(destino)) return null;
  return kmLineaRecta({ lat: sitio!.lat as number, lng: sitio!.lng as number }, { lat: destino!.lat as number, lng: destino!.lng as number });
}

/**
 * Lo que se le dice al tocar «Sugerir km en línea recta»: la cifra y que es en LÍNEA
 * RECTA (por carretera es más), o qué GPS falta.
 */
export function textoSugerenciaKm(sitio: ConGps | null | undefined, destino: ConGps | null | undefined): string {
  if (!tieneGps(sitio)) return 'Falta el GPS del sitio (se escribe arriba, en 📍 Sitios → ✏️ Editar).';
  if (!tieneGps(destino)) return 'Falta el GPS del destino (latitud y longitud).';
  const km = kmSugerido(sitio, destino);
  if (km === null) return 'El GPS no se entiende: la latitud va de −90 a 90 y la longitud de −180 a 180.';
  return `${km.toLocaleString('es-VE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km en línea recta; por carretera es más: confirma los km de verdad.`;
}

/**
 * Una coordenada escrita a mano: «10,6012» o «-66.93». Vacío = sin dato (null, sin
 * error); fuera de rango o ilegible = error. `eje` dice el rango (lat ±90, lng ±180).
 * ⚠️ Acá el punto y la coma son el DECIMAL (no hay miles en una coordenada).
 */
export function coordenadaDeCampo(txt: string, eje: 'lat' | 'lng'): { valor: number | null; error: string | null } {
  const t = String(txt ?? '').trim().replace(/\s+/g, '');
  if (!t) return { valor: null, error: null };
  if (!/^[-+−]?\d{1,3}([.,]\d+)?$/.test(t)) return { valor: null, error: 'No se entiende: escribe solo la cifra (por ejemplo 10,6012 o -66,9301).' };
  const n = Number(t.replace('−', '-').replace(',', '.'));
  const max = eje === 'lat' ? 90 : 180;
  if (!Number.isFinite(n) || n < -max || n > max) {
    return { valor: null, error: `${eje === 'lat' ? 'La latitud' : 'La longitud'} va de −${max} a ${max}.` };
  }
  return { valor: n, error: null };
}

/** Cómo se llama cada clase de lista en pantalla: la clase 'terraza' se muestra «Patio». */
export function etiquetaClaseLista(clase: string, plural = false): string {
  switch (clase) {
    case 'terraza': return plural ? 'Patios' : 'Patio';
    case 'transportista': return plural ? 'Transportistas' : 'Transportista';
    case 'origen': return plural ? 'Orígenes' : 'Origen';
    case 'destino': return plural ? 'Destinos' : 'Destino';
    case 'material': return plural ? 'Materiales' : 'Material';
    default: return String(clase ?? '');
  }
}
