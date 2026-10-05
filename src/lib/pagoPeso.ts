// PAGO POR PESO DE LOS VIAJES DE CAMIONES (03-oct-2026).
//
// Pedido del cliente: «hay que gestionar el pago de los pesajes de la romana, los
// pesos de viajes de camiones (…) un histórico (…) ver por empresa, por máquina (…)
// con el resumen ejecutivo, todas las opciones (…) precio por tonelada, por kg, por
// máquina, por empresa» y «hagamos un reporte aparte del de viajes, porque ya está
// el de pago por viajes; ahora necesito uno por peso, y de normal se paga por peso
// que cargue el camión».
//
// Es un apartado APARTE del pago por viaje (pagoViajes.ts): tablas propias, cálculo
// propio y papel propio. Reglas:
//   · TODO camión entra: no hay «modo» como en el pago por viaje. Lo normal es que
//     el camión cobre por lo que cargó.
//   · Se paga el NETO de la romana (bruto − tara, que calcula la base) × el precio
//     que rige ese día. El precio se guarda POR TONELADA o POR KILO; acá todo se
//     lleva a $/kg para sumar.
//   · Las tarifas se cambian como en el pago por viaje: una GENERAL desde una fecha,
//     o BLINDADA a un rango que manda sobre la general. Para todos, una empresa, un
//     grupo de camiones o un camión; en Este, Oeste o ambas zonas: manda la más
//     específica (tarifaPesoEn). Nunca se editan ni se borran: se anulan.
//   · Un viaje SIN peso no se inventa: sale $0 con alerta «sin peso».
//   · La marca «no facturó» del pago por viaje se RESPETA: es un hecho del viaje,
//     no del modo de pago.
//
// ⭐ SIN IMPORTS, a propósito: se prueba sola (scripts/test-pago-peso.mjs).

export type UnidadTarifaPeso = 'ton' | 'kg';
export type ZonaPeso = 'este' | 'oeste';
export type AlcancePeso = 'general' | 'empresa' | 'grupo' | 'camion';
export const ALCANCES_PESO: AlcancePeso[] = ['general', 'empresa', 'grupo', 'camion'];

export type TarifaPeso = {
  id: string;
  /** 'ton' = el precio es por tonelada; 'kg' = por kilo. */
  unidad: string;
  precio: number | string;
  /** 'este' / 'oeste'; null = ambas zonas. */
  zona?: string | null;
  alcance?: string | null;
  company_id?: string | null;
  grupo_nombre?: string | null;
  machinery_ids?: string[] | null;
  desde: string;
  hasta?: string | null;
  nota?: string | null;
  created_at?: string | null;
  created_by_nombre?: string | null;
  anulada_at?: string | null;
  anulada_motivo?: string | null;
};

export type MarcaPeso = { viaje_id: string; facturable: boolean; created_at?: string | null; id?: string };

export type ViajePeso = {
  id: string;
  machinery_id: string | null;
  machine_code?: string | null;
  company_id: string | null;
  zona_pago: string | null;
  registered_at: string;
  folio?: number | string | null;
  fuera_catalogo?: boolean | null;
  placa_snap?: string | null;
  ubicacion_nombre?: string | null;
  listero_name?: string | null;
  frente_nombre?: string | null;
  peso_bruto_kg?: number | string | null;
  peso_tara_kg?: number | string | null;
  peso_neto_kg?: number | string | null;
};

export type MotivoSinPagoPeso = 'no_facturo' | 'sin_peso' | 'sin_tarifa' | 'sin_empresa' | 'fuera_catalogo';

export type LineaPeso = {
  viaje: ViajePeso;
  jornada: string;
  zona: ZonaPeso | null;
  tarifa: TarifaPeso | null;
  /** Neto en KILOS (0 si el viaje no trae peso válido). */
  kg: number;
  /** $ por kilo con el que se pagó (0 si no se pagó). */
  precioKg: number;
  monto: number;
  facturable: boolean;
  motivoSinPago: MotivoSinPagoPeso | null;
};

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const dia = (v: unknown): string => String(v ?? '').slice(0, 10);
const limpio = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
const redondear = (n: number) => Math.round(n * 100) / 100;

export function zonaPesoValida(v: unknown): ZonaPeso | null {
  const s = String(v ?? '').trim().toLowerCase();
  return s === 'este' || s === 'oeste' ? s : null;
}

/** Jornada (7am a 7am, Caracas UTC−4 fijo) de un instante ISO. */
export function jornadaDeInstantePeso(iso: string | null | undefined): string {
  const t = Date.parse(String(iso ?? ''));
  if (!Number.isFinite(t)) return '';
  return new Date(t - 11 * 3600 * 1000).toISOString().slice(0, 10);
}

export function unidadTarifaPeso(t: { unidad?: unknown } | null | undefined): UnidadTarifaPeso {
  return String(t?.unidad ?? '').trim().toLowerCase() === 'kg' ? 'kg' : 'ton';
}

/** El precio de la tarifa llevado a $ por KILO. */
export function precioPorKg(t: TarifaPeso | null | undefined): number {
  if (!t) return 0;
  const p = num(t.precio);
  if (!(p > 0)) return 0;
  return unidadTarifaPeso(t) === 'kg' ? p : p / 1000;
}

/** El NETO en kilos de un viaje: el guardado por la base, o bruto − tara si faltara. 0 = sin peso. */
export function netoKgDeViaje(v: ViajePeso | null | undefined): number {
  if (!v) return 0;
  if (v.peso_neto_kg != null && String(v.peso_neto_kg) !== '') {
    const n = num(v.peso_neto_kg);
    return n > 0 ? n : 0;
  }
  const b = num(v.peso_bruto_kg), t = num(v.peso_tara_kg);
  return b > 0 && t > 0 && b > t ? b - t : 0;
}

export function alcancePeso(t: { alcance?: unknown } | null | undefined): AlcancePeso | null {
  const a = String(t?.alcance ?? '').trim().toLowerCase() || 'general';
  return (ALCANCES_PESO as string[]).includes(a) ? (a as AlcancePeso) : null;
}

const NIVEL: Record<AlcancePeso, number> = { general: 1, empresa: 2, grupo: 3, camion: 4 };

export type ContextoPeso = { machineryId?: string | null; companyId?: string | null };

/** ¿La tarifa le toca a un viaje de esa zona (o sin zona), camión y empresa? */
export function tarifaPesoAplica(t: TarifaPeso, zona: ZonaPeso | null, ctx?: ContextoPeso | null): boolean {
  const zonaT = zonaPesoValida(t.zona);
  // Una tarifa CON zona solo paga viajes de esa zona; una sin zona paga cualquiera,
  // incluso el viaje al que le falta la zona (acá la zona no es obligatoria).
  if (zonaT && zonaT !== zona) return false;
  switch (alcancePeso(t)) {
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
 * Tarifa de peso de un viaje en una jornada. Entre las que le tocan:
 *   1. Manda la MÁS ESPECÍFICA: camión → grupo → empresa → todos.
 *   2. Del mismo alcance, la BLINDADA (con `hasta`) que cubre la fecha; entre dos
 *      blindadas, la última guardada.
 *   3. Si no hay blindada, la de `desde` más reciente; con el mismo `desde`, la última guardada.
 *   · Las anuladas y las de precio 0 no cuentan.
 */
export function tarifaPesoEn(tarifas: TarifaPeso[] | null | undefined, zona: unknown, fecha: string, ctx?: ContextoPeso | null): TarifaPeso | null {
  const z = zonaPesoValida(zona);
  const f = dia(fecha);
  if (!f) return null;
  let mejor: TarifaPeso | null = null;
  let claveMejor: (string | number)[] = [];
  for (const t of tarifas ?? []) {
    if (!t || t.anulada_at || !(num(t.precio) > 0) || !tarifaPesoAplica(t, z, ctx)) continue;
    const desde = dia(t.desde);
    if (!desde || desde > f) continue;
    const hasta = t.hasta ? dia(t.hasta) : '';
    if (hasta && f > hasta) continue;
    const clave = [NIVEL[alcancePeso(t) as AlcancePeso], hasta ? 1 : 0, hasta ? '' : desde, String(t.created_at ?? '')];
    if (!mejor || compararClaves(clave, claveMejor) > 0) { mejor = t; claveMejor = clave; }
  }
  return mejor;
}

/** Revisa una tarifa antes de guardarla. Devuelve el motivo del rechazo o null. */
export function validarTarifaPeso(t: {
  unidad: unknown; zona: unknown; precio: unknown; desde: unknown; hasta?: unknown;
  alcance?: unknown; companyId?: unknown; camiones?: unknown[] | null; grupoNombre?: unknown;
}): string | null {
  const u = String(t.unidad ?? '').trim().toLowerCase();
  if (u !== 'ton' && u !== 'kg') return 'Elige si el precio es por tonelada o por kilo.';
  const zona = String(t.zona ?? 'ambas').trim().toLowerCase();
  if (zona !== 'ambas' && !zonaPesoValida(zona)) return 'Elige la zona (Este, Oeste o ambas).';
  const p = Number(String(t.precio ?? '').replace(',', '.'));
  if (!Number.isFinite(p) || p <= 0) return 'Escribe un precio mayor que 0.';
  const desde = dia(t.desde);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(desde)) return 'Elige la fecha desde la que rige.';
  const hasta = t.hasta ? dia(t.hasta) : '';
  if (hasta && !/^\d{4}-\d{2}-\d{2}$/.test(hasta)) return 'La fecha «hasta» no es válida.';
  if (hasta && hasta < desde) return 'La fecha «hasta» no puede ser anterior a «desde».';
  const alcance = alcancePeso({ alcance: t.alcance });
  if (!alcance) return 'Elige a quién aplica la tarifa.';
  const camiones = Array.from(new Set((t.camiones ?? []).map((c) => String(c ?? '')).filter(Boolean)));
  if (alcance === 'empresa' && !String(t.companyId ?? '').trim()) return 'Elige la empresa.';
  if (alcance === 'camion' && camiones.length !== 1) return 'Elige el camión.';
  if (alcance === 'grupo' && !camiones.length) return 'Elige los camiones del grupo.';
  if (alcance === 'grupo' && String(t.grupoNombre ?? '').trim().length < 2) return 'Ponle nombre al grupo.';
  return null;
}

/** «$12,00 / Ton» o «$0,012 / Kg». */
export function textoPrecioPeso(t: TarifaPeso | null | undefined): string {
  if (!t) return '—';
  const u = unidadTarifaPeso(t);
  return `${usd(num(t.precio), u === 'kg' ? 4 : 2)} / ${u === 'kg' ? 'Kg' : 'Ton'}`;
}

/**
 * Las tarifas con que se pagó un renglón, compacto (05-oct-2026, a pedido:
 * «mostrar los dos precios en vez de varias»).
 *   · Una sola: «$2,00 / Ton».
 *   · Varias de la MISMA unidad: «$2,00 / $3,00 / Ton» (precios de menor a mayor).
 *   · De unidades DISTINTAS (raro: una por Ton y otra por Kg): no se pueden
 *     fundir en una, así que van completas: «$2,00 / Ton · $0,0030 / Kg».
 * Dos tarifas del mismo precio y unidad (p. ej. dos zonas a $2/Ton) cuentan una.
 */
export function textoTarifasPeso(tarifas: (TarifaPeso | null | undefined)[] | null | undefined): string {
  const vistas = new Map<string, { precio: number; unidad: UnidadTarifaPeso }>();
  (tarifas ?? []).forEach((t) => {
    if (!t) return;
    const precio = num(t.precio);
    if (!(precio > 0)) return;
    const unidad = unidadTarifaPeso(t);
    vistas.set(`${precio}|${unidad}`, { precio, unidad });
  });
  const arr = Array.from(vistas.values());
  if (arr.length === 0) return '—';
  const dec = (u: UnidadTarifaPeso) => (u === 'kg' ? 4 : 2);
  const label = (u: UnidadTarifaPeso) => (u === 'kg' ? 'Kg' : 'Ton');
  if (new Set(arr.map((x) => x.unidad)).size === 1) {
    const u = arr[0].unidad;
    const precios = arr.map((x) => x.precio).sort((a, b) => a - b).map((x) => usd(x, dec(u)));
    return `${precios.join(' / ')} / ${label(u)}`;
  }
  return arr.sort((a, b) => (a.unidad === b.unidad ? 0 : a.unidad === 'ton' ? -1 : 1) || a.precio - b.precio)
    .map((x) => `${usd(x.precio, dec(x.unidad))} / ${label(x.unidad)}`).join(' · ');
}

export function etiquetaZonaPeso(t: { zona?: unknown }): string {
  const z = zonaPesoValida(t.zona);
  return z === 'oeste' ? 'Oeste' : z === 'este' ? 'Este' : 'Ambas zonas';
}

export function etiquetaAlcancePeso(t: TarifaPeso | null | undefined): string {
  switch (t ? alcancePeso(t) : null) {
    case 'empresa': return 'tarifa de la empresa';
    case 'grupo': return `tarifa del grupo «${t?.grupo_nombre ?? ''}»`;
    case 'camion': return 'tarifa del camión';
    case 'general': return 'tarifa de todos';
    default: return '';
  }
}

export function etiquetaMotivoSinPagoPeso(m: MotivoSinPagoPeso | null): string {
  switch (m) {
    case 'no_facturo': return 'No facturó';
    case 'sin_peso': return 'Sin peso';
    case 'sin_tarifa': return 'Sin tarifa';
    case 'sin_empresa': return 'Sin empresa';
    case 'fuera_catalogo': return 'Camión fuera del catálogo';
    default: return '';
  }
}

/** Última marca de cada viaje (misma regla que el pago por viaje). */
export function indexarMarcasPeso(filas: MarcaPeso[] | null | undefined): Map<string, MarcaPeso> {
  const idx = new Map<string, MarcaPeso>();
  const clave = (m: MarcaPeso) => `${String(m.created_at ?? '')}|${String(m.id ?? '')}`;
  (filas ?? []).forEach((m) => {
    if (!m?.viaje_id || typeof m.facturable !== 'boolean') return;
    const prev = idx.get(m.viaje_id);
    if (!prev || clave(m) >= clave(prev)) idx.set(m.viaje_id, m);
  });
  return idx;
}

/** Viajes cuya jornada cae dentro de [desde, hasta]. */
export function viajesPesoEnRango(viajes: ViajePeso[] | null | undefined, desde: string, hasta: string): ViajePeso[] {
  return (viajes ?? []).filter((v) => {
    const j = jornadaDeInstantePeso(v?.registered_at);
    return !!j && j >= desde && j <= hasta;
  });
}

/**
 * Las líneas del pago por peso: UNA por viaje, con su neto, su tarifa y su monto.
 * Todo lo demás (resumen, bloques, papel) sale de estas mismas líneas.
 */
export function calcularPagoPeso(opts: {
  viajes: ViajePeso[] | null | undefined;
  tarifas: TarifaPeso[] | null | undefined;
  marcas?: Map<string, MarcaPeso> | null;
}): LineaPeso[] {
  const out: LineaPeso[] = [];
  (opts.viajes ?? []).forEach((v) => {
    if (!v?.id) return;
    const jornada = jornadaDeInstantePeso(v.registered_at);
    if (!jornada) return;
    const fuera = !!v.fuera_catalogo || !v.machinery_id;
    const zona = zonaPesoValida(v.zona_pago);
    const kg = netoKgDeViaje(v);
    const marca = opts.marcas?.get(v.id) ?? null;
    const facturable = marca ? marca.facturable : true;
    const tarifa = tarifaPesoEn(opts.tarifas, zona, jornada, { machineryId: v.machinery_id, companyId: v.company_id });
    let motivoSinPago: MotivoSinPagoPeso | null = null;
    if (!facturable) motivoSinPago = 'no_facturo';
    else if (fuera) motivoSinPago = 'fuera_catalogo';
    else if (!v.company_id) motivoSinPago = 'sin_empresa';
    else if (!(kg > 0)) motivoSinPago = 'sin_peso';
    else if (!tarifa) motivoSinPago = 'sin_tarifa';
    const precioKg = motivoSinPago ? 0 : precioPorKg(tarifa);
    const monto = motivoSinPago ? 0 : redondear(kg * precioKg);
    out.push({ viaje: v, jornada, zona, tarifa, kg, precioKg, monto, facturable, motivoSinPago });
  });
  return out.sort((a, b) => String(a.viaje.registered_at).localeCompare(String(b.viaje.registered_at)));
}

// ── RESUMEN, FILTROS Y BLOQUES ──────────────────────────────────────────────

export type TotalPeso = {
  viajes: number; pagados: number; noFacturados: number; pendientes: number;
  /** Kilos de los viajes PAGADOS. */
  kg: number;
  /** Kilos de TODOS los viajes con peso (pagados o no). */
  kgTotal: number;
  monto: number;
};

export function totalPeso(lineas: LineaPeso[] | null | undefined): TotalPeso {
  const t: TotalPeso = { viajes: 0, pagados: 0, noFacturados: 0, pendientes: 0, kg: 0, kgTotal: 0, monto: 0 };
  (lineas ?? []).forEach((l) => {
    t.viajes += 1;
    t.kgTotal += l.kg;
    if (l.monto > 0) { t.pagados += 1; t.kg += l.kg; }
    else if (l.motivoSinPago === 'no_facturo') t.noFacturados += 1;
    else t.pendientes += 1;
    t.monto += l.monto;
  });
  t.monto = redondear(t.monto);
  t.kg = redondear(t.kg);
  t.kgTotal = redondear(t.kgTotal);
  return t;
}

/** Las tarjetas del RESUMEN EJECUTIVO (pedido expreso), sacadas del total. */
export type TarjetaPeso = { k: string; titulo: string; valor: string; nota?: string };

export function tarjetasResumenPeso(t: TotalPeso, unidad: UnidadTarifaPeso = 'ton'): TarjetaPeso[] {
  const porViaje = t.pagados > 0 ? t.kg / t.pagados : 0;
  const porUnidad = t.kg > 0 ? t.monto / (unidad === 'kg' ? t.kg : t.kg / 1000) : 0;
  return [
    { k: 'monto', titulo: 'Total a pagar', valor: usd(t.monto), nota: `${t.pagados} viaje(s) pagado(s)` },
    { k: 'peso', titulo: `${unidad === 'kg' ? 'Kilos' : 'Toneladas'} pagadas`, valor: pesoTexto(t.kg, unidad), nota: t.kgTotal > t.kg ? `de ${pesoTexto(t.kgTotal, unidad)} pesadas` : undefined },
    { k: 'promedio', titulo: 'Promedio por viaje', valor: pesoTexto(porViaje, unidad) },
    { k: 'precio', titulo: `Precio medio por ${unidad === 'kg' ? 'Kg' : 'Ton'}`, valor: usd(porUnidad, unidad === 'kg' ? 4 : 2) },
    { k: 'viajes', titulo: 'Viajes', valor: String(t.viajes), nota: `${t.noFacturados ? `${t.noFacturados} no facturó · ` : ''}${t.pendientes ? `${t.pendientes} sin pagar` : 'todos pagados'}` },
  ];
}

export const SIN_OBRA_PESO = 'Sin obra';
export const SIN_FRENTE_PESO = 'Sin frente';
export const CLAVE_SIN_EMPRESA_PESO = '(sin empresa)';

export const obraDeLineaPeso = (l: LineaPeso): string => limpio(l.viaje?.ubicacion_nombre) || SIN_OBRA_PESO;
export const frenteDeLineaPeso = (l: LineaPeso): string => limpio(l.viaje?.frente_nombre) || SIN_FRENTE_PESO;
export const empresaDeLineaPeso = (l: LineaPeso): string => limpio(l.viaje?.company_id) || CLAVE_SIN_EMPRESA_PESO;
export const maquinaDeLineaPeso = (l: LineaPeso): string =>
  limpio(l.viaje?.machinery_id) || `code:${limpio(l.viaje?.machine_code) || '—'}`;

/** Lista vacía = todas. */
export type FiltroPeso = { empresas: string[]; obras: string[]; maquinas: string[]; frentes: string[] };
export const FILTRO_PESO_TODO: FiltroPeso = { empresas: [], obras: [], maquinas: [], frentes: [] };

const pasa = (lista: string[] | null | undefined, clave: string) => !lista || lista.length === 0 || lista.includes(clave);

export function filtrarLineasPeso(lineas: LineaPeso[] | null | undefined, f: FiltroPeso): LineaPeso[] {
  return (lineas ?? []).filter((l) =>
    pasa(f.empresas, empresaDeLineaPeso(l)) && pasa(f.obras, obraDeLineaPeso(l))
    && pasa(f.maquinas, maquinaDeLineaPeso(l)) && pasa(f.frentes, frenteDeLineaPeso(l)));
}

export function acotarFiltroPeso(f: FiltroPeso, hay: { empresas: string[]; obras: string[]; maquinas: string[]; frentes: string[] }): FiltroPeso {
  const s = (xs: string[]) => new Set(xs);
  const e = s(hay.empresas), o = s(hay.obras), m = s(hay.maquinas), fr = s(hay.frentes);
  return {
    empresas: (f.empresas ?? []).filter((k) => e.has(k)),
    obras: (f.obras ?? []).filter((k) => o.has(k)),
    maquinas: (f.maquinas ?? []).filter((k) => m.has(k)),
    frentes: (f.frentes ?? []).filter((k) => fr.has(k)),
  };
}

export function filtroPesoActivo(f: FiltroPeso): boolean {
  return (f.empresas?.length ?? 0) + (f.obras?.length ?? 0) + (f.maquinas?.length ?? 0) + (f.frentes?.length ?? 0) > 0;
}

export type OpcionDisponible = { id: string; name: string; viajes: number };

function disponibles(lineas: LineaPeso[] | null | undefined, claveDe: (l: LineaPeso) => string, nombreDe: (k: string) => string, ultimo: string): OpcionDisponible[] {
  const m = new Map<string, number>();
  (lineas ?? []).forEach((l) => m.set(claveDe(l), (m.get(claveDe(l)) ?? 0) + 1));
  return Array.from(m, ([id, viajes]) => ({ id, name: nombreDe(id), viajes }))
    .sort((a, b) => Number(a.id === ultimo) - Number(b.id === ultimo) || a.name.localeCompare(b.name, 'es', { numeric: true }));
}

export const obrasDisponiblesPeso = (lineas: LineaPeso[] | null | undefined) => disponibles(lineas, obraDeLineaPeso, (k) => k, SIN_OBRA_PESO);
export const frentesDisponiblesPeso = (lineas: LineaPeso[] | null | undefined) => disponibles(lineas, frenteDeLineaPeso, (k) => k, SIN_FRENTE_PESO);
export const empresasDisponiblesPeso = (lineas: LineaPeso[] | null | undefined, nombres: Map<string, string> | null | undefined) =>
  disponibles(lineas, empresaDeLineaPeso, (k) => (k === CLAVE_SIN_EMPRESA_PESO ? 'Sin empresa (fuera del catálogo)' : nombres?.get(k) || 'Empresa'), CLAVE_SIN_EMPRESA_PESO);

export type FichaCamionPeso = { marca?: string | null; modelo?: string | null; placa?: string | null; serial?: string | null; encargado?: string | null };

export function maquinasDisponiblesPeso(
  lineas: LineaPeso[] | null | undefined,
  fichas: Map<string, FichaCamionPeso> | null | undefined,
  nombres: Map<string, string> | null | undefined,
): { id: string; code: string; placa: string; empresa: string; viajes: number }[] {
  const m = new Map<string, { id: string; code: string; placa: string; empresa: string; viajes: number }>();
  (lineas ?? []).forEach((l) => {
    const id = maquinaDeLineaPeso(l);
    const ficha = fichas?.get(limpio(l.viaje?.machinery_id));
    const placa = limpio(l.viaje?.placa_snap) || limpio(ficha?.placa) || limpio(ficha?.serial);
    const empKey = empresaDeLineaPeso(l);
    const empresa = empKey === CLAVE_SIN_EMPRESA_PESO ? 'Sin empresa' : (nombres?.get(empKey) || 'Empresa');
    const prev = m.get(id);
    if (prev) { prev.viajes += 1; if (!prev.placa && placa) prev.placa = placa; }
    else m.set(id, { id, code: limpio(l.viaje?.machine_code) || '—', placa, empresa, viajes: 1 });
  });
  return Array.from(m.values()).sort((a, b) =>
    a.empresa.localeCompare(b.empresa, 'es') || a.code.localeCompare(b.code, 'es', { numeric: true }) || a.placa.localeCompare(b.placa, 'es'));
}

export type EjePeso = 'empresa' | 'obra' | 'frente' | 'maquina';
export type BloquePeso = { clave: string; nombre: string; lineas: LineaPeso[]; total: TotalPeso };

/** Los bloques del papel y de la pantalla. Cada línea va a UN solo bloque. */
export function bloquesPeso(
  lineas: LineaPeso[] | null | undefined,
  eje: EjePeso,
  nombresEmpresa: Map<string, string> | null | undefined,
  o?: Pick<OpcionesPagoPeso, 'sinEmpresas'> | null,
): BloquePeso[] {
  const m = new Map<string, LineaPeso[]>();
  const nombreMaq = new Map<string, string>();
  (lineas ?? []).forEach((l) => {
    const k = eje === 'obra' ? obraDeLineaPeso(l) : eje === 'frente' ? frenteDeLineaPeso(l) : eje === 'maquina' ? maquinaDeLineaPeso(l) : empresaDeLineaPeso(l);
    if (eje === 'maquina' && !nombreMaq.has(k)) nombreMaq.set(k, `${limpio(l.viaje?.machine_code) || '—'}${limpio(l.viaje?.placa_snap) ? ` · ${limpio(l.viaje?.placa_snap)}` : ''}`);
    const lista = m.get(k) ?? [];
    lista.push(l);
    m.set(k, lista);
  });
  const nombreReal = (k: string) =>
    eje === 'maquina' ? nombreMaq.get(k) || k
      : eje !== 'empresa' ? k
        : k === CLAVE_SIN_EMPRESA_PESO ? 'Sin empresa (fuera del catálogo)' : nombresEmpresa?.get(k) || 'Empresa';
  const ultimo = eje === 'obra' ? SIN_OBRA_PESO : eje === 'frente' ? SIN_FRENTE_PESO : eje === 'empresa' ? CLAVE_SIN_EMPRESA_PESO : '';
  const bloques = Array.from(m, ([clave, ls]) => ({ clave, nombre: nombreReal(clave), lineas: ls, total: totalPeso(ls) }))
    .sort((a, b) => Number(a.clave === ultimo) - Number(b.clave === ultimo) || a.nombre.localeCompare(b.nombre, 'es', { numeric: true }));
  if (eje === 'empresa' && o?.sinEmpresas) bloques.forEach((b, i) => { b.nombre = `Empresa ${i + 1}`; });
  return bloques;
}

export type RenglonCamionPeso = {
  machineryId: string; code: string; empresa: string; marca: string; modelo: string; placa: string; encargado: string;
  viajes: number; pagados: number; noFacturados: number; pendientes: number; kg: number; monto: number;
  /** Texto de la(s) tarifa(s) con que se pagó: «$2,00 / Ton», o «$2,00 / $3,00 / Ton»
   *  cuando el camión cruzó zonas con precios distintos (05-oct-2026). */
  tarifa: string;
};

/** Un renglón por CAMIÓN (y empresa congelada), con sus kilos pagados y su monto. */
export function renglonesPorCamionPeso(
  lineas: LineaPeso[] | null | undefined,
  fichas: Map<string, FichaCamionPeso> | null | undefined,
  nombresEmpresa?: Map<string, string> | null,
): RenglonCamionPeso[] {
  const m = new Map<string, RenglonCamionPeso & { tarifas: Map<string, TarifaPeso> }>();
  (lineas ?? []).forEach((l) => {
    const id = maquinaDeLineaPeso(l);
    const empresaId = empresaDeLineaPeso(l);
    const k = `${id}|${empresaId}`;
    let r = m.get(k);
    if (!r) {
      const f = (l.viaje?.machinery_id && fichas?.get(l.viaje.machinery_id)) || {};
      r = {
        machineryId: id, code: limpio(l.viaje?.machine_code) || '—',
        empresa: empresaId === CLAVE_SIN_EMPRESA_PESO ? 'Sin empresa' : nombresEmpresa?.get(empresaId) || 'Empresa',
        marca: limpio(f.marca), modelo: limpio(f.modelo),
        placa: limpio(l.viaje?.placa_snap) || limpio(f.placa) || limpio(f.serial),
        encargado: limpio(f.encargado),
        viajes: 0, pagados: 0, noFacturados: 0, pendientes: 0, kg: 0, monto: 0, tarifa: '—', tarifas: new Map(),
      };
      m.set(k, r);
    }
    r.viajes += 1;
    if (l.monto > 0) {
      r.pagados += 1; r.kg = redondear(r.kg + l.kg); r.monto = redondear(r.monto + l.monto);
      if (l.tarifa && num(l.tarifa.precio) > 0) r.tarifas.set(`${num(l.tarifa.precio)}|${unidadTarifaPeso(l.tarifa)}`, l.tarifa);
    }
    else if (l.motivoSinPago === 'no_facturo') r.noFacturados += 1;
    else r.pendientes += 1;
  });
  return Array.from(m.values()).map(({ tarifas, ...r }) => ({ ...r, tarifa: textoTarifasPeso(Array.from(tarifas.values())) }))
    .sort((a, b) => a.code.localeCompare(b.code, 'es', { numeric: true }) || a.placa.localeCompare(b.placa, 'es') || a.empresa.localeCompare(b.empresa, 'es'));
}

export type ConteoPeso = { clave: string; viajes: number; pagados: number; kg: number; monto: number };

function contarPor(lineas: LineaPeso[] | null | undefined, claveDe: (l: LineaPeso) => string): ConteoPeso[] {
  const m = new Map<string, ConteoPeso>();
  (lineas ?? []).forEach((l) => {
    const k = claveDe(l);
    const c = m.get(k) ?? { clave: k, viajes: 0, pagados: 0, kg: 0, monto: 0 };
    c.viajes += 1;
    if (l.monto > 0) { c.pagados += 1; c.kg = redondear(c.kg + l.kg); }
    c.monto = redondear(c.monto + l.monto);
    m.set(k, c);
  });
  return Array.from(m.values()).sort((a, b) => a.clave.localeCompare(b.clave, 'es', { numeric: true }));
}

export const conteoPorTipoPeso = (lineas: LineaPeso[] | null | undefined) => contarPor(lineas, (l) => limpio(l.viaje?.machine_code) || 'Sin tipo');
export const conteoPorZonaPeso = (lineas: LineaPeso[] | null | undefined) => contarPor(lineas, (l) => (l.zona === 'este' ? 'Este' : l.zona === 'oeste' ? 'Oeste' : 'Sin zona'));
/** Cantidad por JORNADA (día), para el histórico del rango. */
export const conteoPorDiaPeso = (lineas: LineaPeso[] | null | undefined) => contarPor(lineas, (l) => l.jornada);

// ── LAS PASTILLAS DEL PAPEL ─────────────────────────────────────────────────

export type OpcionesPagoPeso = {
  sinMarca: boolean;
  sinModelo: boolean;
  sinPlaca: boolean;
  sinEncargado: boolean;
  /** Sin el NOMBRE de las empresas: «Empresa 1», «Empresa 2»… */
  sinEmpresas: boolean;
  /** Sin el resumen ejecutivo (las tarjetas del principio). */
  sinResumen: boolean;
  /** Sin el cuadro camión por camión. */
  sinListado: boolean;
  /** Sin el detalle viaje por viaje (folio, fecha, bruto, tara, neto, monto). */
  sinViajes: boolean;
  /** Sin bruto y tara en el detalle (queda solo el neto). */
  sinBrutoTara: boolean;
  sinTipos: boolean;
  sinZonas: boolean;
  /** Sin el cuadro por día (el histórico del rango). */
  sinDias: boolean;
  sinFrente: boolean;
  sinAlcance: boolean;
};

/** Lo nuevo entra apagado: el papel de arranque es resumen + camión por camión. */
export const OPCIONES_PESO_POR_DEFECTO: OpcionesPagoPeso = {
  sinMarca: true, sinModelo: true, sinPlaca: false, sinEncargado: true, sinEmpresas: false,
  sinResumen: false, sinListado: false, sinViajes: true, sinBrutoTara: true,
  sinTipos: true, sinZonas: true, sinDias: true, sinFrente: true, sinAlcance: true,
};

export const PASTILLAS_PESO: { key: keyof OpcionesPagoPeso; chip: string; largo: string; archivo: string }[] = [
  { key: 'sinResumen', chip: '🚫 Resumen ejecutivo', largo: 'resumen ejecutivo', archivo: 'sin resumen' },
  { key: 'sinListado', chip: '🚫 Camión por camión', largo: 'cuadro por camión', archivo: 'sin camiones' },
  { key: 'sinViajes', chip: '🚫 Viaje por viaje', largo: 'detalle por viaje', archivo: 'sin viajes' },
  { key: 'sinBrutoTara', chip: '🚫 Bruto y tara', largo: 'bruto y tara', archivo: 'sin bruto-tara' },
  { key: 'sinMarca', chip: '🚫 Marca', largo: 'marca', archivo: 'sin marca' },
  { key: 'sinModelo', chip: '🚫 Modelo', largo: 'modelo', archivo: 'sin modelo' },
  { key: 'sinPlaca', chip: '🚫 Serial / Placa', largo: 'serial/placa', archivo: 'sin placa' },
  { key: 'sinEncargado', chip: '🚫 Encargado', largo: 'encargado', archivo: 'sin encargado' },
  { key: 'sinEmpresas', chip: '🚫 Nombre de empresas', largo: 'nombres de empresas', archivo: 'sin empresas' },
  { key: 'sinFrente', chip: '🚫 Frente de trabajo', largo: 'columna de frente', archivo: 'sin frente' },
  { key: 'sinTipos', chip: '🚫 Cantidad por tipo', largo: 'cantidad por tipo de equipo', archivo: 'sin tipos' },
  { key: 'sinZonas', chip: '🚫 Cantidad por zona', largo: 'cantidad por zona', archivo: 'sin zonas' },
  { key: 'sinDias', chip: '🚫 Día por día', largo: 'cuadro por día', archivo: 'sin dias' },
  { key: 'sinAlcance', chip: '🚫 Alcance del informe', largo: 'cuadro de alcance', archivo: 'sin alcance' },
];

export function alternarPeso(o: OpcionesPagoPeso, key: keyof OpcionesPagoPeso): OpcionesPagoPeso {
  return { ...o, [key]: !o[key] };
}

/** Para la PANTALLA, antes de descargar. En el papel no va. */
export function ocultosPesoEnPalabras(o: OpcionesPagoPeso): string {
  const l = PASTILLAS_PESO.filter((p) => o[p.key]).map((p) => p.largo);
  return l.length === 0 ? 'Sale completo.' : `No sale: ${l.join(', ')}.`;
}

export function alcancePesoEnPalabras(f: FiltroPeso, eje: EjePeso, o: OpcionesPagoPeso, nombresEmpresa: Map<string, string> | null | undefined): string[] {
  const nombreE = (k: string) => (k === CLAVE_SIN_EMPRESA_PESO ? 'Sin empresa' : nombresEmpresa?.get(k) || 'Empresa');
  const l: string[] = [`Agrupado por ${eje === 'obra' ? 'obra / ubicación' : eje === 'frente' ? 'frente de trabajo' : eje === 'maquina' ? 'camión' : 'empresa'}.`];
  l.push(f.empresas.length === 0 ? 'Empresas: todas.' : o.sinEmpresas ? `Empresas: solo ${f.empresas.length} elegida(s).` : `Empresas: solo ${f.empresas.map(nombreE).join(', ')}.`);
  l.push(f.obras.length === 0 ? 'Obras: todas.' : `Obras: solo ${f.obras.join(', ')}.`);
  l.push((f.frentes ?? []).length === 0 ? 'Frentes: todos.' : `Frentes: solo ${f.frentes.join(', ')}.`);
  l.push((f.maquinas ?? []).length === 0 ? 'Camiones: todos.' : `Camiones: solo ${f.maquinas.length} elegido(s).`);
  if (filtroPesoActivo(f)) l.push('⚠️ Este papel está FILTRADO: su total no es el pago completo del rango.');
  return l;
}

export function sufijoArchivoPeso(f: FiltroPeso, eje: EjePeso, o: OpcionesPagoPeso): string {
  const partes: string[] = [];
  if (eje !== 'empresa') partes.push(`por ${eje === 'obra' ? 'obra' : eje === 'frente' ? 'frente' : 'camion'}`);
  if (f.obras.length === 1) partes.push(f.obras[0]);
  else if (f.obras.length > 1) partes.push(`${f.obras.length} obras`);
  if (f.empresas.length) partes.push(`${f.empresas.length} empresa(s)`);
  if ((f.frentes ?? []).length) partes.push(`${f.frentes.length} frente(s)`);
  if ((f.maquinas ?? []).length) partes.push(`${f.maquinas.length} camion(es)`);
  PASTILLAS_PESO.filter((p) => o[p.key] !== OPCIONES_PESO_POR_DEFECTO[p.key]).forEach((p) => partes.push(o[p.key] ? p.archivo : p.archivo.replace(/^sin /, 'con ')));
  return partes.length ? ` (${partes.join(', ')})`.replace(/[\\/:*?"<>|]/g, ' ') : '';
}

// ── EL PAPEL ────────────────────────────────────────────────────────────────

const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Sin `Intl` con idioma: miles con punto y decimales con coma, siempre igual en cualquier teléfono. */
function fijo(n: number, dec: number): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return (0).toFixed(dec).replace('.', ',');
  const neg = v < 0;
  const [entero, d] = Math.abs(v).toFixed(dec).split('.');
  const miles = entero.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${neg ? '-' : ''}${miles}${dec > 0 ? `,${d}` : ''}`;
}

export function usd(n: number, dec = 2): string {
  return `$${fijo(Number(n || 0), dec)}`;
}

/** «32.540,00 Kg» o «32,54 Ton». */
export function pesoTexto(kg: number, unidad: UnidadTarifaPeso = 'ton'): string {
  const n = Number(kg || 0);
  return unidad === 'kg' ? `${fijo(n, 2)} Kg` : `${fijo(n / 1000, 2)} Ton`;
}

const dmy = (iso: string) => {
  const [y, m, d] = String(iso ?? '').slice(0, 10).split('-');
  return y && m && d ? `${d}/${m}/${y}` : iso;
};
const horaCaracas = (iso: string) => {
  const t = Date.parse(String(iso ?? ''));
  if (!Number.isFinite(t)) return '';
  const d = new Date(t - 4 * 3600 * 1000);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
};

export const CSS_PAGO_PESO = `
  table{width:100%;border-collapse:collapse;font-size:11px;margin:4px 0 10px}
  th,td{border:1px solid #ccc;padding:4px 7px;text-align:left}
  th{background:#1E3A5F;color:#fff}
  td.r,th.r{text-align:right}td.c{text-align:center}td.b{font-weight:700}
  tfoot td{background:#1E3A5F;color:#fff;font-weight:800}
  h3{font-size:13px;color:#1E3A5F;margin:14px 0 2px}
  p.n{font-size:10px;color:#666;margin:0 0 8px}
  .alc{font-size:10px;color:#444;border:1px solid #ccc;border-radius:4px;padding:6px 9px;margin-top:12px}
  .tj{display:flex;flex-wrap:wrap;gap:8px;margin:6px 0 10px}
  .tj div{flex:1 1 120px;border:1px solid #ccc;border-radius:6px;padding:6px 9px}
  .tj b{display:block;font-size:16px;color:#1E3A5F}
  .tj small{color:#666;font-size:9px}
  .tj span{font-size:10px;color:#444;text-transform:uppercase;letter-spacing:.03em}`;

export type DatosPapelPeso = {
  lineas: LineaPeso[];
  eje: EjePeso;
  filtro: FiltroPeso;
  opciones: OpcionesPagoPeso;
  unidad: UnidadTarifaPeso;
  nombresEmpresa: Map<string, string>;
  fichas?: Map<string, FichaCamionPeso> | null;
};

/**
 * El cuerpo del PDF. ⭐ No calcula plata: recibe las líneas con su monto puesto.
 * ⭐ Lo oculto no deja rastro (regla de la casa): ninguna pastilla escribe nada.
 */
export function cuerpoPagoPeso(d: DatosPapelPeso): string {
  const o = d.opciones;
  const u = d.unidad;
  const U = u === 'kg' ? 'Kg' : 'Ton';
  const bloques = bloquesPeso(d.lineas, d.eje, d.nombresEmpresa, o);
  const tot = totalPeso(d.lineas);
  const rotulo = d.eje === 'obra' ? 'Obra / ubicación' : d.eje === 'frente' ? 'Frente de trabajo' : d.eje === 'maquina' ? 'Camión' : 'Empresa';
  const partes: string[] = [];

  if (!o.sinResumen) {
    partes.push(`<div class="tj">${tarjetasResumenPeso(tot, u).map((t) => `<div><span>${esc(t.titulo)}</span><b>${esc(t.valor)}</b>${t.nota ? `<small>${esc(t.nota)}</small>` : ''}</div>`).join('')}</div>`);
  }

  partes.push(`<table><thead><tr><th>${rotulo}</th><th class="r">Viajes pagados</th><th class="r">${U}</th><th class="r">No facturó</th><th class="r">Sin pagar</th><th class="r">Total</th></tr></thead>
    <tbody>${bloques.map((b) => `<tr><td>${esc(b.nombre)}</td><td class="r">${b.total.pagados}</td><td class="r">${fijo(u === 'kg' ? b.total.kg : b.total.kg / 1000, 2)}</td><td class="r">${b.total.noFacturados || '—'}</td><td class="r">${b.total.pendientes || '—'}</td><td class="r b">${usd(b.total.monto)}</td></tr>`).join('') || '<tr><td colspan="6" class="c">Sin viajes con ese filtro</td></tr>'}</tbody>
    <tfoot><tr><td>TOTAL A PAGAR</td><td class="r">${tot.pagados}</td><td class="r">${fijo(u === 'kg' ? tot.kg : tot.kg / 1000, 2)}</td><td class="r">${tot.noFacturados}</td><td class="r">${tot.pendientes}</td><td class="r">${usd(tot.monto)}</td></tr></tfoot></table>`);

  const cuadro = (titulo: string, col: string, filas: ConteoPeso[]) => `<h3>${titulo}</h3>
    <table><thead><tr><th>${col}</th><th class="r">Viajes</th><th class="r">Pagados</th><th class="r">${U}</th><th class="r">Monto</th></tr></thead>
    <tbody>${filas.map((c) => `<tr><td>${esc(c.clave)}</td><td class="r">${c.viajes}</td><td class="r">${c.pagados}</td><td class="r">${fijo(u === 'kg' ? c.kg : c.kg / 1000, 2)}</td><td class="r b">${usd(c.monto)}</td></tr>`).join('')}</tbody></table>`;
  if (!o.sinTipos) partes.push(cuadro('Cantidad por tipo de equipo', 'Tipo', conteoPorTipoPeso(d.lineas)));
  if (!o.sinZonas) partes.push(cuadro('Cantidad por zona', 'Zona', conteoPorZonaPeso(d.lineas)));
  if (!o.sinDias) partes.push(cuadro('Día por día (jornada 7am a 7am)', 'Jornada', conteoPorDiaPeso(d.lineas).map((c) => ({ ...c, clave: dmy(c.clave) }))));

  if (!o.sinListado || !o.sinViajes) {
    bloques.forEach((b) => {
      const motivos = new Map<MotivoSinPagoPeso, number>();
      b.lineas.forEach((l) => { if (l.motivoSinPago && l.motivoSinPago !== 'no_facturo') motivos.set(l.motivoSinPago, (motivos.get(l.motivoSinPago) ?? 0) + 1); });
      const porQue = Array.from(motivos.entries()).sort((a, c) => c[1] - a[1]).map(([k, n]) => `${n} ${etiquetaMotivoSinPagoPeso(k).toLowerCase()}`).join(' · ');
      partes.push(`<h3>${esc(b.nombre)} — ${usd(b.total.monto)} · ${pesoTexto(b.total.kg, u)}</h3>`);
      if (!o.sinListado) {
        const rs = renglonesPorCamionPeso(b.lineas, d.fichas, d.nombresEmpresa);
        const cols: string[] = ['Camión'];
        if (!o.sinEmpresas) cols.push('Empresa');
        if (!o.sinMarca || !o.sinModelo) cols.push(!o.sinMarca && !o.sinModelo ? 'Marca / Modelo' : !o.sinMarca ? 'Marca' : 'Modelo');
        if (!o.sinPlaca) cols.push('Serial / Placa');
        if (!o.sinEncargado) cols.push('Encargado');
        cols.push('Viajes', U, 'Tarifa', 'Monto');
        const celdas = (r: RenglonCamionPeso) => {
          const c: string[] = [`<td>${esc(r.code)}</td>`];
          if (!o.sinEmpresas) c.push(`<td>${esc(r.empresa)}</td>`);
          if (!o.sinMarca || !o.sinModelo) c.push(`<td>${esc([o.sinMarca ? '' : r.marca, o.sinModelo ? '' : r.modelo].filter(Boolean).join(' ') || '—')}</td>`);
          if (!o.sinPlaca) c.push(`<td>${esc(r.placa || '—')}</td>`);
          if (!o.sinEncargado) c.push(`<td>${esc(r.encargado || '—')}</td>`);
          c.push(`<td class="r">${r.pagados}${r.viajes > r.pagados ? ` <small>de ${r.viajes}</small>` : ''}</td>`, `<td class="r">${fijo(u === 'kg' ? r.kg : r.kg / 1000, 2)}</td>`, `<td class="r">${esc(r.tarifa)}</td>`, `<td class="r b">${usd(r.monto)}</td>`);
          return c.join('');
        };
        const numCols = new Set(['Viajes', U, 'Tarifa', 'Monto']);
        partes.push(`<table><thead><tr>${cols.map((c) => `<th${numCols.has(c) ? ' class="r"' : ''}>${c}</th>`).join('')}</tr></thead>
          <tbody>${rs.map((r) => `<tr>${celdas(r)}</tr>`).join('') || `<tr><td colspan="${cols.length}" class="c">Sin viajes</td></tr>`}</tbody></table>`);
      }
      if (!o.sinViajes) {
        const cols: string[] = ['Folio', 'Jornada', 'Hora', 'Camión'];
        if (!o.sinPlaca) cols.push('Placa');
        if (!o.sinFrente) cols.push('Frente');
        cols.push('Obra');
        if (!o.sinBrutoTara) cols.push(`Bruto ${U}`, `Tara ${U}`);
        cols.push(`Neto ${U}`, 'Tarifa', 'Monto');
        const numCols = new Set([`Bruto ${U}`, `Tara ${U}`, `Neto ${U}`, 'Tarifa', 'Monto']);
        const p = (kg: unknown) => (num(kg) > 0 ? fijo(u === 'kg' ? num(kg) : num(kg) / 1000, 2) : '—');
        const fila = (l: LineaPeso) => {
          const c: string[] = [`<td>${esc(l.viaje.folio ?? '—')}</td>`, `<td>${dmy(l.jornada)}</td>`, `<td>${horaCaracas(l.viaje.registered_at)}</td>`, `<td>${esc(l.viaje.machine_code ?? '—')}</td>`];
          if (!o.sinPlaca) c.push(`<td>${esc(l.viaje.placa_snap || '—')}</td>`);
          if (!o.sinFrente) c.push(`<td>${esc(frenteDeLineaPeso(l))}</td>`);
          c.push(`<td>${esc(obraDeLineaPeso(l))}</td>`);
          if (!o.sinBrutoTara) c.push(`<td class="r">${p(l.viaje.peso_bruto_kg)}</td>`, `<td class="r">${p(l.viaje.peso_tara_kg)}</td>`);
          c.push(`<td class="r">${p(l.kg)}</td>`, `<td class="r">${l.motivoSinPago ? esc(etiquetaMotivoSinPagoPeso(l.motivoSinPago)) : esc(textoPrecioPeso(l.tarifa))}</td>`, `<td class="r b">${l.monto > 0 ? usd(l.monto) : '—'}</td>`);
          return c.join('');
        };
        partes.push(`<table><thead><tr>${cols.map((c) => `<th${numCols.has(c) ? ' class="r"' : ''}>${c}</th>`).join('')}</tr></thead>
          <tbody>${b.lineas.map((l) => `<tr>${fila(l)}</tr>`).join('')}</tbody></table>`);
      }
      if (b.total.noFacturados || b.total.pendientes) {
        partes.push(`<p class="n">${b.total.noFacturados ? `${b.total.noFacturados} viaje(s) marcados «no facturó». ` : ''}${b.total.pendientes ? `${b.total.pendientes} viaje(s) sin pagar: ${porQue}.` : ''}</p>`);
      }
    });
  }

  if (!o.sinAlcance) {
    // Dice QUÉ viajes entraron (el filtro cambia el total), nunca qué columnas se apagaron.
    partes.push(`<div class="alc"><b>Alcance del informe</b><br/>${alcancePesoEnPalabras(d.filtro, d.eje, o, d.nombresEmpresa).map(esc).join('<br/>')}</div>`);
  }
  return partes.join('\n');
}
