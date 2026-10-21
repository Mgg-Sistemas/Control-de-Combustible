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

export type FuenteKey = 'jornadas' | 'horometros' | 'viajes' | 'peso';
export type ModoFuente = 'suma' | 'muestra' | 'oculta';

export const FUENTES_META: Record<FuenteKey, { icon: string; label: string }> = {
  jornadas: { icon: '🕐', label: 'Jornadas' },
  horometros: { icon: '⚙️', label: 'Horómetros' },
  viajes: { icon: '🚛', label: 'Viajes' },
  peso: { icon: '⚖️', label: 'Peso' },
};
export const FUENTES_ORDEN: FuenteKey[] = ['jornadas', 'horometros', 'viajes', 'peso'];

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
  montos: Partial<Record<FuenteKey, number>>;
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

/** Cómo se parte el cuerpo del papel (20-oct-2026: + categoría y frente, a pedido). */
export type AgruparConsolidado = 'empresa' | 'maquina' | 'global' | 'categoria' | 'frente';

export const SIN_CATEGORIA = 'Sin clasificación';
export const SIN_FRENTE = 'Sin frente';
export const categoriaDe = (f: Pick<FilaConsolidada, 'categoria'>): string => String(f.categoria ?? '').trim() || SIN_CATEGORIA;
export const frenteDe = (f: Pick<FilaConsolidada, 'frente'>): string => String(f.frente ?? '').trim() || SIN_FRENTE;

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
  /** ⚖️ Costo maquinaria ÷ toneladas del acarreo, global y por frente
   *  (21-oct-2026, a pedido del jefe: «$25.000 entre 2.000 t = $12,5 la
   *  tonelada»). Nace prendida: es el corazón del pedido. */
  costoTonelada: boolean;
  /** 🕐 Costo maquinaria ÷ horas facturadas («la hora me salió a 89, no a 100»). */
  horaPromedio: boolean;
  /** Ids marcados en el selector; vacío = todas. Esto SÍ cambia el total (va FILTRADO). */
  soloMaquinas?: string[];
  /** NOMBRES de empresa marcados; vacío = todas (19-oct-2026, a pedido: «poder
   *  sacarlo para una sola empresa»). También cambia el total: va FILTRADO. */
  soloEmpresas?: string[];
  /** CLASIFICACIONES marcadas; vacío = todas (20-oct-2026, a pedido: «para solo
   *  una categoría en específico»). También cambia el total: va FILTRADO. */
  soloCategorias?: string[];
  /** FRENTES marcados (por nombre, el vigente al final del rango); vacío = todos
   *  (20-oct-2026, a pedido: «poder seleccionar un frente o varios»). «Sin
   *  frente» también se puede marcar. Cambia el total: va FILTRADO. */
  soloFrentes?: string[];
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
  costoTonelada: true,
  horaPromedio: true,
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

/** Aplica el selector de máquinas y bota las filas que quedaron sin NINGÚN monto visible. */
export function filasElegidas(filas: readonly FilaConsolidada[], op: OpcionesConsolidado): FilaConsolidada[] {
  const marcadas = new Set(op.soloMaquinas ?? []);
  const empresas = new Set((op.soloEmpresas ?? []).map((e) => e.trim().toLowerCase()).filter(Boolean));
  const categorias = new Set((op.soloCategorias ?? []).map((e) => e.trim().toLowerCase()).filter(Boolean));
  const frentes = new Set((op.soloFrentes ?? []).map((e) => e.trim().toLowerCase()).filter(Boolean));
  const visibles = fuentesVisibles(op);
  return (filas ?? [])
    .filter((f) => marcadas.size === 0 || marcadas.has(f.id))
    .filter((f) => empresas.size === 0 || empresas.has(f.empresa.trim().toLowerCase()))
    .filter((f) => categorias.size === 0 || categorias.has(categoriaDe(f).toLowerCase()))
    .filter((f) => frentes.size === 0 || frentes.has(frenteDe(f).toLowerCase()))
    .filter((f) => visibles.some((k) => (f.montos[k] ?? 0) !== 0))
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

export function totalesConsolidado(filas: readonly FilaConsolidada[], op: OpcionesConsolidado): TotalesConsolidado {
  const elegidas = filasElegidas(filas, op);
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
export function solapesConsolidado(filas: readonly FilaConsolidada[], op: OpcionesConsolidado): SolapeConsolidado[] {
  const suman = fuentesQueSuman(op);
  return filasElegidas(filas, op)
    .map((f) => ({ fila: f, fuentes: suman.filter((k) => (f.montos[k] ?? 0) > 0), monto: totalFila(f, op) }))
    .filter((x) => x.fuentes.length >= 2)
    .sort((a, b) => b.monto - a.monto);
}

export type EmpresaConsolidada = { empresa: string; porFuente: Record<FuenteKey, number>; cantPorFuente: Record<FuenteKey, number>; total: number; maquinas: number };
export function porEmpresaConsolidado(filas: readonly FilaConsolidada[], op: OpcionesConsolidado): EmpresaConsolidada[] {
  const m = new Map<string, EmpresaConsolidada>();
  for (const f of filasElegidas(filas, op)) {
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

export function topMaquinas(filas: readonly FilaConsolidada[], op: OpcionesConsolidado, n = 5): { fila: FilaConsolidada; total: number; principal: FuenteKey | null }[] {
  return filasElegidas(filas, op)
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
): CostoTonelada {
  const soloFrentes = new Set((op.soloFrentes ?? []).map((e) => e.trim().toLowerCase()).filter(Boolean));
  // El cruce por frente es por NOMBRE sin distinguir mayúsculas: el de la máquina
  // viene del catálogo de frentes y el del viaje quedó congelado como texto.
  const pf = new Map<string, FrenteTonelada>();
  const fr = (nombre: string): FrenteTonelada => {
    const k = nombre.trim().toLowerCase();
    let x = pf.get(k);
    if (!x) { x = { frente: nombre.trim(), costo: 0, horas: 0, toneladas: 0, usdPorTon: null }; pf.set(k, x); }
    return x;
  };
  const hayHoro = op.fuentes.horometros !== 'oculta';
  const hayJor = op.fuentes.jornadas !== 'oculta';
  let costo = 0;
  let horas = 0;
  let acarreoJornada = 0;
  let camionesJornada = 0;
  for (const f of filasElegidas(filas, op)) {
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
    if (soloFrentes.size > 0 && !soloFrentes.has(fnom.toLowerCase())) continue;
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
}, op: OpcionesConsolidado): ResumenFrentes {
  const t = totalesConsolidado(d.filas, op);
  const tarjetas: ResumenFrentes['tarjetas'] = [];
  const cuadros: ResumenFrentes['cuadros'] = [];

  tarjetas.push({ k: 'total', titulo: '💰 TOTAL GENERAL', valor: usd(t.total), nota: `Del ${dmy(d.desde)} al ${dmy(d.hasta)}` });
  if (op.tarjetasFuente) {
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
  tarjetas.push({ k: 'maquinas', titulo: '🚜 Máquinas', valor: String(t.maquinas), nota: op.sinEmpresas ? undefined : `${t.empresas} empresa(s)` });
  if (op.promedioDia) {
    const dias = diasDelPeriodo(d.desde, d.hasta);
    tarjetas.push({ k: 'promedio_dia', titulo: '📅 Promedio por día', valor: dias > 0 ? usd(t.total / dias) : '—', nota: dias > 0 ? `${dias} día(s)` : undefined });
  }
  // ⚖️🕐 Lo que el jefe calcula a mano todos los días (21-oct-2026, a pedido):
  // cuánto le cuesta la MAQUINARIA por cada tonelada que mueve el acarreo, y a
  // cuánto le está saliendo la hora facturada en promedio. Redactado completo en
  // la nota, como el informe operativo: la cifra sin su cuento no le sirve.
  if (op.costoTonelada || op.horaPromedio) {
    const ct = costoPorTonelada(d.filas, op, d.viajesTon ?? []);
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
      const cojos = ct.porFrente.filter((x) => x.usdPorTon == null && x.costo > 0).map((x) => `${x.frente} (${usd(x.costo)} sin toneladas)`);
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
    const ant = totalesConsolidado(d.filasAnterior, op);
    const detalle = fuentesQueSuman(op).map((k) => `${FUENTES_META[k].icon} ${varPct(t.porFuente[k], ant.porFuente[k])}`).join(' · ');
    tarjetas.push({ k: 'comparacion', titulo: '📊 vs período anterior', valor: varPct(t.total, ant.total), nota: `antes ${usd(ant.total)}${detalle ? ` · ${detalle}` : ''}` });
  }

  if (op.cuadroEmpresas && !op.sinEmpresas) {
    cuadros.push({
      k: 'por_empresa',
      titulo: '🏢 Cuánto se le paga a cada empresa',
      filas: porEmpresaConsolidado(d.filas, op).map((e) => ({ clave: `${e.empresa} (${e.maquinas})`, n: e.total })),
    });
  }
  if (op.top5) {
    cuadros.push({
      k: 'top5',
      titulo: '🏆 Las 5 máquinas más costosas',
      filas: topMaquinas(d.filas, op, 5).map((x) => ({
        clave: `${x.fila.code}${x.fila.placa ? ` · ${x.fila.placa}` : ''}${x.principal ? ` (${FUENTES_META[x.principal].icon} ${FUENTES_META[x.principal].label.toLowerCase()})` : ''} — ${pct(x.total, t.total)} del total`,
        n: x.total,
      })),
    });
  }
  if (op.solapes) {
    const s = solapesConsolidado(d.filas, op);
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
}, op: OpcionesConsolidado, edicion?: EdicionResumen): string {
  const elegidas = filasElegidas(d.filas, op);
  const visibles = fuentesVisibles(op);
  const suman = new Set(fuentesQueSuman(op));
  const t = totalesConsolidado(d.filas, op);
  const solapeIds = new Set(solapesConsolidado(d.filas, op).map((x) => x.fila.id));
  let html = `<div class="cj">`;
  html += `<p class="nota">Del ${dmy(d.desde)} al ${dmy(d.hasta)}. Cada monto sale de su propio control (jornadas de Control de pagos, pago por horómetro, pago por viajes y pago por peso): este papel no inventa nada, solo junta y suma.${visibles.some((k) => !suman.has(k)) ? ' Lo marcado «ref» se muestra sin sumar.' : ''}</p>`;
  if (elegidas.length === 0) return `${html}<p class="nota">Sin montos en el rango con las fuentes elegidas.</p></div>`;

  const conCant = !op.sinCantidades;
  const celdaCant = (k: FuenteKey, f: { cant?: Partial<Record<FuenteKey, number>> } | Record<FuenteKey, number>, deTotales = false): string => {
    if (!conCant) return '';
    const v = deTotales ? (f as Record<FuenteKey, number>)[k] : (f as FilaConsolidada).cant?.[k];
    const tx = cantTexto(k, v ?? 0);
    return tx ? `<div class="q">${esc(tx)}</div>` : '';
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
        const empresas = porEmpresaConsolidado(d.filas, op);
        html += `<h3>${esc(c.titulo)}</h3><table><thead><tr><th>Empresa</th><th class="r">Máquinas</th>${visibles.map((k) => `<th class="r">${FUENTES_META[k].icon} ${FUENTES_META[k].label}${suman.has(k) ? '' : ' (ref)'}</th>`).join('')}<th class="r">TOTAL</th><th class="r">% del total</th></tr></thead><tbody>${empresas.map((e) => `<tr><td>${esc(e.empresa)}</td><td class="r">${e.maquinas}</td>${visibles.map((k) => `<td class="r${suman.has(k) ? '' : ' ref'}">${e.porFuente[k] !== 0 ? usd(e.porFuente[k]) : '—'}${e.porFuente[k] !== 0 ? celdaCant(k, e.cantPorFuente, true) : ''}</td>`).join('')}<td class="r b">${usd(e.total)}</td><td class="r">${t.total > 0 ? `${Math.round((e.total / t.total) * 100)}%` : '—'}</td></tr>`).join('')}</tbody></table>`;
        continue;
      }
      html += `<h3>${esc(c.titulo)}</h3><table><tbody>${c.filas.map((f) => `<tr><td>${esc(f.clave)}</td><td class="r b">${usd(f.n)}</td></tr>`).join('')}</tbody></table>`;
    }
  }

  // ── La matriz máquina × fuente ──
  const th = (k: FuenteKey) => `<th class="r">${FUENTES_META[k].icon} ${FUENTES_META[k].label}${suman.has(k) ? '' : ' (ref)'}</th>`;
  const cab = `<tr><th>Máquina</th>${op.sinPlaca ? '' : '<th>Placa / serial</th>'}${op.sinMarcaModelo ? '' : '<th>Marca / modelo</th>'}${op.sinEmpresas || op.agruparPor === 'empresa' ? '' : '<th>Empresa</th>'}${visibles.map(th).join('')}<th class="r">TOTAL</th></tr>`;
  const filaTd = (f: FilaConsolidada) => {
    const celdas = visibles.map((k) => {
      const v = f.montos[k] ?? 0;
      return `<td class="r${suman.has(k) ? '' : ' ref'}">${v !== 0 ? usd(v) : '—'}${v !== 0 ? celdaCant(k, f) : ''}</td>`;
    }).join('');
    const warn = solapeIds.has(f.id) && op.solapes;
    return `<tr><td>${warn ? '⚠️ ' : ''}${esc(f.code)}</td>${op.sinPlaca ? '' : `<td>${esc(f.placa || '—')}</td>`}${op.sinMarcaModelo ? '' : `<td>${esc([f.marca, f.modelo].filter(Boolean).join(' ') || '—')}</td>`}${op.sinEmpresas || op.agruparPor === 'empresa' ? '' : `<td>${esc(f.empresa)}</td>`}${celdas}<td class="r b">${usd(totalFila(f, op))}</td></tr>`;
  };
  const filaTotales = (lista: FilaConsolidada[], etiqueta: string, clase: string) => {
    const cols = 1 + (op.sinPlaca ? 0 : 1) + (op.sinMarcaModelo ? 0 : 1) + (op.sinEmpresas || op.agruparPor === 'empresa' ? 0 : 1);
    const porF = visibles.map((k) => {
      const v = r2(lista.reduce((s, f) => s + (f.montos[k] ?? 0), 0));
      const c = r2(lista.reduce((s, f) => s + (f.cant?.[k] ?? 0), 0));
      const tx = conCant ? cantTexto(k, c) : '';
      return `<td class="r${suman.has(k) ? '' : ' ref'}">${usd(v)}${tx ? `<div class="q">${esc(tx)}</div>` : ''}</td>`;
    }).join('');
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
    : null;
  html += `<h2>📑 Detalle ${porBloques ? porBloques.titulo : 'por máquina'}</h2>`;
  if (porBloques) {
    const nombres = Array.from(new Set(elegidas.map(porBloques.clave))).sort(cmpTx);
    for (const nombre of nombres) {
      const lista = elegidas.filter((f) => porBloques.clave(f) === nombre);
      html += `<h3>${porBloques.icon} ${esc(nombre)}</h3><table><thead>${cab}</thead><tbody>${lista.map(filaTd).join('')}${filaTotales(lista, `Subtotal ${nombre}`, 'sub')}</tbody></table>`;
    }
    html += `<table><tbody>${filaTotales(elegidas, 'TOTAL GENERAL', 'tot')}</tbody></table>`;
  } else {
    html += `<h3>${op.agruparPor === 'maquina' ? '🚜 Por máquina' : '📋 Todas las máquinas'}</h3><table><thead>${cab}</thead><tbody>${elegidas.map(filaTd).join('')}${filaTotales(elegidas, 'TOTAL GENERAL', 'tot')}</tbody></table>`;
  }

  return `${html}</div>`;
}

export function subtituloConsolidado(d: { desde: string; hasta: string }, op: OpcionesConsolidado, filtrado: boolean): string {
  const fuentes = fuentesQueSuman(op).map((k) => FUENTES_META[k].label.toLowerCase()).join(' + ') || 'sin fuentes que sumen';
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
    partes.push({ maquina: 'por máquina', global: 'global', categoria: 'por categoría', frente: 'por frente' }[op.agruparPor]);
  }
  if (op.sinEmpresas) partes.push('sin empresas');
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
  if (!op.resumen) partes.push('sin resumen');
  if (op.sinCantidades) partes.push('sin cantidades');
  return partes.length ? ` (${partes.join(', ')})` : '';
}

export function nombreArchivoConsolidado(desde: string, hasta: string, op: OpcionesConsolidado): string {
  return `Reporte consolidado de pagos ${dmy(desde).replace(/\//g, '-')} a ${dmy(hasta).replace(/\//g, '-')}${sufijoArchivoConsolidado(op)}`;
}
