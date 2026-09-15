// PAGO DE VIAJES DE CAMIONES (15-sep-2026).
//
// Pedido del cliente: desde el 15-sep-2026 los camiones se le pagan a su empresa POR
// VIAJE, con la tarifa de la zona del CDT. Vive SOLO en el módulo de Viajes de camiones:
// no toca jornadas, Control de Maquinaria ni Control de Pagos. Tres reglas:
//   · Los precios se cambian como en jornada: un precio GENERAL desde una fecha en
//     adelante, o uno BLINDADO a un rango de fechas que manda sobre el general.
//   · Cada camión se pone o se quita del pago por viaje, con fecha (p. ej. los chutos).
//     Un camión sin asignar no entra al pago por viaje.
//   · El estado del camión no decide nada: cada viaje se paga salvo que alguien lo
//     marque «no facturó», y esa marca se puede quitar.
//
// ⭐ SIN IMPORTS, a propósito: se prueba sola (scripts/test-pago-viajes.mjs).

export const INICIO_PAGO_VIAJES = '2026-09-15';

export type ZonaPagoViaje = 'este' | 'oeste';
export type ModoPago = 'jornada' | 'viaje';

export type TarifaViaje = {
  id: string;
  zona: string;
  precio: number | string;
  desde: string;
  hasta?: string | null;
  nota?: string | null;
  created_at?: string | null;
  created_by_nombre?: string | null;
  anulada_at?: string | null;
  anulada_motivo?: string | null;
};

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
};

/** Por qué un viaje de un camión por viaje no suma dinero. */
export type MotivoSinPago = 'no_facturo' | 'sin_zona' | 'sin_tarifa' | 'sin_empresa';

export type LineaViaje = {
  viaje: ViajePago;
  jornada: string;
  zona: ZonaPagoViaje | null;
  tarifa: TarifaViaje | null;
  precio: number;
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
  idx.forEach((lista) =>
    lista.sort((a, b) => dia(a.desde).localeCompare(dia(b.desde)) || String(a.created_at ?? '').localeCompare(String(b.created_at ?? ''))),
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

/**
 * Tarifa de una zona en una jornada.
 *   · La BLINDADA (con `hasta`) que cubre la fecha manda sobre la general; entre dos
 *     blindadas que se pisan, la última que se guardó.
 *   · Si no hay blindada, la GENERAL con el `desde` más reciente; con el mismo `desde`,
 *     la última que se guardó.
 *   · Las anuladas no cuentan.
 */
export function tarifaViajeEn(tarifas: TarifaViaje[] | null | undefined, zona: unknown, fecha: string): TarifaViaje | null {
  const z = zonaViajeValida(zona);
  const f = dia(fecha);
  if (!z || !f) return null;
  let blindada: TarifaViaje | null = null;
  let general: TarifaViaje | null = null;
  const at = (t: TarifaViaje) => String(t.created_at ?? '');
  for (const t of tarifas ?? []) {
    if (!t || t.anulada_at || zonaViajeValida(t.zona) !== z || !(num(t.precio) > 0)) continue;
    const desde = dia(t.desde);
    if (!desde || desde > f) continue;
    const hasta = t.hasta ? dia(t.hasta) : '';
    if (hasta) {
      if (f > hasta) continue;
      if (!blindada || at(t) > at(blindada)) blindada = t;
    } else if (!general || desde > dia(general.desde) || (desde === dia(general.desde) && at(t) > at(general))) {
      general = t;
    }
  }
  return blindada ?? general;
}

/** Revisa una tarifa antes de guardarla. Devuelve el motivo del rechazo o null. */
export function validarTarifa(t: { zona: unknown; precio: unknown; desde: unknown; hasta?: unknown }): string | null {
  if (!zonaViajeValida(t.zona)) return 'Elige la zona (Este u Oeste).';
  const p = Number(String(t.precio ?? '').replace(',', '.'));
  if (!Number.isFinite(p) || p <= 0) return 'Escribe un precio mayor que 0.';
  const desde = dia(t.desde);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(desde)) return 'Elige la fecha desde la que rige.';
  const hasta = t.hasta ? dia(t.hasta) : '';
  if (hasta && !/^\d{4}-\d{2}-\d{2}$/.test(hasta)) return 'La fecha «hasta» no es válida.';
  if (hasta && hasta < desde) return 'La fecha «hasta» no puede ser anterior a «desde».';
  return null;
}

/** Última marca de cada viaje. */
export type IndiceMarcas = Map<string, MarcaViaje>;

export function indexarMarcas(filas: MarcaViaje[] | null | undefined): IndiceMarcas {
  const idx: IndiceMarcas = new Map();
  (filas ?? []).forEach((m) => {
    if (!m?.viaje_id || typeof m.facturable !== 'boolean') return;
    const prev = idx.get(m.viaje_id);
    if (!prev || String(m.created_at ?? '') >= String(prev.created_at ?? '')) idx.set(m.viaje_id, m);
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
    const tarifa = zona ? tarifaViajeEn(opts.tarifas, zona, jornada) : null;
    const marca = opts.marcas.get(v.id) ?? null;
    const facturable = marca ? marca.facturable : true;
    let motivoSinPago: MotivoSinPago | null = null;
    if (!v.company_id) motivoSinPago = 'sin_empresa';
    else if (!facturable) motivoSinPago = 'no_facturo';
    else if (!zona) motivoSinPago = 'sin_zona';
    else if (!tarifa) motivoSinPago = 'sin_tarifa';
    const precio = tarifa ? num(tarifa.precio) : 0;
    const monto = motivoSinPago ? 0 : precio;

    const semana = opts.semanaDe(jornada);
    const clave = `${v.company_id ?? ''}|${semana}`;
    const g = grupos.get(clave) ?? { companyId: v.company_id ?? null, semana, lineas: [], porCamion: [], viajes: 0, pagados: 0, noFacturados: 0, pendientes: 0, montoUSD: 0 };
    g.lineas.push({ viaje: v, jornada, zona, tarifa, precio, monto, facturable, marca, motivoSinPago });
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
    const k = `${code}|${l.zona}|${l.precio}`;
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
    default: return '';
  }
}
