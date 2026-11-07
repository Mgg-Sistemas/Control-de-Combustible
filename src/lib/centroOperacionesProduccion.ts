// 🏭 CENTRO DE OPERACIONES — ⚙️ PRODUCCIÓN DE TRITURACIÓN (06-nov-2026, a pedido de la
// encargada del CDT).
//
// Lo que pidió (dos audios; el segundo corrige al primero):
//   · Un bloque 2 en el 📅 Parte diario: «Producción de trituración». Por cada equipo (la
//     Trituradora 1, la 2 de Ecosocialismo cuando la arreglen y el cono que hay que comprar)
//     ella anota las HORAS que trabajó y las TONELADAS POR HORA que ve en sitio (dependen de
//     cuánto abre o cierra la mandíbula): horas × t/h = toneladas.
//   · Dos modos: TRITURADO MIXTO (un solo producto) y CRIBADO, que sale clasificado en los %
//     que ella ve con la pala (por defecto polvillo, arrocillo y estéril). Un día puede tener
//     las dos cosas (10 h prendida, 4 de ellas cribando) → varias líneas por equipo y día.
//   · ⭐ NO DESCUENTA NI LIMITA LAS SALIDAS (audio 2): «que la salida la maneje yo», porque el
//     CERNIDOR también produce y no se mide. Por eso aquí solo se REGISTRA y se REPORTA; la
//     comparación «producido vs. salido» es INFORMATIVA (como «Patios vs. Reporte General»),
//     nunca un error ni un tope.
//
// Reglas:
//   · Las toneladas las calcula la BASE (columna generada `round(horas × t/h, 2)`); aquí se
//     calculan igual para mostrarlas en vivo.
//   · Lo que se guarda queda CONGELADO: el nombre del equipo, la t/h usada y el factor t/m³ de
//     cada producto. Cambiar después la t/h por defecto o el factor del material no mueve lo
//     ya anotado.
//   · Un equipo no pasa de 24 h en una jornada (la base también lo exige).
//   · Los % del cribado suman 100 (la base también lo exige). El reparto en toneladas cuadra
//     EXACTO con el total: el último producto absorbe el redondeo.
//   · m³ = toneladas ÷ factor del material (el de ⚙️ Ajustes → Materiales; sin factor, 1,2,
//     la misma regla que las salidas de agregados).
//
// TODO ESTE ARCHIVO ES PURO (sin React ni Supabase). Lo prueba
// `scripts/test-centro-operaciones-produccion.mjs`.
import type { ItemLista, Movimiento } from './centroOperaciones';
import { leerNumero } from './numeros';
import { norm } from './text';
import { factorDeMaterial, salidasDeClase } from '../components/centroOperaciones/salidasParteDiario';

// ═══════════════════════════ Tipos ═══════════════════════════

export type TipoEquipo = 'trituradora' | 'cono' | 'otro';
export type ModoProduccion = 'mixto' | 'cribado';

/** Un equipo de trituración del sitio (`cop_equipos_trituracion`). */
export type EquipoTrituracion = {
  id: string;
  sitioId: string;
  nombre: string;
  tipo: TipoEquipo;
  codigo: string | null;
  serial: string | null;
  /** Toneladas por hora que se proponen al anotar (ella las cambia según la mandíbula). */
  thDefecto: number | null;
  activo: boolean;
  orden: number;
  nota: string | null;
};

/** Un producto del reparto, con su % y el factor t/m³ CONGELADO al guardar. */
export type RepartoItem = { producto: string; pct: number; factor: number | null };

/** Una línea de producción (`cop_produccion`): un equipo, un modo, unas horas, en una jornada. */
export type Produccion = {
  id: string;
  sitioId: string;
  fecha: string;
  equipoId: string;
  /** El nombre del equipo al anotar (congelado). */
  equipoNombre: string;
  modo: ModoProduccion;
  horas: number;
  tPorHora: number;
  /** Lo calcula la base: round(horas × t/h, 2). */
  toneladas: number;
  reparto: RepartoItem[];
  nota: string | null;
  creadoPor: string | null;
  creadoAt: string | null;
  editadoPor: string | null;
  editadoAt: string | null;
};

// ═══════════════════════════ Constantes ═══════════════════════════

export const HORAS_MAX_JORNADA = 24;
export const TPH_MAX = 5000;
export const PRODUCTO_MIXTO = 'Triturado mixto';
/** Lo que saca el cribado (audio 1): polvillo, arrocillo y estéril. Se pueden agregar otros. */
export const PRODUCTOS_CRIBADO = ['Polvillo', 'Arrocillo', 'Estéril'] as const;

export const MODOS: { key: ModoProduccion; label: string; ayuda: string }[] = [
  { key: 'mixto', label: '🪨 Triturado mixto', ayuda: 'Todo sale como triturado mixto.' },
  { key: 'cribado', label: '🧪 Cribado', ayuda: 'Sale clasificado según los % que tú ves en sitio.' },
];

export const TIPOS_EQUIPO: { key: TipoEquipo; label: string }[] = [
  { key: 'trituradora', label: '⚙️ Trituradora' },
  { key: 'cono', label: '🔺 Cono triturador' },
  { key: 'otro', label: '🔧 Otro' },
];

export const etiquetaModo = (m: ModoProduccion | string): string => (m === 'cribado' ? '🧪 Cribado' : '🪨 Triturado mixto');
export const etiquetaTipo = (t: TipoEquipo | string): string => TIPOS_EQUIPO.find((x) => x.key === t)?.label ?? '🔧 Otro';

// ═══════════════════════════ Utilidades ═══════════════════════════

const limpia = (s: unknown): string => String(s ?? '').replace(/\s+/g, ' ').trim();
const llave = (s: unknown): string => norm(limpia(s));
const esNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const redondear = (n: number, dec: number): number => {
  const f = 10 ** dec;
  const r = Math.round((n + Number.EPSILON) * f) / f;
  return r === 0 ? 0 : r;
};
export const r2 = (n: number): number => redondear(n, 2);
const tieneDigito = (t: unknown): boolean => /\d/.test(String(t ?? ''));

/** «1.500,00» */
export const fmtT = (n: number | null | undefined): string =>
  (esNum(n) ? n : 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** «10,5» (horas y t/h: sin ceros de más) */
export const fmtN = (n: number | null | undefined): string =>
  (esNum(n) ? n : 0).toLocaleString('es-VE', { maximumFractionDigits: 2 });
/** «10 h 30 min» → para que se lea lo que se entendió de «10:30». */
export function textoHoras(h: number): string {
  if (!esNum(h) || h <= 0) return '0 h';
  const enteras = Math.floor(h + 1e-9);
  const min = Math.round((h - enteras) * 60);
  if (min === 60) return `${enteras + 1} h`;
  return min ? `${enteras} h ${min} min` : `${enteras} h`;
}

// ═══════════════════════════ Leer lo escrito ═══════════════════════════

export type Lectura = { ok: true; valor: number } | { ok: false; error: string; vacio?: boolean };

/**
 * Las horas: «10», «10,5», «10.5» o «10:30» (horas y minutos). De más de 0 a 24.
 * Vacío = error con `vacio` (la pantalla no lo pinta en rojo hasta guardar).
 */
export function leerHoras(texto: unknown): Lectura {
  const t = limpia(texto);
  if (!t) return { ok: false, error: 'Escribe las horas que trabajó.', vacio: true };
  const hm = t.match(/^(\d{1,2})\s*[:hH]\s*(\d{1,2})\s*(?:m|min)?$/);
  let h: number;
  if (hm) {
    const min = Number(hm[2]);
    if (min >= 60) return { ok: false, error: `«${t}»: los minutos van de 0 a 59.` };
    h = Number(hm[1]) + min / 60;
  } else {
    if (!tieneDigito(t) || /[^0-9.,\shH]/.test(t.replace(/hrs?|horas?/i, ''))) return { ok: false, error: `«${t}» no es un número de horas (ejemplos: 10, 10,5 o 10:30).` };
    h = leerNumero(t);
  }
  if (!esNum(h) || h <= 0) return { ok: false, error: 'Las horas tienen que ser más de 0.' };
  if (h > HORAS_MAX_JORNADA) return { ok: false, error: `Son ${fmtN(h)} h: una jornada tiene como máximo ${HORAS_MAX_JORNADA} h.` };
  return { ok: true, valor: redondear(h, 4) };
}

/** Las toneladas por hora: más de 0, hasta 5.000. */
export function leerTph(texto: unknown): Lectura {
  const t = limpia(texto);
  if (!t) return { ok: false, error: 'Escribe las toneladas por hora.', vacio: true };
  if (!tieneDigito(t)) return { ok: false, error: `«${t}» no es un número de toneladas por hora.` };
  const n = leerNumero(t);
  if (!esNum(n) || n <= 0) return { ok: false, error: 'Las toneladas por hora tienen que ser más de 0.' };
  if (n > TPH_MAX) return { ok: false, error: `${fmtN(n)} t/h es demasiado: revisa la cifra (máximo ${fmtN(TPH_MAX)}).` };
  return { ok: true, valor: redondear(n, 4) };
}

/** Un porcentaje: de más de 0 a 100. */
export function leerPct(texto: unknown): Lectura {
  const t = limpia(texto).replace('%', '').trim();
  if (!t) return { ok: false, error: 'Falta el %.', vacio: true };
  if (!tieneDigito(t)) return { ok: false, error: `«${t}» no es un porcentaje.` };
  const n = leerNumero(t);
  if (!esNum(n) || n <= 0) return { ok: false, error: 'El % tiene que ser más de 0 (si no salió nada de ese producto, quítalo).' };
  if (n > 100) return { ok: false, error: `${fmtN(n)} % es más de 100.` };
  return { ok: true, valor: redondear(n, 4) };
}

// ═══════════════════════════ Factores y reparto ═══════════════════════════

/** El factor t/m³ del producto: el de su material en la lista; si no tiene, 1,2 (como las salidas). */
export function factorDeProducto(producto: string, listas: ItemLista[]): { factor: number; deLista: boolean } {
  return factorDeMaterial({ texto: producto, listaId: null }, listas ?? []);
}

/** El reparto del triturado mixto: un solo producto al 100 %. */
export function repartoMixto(listas: ItemLista[]): RepartoItem[] {
  return [{ producto: PRODUCTO_MIXTO, pct: 100, factor: factorDeProducto(PRODUCTO_MIXTO, listas).factor }];
}

/** Lo que trae el formulario del cribado: el nombre y el % escritos. */
export type FilaRepartoForm = { producto: string; pct: string };

/** Las filas de arranque del cribado: el último reparto de ese equipo, o polvillo/arrocillo/estéril vacíos. */
export function repartoInicial(ultimo: RepartoItem[] | null | undefined): FilaRepartoForm[] {
  const previo = (ultimo ?? []).filter((r) => limpia(r?.producto));
  if (previo.length && !(previo.length === 1 && llave(previo[0].producto) === llave(PRODUCTO_MIXTO))) {
    return previo.map((r) => ({ producto: limpia(r.producto), pct: esNum(r.pct) ? fmtN(r.pct) : '' }));
  }
  return PRODUCTOS_CRIBADO.map((p) => ({ producto: p, pct: '' }));
}

export type RevisionReparto = {
  ok: boolean;
  /** La suma de los % que se pudieron leer. */
  suma: number;
  /** «Suman 100 % ✅», «Suman 110 %: sobran 10 %», «Suman 70 %: faltan 30 %». */
  texto: string;
  errores: string[];
  items: RepartoItem[];
};

/** Revisa el reparto del cribado: nombres, sin repetidos, % válidos y que sumen 100. */
export function revisarReparto(filas: FilaRepartoForm[], listas: ItemLista[]): RevisionReparto {
  const errores: string[] = [];
  const items: RepartoItem[] = [];
  const vistos = new Set<string>();
  let suma = 0;
  const usadas = (filas ?? []).filter((f) => limpia(f?.producto) || limpia(f?.pct));
  if (!usadas.length) errores.push('El cribado necesita al menos un producto con su %.');
  for (const f of usadas) {
    const nombre = limpia(f.producto);
    if (!nombre) { errores.push(`Hay un % (${limpia(f.pct)}) sin el nombre del producto.`); continue; }
    if (vistos.has(llave(nombre))) { errores.push(`«${nombre}» está repetido: déjalo una sola vez.`); continue; }
    vistos.add(llave(nombre));
    const p = leerPct(f.pct);
    if (!p.ok) { errores.push(`${nombre}: ${p.error}`); continue; }
    suma += p.valor;
    items.push({ producto: nombre, pct: p.valor, factor: factorDeProducto(nombre, listas).factor });
  }
  suma = redondear(suma, 2);
  const dif = redondear(100 - suma, 2);
  let texto: string;
  if (Math.abs(dif) <= 0.01) texto = 'Suman 100 % ✅';
  else if (dif > 0) texto = `Suman ${fmtN(suma)} %: faltan ${fmtN(dif)} %`;
  else texto = `Suman ${fmtN(suma)} %: sobran ${fmtN(-dif)} %`;
  if (usadas.length && Math.abs(dif) > 0.01) errores.push(`Los % ${texto.toLowerCase()} (tienen que sumar 100 %).`);
  return { ok: errores.length === 0, suma, texto, errores, items };
}

/** Lo que sale de cada producto: toneladas (cuadran EXACTO con el total) y m³. */
export type DesgloseProducto = { producto: string; pct: number; toneladas: number; m3: number; factor: number };

export function desglosar(toneladas: number, reparto: RepartoItem[]): DesgloseProducto[] {
  const total = esNum(toneladas) && toneladas > 0 ? r2(toneladas) : 0;
  const items = (reparto ?? []).filter((r) => r && esNum(r.pct) && r.pct > 0);
  let acumulado = 0;
  return items.map((r, i) => {
    const t = i === items.length - 1 ? r2(total - acumulado) : r2((total * r.pct) / 100);
    acumulado = r2(acumulado + t);
    const factor = esNum(r.factor) && r.factor > 0 ? r.factor : 1.2;
    return { producto: limpia(r.producto), pct: r.pct, toneladas: t, m3: r2(t / factor), factor };
  });
}

export const toneladasDe = (horas: number, tph: number): number => (esNum(horas) && esNum(tph) ? r2(horas * tph) : 0);

// ═══════════════════════════ El formulario ═══════════════════════════

export type FormProduccion = {
  modo: ModoProduccion;
  horas: string;
  tph: string;
  reparto: FilaRepartoForm[];
  nota: string;
};

export function formVacio(equipo: EquipoTrituracion | null, ultimoCribado?: RepartoItem[] | null): FormProduccion {
  return {
    modo: 'mixto',
    horas: '',
    tph: equipo && esNum(equipo.thDefecto) ? fmtN(equipo.thDefecto) : '',
    reparto: repartoInicial(ultimoCribado),
    nota: '',
  };
}

export function formDeProduccion(p: Produccion): FormProduccion {
  return {
    modo: p.modo,
    horas: fmtN(p.horas),
    tph: fmtN(p.tPorHora),
    reparto: p.modo === 'cribado'
      ? (p.reparto ?? []).map((r) => ({ producto: r.producto, pct: fmtN(r.pct) }))
      : repartoInicial(null),
    nota: p.nota ?? '',
  };
}

/** ¿El formulario tiene algo escrito, distinto de como arrancó? (para «✏️ sin guardar»). */
export function formCambio(f: FormProduccion, base: FormProduccion): boolean {
  const k = (x: FormProduccion) => JSON.stringify([x.modo, limpia(x.horas), limpia(x.tph), limpia(x.nota),
    x.modo === 'cribado' ? x.reparto.map((r) => [limpia(r.producto), limpia(r.pct)]) : []]);
  return k(f) !== k(base);
}

export type RevisionForm = {
  ok: boolean;
  errores: string[];
  /** Lo que se ve en vivo (aunque falten cosas): null si no se puede calcular aún. */
  toneladas: number | null;
  desglose: DesgloseProducto[];
  reparto: RevisionReparto | null;
  /** Las horas leídas (para el tope del equipo). */
  horas: number | null;
  datos: { modo: ModoProduccion; horas: number; tPorHora: number; reparto: RepartoItem[]; nota: string | null } | null;
};

/**
 * Revisa el formulario completo. `horasOtras` = las horas que el equipo YA tiene en la
 * jornada (sin contar la línea que se está corrigiendo): con estas no puede pasar de 24.
 */
export function revisarForm(f: FormProduccion, listas: ItemLista[], horasOtras: number, equipoNombre: string): RevisionForm {
  const errores: string[] = [];
  const h = leerHoras(f.horas);
  const t = leerTph(f.tph);
  if (!h.ok) errores.push(h.error);
  if (!t.ok) errores.push(t.error);
  const otras = esNum(horasOtras) && horasOtras > 0 ? horasOtras : 0;
  if (h.ok && otras + h.valor > HORAS_MAX_JORNADA + 1e-9) {
    errores.push(`${limpia(equipoNombre) || 'Este equipo'} ya tiene ${fmtN(otras)} h anotadas en esta jornada: con estas serían ${fmtN(r2(otras + h.valor))} h (el máximo es ${HORAS_MAX_JORNADA}).`);
  }
  let reparto: RevisionReparto | null = null;
  let items: RepartoItem[];
  if (f.modo === 'cribado') {
    reparto = revisarReparto(f.reparto, listas);
    errores.push(...reparto.errores);
    items = reparto.items;
  } else {
    items = repartoMixto(listas);
  }
  const toneladas = h.ok && t.ok ? toneladasDe(h.valor, t.valor) : null;
  const desglose = toneladas !== null && (f.modo === 'mixto' || (reparto && reparto.ok)) ? desglosar(toneladas, items) : [];
  const ok = errores.length === 0 && h.ok && t.ok;
  return {
    ok,
    errores,
    toneladas,
    desglose,
    reparto,
    horas: h.ok ? h.valor : null,
    datos: ok && h.ok && t.ok ? { modo: f.modo, horas: h.valor, tPorHora: t.valor, reparto: items, nota: limpia(f.nota) || null } : null,
  };
}

// ═══════════════════════════ Lo del día / del período ═══════════════════════════

/** Las horas que un equipo ya tiene en una jornada, sin contar `salvoId`. */
export function horasDelEquipo(producciones: Produccion[], equipoId: string, fecha: string, salvoId?: string | null): number {
  return r2((producciones ?? [])
    .filter((p) => p && p.equipoId === equipoId && p.fecha === fecha && p.id !== salvoId)
    .reduce((s, p) => s + (esNum(p.horas) ? p.horas : 0), 0));
}

/** El último reparto de CRIBADO de un equipo (para proponer los mismos % la próxima vez). */
export function ultimoRepartoCribado(producciones: Produccion[], equipoId: string): RepartoItem[] | null {
  const delEquipo = (producciones ?? []).filter((p) => p && p.equipoId === equipoId && p.modo === 'cribado' && p.reparto?.length);
  if (!delEquipo.length) return null;
  delEquipo.sort((a, b) => (a.fecha === b.fecha ? String(a.creadoAt ?? '').localeCompare(String(b.creadoAt ?? '')) : a.fecha.localeCompare(b.fecha)));
  return delEquipo[delEquipo.length - 1].reparto;
}

/**
 * Los equipos que se muestran en una jornada: los ACTIVOS (en su orden) más los inactivos
 * que tienen algo anotado ESE día (lo anotado nunca desaparece de la vista).
 */
export function equiposDelDia(equipos: EquipoTrituracion[], producciones: Produccion[], fecha: string): EquipoTrituracion[] {
  const conAlgo = new Set((producciones ?? []).filter((p) => p.fecha === fecha).map((p) => p.equipoId));
  return (equipos ?? [])
    .filter((e) => e && (e.activo || conAlgo.has(e.id)))
    .sort((a, b) => (a.orden - b.orden) || a.nombre.localeCompare(b.nombre, 'es'));
}

export type TotalesProduccion = {
  lineas: number;
  horas: number;
  toneladas: number;
  m3: number;
  /** Por producto (A→Z con el mixto primero): t y m³. */
  porProducto: { producto: string; toneladas: number; m3: number }[];
};

/** Junta las líneas: horas, toneladas, m³ y lo que salió de cada producto. */
export function totalesProduccion(producciones: Produccion[]): TotalesProduccion {
  const por = new Map<string, { producto: string; toneladas: number; m3: number }>();
  let horas = 0; let toneladas = 0; let m3 = 0; let lineas = 0;
  for (const p of producciones ?? []) {
    if (!p) continue;
    lineas++;
    horas += esNum(p.horas) ? p.horas : 0;
    const tot = esNum(p.toneladas) ? p.toneladas : toneladasDe(p.horas, p.tPorHora);
    toneladas += tot;
    for (const d of desglosar(tot, p.reparto)) {
      m3 += d.m3;
      const k = llave(d.producto);
      const g = por.get(k);
      if (g) { g.toneladas = r2(g.toneladas + d.toneladas); g.m3 = r2(g.m3 + d.m3); } else por.set(k, { producto: d.producto, toneladas: d.toneladas, m3: d.m3 });
    }
  }
  const porProducto = [...por.values()].sort((a, b) => {
    const am = llave(a.producto) === llave(PRODUCTO_MIXTO) ? 0 : 1;
    const bm = llave(b.producto) === llave(PRODUCTO_MIXTO) ? 0 : 1;
    return am - bm || a.producto.localeCompare(b.producto, 'es');
  });
  return { lineas, horas: r2(horas), toneladas: r2(toneladas), m3: r2(m3), porProducto };
}

/** Lo que dice plegado el bloque: «Trituradora 1 · 10 h · 2.650,00 t» o «Sin producción anotada». */
export function resumenBloqueProduccion(producciones: Produccion[], fecha: string): string {
  const delDia = (producciones ?? []).filter((p) => p.fecha === fecha);
  if (!delDia.length) return 'Sin producción anotada';
  const t = totalesProduccion(delDia);
  return `${fmtN(t.horas)} h · ${fmtT(t.toneladas)} t · ≈ ${fmtT(t.m3)} m³`;
}

/** Una línea en palabras: «🪨 Triturado mixto · 6 h × 250 t/h = 1.500,00 t». */
export function textoLinea(p: Pick<Produccion, 'modo' | 'horas' | 'tPorHora' | 'toneladas'>): string {
  const t = esNum(p.toneladas) ? p.toneladas : toneladasDe(p.horas, p.tPorHora);
  return `${etiquetaModo(p.modo)} · ${fmtN(p.horas)} h × ${fmtN(p.tPorHora)} t/h = ${fmtT(t)} t`;
}

// ═══════════════════════════ Producido vs. salido (INFORMATIVO) ═══════════════════════════

export type FilaProducidoSalido = {
  producto: string;
  producidoT: number;
  producidoM3: number;
  /** Lo que salió en el período (salidas de agregados de ese material). null = no salió nada. */
  salidoT: number | null;
  salidoM3: number | null;
  /** salido − producido, en t; null si no salió. */
  diferenciaT: number | null;
};

/**
 * Por cada producto: lo producido en la trituración contra lo que SALIÓ (las salidas de
 * agregados de ese material en el mismo período, confirmadas o esperando pesaje). Solo
 * informa: lo que sale de más viene del CERNIDOR, que no se mide (audio 2). También lista
 * los materiales que SALIERON y no se produjeron en la trituradora.
 */
export function producidoVsSalido(producciones: Produccion[], movimientos: Movimiento[]): FilaProducidoSalido[] {
  const tot = totalesProduccion(producciones);
  const salidas = salidasDeClase(movimientos ?? [], 'agregados').filter((m) => m.estado !== 'por_confirmar');
  const sal = new Map<string, { nombre: string; t: number; m3: number; hayT: boolean; hayM3: boolean }>();
  for (const m of salidas) {
    const nombre = limpia(m.material) || 'Sin material';
    const k = llave(nombre);
    const g = sal.get(k) ?? { nombre, t: 0, m3: 0, hayT: false, hayM3: false };
    if (m.estado === 'confirmado' && esNum(m.toneladas)) { g.t = r2(g.t + m.toneladas); g.hayT = true; }
    if (esNum(m.m3)) { g.m3 = r2(g.m3 + m.m3); g.hayM3 = true; }
    sal.set(k, g);
  }
  const filas: FilaProducidoSalido[] = tot.porProducto.map((p) => {
    const s = sal.get(llave(p.producto));
    sal.delete(llave(p.producto));
    const salidoT = s && s.hayT ? s.t : null;
    return {
      producto: p.producto,
      producidoT: p.toneladas,
      producidoM3: p.m3,
      salidoT,
      salidoM3: s && s.hayM3 ? s.m3 : null,
      diferenciaT: salidoT === null ? null : r2(salidoT - p.toneladas),
    };
  });
  for (const s of sal.values()) {
    filas.push({ producto: s.nombre, producidoT: 0, producidoM3: 0, salidoT: s.hayT ? s.t : null, salidoM3: s.hayM3 ? s.m3 : null, diferenciaT: s.hayT ? s.t : null });
  }
  return filas;
}

export const NOTA_CERNIDOR = 'Comparación informativa: lo que sale puede ser más de lo triturado porque el cernidor también produce y no se mide. No descuenta ni limita las salidas.';

// ═══════════════════════════ Filas de la base ═══════════════════════════

const numONull = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : v;
  return esNum(n) ? n : null;
};

export function filaAEquipo(r: any): EquipoTrituracion {
  return {
    id: String(r?.id ?? ''),
    sitioId: String(r?.sitio_id ?? ''),
    nombre: limpia(r?.nombre),
    tipo: (['trituradora', 'cono', 'otro'].includes(r?.tipo) ? r.tipo : 'otro') as TipoEquipo,
    codigo: limpia(r?.codigo) || null,
    serial: limpia(r?.serial) || null,
    thDefecto: numONull(r?.th_defecto),
    activo: r?.activo !== false,
    orden: numONull(r?.orden) ?? 0,
    nota: limpia(r?.nota) || null,
  };
}

export function equipoAFila(e: Partial<EquipoTrituracion>): Record<string, unknown> {
  const f: Record<string, unknown> = {};
  if (e.id !== undefined) f.id = e.id;
  if (e.sitioId !== undefined) f.sitio_id = e.sitioId;
  if (e.nombre !== undefined) f.nombre = limpia(e.nombre);
  if (e.tipo !== undefined) f.tipo = e.tipo;
  if (e.codigo !== undefined) f.codigo = limpia(e.codigo) || null;
  if (e.serial !== undefined) f.serial = limpia(e.serial) || null;
  if (e.thDefecto !== undefined) f.th_defecto = esNum(e.thDefecto) && e.thDefecto > 0 ? e.thDefecto : null;
  if (e.activo !== undefined) f.activo = !!e.activo;
  if (e.orden !== undefined) f.orden = esNum(e.orden) ? Math.round(e.orden) : 0;
  if (e.nota !== undefined) f.nota = limpia(e.nota) || null;
  return f;
}

function repartoDeFila(v: unknown): RepartoItem[] {
  const arr = Array.isArray(v) ? v : [];
  return arr
    .map((x: any) => ({ producto: limpia(x?.producto), pct: numONull(x?.pct) ?? 0, factor: numONull(x?.factor) }))
    .filter((x) => x.producto && x.pct > 0);
}

export function filaAProduccion(r: any): Produccion {
  const horas = numONull(r?.horas) ?? 0;
  const tph = numONull(r?.t_por_hora) ?? 0;
  return {
    id: String(r?.id ?? ''),
    sitioId: String(r?.sitio_id ?? ''),
    fecha: String(r?.fecha ?? '').slice(0, 10),
    equipoId: String(r?.equipo_id ?? ''),
    equipoNombre: limpia(r?.equipo_nombre),
    modo: r?.modo === 'cribado' ? 'cribado' : 'mixto',
    horas,
    tPorHora: tph,
    toneladas: numONull(r?.toneladas) ?? toneladasDe(horas, tph),
    reparto: repartoDeFila(r?.reparto),
    nota: limpia(r?.nota) || null,
    creadoPor: limpia(r?.created_by_nombre) || null,
    creadoAt: r?.created_at ?? null,
    editadoPor: limpia(r?.updated_by_nombre) || null,
    editadoAt: r?.updated_at ?? null,
  };
}

/** Lo que se escribe en la base (las toneladas NO: las calcula ella). */
export function produccionAFila(p: {
  sitioId: string; fecha: string; equipo: EquipoTrituracion;
  modo: ModoProduccion; horas: number; tPorHora: number; reparto: RepartoItem[]; nota: string | null;
}): Record<string, unknown> {
  return {
    sitio_id: p.sitioId,
    fecha: p.fecha,
    equipo_id: p.equipo.id,
    equipo_nombre: limpia(p.equipo.nombre),
    modo: p.modo,
    horas: p.horas,
    t_por_hora: p.tPorHora,
    reparto: p.reparto.map((r) => ({ producto: limpia(r.producto), pct: r.pct, factor: esNum(r.factor) ? r.factor : null })),
    nota: limpia(p.nota) || null,
  };
}

// ═══════════════════════════ Equipos: revisar antes de guardar ═══════════════════════════

export type FormEquipo = { nombre: string; tipo: TipoEquipo; codigo: string; serial: string; th: string; nota: string };

export function formEquipoVacio(): FormEquipo {
  return { nombre: '', tipo: 'trituradora', codigo: '', serial: '', th: '', nota: '' };
}

export function formDeEquipo(e: EquipoTrituracion): FormEquipo {
  return { nombre: e.nombre, tipo: e.tipo, codigo: e.codigo ?? '', serial: e.serial ?? '', th: esNum(e.thDefecto) ? fmtN(e.thDefecto) : '', nota: e.nota ?? '' };
}

/** Revisa un equipo: nombre obligatorio y sin repetir entre los ACTIVOS del sitio; t/h opcional. */
export function revisarEquipo(f: FormEquipo, otros: EquipoTrituracion[], editandoId: string | null): { ok: boolean; error: string | null; thDefecto: number | null } {
  const nombre = limpia(f.nombre);
  if (!nombre) return { ok: false, error: 'Escribe el nombre del equipo (por ejemplo «Trituradora 1»).', thDefecto: null };
  const repetido = (otros ?? []).find((e) => e.activo && e.id !== editandoId && llave(e.nombre) === llave(nombre));
  if (repetido) return { ok: false, error: `Ya hay un equipo activo llamado «${repetido.nombre}».`, thDefecto: null };
  let th: number | null = null;
  if (limpia(f.th)) {
    const t = leerTph(f.th);
    if (!t.ok) return { ok: false, error: t.error, thDefecto: null };
    th = t.valor;
  }
  return { ok: true, error: null, thDefecto: th };
}
