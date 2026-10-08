// PAGO DE VIAJES DE CAMIONES (15-sep-2026).
//
// Pedido del cliente: desde el 14-sep-2026 los camiones se le pagan a su empresa POR
// VIAJE, con la tarifa de la zona del CDT. Vive SOLO en el módulo de Viajes de camiones:
// no toca jornadas, Control de Maquinaria ni Control de Pagos. Tres reglas:
//   · Los precios se cambian como en jornada: un precio GENERAL desde una fecha en
//     adelante, o uno BLINDADO a un rango de fechas que manda sobre el general. Una
//     tarifa puede ser para todos, para una empresa, para un grupo de camiones o para
//     un solo camión, en una zona o en ambas: manda la más específica (tarifaViajeEn).
//   · Cada camión se pone o se quita del pago por viaje, con fecha (p. ej. los chutos).
//     Un camión sin asignar no entra al pago por viaje.
//   · El estado del camión no decide nada: cada viaje se paga salvo que alguien lo
//     marque «no facturó», y esa marca se puede quitar.
//
// ⭐ SIN IMPORTS, a propósito: se prueba sola (scripts/test-pago-viajes.mjs).

// Arrancaba el 15-sep; el 17-sep el cliente pidió que las tarifas rijan desde el 14-sep.
import { unidadTarifa, cuentaDelTipo, type UnidadTarifaViaje } from './tarifaViajeUnidad';

export const INICIO_PAGO_VIAJES = '2026-09-14';

export type ZonaPagoViaje = 'este' | 'oeste';
export type ModoPago = 'jornada' | 'viaje';

/** A quién le toca una tarifa, de la menos a la más específica. */
export type AlcanceTarifa = 'general' | 'empresa' | 'grupo' | 'camion';
export const ALCANCES_TARIFA: AlcanceTarifa[] = ['general', 'empresa', 'grupo', 'camion'];

export type TarifaViaje = {
  id: string;
  /** 'este' / 'oeste'; null = ambas zonas. */
  zona: string | null;
  /** Sin dato = general (las tarifas anteriores a los alcances). */
  alcance?: string | null;
  company_id?: string | null;
  grupo_nombre?: string | null;
  /** Camiones de una tarifa de grupo o de camión (fijados al crearla). */
  machinery_ids?: string[] | null;
  precio: number | string;
  desde: string;
  hasta?: string | null;
  nota?: string | null;
  created_at?: string | null;
  created_by_nombre?: string | null;
  anulada_at?: string | null;
  anulada_motivo?: string | null;
  /**
   * QUÉ PASA CON LOS DÍAS QUE ESA TARIFA YA RIGIÓ, al anularla (08-oct-2026).
   * Ver `anuladaModo`. Sin dato = 'siempre', que es como se portó siempre.
   */
  anulada_modo?: string | null;
};

/**
 * Las dos cosas distintas que puede significar «anular una tarifa» (08-oct-2026).
 *
 * ⚠️ POR QUÉ EXISTE. Hasta hoy `anulada_at` borraba la tarifa de TODAS las fechas,
 *    también de los días que ya había regido. Pero el manual enseña a anular como la
 *    forma NORMAL de cambiar un precio («no se editan: se anulan y creas otra»), así
 *    que cada cambio de precio borraba la historia sin avisar: el 04-oct se anularon
 *    las tarifas de $30 (este) y $50 (oeste) y los 1.157 viajes del 14 al 27 de sep
 *    —$36.390— pasaron a salir «sin tarifa» en $0, y en el papel solo quedaron los
 *    viajes con tipo congelado («Este → Oeste», $100). Reclamo del 08-oct-2026:
 *    «si para una fecha coloqué una y en otra fecha otra, no debería afectar».
 *
 * - 'desde_ahora' → rigió desde su `desde` hasta el día en que la anularon. Es lo
 *   que quiere decir un cambio de precio normal, y el default de la pantalla.
 * - 'siempre'     → nunca rigió, en ninguna fecha. Para la tarifa que fue un ERROR
 *   (la que se creó y se anuló a los 46 segundos). Es el valor por omisión acá
 *   para que, mientras la columna no exista en la base, NADA cambie de precio.
 */
export type AnuladaModo = 'desde_ahora' | 'siempre';

export function anuladaModo(t: { anulada_modo?: unknown } | null | undefined): AnuladaModo {
  return String(t?.anulada_modo ?? '').trim().toLowerCase() === 'desde_ahora' ? 'desde_ahora' : 'siempre';
}

export type ModoPagoFila = {
  id?: string;
  machinery_id: string;
  modo: string;
  desde: string;
  nota?: string | null;
  created_at?: string | null;
  created_by_nombre?: string | null;
};

export type MarcaViaje = {
  id?: string;
  viaje_id: string;
  facturable: boolean;
  motivo?: string | null;
  created_at?: string | null;
  created_by_nombre?: string | null;
};

export type ViajePago = {
  id: string;
  machinery_id: string | null;
  machine_code?: string | null;
  company_id: string | null;
  zona_pago: string | null;
  registered_at: string;
  estado_maquina?: string | null;
  folio?: number | string | null;
  origen?: string | null;
  fuera_catalogo?: boolean | null;
  placa_snap?: string | null;
  ubicacion_nombre?: string | null;
  listero_name?: string | null;
  /**
   * TIPO DE VIAJE (26-sep-2026): tarifa con nombre, CONGELADA en el viaje al
   * registrarlo. Si el viaje trae tipo, SU tarifa manda sobre la de zona; si
   * el tipo quedó sin precio, el viaje sale «tipo sin tarifa» — visible y sin
   * pagar, nunca pagado con la tarifa de zona por adivinanza.
   */
  tipo_viaje_nombre?: string | null;
  tipo_viaje_tarifa?: number | string | null;
  /**
   * ⚖️ LA UNIDAD DE ESA TARIFA, congelada en el viaje (07-oct-2026):
   * 'ton' = el precio es POR TONELADA y se multiplica por el peso a pagar.
   * NULL o cualquier otra cosa = 'viaje', que es lo que son los miles de
   * viajes anteriores a hoy.
   */
  tipo_viaje_unidad?: string | null;
  /** El peso a pagar (bruto − tara) en kilos. Lo necesita la tarifa por
   *  tonelada; para la tarifa por viaje ni se mira. */
  peso_neto_kg?: number | string | null;
  /** FRENTE DE TRABAJO (28-sep-2026): de dónde recogió, congelado en el viaje.
   *  Solo informa (agrupar y columna del papel): NO toca ningún cálculo. */
  frente_nombre?: string | null;
};

/** El tipo de viaje de una fila, limpio. null = viaje normal (por zona). */
export function tipoDeViajePago(v: { tipo_viaje_nombre?: string | null } | null | undefined): string | null {
  const n = String(v?.tipo_viaje_nombre ?? '').replace(/\s+/g, ' ').trim();
  return n || null;
}

/** Por qué un viaje de un camión por viaje no suma dinero. */
export type MotivoSinPago = 'no_facturo' | 'sin_zona' | 'sin_tarifa' | 'sin_empresa' | 'fuera_catalogo' | 'tipo_sin_tarifa' | 'tipo_sin_peso';

export type LineaViaje = {
  viaje: ViajePago;
  jornada: string;
  zona: ZonaPagoViaje | null;
  tarifa: TarifaViaje | null;
  /** El precio del catálogo: del viaje entero, o de UNA tonelada si `unidad`
   *  es 'ton'. Leerlo sin mirar la unidad es leer $2 donde hay $44. */
  precio: number;
  /** ⚖️ En qué unidad cobra este viaje. 'viaje' para todo lo de siempre. */
  unidad: UnidadTarifaViaje;
  /** Las toneladas que entraron en la cuenta. null = la tarifa no las usa. */
  toneladas: number | null;
  monto: number;
  facturable: boolean;
  marca: MarcaViaje | null;
  motivoSinPago: MotivoSinPago | null;
};

export type CamionPago = {
  machineryId: string;
  code: string;
  placa: string | null;
  viajes: number;
  pagados: number;
  este: number;
  oeste: number;
  noFacturados: number;
  pendientes: number;
  monto: number;
};

export type PagoViajesGrupo = {
  companyId: string | null;
  semana: string;
  lineas: LineaViaje[];
  porCamion: CamionPago[];
  viajes: number;
  pagados: number;
  noFacturados: number;
  pendientes: number;
  montoUSD: number;
};

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const dia = (v: unknown): string => String(v ?? '').slice(0, 10);

export function zonaViajeValida(v: unknown): ZonaPagoViaje | null {
  const s = String(v ?? '').trim().toLowerCase();
  return s === 'este' || s === 'oeste' ? s : null;
}

/** Jornada (7am a 7am, Caracas UTC−4 fijo) de un instante ISO. */
export function jornadaDeInstante(iso: string | null | undefined): string {
  const t = Date.parse(String(iso ?? ''));
  if (!Number.isFinite(t)) return '';
  return new Date(t - 11 * 3600 * 1000).toISOString().slice(0, 10);
}

/** Modos por máquina, del más viejo al más nuevo. */
export type IndiceModos = Map<string, ModoPagoFila[]>;

export function indexarModos(filas: ModoPagoFila[] | null | undefined): IndiceModos {
  const idx: IndiceModos = new Map();
  (filas ?? []).forEach((f) => {
    if (!f?.machinery_id || !f.desde || (f.modo !== 'jornada' && f.modo !== 'viaje')) return;
    const lista = idx.get(f.machinery_id) ?? [];
    lista.push(f);
    idx.set(f.machinery_id, lista);
  });
  // El id desempata: dos filas del mismo día y la misma hora daban un ganador distinto
  // según el orden en que las devolviera la base, y eso decide si el camión cobra.
  idx.forEach((lista) =>
    lista.sort((a, b) =>
      dia(a.desde).localeCompare(dia(b.desde))
      || String(a.created_at ?? '').localeCompare(String(b.created_at ?? ''))
      || String(a.id ?? '').localeCompare(String(b.id ?? ''))),
  );
  return idx;
}

/** La fila de modo que rige esa jornada (la última con desde <= fecha), o null. */
export function filaModoEn(idx: IndiceModos | null | undefined, machineryId: string | null | undefined, fecha: string): ModoPagoFila | null {
  if (!idx || !machineryId) return null;
  const f = dia(fecha);
  let vigente: ModoPagoFila | null = null;
  for (const m of idx.get(machineryId) ?? []) if (dia(m.desde) <= f) vigente = m;
  return vigente;
}

/** Modo de pago de una máquina en una jornada. Sin fila = jornada (no entra al pago por viaje). */
export function modoPagoEn(idx: IndiceModos | null | undefined, machineryId: string | null | undefined, fecha: string): ModoPago {
  return filaModoEn(idx, machineryId, fecha)?.modo === 'viaje' ? 'viaje' : 'jornada';
}

/** Alcance de una tarifa; sin dato = general; uno inventado = null (no aplica a nadie). */
export function alcanceTarifa(t: { alcance?: unknown } | null | undefined): AlcanceTarifa | null {
  const a = String(t?.alcance ?? '').trim().toLowerCase() || 'general';
  return (ALCANCES_TARIFA as string[]).includes(a) ? (a as AlcanceTarifa) : null;
}

const NIVEL_ALCANCE: Record<AlcanceTarifa, number> = { general: 1, empresa: 2, grupo: 3, camion: 4 };

/** Camión y empresa (la GUARDADA en el viaje) para elegir las tarifas especiales. */
export type ContextoTarifa = { machineryId?: string | null; companyId?: string | null };

/** ¿La tarifa le toca a un viaje de esa zona, camión y empresa? (sin mirar fechas ni precio) */
export function tarifaAplica(t: TarifaViaje, zona: ZonaPagoViaje, ctx?: ContextoTarifa | null): boolean {
  const sinZona = t.zona == null || String(t.zona).trim() === '';
  if (!sinZona && zonaViajeValida(t.zona) !== zona) return false;
  switch (alcanceTarifa(t)) {
    case 'general': return true;
    case 'empresa': return !!ctx?.companyId && t.company_id === ctx.companyId;
    case 'grupo':
    case 'camion': return !!ctx?.machineryId && (t.machinery_ids ?? []).includes(ctx.machineryId);
    default: return false;
  }
}

const compararClaves = (a: (string | number)[], b: (string | number)[]) => {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
  return 0;
};

/**
 * Tarifa de un viaje en una jornada. Entre las que le tocan (zona, camión, empresa):
 *   1. Manda la MÁS ESPECÍFICA: camión → grupo → empresa → todos.
 *   2. Del mismo alcance, la BLINDADA (con `hasta`) que cubre la fecha; entre dos
 *      blindadas, la última que se guardó.
 *   3. Si no hay blindada, la de `desde` más reciente; con el mismo `desde`, la última guardada.
 *   · Las de precio 0 no cuentan. Sin `ctx` solo cuentan las de todos.
 *   · ANULADAS (08-oct-2026): una anulada con `anulada_modo = 'desde_ahora'` SIGUE
 *     rigiendo los días anteriores a su anulación (ver `anuladaModo`); con 'siempre'
 *     —el valor por omisión— no cuenta en ninguna fecha, como antes.
 */
export function tarifaViajeEn(tarifas: TarifaViaje[] | null | undefined, zona: unknown, fecha: string, ctx?: ContextoTarifa | null): TarifaViaje | null {
  const z = zonaViajeValida(zona);
  const f = dia(fecha);
  if (!z || !f) return null;
  let mejor: TarifaViaje | null = null;
  let claveMejor: (string | number)[] = [];
  for (const t of tarifas ?? []) {
    if (!t || !(num(t.precio) > 0) || !tarifaAplica(t, z, ctx)) continue;
    if (t.anulada_at) {
      // Fue un error: no rigió nunca.
      if (anuladaModo(t) !== 'desde_ahora') continue;
      // Dejó de regir el día que la anularon (jornada, como todo lo demás acá).
      // Inclusive: si ese mismo día crearon la nueva, la nueva gana por `desde`.
      if (f > jornadaDeInstante(t.anulada_at)) continue;
    }
    const desde = dia(t.desde);
    if (!desde || desde > f) continue;
    const hasta = t.hasta ? dia(t.hasta) : '';
    if (hasta && f > hasta) continue;
    const clave = [NIVEL_ALCANCE[alcanceTarifa(t) as AlcanceTarifa], hasta ? 1 : 0, hasta ? '' : desde, String(t.created_at ?? '')];
    if (!mejor || compararClaves(clave, claveMejor) > 0) { mejor = t; claveMejor = clave; }
  }
  return mejor;
}

/**
 * QUÉ VIAJES YA REGISTRADOS LE CAMBIARÍA EL PRECIO una tarifa antes de guardarla
 * (08-oct-2026, a pedido: «si coloco una tarifa hoy debería aplicarse para lo que se
 * empiece a registrar ese día, y no para los días anteriores»).
 *
 * No prohíbe nada —a veces hay que poner un precio acordado la semana pasada—: se
 * calcula EXACTO, metiendo la tarifa candidata en la lista y volviendo a resolver
 * cada viaje, y la pantalla lo dice antes de guardar. Así nadie reprecia 970 viajes
 * ya cobrados sin enterarse.
 *
 * Solo mira los viajes de jornadas ANTERIORES a `hoy` que hoy se pagan por ZONA (los
 * que llevan tipo de viaje congelado no usan estas tarifas) y que estén facturando.
 */
export type RetroTarifa = { desdeJornada: string; hastaJornada: string; dias: number };

/**
 * ¿Esta tarifa pisaría días YA TRABAJADOS? Devuelve el tramo retroactivo, o null si
 * solo rige de hoy en adelante. Puro: el conteo de viajes lo pone la pantalla, que lo
 * pide a la base solo cuando hace falta (`contarViajesEnJornadas`).
 *
 * El tramo va del `desde` elegido hasta AYER: el día de hoy no es retroactivo (todavía
 * se está registrando), y ahí es justo donde el cliente quiere que empiece a regir.
 */
export function retroDeTarifa(desde: string, hoy: string, hasta?: string | null): RetroTarifa | null {
  const d = dia(desde);
  const h = dia(hoy);
  if (!d || !h || d >= h) return null;
  const ayer = new Date(Date.parse(`${h}T12:00:00Z`) - 86400000).toISOString().slice(0, 10);
  const fin = hasta && dia(hasta) < ayer ? dia(hasta) : ayer;
  if (fin < d) return null;
  const dias = Math.round((Date.parse(`${fin}T12:00:00Z`) - Date.parse(`${d}T12:00:00Z`)) / 86400000) + 1;
  return { desdeJornada: d, hastaJornada: fin, dias };
}

/** Revisa una tarifa antes de guardarla. Devuelve el motivo del rechazo o null. */
export function validarTarifa(t: {
  zona: unknown; precio: unknown; desde: unknown; hasta?: unknown;
  alcance?: unknown; companyId?: unknown; camiones?: unknown[] | null; grupoNombre?: unknown;
}): string | null {
  const zona = String(t.zona ?? '').trim().toLowerCase();
  if (zona !== 'ambas' && !zonaViajeValida(zona)) return 'Elige la zona (Este, Oeste o ambas).';
  const p = Number(String(t.precio ?? '').replace(',', '.'));
  if (!Number.isFinite(p) || p <= 0) return 'Escribe un precio mayor que 0.';
  const desde = dia(t.desde);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(desde)) return 'Elige la fecha desde la que rige.';
  const hasta = t.hasta ? dia(t.hasta) : '';
  if (hasta && !/^\d{4}-\d{2}-\d{2}$/.test(hasta)) return 'La fecha «hasta» no es válida.';
  if (hasta && hasta < desde) return 'La fecha «hasta» no puede ser anterior a «desde».';
  const alcance = alcanceTarifa({ alcance: t.alcance });
  if (!alcance) return 'Elige a quién aplica la tarifa.';
  const camiones = Array.from(new Set((t.camiones ?? []).map((c) => String(c ?? '')).filter(Boolean)));
  if (alcance === 'empresa' && !String(t.companyId ?? '').trim()) return 'Elige la empresa.';
  if (alcance === 'camion' && camiones.length !== 1) return 'Elige el camión.';
  if (alcance === 'grupo' && !camiones.length) return 'Elige los camiones del grupo.';
  if (alcance === 'grupo' && String(t.grupoNombre ?? '').trim().length < 2) return 'Ponle nombre al grupo (p. ej. «Chutos de la empresa»).';
  return null;
}

/** «Este», «Oeste» o «Ambas zonas». */
export function etiquetaZonaTarifa(t: { zona?: unknown }): string {
  const z = zonaViajeValida(t.zona);
  return z === 'oeste' ? 'Oeste' : z === 'este' ? 'Este' : 'Ambas zonas';
}

/** Texto corto de una tarifa especial para el detalle del viaje; vacío si es de todos. */
export function etiquetaAlcanceCorta(t: TarifaViaje | null | undefined): string {
  switch (t ? alcanceTarifa(t) : null) {
    case 'empresa': return 'tarifa de la empresa';
    case 'grupo': return `tarifa del grupo «${t?.grupo_nombre ?? ''}»`;
    case 'camion': return 'tarifa del camión';
    default: return '';
  }
}

/** Última marca de cada viaje. */
export type IndiceMarcas = Map<string, MarcaViaje>;

export function indexarMarcas(filas: MarcaViaje[] | null | undefined): IndiceMarcas {
  const idx: IndiceMarcas = new Map();
  // Clave con el id: con dos marcas de la misma hora, mandaba la que llegara de última y
  // el mismo viaje salía «facturó» o «no facturó» según el orden de lectura.
  const clave = (m: MarcaViaje) => `${String(m.created_at ?? '')}|${String(m.id ?? '')}`;
  (filas ?? []).forEach((m) => {
    if (!m?.viaje_id || typeof m.facturable !== 'boolean') return;
    const prev = idx.get(m.viaje_id);
    if (!prev || clave(m) >= clave(prev)) idx.set(m.viaje_id, m);
  });
  return idx;
}

/** Sin marca = facturó. */
export function viajeFacturable(idx: IndiceMarcas | null | undefined, viajeId: string): boolean {
  const m = idx?.get(viajeId);
  return m ? m.facturable : true;
}

/**
 * Pago por viajes, agrupado por empresa (la GUARDADA en el viaje) y semana.
 * Solo entran los viajes desde `desde` de camiones que ese día están POR VIAJE, más los
 * de camiones fuera del catálogo, que no tienen modo: esos salen como pendientes para
 * que nadie los pierda de vista.
 */
export function calcularPagoViajes(opts: {
  viajes: ViajePago[] | null | undefined;
  modos: IndiceModos;
  tarifas: TarifaViaje[] | null | undefined;
  marcas: IndiceMarcas;
  semanaDe: (jornada: string) => string;
  desde?: string;
}): Map<string, PagoViajesGrupo> {
  const desde = opts.desde ?? INICIO_PAGO_VIAJES;
  const grupos = new Map<string, PagoViajesGrupo>();
  const camiones = new Map<string, Map<string, CamionPago>>();

  (opts.viajes ?? []).forEach((v) => {
    if (!v?.id) return;
    const jornada = jornadaDeInstante(v.registered_at);
    if (!jornada || jornada < desde) return;
    const fuera = !!v.fuera_catalogo || !v.machinery_id;
    if (!fuera && modoPagoEn(opts.modos, v.machinery_id, jornada) !== 'viaje') return;

    const zona = zonaViajeValida(v.zona_pago);
    // ⭐ EL TIPO DE VIAJE MANDA (26-sep-2026): si el viaje lleva tipo, su tarifa
    //    congelada es el precio y la tarifa de zona NI SE BUSCA — mezclarlas es
    //    como se pagaría dos veces distinto el mismo cruce. Sin tipo, todo
    //    sigue EXACTAMENTE como siempre (amarrado por test).
    const tipoNombre = tipoDeViajePago(v);
    const tarifaTipo = num(v.tipo_viaje_tarifa);
    // ⚖️ POR VIAJE O POR TONELADA (07-oct-2026). La unidad va congelada en el
    //    viaje; con 'ton' el precio se multiplica por el peso a pagar, y un
    //    viaje sin peso NO se paga (ver `cuentaDelTipo`).
    const unidad = unidadTarifa(v.tipo_viaje_unidad);
    const cuenta = tipoNombre ? cuentaDelTipo(tarifaTipo, unidad, v.peso_neto_kg) : null;
    const tarifa = tipoNombre ? null
      : zona ? tarifaViajeEn(opts.tarifas, zona, jornada, { machineryId: v.machinery_id, companyId: v.company_id }) : null;
    const marca = opts.marcas.get(v.id) ?? null;
    const facturable = marca ? marca.facturable : true;
    let motivoSinPago: MotivoSinPago | null = null;
    // La marca a mano manda: si alguien dijo «no facturó», ese es el motivo, aunque además
    // le falte la empresa. Antes salía en «sin pagar» y el jefe no encontraba su marca.
    if (!facturable) motivoSinPago = 'no_facturo';
    // Un camión fuera del catálogo no está inscrito en el pago: se ve, pero no se paga solo.
    else if (fuera) motivoSinPago = 'fuera_catalogo';
    else if (!v.company_id) motivoSinPago = 'sin_empresa';
    // Un tipo sin precio NO cae a la tarifa de zona: la encargada lo marcó
    // especial, y pagarlo como normal sería pagar mal en silencio. Sale
    // visible como «tipo sin tarifa» hasta que el tipo tenga precio (o la
    // jefa le corrija el tipo al viaje).
    // ⚠️ Un tipo POR TONELADA sin peso cargado tampoco se paga, y se dice:
    //    no cae a la tarifa por viaje ni a la de zona. Adivinarle el peso a un
    //    viaje es inventar plata.
    else if (tipoNombre) {
      if (cuenta!.falta === 'tarifa') motivoSinPago = 'tipo_sin_tarifa';
      else if (cuenta!.falta === 'peso') motivoSinPago = 'tipo_sin_peso';
    }
    else if (!zona) motivoSinPago = 'sin_zona';
    else if (!tarifa) motivoSinPago = 'sin_tarifa';
    const precio = tipoNombre ? cuenta!.precio : tarifa ? num(tarifa.precio) : 0;
    const monto = motivoSinPago ? 0 : tipoNombre ? cuenta!.monto : precio;

    const semana = opts.semanaDe(jornada);
    const clave = `${v.company_id ?? ''}|${semana}`;
    const g = grupos.get(clave) ?? { companyId: v.company_id ?? null, semana, lineas: [], porCamion: [], viajes: 0, pagados: 0, noFacturados: 0, pendientes: 0, montoUSD: 0 };
    g.lineas.push({ viaje: v, jornada, zona, tarifa, precio, unidad: tipoNombre ? unidad : 'viaje', toneladas: cuenta?.toneladas ?? null, monto, facturable, marca, motivoSinPago });
    g.viajes += 1;
    if (monto > 0) g.pagados += 1;
    else if (motivoSinPago === 'no_facturo') g.noFacturados += 1;
    else g.pendientes += 1;
    g.montoUSD += monto;
    grupos.set(clave, g);

    const cm = camiones.get(clave) ?? new Map<string, CamionPago>();
    const idCamion = v.machinery_id ?? `fuera:${v.machine_code ?? '—'}`;
    const c = cm.get(idCamion) ?? { machineryId: idCamion, code: v.machine_code ?? '—', placa: v.placa_snap ?? null, viajes: 0, pagados: 0, este: 0, oeste: 0, noFacturados: 0, pendientes: 0, monto: 0 };
    c.viajes += 1;
    if (monto > 0) {
      c.pagados += 1;
      if (zona === 'este') c.este += 1;
      if (zona === 'oeste') c.oeste += 1;
    } else if (motivoSinPago === 'no_facturo') c.noFacturados += 1;
    else c.pendientes += 1;
    c.monto += monto;
    if (!c.placa && v.placa_snap) c.placa = v.placa_snap;
    cm.set(idCamion, c);
    camiones.set(clave, cm);
  });

  grupos.forEach((g, clave) => {
    g.lineas.sort((a, b) => String(a.viaje.registered_at).localeCompare(String(b.viaje.registered_at)));
    g.porCamion = Array.from(camiones.get(clave)?.values() ?? []).sort((a, b) => a.code.localeCompare(b.code, 'es', { numeric: true }));
  });
  return grupos;
}

/** Renglón «N viajes × precio» de un camión, para los bloques de viajes de los informes. */
export type ItemViajePagado = { code: string; zona: ZonaPagoViaje; precio: number; viajes: number };

/** Viajes PAGADOS agrupados por camión, zona y precio (los no pagados no entran). */
export function itemsViajePagados(lineas: LineaViaje[] | null | undefined): ItemViajePagado[] {
  const m = new Map<string, ItemViajePagado>();
  (lineas ?? []).forEach((l) => {
    if (!(l.monto > 0) || !l.zona) return;
    const code = l.viaje.machine_code ?? '—';
    // Agrupa por MÁQUINA, no por código: dos camiones con el mismo código salían en un solo
    // renglón en el PDF y en dos en pantalla.
    const k = `${l.viaje.machinery_id ?? `code:${code}`}|${l.zona}|${l.precio}`;
    const it = m.get(k) ?? { code, zona: l.zona, precio: l.precio, viajes: 0 };
    it.viajes += 1;
    m.set(k, it);
  });
  return Array.from(m.values()).sort((a, b) => a.code.localeCompare(b.code, 'es', { numeric: true }) || a.precio - b.precio);
}

/** Viajes cuya jornada cae dentro de [desde, hasta] (fechas ISO, ambos incluidos). */
export function viajesEnRango(viajes: ViajePago[] | null | undefined, desde: string, hasta: string): ViajePago[] {
  return (viajes ?? []).filter((v) => {
    const j = jornadaDeInstante(v?.registered_at);
    return !!j && j >= desde && j <= hasta;
  });
}

/** Texto corto del motivo, para pantalla y PDF. */
export function etiquetaMotivoSinPago(m: MotivoSinPago | null): string {
  switch (m) {
    case 'no_facturo': return 'No facturó';
    case 'sin_zona': return 'Sin zona';
    case 'sin_tarifa': return 'Sin tarifa';
    case 'sin_empresa': return 'Sin empresa';
    case 'fuera_catalogo': return 'Camión fuera del catálogo';
    case 'tipo_sin_tarifa': return 'Tipo de viaje sin tarifa';
    case 'tipo_sin_peso': return 'Tarifa por tonelada sin peso cargado';
    default: return '';
  }
}

/** Un camión que hizo viajes sin estar en el pago por viaje. */
export type CamionSinPagoViaje = {
  machineryId: string;
  code: string;
  companyId: string | null;
  viajes: number;
  /** Nunca se le asignó modo (vs. se le quitó a propósito). */
  sinConfigurar: boolean;
};

/**
 * Camiones que REGISTRARON viajes en el rango pero no entran al pago por viaje.
 *
 * ⭐ El cálculo los descarta en silencio y esos viajes no salen en ninguna pantalla: ni
 *    pagados, ni «sin pagar». Así el jefe ve lo que se está quedando por fuera y decide.
 */
export function viajesFueraDelPago(opts: {
  viajes: ViajePago[] | null | undefined;
  modos: IndiceModos;
  desde?: string;
}): CamionSinPagoViaje[] {
  const desde = opts.desde ?? INICIO_PAGO_VIAJES;
  const m = new Map<string, CamionSinPagoViaje>();
  (opts.viajes ?? []).forEach((v) => {
    if (!v?.id || !v.machinery_id || v.fuera_catalogo) return;
    const jornada = jornadaDeInstante(v.registered_at);
    if (!jornada || jornada < desde) return;
    const fila = filaModoEn(opts.modos, v.machinery_id, jornada);
    if (fila?.modo === 'viaje') return;
    const c = m.get(v.machinery_id) ?? {
      machineryId: v.machinery_id,
      code: v.machine_code ?? '—',
      companyId: v.company_id ?? null,
      viajes: 0,
      sinConfigurar: true,
    };
    c.viajes += 1;
    if (fila) c.sinConfigurar = false;
    m.set(v.machinery_id, c);
  });
  return Array.from(m.values()).sort((a, b) => b.viajes - a.viajes || a.code.localeCompare(b.code, 'es', { numeric: true }));
}
