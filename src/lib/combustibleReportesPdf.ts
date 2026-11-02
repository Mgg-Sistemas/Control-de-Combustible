/**
 * 02-nov-2026: PDF de los reportes personalizables de Consumos y de Entradas.
 * Mismo mecanismo de exportación que combustiblePdf.ts (exportPdf). Las gráficas
 * son barras HTML simples (sin librerías). Lo que la persona apaga simplemente
 * no sale: ni columna vacía ni aviso de que se quitó.
 */
import { exportPdf, nowStamp } from './pdf';
import { LOGO_DATA_URI } from './logoData';
import {
  Barra,
  OpcionesActivas,
  equipoDeConsumo,
  seriesConsumos,
  seriesEntradas,
  totalesPorEquipo,
} from './combustibleReportes';
import { HorometroDia, claveHorometro, horasHorometro, jornadaDeDespacho } from './combustibleHorometro';

function esc(val: any): string {
  return String(val ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function fmt(n: any): string {
  const v = Number(n);
  if (n == null || n === '' || !Number.isFinite(v)) return '—';
  return v.toLocaleString('es-VE', { maximumFractionDigits: 2 });
}
const periodoTxt = (desde: string, hasta: string) => (desde === hasta ? desde : `${desde} al ${hasta}`);

function graficaHtml(titulo: string, datos: Barra[], max = 15): string {
  if (!datos.length) return '';
  const top = datos.slice(0, max);
  const tope = Math.max(...top.map((b) => b.value), 1);
  const filas = top
    .map(
      (b) => `<div class="bar-row"><div class="bar-lbl">${esc(b.label)}</div><div class="bar-track"><div class="bar-fill" style="width:${Math.max(1, Math.round((b.value / tope) * 100))}%"></div></div><div class="bar-val">${fmt(b.value)} L</div></div>`,
    )
    .join('');
  const resto = datos.length > max ? `<div class="muted">+${datos.length - max} más</div>` : '';
  return `<div class="chart"><div class="chart-t">${esc(titulo)}</div>${filas}${resto}</div>`;
}

function documento(titulo: string, periodo: string, cuerpo: string): string {
  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8" /><title>${esc(titulo)}</title>
  <style>
    @page { size: letter portrait; margin: 1.2cm; }
    body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; font-size: 10.5px; color: #1f2937; margin: 0; }
    .head { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #1E3A5F; padding-bottom: 8px; margin-bottom: 10px; gap: 10px; }
    .logo { height: 40px; object-fit: contain; }
    .title { font-size: 15px; font-weight: 900; color: #1E3A5F; margin: 0; text-transform: uppercase; }
    .kpis { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 10px; }
    .kpi { background: #F3F4F6; border: 1px solid #E5E7EB; border-radius: 6px; padding: 6px 10px; }
    .kpi b { display: block; font-size: 14px; color: #1E3A5F; }
    .chart { border: 1px solid #E5E7EB; border-radius: 6px; padding: 8px; margin-bottom: 10px; page-break-inside: avoid; }
    .chart-t { font-weight: 900; color: #1E3A5F; margin-bottom: 6px; }
    .bar-row { display: flex; align-items: center; gap: 6px; margin: 2px 0; }
    .bar-lbl { width: 32%; font-size: 9.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .bar-track { flex: 1; background: #EEF2F7; height: 11px; border-radius: 3px; }
    .bar-fill { background: #1E3A5F; height: 11px; border-radius: 3px; }
    .bar-val { width: 80px; text-align: right; font-family: monospace; font-size: 9.5px; }
    h3 { color: #1E3A5F; font-size: 12px; margin: 12px 0 6px; }
    table { width: 100%; border-collapse: collapse; font-size: 9.5px; margin-bottom: 8px; }
    th { background: #1E3A5F; color: #fff; padding: 6px 5px; text-align: left; font-size: 8.5px; text-transform: uppercase; }
    td { padding: 5px; border-bottom: 1px solid #E5E7EB; vertical-align: top; }
    td.n { text-align: right; font-family: monospace; }
    tfoot td { background: #E5E7EB; font-weight: 900; border-top: 2px solid #1E3A5F; }
    .muted { color: #6b7280; font-size: 9px; }
  </style></head><body>
  <div class="head"><img class="logo" src="${LOGO_DATA_URI}" /><div style="text-align:right"><p class="title">${esc(titulo)}</p><div>${esc(periodo)}</div><div class="muted">Emitido ${esc(nowStamp())}</div></div></div>
  ${cuerpo}
  </body></html>`;
}

export interface DatosReporteConsumos {
  desde: string;
  hasta: string;
  /** Consumos ya filtrados (filtrarConsumos), con machine/vehicle/tank embebidos. */
  filas: any[];
  /** Horómetro del inspector por máquina y jornada (cargarHorometros). */
  horometros: Map<string, HorometroDia>;
}

export async function exportarReporteConsumosPdf(datos: DatosReporteConsumos, op: OpcionesActivas): Promise<void> {
  const { filas } = datos;
  const s = seriesConsumos(filas);
  const montoTotal = filas.reduce((a, d) => a + (Number(d.total_amount) || 0), 0);
  let cuerpo = `<div class="kpis"><div class="kpi">Litros<b>${fmt(s.total)} L</b></div><div class="kpi">Surtidos<b>${filas.length}</b></div><div class="kpi">Equipos<b>${s.porEquipo.length}</b></div>${op.monto ? `<div class="kpi">Monto<b>${fmt(montoTotal)}</b></div>` : ''}</div>`;

  if (op.graficas) {
    cuerpo += s.porDia.length > 1 ? graficaHtml('⛽ Litros por día', s.porDia, 31) : '';
    cuerpo += graficaHtml('🚜 Litros por máquina / vehículo', s.porEquipo);
  }

  const horoDe = (d: any): HorometroDia | null => (d?.machinery_id ? datos.horometros.get(claveHorometro(d.machinery_id, jornadaDeDespacho(d))) ?? null : null);

  if (op.tabla) {
    const cols: { t: string; n?: boolean; v: (d: any) => string }[] = [
      { t: 'Fecha', v: (d) => esc(String(d.dispatch_date ?? '').slice(0, 10)) },
      { t: 'Equipo', v: (d) => `<b>${esc(equipoDeConsumo(d).nombre)}</b>` },
    ];
    if (op.placa) cols.push({ t: 'Placa', v: (d) => esc(equipoDeConsumo(d).placa || 'S/P') });
    if (op.serial) cols.push({ t: 'Serial', v: (d) => esc(equipoDeConsumo(d).serial || '—') });
    cols.push({ t: 'Litros', n: true, v: (d) => `${fmt(d.liters)} L` });
    if (op.horometro) {
      cols.push({
        t: 'Horómetro',
        v: (d) => {
          const h = horoDe(d);
          if (!h || (h.inicial == null && h.final == null)) return '—';
          const hrs = horasHorometro(h);
          return `${fmt(h.inicial)} ➔ ${fmt(h.final)}${hrs != null ? ` (${fmt(hrs)} h)` : ''}`;
        },
      });
    }
    if (op.contador) cols.push({ t: 'Contador', v: (d) => (d.fuel_start != null || d.fuel_end != null ? `${fmt(d.fuel_start)} ➔ ${fmt(d.fuel_end)}` : '—') });
    if (op.tanque) cols.push({ t: 'Tanque', v: (d) => esc(d.tank?.name || '—') });
    if (op.operador) cols.push({ t: 'Operador', v: (d) => esc(d.driver_operator || '—') });
    if (op.monto) {
      cols.push({ t: 'Precio/L', n: true, v: (d) => fmt(d.price_per_liter) });
      cols.push({ t: 'Monto', n: true, v: (d) => fmt(d.total_amount) });
    }
    if (op.nota) cols.push({ t: 'Nota', v: (d) => esc(d.notes || '') });
    const iLitros = cols.findIndex((c) => c.t === 'Litros');
    const pie = cols.map((c, i) => (i === 0 ? '<td>Total</td>' : i === iLitros ? `<td class="n">${fmt(s.total)} L</td>` : c.t === 'Monto' ? `<td class="n">${fmt(montoTotal)}</td>` : '<td></td>')).join('');
    cuerpo += `<h3>Consumos</h3><table><thead><tr>${cols.map((c) => `<th>${c.t}</th>`).join('')}</tr></thead><tbody>${filas
      .map((d) => `<tr>${cols.map((c) => `<td${c.n ? ' class="n"' : ''}>${c.v(d)}</td>`).join('')}</tr>`)
      .join('')}</tbody><tfoot><tr>${pie}</tr></tfoot></table>`;
  }

  if (op.totales) {
    const tot = totalesPorEquipo(filas);
    cuerpo += `<h3>Totales por máquina / vehículo</h3><table><thead><tr><th>Equipo</th>${op.placa ? '<th>Placa</th>' : ''}${op.serial ? '<th>Serial</th>' : ''}<th>Surtidos</th><th>Litros</th>${op.monto ? '<th>Monto</th>' : ''}</tr></thead><tbody>${tot
      .map((t) => `<tr><td><b>${esc(t.nombre)}</b></td>${op.placa ? `<td>${esc(t.placa || 'S/P')}</td>` : ''}${op.serial ? `<td>${esc(t.serial || '—')}</td>` : ''}<td class="n">${t.surtidos}</td><td class="n">${fmt(t.litros)} L</td>${op.monto ? `<td class="n">${fmt(t.monto)}</td>` : ''}</tr>`)
      .join('')}</tbody></table>`;
  }

  await exportPdf(documento('Reporte de consumos de combustible', periodoTxt(datos.desde, datos.hasta), cuerpo), `Consumos-Combustible-${datos.desde}${datos.hasta !== datos.desde ? `-${datos.hasta}` : ''}`);
}

export interface DatosReporteEntradas {
  desde: string;
  hasta: string;
  /** Entradas ya filtradas (filtrarEntradas). */
  filas: any[];
  nombreTanque: (id: string) => string;
}

export async function exportarReporteEntradasPdf(datos: DatosReporteEntradas, op: OpcionesActivas): Promise<void> {
  const { filas, nombreTanque } = datos;
  const s = seriesEntradas(filas, nombreTanque);
  let cuerpo = `<div class="kpis"><div class="kpi">Litros<b>${fmt(s.total)} L</b></div><div class="kpi">Entradas<b>${filas.length}</b></div>${op.costoTotal ? `<div class="kpi">Costo<b>${fmt(s.costo)}</b></div>` : ''}</div>`;

  if (op.graficas) {
    cuerpo += s.porDia.length > 1 ? graficaHtml('⬇️ Litros por día', s.porDia, 31) : '';
    cuerpo += graficaHtml('🛢️ Litros por tanque', s.porTanque);
    cuerpo += graficaHtml('🏭 Litros por proveedor', s.porProveedor);
  }

  if (op.tabla) {
    const cols: { t: string; n?: boolean; v: (i: any) => string }[] = [{ t: 'Fecha', v: (i) => esc(String(i.intake_date ?? '').slice(0, 10)) }];
    if (op.proveedor) cols.push({ t: 'Proveedor', v: (i) => esc(i.supplier || '—') });
    if (op.factura) cols.push({ t: 'Factura', v: (i) => esc(i.invoice_no || '—') });
    if (op.tanque) cols.push({ t: 'Tanque', v: (i) => esc(nombreTanque(String(i.tank_id ?? '')) || '—') });
    if (op.combustible) cols.push({ t: 'Combustible', v: (i) => esc(String(i.fuel ?? '').toUpperCase()) });
    cols.push({ t: 'Litros', n: true, v: (i) => `${fmt(i.liters)} L` });
    if (op.costoUnitario) cols.push({ t: 'Costo unit.', n: true, v: (i) => fmt(i.unit_cost) });
    if (op.costoTotal) cols.push({ t: 'Costo total', n: true, v: (i) => fmt(i.total_cost) });
    if (op.nota) cols.push({ t: 'Nota', v: (i) => esc(i.notes || '') });
    const pie = cols.map((c, k) => (k === 0 ? '<td>Total</td>' : c.t === 'Litros' ? `<td class="n">${fmt(s.total)} L</td>` : c.t === 'Costo total' ? `<td class="n">${fmt(s.costo)}</td>` : '<td></td>')).join('');
    cuerpo += `<h3>Entradas</h3><table><thead><tr>${cols.map((c) => `<th>${c.t}</th>`).join('')}</tr></thead><tbody>${filas
      .map((i) => `<tr>${cols.map((c) => `<td${c.n ? ' class="n"' : ''}>${c.v(i)}</td>`).join('')}</tr>`)
      .join('')}</tbody><tfoot><tr>${pie}</tr></tfoot></table>`;
  }

  if (op.totales) {
    const tabla = (titulo: string, datosT: Barra[]) =>
      datosT.length ? `<h3>${titulo}</h3><table><thead><tr><th>${titulo.split(' ').pop()}</th><th>Litros</th></tr></thead><tbody>${datosT.map((b) => `<tr><td>${esc(b.label)}</td><td class="n">${fmt(b.value)} L</td></tr>`).join('')}</tbody></table>` : '';
    if (op.tanque) cuerpo += tabla('Totales por tanque', s.porTanque);
    if (op.proveedor) cuerpo += tabla('Totales por proveedor', s.porProveedor);
  }

  await exportPdf(documento('Reporte de entradas de combustible', periodoTxt(datos.desde, datos.hasta), cuerpo), `Entradas-Combustible-${datos.desde}${datos.hasta !== datos.desde ? `-${datos.hasta}` : ''}`);
}
