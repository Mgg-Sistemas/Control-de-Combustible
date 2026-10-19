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
  montos: Partial<Record<FuenteKey, number>>;
};

export type OpcionesConsolidado = {
  fuentes: Record<FuenteKey, ModoFuente>;
  /** Cómo se parte el cuerpo del papel. */
  agruparPor: 'empresa' | 'maquina' | 'global';
  sinMarcaModelo: boolean;
  sinPlaca: boolean;
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
  /** Ids marcados en el selector; vacío = todas. Esto SÍ cambia el total (va FILTRADO). */
  soloMaquinas?: string[];
};

export const OPCIONES_CONSOLIDADO_POR_DEFECTO: OpcionesConsolidado = {
  fuentes: { jornadas: 'suma', horometros: 'suma', viajes: 'suma', peso: 'suma' },
  agruparPor: 'empresa',
  sinMarcaModelo: true, // el papel del jefe nace limpio: marca/modelo se enciende
  sinPlaca: false,
  sinEmpresas: false,
  resumen: true,
  tarjetasFuente: true,
  cuadroEmpresas: true,
  top5: true,
  solapes: true,
  comparacion: true,
  promedioDia: true,
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
  const visibles = fuentesVisibles(op);
  return (filas ?? [])
    .filter((f) => marcadas.size === 0 || marcadas.has(f.id))
    .filter((f) => visibles.some((k) => (f.montos[k] ?? 0) !== 0))
    .slice()
    .sort((a, b) => cmpTx(a.empresa, b.empresa) || cmpTx(a.code, b.code) || cmpTx(a.placa, b.placa));
}

/** El total de la FILA: solo las fuentes en 'suma'. */
export const totalFila = (f: FilaConsolidada, op: OpcionesConsolidado): number =>
  r2(fuentesQueSuman(op).reduce((s, k) => s + (f.montos[k] ?? 0), 0));

export type TotalesConsolidado = {
  porFuente: Record<FuenteKey, number>;
  total: number;
  maquinas: number;
  empresas: number;
};

export function totalesConsolidado(filas: readonly FilaConsolidada[], op: OpcionesConsolidado): TotalesConsolidado {
  const elegidas = filasElegidas(filas, op);
  const porFuente = { jornadas: 0, horometros: 0, viajes: 0, peso: 0 } as Record<FuenteKey, number>;
  for (const f of elegidas) for (const k of FUENTES_ORDEN) porFuente[k] = r2(porFuente[k] + (f.montos[k] ?? 0));
  const total = r2(fuentesQueSuman(op).reduce((s, k) => s + porFuente[k], 0));
  return { porFuente, total, maquinas: elegidas.length, empresas: new Set(elegidas.map((f) => f.empresa)).size };
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

export type EmpresaConsolidada = { empresa: string; porFuente: Record<FuenteKey, number>; total: number; maquinas: number };
export function porEmpresaConsolidado(filas: readonly FilaConsolidada[], op: OpcionesConsolidado): EmpresaConsolidada[] {
  const m = new Map<string, EmpresaConsolidada>();
  for (const f of filasElegidas(filas, op)) {
    const e = m.get(f.empresa) ?? { empresa: f.empresa, porFuente: { jornadas: 0, horometros: 0, viajes: 0, peso: 0 }, total: 0, maquinas: 0 };
    for (const k of FUENTES_ORDEN) e.porFuente[k] = r2(e.porFuente[k] + (f.montos[k] ?? 0));
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
}, op: OpcionesConsolidado): ResumenFrentes {
  const t = totalesConsolidado(d.filas, op);
  const tarjetas: ResumenFrentes['tarjetas'] = [];
  const cuadros: ResumenFrentes['cuadros'] = [];

  tarjetas.push({ k: 'total', titulo: '💰 TOTAL GENERAL', valor: usd(t.total), nota: `Del ${dmy(d.desde)} al ${dmy(d.hasta)}` });
  if (op.tarjetasFuente) {
    for (const k of fuentesVisibles(op)) {
      const suma = op.fuentes[k] === 'suma';
      tarjetas.push({
        k: `fuente_${k}`,
        titulo: `${FUENTES_META[k].icon} ${FUENTES_META[k].label}`,
        valor: usd(t.porFuente[k]),
        nota: suma ? `${pct(t.porFuente[k], t.total)} del total` : 'referencia · no suma',
      });
    }
  }
  tarjetas.push({ k: 'maquinas', titulo: '🚜 Máquinas', valor: String(t.maquinas), nota: op.sinEmpresas ? undefined : `${t.empresas} empresa(s)` });
  if (op.promedioDia) {
    const dias = diasDelPeriodo(d.desde, d.hasta);
    tarjetas.push({ k: 'promedio_dia', titulo: '📅 Promedio por día', valor: dias > 0 ? usd(t.total / dias) : '—', nota: dias > 0 ? `${dias} día(s)` : undefined });
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
        clave: `${x.fila.code}${x.fila.placa ? ` · ${x.fila.placa}` : ''}${x.principal ? ` (${FUENTES_META[x.principal].icon} ${FUENTES_META[x.principal].label.toLowerCase()})` : ''}`,
        n: x.total,
      })),
    });
  }
  if (op.solapes) {
    const s = solapesConsolidado(d.filas, op);
    cuadros.push({
      k: 'solapes',
      titulo: `⚠️ Cobran por dos fuentes a la vez (${s.length})`,
      filas: s.map((x) => ({
        clave: `${x.fila.code}${x.fila.placa ? ` · ${x.fila.placa}` : ''} — ${x.fuentes.map((k) => FUENTES_META[k].icon).join('+')}`,
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
  .cj h3{font-size:13px;color:#16324F;margin:12px 0 4px}
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
}, op: OpcionesConsolidado, edicion?: EdicionResumen): string {
  const elegidas = filasElegidas(d.filas, op);
  const visibles = fuentesVisibles(op);
  const suman = new Set(fuentesQueSuman(op));
  const t = totalesConsolidado(d.filas, op);
  const solapeIds = new Set(solapesConsolidado(d.filas, op).map((x) => x.fila.id));
  let html = `<div class="cj">`;
  html += `<p class="nota">Del ${dmy(d.desde)} al ${dmy(d.hasta)}. Cada monto sale de su propio control (jornadas de Control de pagos, pago por horómetro, pago por viajes y pago por peso): este papel no inventa nada, solo junta y suma.${visibles.some((k) => !suman.has(k)) ? ' Lo marcado «ref» se muestra sin sumar.' : ''}</p>`;
  if (elegidas.length === 0) return `${html}<p class="nota">Sin montos en el rango con las fuentes elegidas.</p></div>`;

  // ── Resumen ejecutivo (editable) ──
  if (op.resumen) {
    const r = aplicarEdicionResumen(resumenConsolidado(d, op), edicion ?? {});
    html += `<div class="tjs">${r.tarjetas.map((x) => `<div class="tj"><div class="v">${esc(x.valor)}</div><div class="t">${esc(x.titulo)}</div>${x.nota ? `<div class="n">${esc(x.nota)}</div>` : ''}</div>`).join('')}</div>`;
    for (const c of r.cuadros) {
      if (!c.filas.length) continue;
      html += `<h3>${esc(c.titulo)}</h3><table><tbody>${c.filas.map((f) => `<tr><td>${esc(f.clave)}</td><td class="r b">${usd(f.n)}</td></tr>`).join('')}</tbody></table>`;
    }
  }

  // ── La matriz máquina × fuente ──
  const th = (k: FuenteKey) => `<th class="r">${FUENTES_META[k].icon} ${FUENTES_META[k].label}${suman.has(k) ? '' : ' (ref)'}</th>`;
  const cab = `<tr><th>Máquina</th>${op.sinPlaca ? '' : '<th>Placa / serial</th>'}${op.sinMarcaModelo ? '' : '<th>Marca / modelo</th>'}${op.sinEmpresas || op.agruparPor === 'empresa' ? '' : '<th>Empresa</th>'}${visibles.map(th).join('')}<th class="r">TOTAL</th></tr>`;
  const filaTd = (f: FilaConsolidada) => {
    const celdas = visibles.map((k) => {
      const v = f.montos[k] ?? 0;
      return `<td class="r${suman.has(k) ? '' : ' ref'}">${v !== 0 ? usd(v) : '—'}</td>`;
    }).join('');
    const warn = solapeIds.has(f.id) && op.solapes;
    return `<tr><td>${warn ? '⚠️ ' : ''}${esc(f.code)}</td>${op.sinPlaca ? '' : `<td>${esc(f.placa || '—')}</td>`}${op.sinMarcaModelo ? '' : `<td>${esc([f.marca, f.modelo].filter(Boolean).join(' ') || '—')}</td>`}${op.sinEmpresas || op.agruparPor === 'empresa' ? '' : `<td>${esc(f.empresa)}</td>`}${celdas}<td class="r b">${usd(totalFila(f, op))}</td></tr>`;
  };
  const filaTotales = (lista: FilaConsolidada[], etiqueta: string, clase: string) => {
    const cols = 1 + (op.sinPlaca ? 0 : 1) + (op.sinMarcaModelo ? 0 : 1) + (op.sinEmpresas || op.agruparPor === 'empresa' ? 0 : 1);
    const porF = visibles.map((k) => {
      const v = r2(lista.reduce((s, f) => s + (f.montos[k] ?? 0), 0));
      return `<td class="r${suman.has(k) ? '' : ' ref'}">${usd(v)}</td>`;
    }).join('');
    const tot = r2(lista.reduce((s, f) => s + totalFila(f, op), 0));
    return `<tr class="${clase}"><td colspan="${cols}">${esc(etiqueta)}</td>${porF}<td class="r">${usd(tot)}</td></tr>`;
  };

  if (op.agruparPor === 'empresa' && !op.sinEmpresas) {
    for (const e of porEmpresaConsolidado(d.filas, op)) {
      const lista = elegidas.filter((f) => f.empresa === e.empresa);
      html += `<h3>🏢 ${esc(e.empresa)}</h3><table><thead>${cab}</thead><tbody>${lista.map(filaTd).join('')}${filaTotales(lista, `Subtotal ${e.empresa}`, 'sub')}</tbody></table>`;
    }
    html += `<table><tbody>${filaTotales(elegidas, 'TOTAL GENERAL', 'tot')}</tbody></table>`;
  } else {
    html += `<h3>${op.agruparPor === 'maquina' ? '🚜 Por máquina' : '📋 Todas las máquinas'}</h3><table><thead>${cab}</thead><tbody>${elegidas.map(filaTd).join('')}${filaTotales(elegidas, 'TOTAL GENERAL', 'tot')}</tbody></table>`;
  }

  void t;
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
  if (op.agruparPor !== 'empresa') partes.push(op.agruparPor === 'maquina' ? 'por máquina' : 'global');
  if (op.sinEmpresas) partes.push('sin empresas');
  if ((op.soloMaquinas ?? []).length) partes.push(`solo ${(op.soloMaquinas ?? []).length} máquina(s)`);
  if (!op.resumen) partes.push('sin resumen');
  return partes.length ? ` (${partes.join(', ')})` : '';
}

export function nombreArchivoConsolidado(desde: string, hasta: string, op: OpcionesConsolidado): string {
  return `Reporte consolidado de pagos ${dmy(desde).replace(/\//g, '-')} a ${dmy(hasta).replace(/\//g, '-')}${sufijoArchivoConsolidado(op)}`;
}
