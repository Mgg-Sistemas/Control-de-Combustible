// EL PAPEL DEL REPORTE DE COMIDAS (18-sep-2026).
//
// Arma el CUERPO del documento; el membrete (logos, fecha de emisión, pie) lo
// pone `pdfDocument` de pdf.ts, igual que el PDF del cobro. El reporte viejo de
// comidas armaba su propio `<style>` suelto y salía sin membrete, distinto a
// todos los demás papeles del sistema; esto lo unifica.
//
// ⚠️ EL ENCABEZADO Y CADA FILA RECORREN LA MISMA LISTA DE COLUMNAS. Un `<th>`
//    sin su `<td>` corre la tabla entera y el papel sale con la cédula debajo de
//    «Almuerzo» sin que nadie lo note hasta que el cliente lo lee. Por eso las
//    tres tablas se arman con `tabla()`, que recibe las columnas una sola vez y
//    pinta cabecera y cuerpo con ellas.
//
// Devuelve texto, no toca red ni pantalla: se prueba entero.
// Prueba: scripts/test-comida-reporte.mjs

import {
  OpcionesComida, columnasEmpresa, columnasPersona, columnasDetalle,
  TITULO_EMPRESA, TITULO_PERSONA, TITULO_DETALLE,
  NUMERICA_EMPRESA, NUMERICA_PERSONA, NUMERICA_DETALLE,
  ColumnaEmpresa, ColumnaPersona, ColumnaDetalle,
} from './comidaReporteOpciones';
import { FiltroComida, GrupoComida, LineaDetalle, TotalesComida, alcanceEnPalabras } from './comidaReporte';

export const escapar = (v: unknown): string =>
  String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const usd = (n: number) => `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dmy = (iso: string) => {
  const [y, m, d] = String(iso ?? '').split('-');
  return y && m && d ? `${d}/${m}/${y}` : String(iso ?? '');
};

/** Los tiempos de comida que salen como columna, en orden, y cómo se llaman. */
export type CatalogoComidas = { key: string; label: string }[];

type Celda = { txt: string; num?: boolean };

/** Una tabla completa: cabecera y cuerpo salen de la MISMA lista de columnas. */
function tabla(titulos: string[], numericas: boolean[], filas: Celda[][], pie?: Celda[]): string {
  const th = titulos.map((t, i) => `<th class="${numericas[i] ? 'r' : 'l'}">${escapar(t)}</th>`).join('');
  const tr = filas
    .map((f) => `<tr>${f.map((c, i) => `<td class="${c.num ?? numericas[i] ? 'r' : 'l'}">${c.txt}</td>`).join('')}</tr>`)
    .join('');
  const tf = pie
    ? `<tr class="tot">${pie.map((c, i) => `<td class="${c.num ?? numericas[i] ? 'r' : 'l'}">${c.txt}</td>`).join('')}</tr>`
    : '';
  return `<table><thead><tr>${th}</tr></thead><tbody>${tr}${tf}</tbody></table>`;
}

const etiquetaComida = (k: string, cat: CatalogoComidas): string =>
  cat.find((c) => c.key === k)?.label ?? (k === 'sin_comida' ? 'Sin comida marcada' : k);

/** Cuadro por EMPRESA o por PERSONA: mismas reglas, columnas distintas. */
function cuadroGrupos(
  grupos: GrupoComida[],
  o: OpcionesComida,
  cat: CatalogoComidas,
  quien: 'empresa' | 'persona',
  cedulas?: Map<string, string>,
): string {
  if (!grupos.length) return '';
  // ⚠️ Una comida que NO está en el catálogo (una entrega por carnet sin comida
  //    marcada, o un tipo raro) igual suma en el Total de la fila. Sin su propia
  //    columna, la fila no cuadraba: 3 + 2 + 0 + 0 = 6. Se le abre una columna al
  //    final, con su nombre crudo, para que se vea qué quedó mal marcado.
  const extras = Array.from(new Set(grupos.flatMap((g) => Object.keys(g.porComida))))
    .filter((k) => !cat.some((m) => m.key === k))
    .sort();
  cat = [...cat, ...extras.map((k) => ({ key: k, label: k === 'sin_comida' ? 'Sin comida' : k }))];
  const cols: (ColumnaEmpresa | ColumnaPersona)[] = quien === 'empresa' ? columnasEmpresa(o) : columnasPersona(o);
  const TIT: Record<string, string> = quien === 'empresa' ? TITULO_EMPRESA : (TITULO_PERSONA as Record<string, string>);
  const NUM: Record<string, boolean> = quien === 'empresa' ? NUMERICA_EMPRESA : (NUMERICA_PERSONA as Record<string, boolean>);

  // «comidas» es una columna que se ABRE en una por cada tiempo de comida.
  const titulos: string[] = [];
  const numericas: boolean[] = [];
  cols.forEach((c) => {
    if (c === 'comidas') { cat.forEach((m) => { titulos.push(m.label); numericas.push(true); }); return; }
    titulos.push(TIT[c]);
    numericas.push(!!NUM[c]);
  });

  const filas = grupos.map((g, i) => {
    const celdas: Celda[] = [];
    cols.forEach((c) => {
      if (c === 'comidas') { cat.forEach((m) => celdas.push({ txt: String(g.porComida[m.key] || 0) })); return; }
      if (c === 'n') celdas.push({ txt: String(i + 1) });
      else if (c === 'empresa' || c === 'persona') celdas.push({ txt: escapar(g.nombre) });
      else if (c === 'cedula') celdas.push({ txt: escapar(cedulas?.get(g.clave) || '—') });
      else if (c === 'total') celdas.push({ txt: `<b>${g.total}</b>` });
      else if (c === 'monto') celdas.push({ txt: usd(g.monto) + (g.sinPrecio > 0 ? ` <span class="warn">(${g.sinPrecio} sin precio)</span>` : '') });
      else if (c === 'dias') celdas.push({ txt: String(g.dias) });
    });
    return celdas;
  });

  // El TOTAL se suma de los grupos que se están pintando: si mañana se filtra
  // distinto, el pie sigue cuadrando con lo que se ve arriba.
  const pie: Celda[] = [];
  cols.forEach((c) => {
    if (c === 'comidas') {
      cat.forEach((m) => pie.push({ txt: `<b>${grupos.reduce((a, g) => a + (g.porComida[m.key] || 0), 0)}</b>` }));
      return;
    }
    if (c === 'n') pie.push({ txt: '' });
    else if (c === 'empresa' || c === 'persona') pie.push({ txt: '<b>TOTAL</b>' });
    else if (c === 'cedula') pie.push({ txt: '' });
    else if (c === 'total') pie.push({ txt: `<b>${grupos.reduce((a, g) => a + g.total, 0)}</b>` });
    else if (c === 'monto') pie.push({ txt: `<b>${usd(grupos.reduce((a, g) => a + g.monto, 0))}</b>` });
    else if (c === 'dias') pie.push({ txt: '' });
  });

  const titulo = quien === 'empresa' ? '🏢 Entregas por empresa' : '👤 Entregas por persona';
  return `<h2>${titulo}</h2>${tabla(titulos, numericas, filas, pie)}`;
}

function cuadroPorComida(t: TotalesComida, cat: CatalogoComidas): string {
  const filas = cat
    .map((m) => [{ txt: escapar(m.label) }, { txt: String(t.porComida[m.key] || 0) }])
    .concat(
      // Lo que llegó con una comida que no está en el catálogo no se esconde:
      // se ve, con su nombre crudo, para que se note que algo quedó mal marcado.
      Object.keys(t.porComida)
        .filter((k) => !cat.some((m) => m.key === k))
        .sort()
        .map((k) => [{ txt: escapar(k === 'sin_comida' ? 'Sin comida marcada' : k) }, { txt: String(t.porComida[k]) }]),
    );
  const pie: Celda[] = [{ txt: '<b>TOTAL</b>' }, { txt: `<b>${t.total}</b>` }];
  return `<h2>🍽️ Cantidad por comida</h2>${tabla(['Comida', 'Cantidad'], [false, true], filas, pie)}`;
}

/**
 * TOPE DEL LISTADO ENTREGA POR ENTREGA.
 *
 * Un mes trae miles de entregas por carnet (una semana ya tuvo 1.259), y un
 * documento de 20 mil filas cuelga la vista previa en el navegador del teléfono.
 * Pasado el tope se cortan las filas del DETALLE —nunca los cuadros ni los
 * totales, que siguen contando todo— y el papel dice cuántas quedaron fuera.
 * Es el mismo criterio del PDF de Auditoría (tope de 1.500, avisado).
 */
export const TOPE_DETALLE = 3000;

function cuadroDetalle(todas: LineaDetalle[], o: OpcionesComida, cat: CatalogoComidas): string {
  if (!todas.length) return '';
  const lineas = todas.slice(0, TOPE_DETALLE);
  const fuera = todas.length - lineas.length;
  const cols = columnasDetalle(o);
  const titulos = cols.map((c) => TITULO_DETALLE[c]);
  const numericas = cols.map((c) => !!NUMERICA_DETALLE[c]);
  const filas = lineas.map((l) => cols.map((c): Celda => {
    if (c === 'fecha') return { txt: escapar(dmy(l.fecha)) };
    if (c === 'hora') return { txt: escapar(l.hora || '—') };
    if (c === 'quienRecibe') return { txt: `${l.via === 'empresa' ? '🏢' : '👤'} ${escapar(l.quienRecibe)}` };
    if (c === 'comida') return { txt: escapar(etiquetaComida(l.comida, cat) + (l.plato ? ` · ${l.plato}` : '')) };
    if (c === 'cantidad') return { txt: String(l.cantidad) };
    if (c === 'monto') return { txt: l.conPrecio ? usd(l.monto) : '<span class="warn">sin precio</span>' };
    if (c === 'quien') return { txt: escapar(l.quien || '—') };
    return { txt: escapar(l.nota || '') };
  }));
  const aviso = fuera > 0
    ? `<p class="sub warn">⚠️ Se muestran las primeras ${TOPE_DETALLE} de ${todas.length} entregas: quedaron fuera ${fuera}. Los cuadros y los totales de arriba sí cuentan todas. Para verlas, achica el rango o filtra por empresa, persona o comida.</p>`
    : '';
  return `<h2>🧾 Entrega por entrega (${todas.length})</h2>${aviso}${tabla(titulos, numericas, filas)}`;
}

function cuadroAlcance(f: FiltroComida, o: OpcionesComida, t: TotalesComida, nombres: Parameters<typeof alcanceEnPalabras>[1]): string {
  const lineas = alcanceEnPalabras(f, nombres);
  const extra: string[] = [];
  if (t.sinPrecio > 0 && !o.sinMontos) {
    extra.push(`${t.sinPrecio} comida(s) sin precio ese día: se cuentan, pero NO suman al monto.`);
  }
  if (o.sinMontos) extra.push('Este papel salió SIN montos, a pedido.');
  else extra.push('El valor es cantidad × precio de ese día, el mismo de la tarjeta de cobro. Lo que se COBRA por cuenta (sin el consumo interno) sale en «PDF del cobro».');
  return `<h2>🔎 Alcance de este informe</h2>
    <p class="sub">Lo que se pidió, para que el total se pueda revisar después:</p>
    <ul>${[...lineas, ...extra].map((s) => `<li>${escapar(s)}</li>`).join('')}</ul>`;
}

const CSS = `
  h2{font-size:13px;margin:16px 0 6px;color:#16324F}
  table{border-collapse:collapse;width:100%;font-size:11px;margin-bottom:6px}
  th,td{border:1px solid #ccc;padding:5px 7px}
  th{background:#16324F;color:#fff;text-align:center}
  td.l,th.l{text-align:left} td.r,th.r{text-align:right;font-variant-numeric:tabular-nums}
  tr.tot td{background:#EAF1FB;font-weight:800}
  .warn{color:#B45309}
  ul{margin:4px 0 0 16px;padding:0;font-size:11px} li{margin-bottom:2px}
  .kpis{font-size:12px;margin:2px 0 8px}
  .kpis b{font-size:14px}
`;

export type DatosReporteComida = {
  filtro: FiltroComida;
  opciones: OpcionesComida;
  comidas: CatalogoComidas;
  gruposEmpresas: GrupoComida[];
  gruposPersonas: GrupoComida[];
  cedulas?: Map<string, string>;
  lineas: LineaDetalle[];
  totales: TotalesComida;
  nombres?: Parameters<typeof alcanceEnPalabras>[1];
};

/** El cuerpo del documento. El membrete lo pone `pdfDocument`. */
export function cuerpoReporteComida(d: DatosReporteComida): string {
  const { opciones: o, totales: t } = d;
  const partes: string[] = [];

  partes.push(`<div class="kpis">
    Comidas entregadas: <b>${t.total}</b> ·
    Empresas: <b>${t.empresas}</b> ·
    Personas: <b>${t.personas}</b>${o.sinMontos ? '' : ` · Valor: <b>${usd(t.monto)}</b>`}
  </div>`);

  if (!o.sinComidas) partes.push(cuadroPorComida(t, d.comidas));
  if (!o.sinEmpresas) partes.push(cuadroGrupos(d.gruposEmpresas, o, d.comidas, 'empresa'));
  if (!o.sinPersonas) partes.push(cuadroGrupos(d.gruposPersonas, o, d.comidas, 'persona', d.cedulas));
  if (!o.sinDetalle) partes.push(cuadroDetalle(d.lineas, o, d.comidas));
  if (!o.sinAlcance) partes.push(cuadroAlcance(d.filtro, o, t, d.nombres ?? {}));

  return partes.filter(Boolean).join('\n');
}

export const CSS_REPORTE_COMIDA = CSS;

/** Subtítulo del membrete: el rango, en criollo. */
export function subtituloReporteComida(f: FiltroComida): string {
  return f.desde === f.hasta ? `Día ${dmy(f.desde)}` : `Del ${dmy(f.desde)} al ${dmy(f.hasta)}`;
}

/** Nombre del archivo, con el sufijo de lo que se ocultó (lo pone quien llama). */
export function nombreArchivoComida(f: FiltroComida, sufijo: string): string {
  const rango = f.desde === f.hasta ? dmy(f.desde) : `${dmy(f.desde)} a ${dmy(f.hasta)}`;
  return `Comidas ${rango}${sufijo}`.replace(/\//g, '-');
}
