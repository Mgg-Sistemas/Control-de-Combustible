import { pdfDocument, exportPdf, dateRangeLabel } from './pdf';

/**
 * Reporte "Trazabilidad e Historial por Equipo" (PDF), Módulo de Reportes →
 * Maquinaria/Vehículos. Función PURA: no consulta Supabase, recibe los datos
 * ya cargados/filtrados por la pantalla que la invoca (MachineTraceabilityScreen).
 */

export type TraceEvent = {
  tipo: 'averia' | 'parada';
  motivo: string | null;
  startIso: string;
  endIso: string | null; // null = todavía vigente (no reactivada/resuelta)
};

export type TraceWorkedDay = { date: string; dayH: number; nightH: number };

const esc = (v: any) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const dmy = (iso: string) => { const [y, m, d] = (iso || '').split('-'); return y && m && d ? `${d}/${m}/${y}` : (iso || '—'); };
const dmyHm = (iso: string) => {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};
const fmtDuration = (ms: number) => {
  const totalH = Math.max(0, ms / 3600000);
  const d = Math.floor(totalH / 24);
  const h2 = Math.round(totalH - d * 24);
  return d > 0 ? `${d}d ${h2}h` : `${Math.round(totalH)}h`;
};

export async function generateMachineTraceabilityReport(opts: {
  machineLabel: string;
  fromISO: string;
  toISO: string;
  events: TraceEvent[];
  workedDays: TraceWorkedDay[];
}): Promise<boolean> {
  const { machineLabel, fromISO, toISO, events, workedDays } = opts;

  const diasTrabajados = workedDays.filter((d) => d.dayH + d.nightH > 0).length;
  const horasTotales = workedDays.reduce((s, d) => s + d.dayH + d.nightH, 0);
  const averias = events.filter((e) => e.tipo === 'averia');
  const paradas = events.filter((e) => e.tipo === 'parada');
  const nowMs = Date.now();
  const msInactivo = events.reduce((s, e) => s + (Math.max(0, (e.endIso ? new Date(e.endIso).getTime() : nowMs) - new Date(e.startIso).getTime())), 0);

  const resumen = `
    <table class="est">
      <thead><tr><th>Días trabajados</th><th>Horas totales</th><th>Averías</th><th>Paradas</th><th>Tiempo inactivo total</th></tr></thead>
      <tbody><tr>
        <td>${diasTrabajados}</td><td>${horasTotales.toFixed(1)} h</td><td>${averias.length}</td><td>${paradas.length}</td><td>${fmtDuration(msInactivo)}</td>
      </tr></tbody>
    </table>
  `;

  const filasEventos = events
    .slice()
    .sort((a, b) => new Date(b.startIso).getTime() - new Date(a.startIso).getTime())
    .map((e) => {
      const dur = fmtDuration((e.endIso ? new Date(e.endIso).getTime() : nowMs) - new Date(e.startIso).getTime());
      return `<tr>
        <td>${e.tipo === 'averia' ? '🔴 Avería' : '🟡 Parada'}</td>
        <td>${esc(e.motivo || '—')}</td>
        <td>${dmyHm(e.startIso)}</td>
        <td>${e.endIso ? dmyHm(e.endIso) : '— (vigente)'}</td>
        <td>${dur}</td>
        <td>${e.endIso ? 'Resuelto' : 'Vigente'}</td>
      </tr>`;
    })
    .join('');

  const tablaEventos = `
    <h3 class="sec">Historial de paradas y averías</h3>
    <table class="hs">
      <thead><tr><th>Tipo</th><th>Motivo</th><th>Inicio</th><th>Fin / Reactivación</th><th>Tiempo inactivo</th><th>Estado</th></tr></thead>
      <tbody>${filasEventos || '<tr><td colspan="6">Sin paradas ni averías en el rango.</td></tr>'}</tbody>
    </table>
  `;

  const filasDias = workedDays
    .filter((d) => d.dayH + d.nightH > 0)
    .slice()
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .map((d) => `<tr><td>${dmy(d.date)}</td><td>${d.dayH.toFixed(1)} h</td><td>${d.nightH.toFixed(1)} h</td><td>${(d.dayH + d.nightH).toFixed(1)} h</td></tr>`)
    .join('');

  const tablaDias = `
    <h3 class="sec">Días trabajados</h3>
    <table class="hs">
      <thead><tr><th>Fecha</th><th>Horas día</th><th>Horas noche</th><th>Total</th></tr></thead>
      <tbody>${filasDias || '<tr><td colspan="4">Sin horas registradas en el rango.</td></tr>'}</tbody>
    </table>
  `;

  const extraCss = `
    h3.sec{color:#1E3A5F;font-size:13px;margin:16px 0 6px}
    table.est{width:100%;border-collapse:collapse;margin:0 0 14px;font-size:11px}
    table.est th,table.est td{border:1px solid #ccc;padding:5px 7px;text-align:center}
    table.est th{background:#1E3A5F;color:#fff}
    table.hs{width:100%;border-collapse:collapse;margin:4px 0;font-size:10px}
    table.hs th,table.hs td{border:1px solid #ccc;padding:4px 6px;text-align:left;vertical-align:top}
    table.hs th{background:#1E3A5F;color:#fff}
  `;

  const html = pdfDocument({
    title: 'Trazabilidad e Historial por Equipo',
    subtitle: `Máquina: ${esc(machineLabel)} · ${dateRangeLabel(fromISO, toISO) || `${dmy(fromISO)} a ${dmy(toISO)}`}`,
    body: resumen + tablaEventos + tablaDias,
    extraCss,
  });

  return await exportPdf(html, `Trazabilidad - ${machineLabel}`);
}
