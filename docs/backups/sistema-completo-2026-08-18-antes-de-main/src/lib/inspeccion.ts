// PDF del REPORTE DE INSPECCIÓN de una máquina (control por equipo), con los
// estilos del sistema: inventario de equipos/herramientas con su estado en color,
// observaciones generales y las firmas de control y conformidad.
import { pdfDocument } from './pdf';

export type InspeccionPdfItem = {
  descripcion: string;
  cantidad: number;
  unidad: string;
  serial: string | null;
  estado: string;
  nivel: 'ok' | 'warn' | 'bad';
};
export type InspeccionPdfData = {
  machineName: string;         // nombre/código de la máquina
  machineType: string;         // "Tipo de Unidad" (ej. Camión Taller Soldadura)
  plate: string | null;
  serial: string | null;
  fecha: string;               // dd/mm/aaaa
  hora: string;                // "12:48 pm"
  items: InspeccionPdfItem[];
  condicionGeneral?: string | null;
  observaciones: { label: string; text: string }[];
  inspector?: string | null;
  operator?: string | null;
};

const esc = (s: any) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// Color del estado según su nivel (🟢 ok · 🟠 regular · 🔴 malo).
const NIVEL_COLOR: Record<string, string> = { ok: '#15803D', warn: '#EA6A1F', bad: '#DC2626' };

export function inspeccionHtml(d: InspeccionPdfData): string {
  const cantTxt = (it: InspeccionPdfItem) => `${(Math.round((Number(it.cantidad) || 0) * 100) / 100)} ${esc(it.unidad || '')}`.trim();
  const rows = d.items.map((it, i) => `<tr>
      <td class="c">${i + 1}</td>
      <td class="b">${esc(it.descripcion)}</td>
      <td class="c">${cantTxt(it)}</td>
      <td>${esc(it.serial || '—')}</td>
      <td class="b" style="color:${NIVEL_COLOR[it.nivel] || '#15803D'}">${esc(it.estado || '—')}</td>
    </tr>`).join('');

  const obsRows: { label: string; text: string }[] = [];
  if (d.condicionGeneral && d.condicionGeneral.trim()) obsRows.push({ label: 'Condición General', text: d.condicionGeneral.trim() });
  (d.observaciones || []).forEach((o) => { if ((o.label && o.label.trim()) || (o.text && o.text.trim())) obsRows.push(o); });
  const obsHtml = obsRows.length
    ? `<table class="obs"><tbody>${obsRows.map((o) => `<tr><td class="k">${esc(o.label)}</td><td>${esc(o.text)}</td></tr>`).join('')}</tbody></table>`
    : `<div class="muted">Sin observaciones.</div>`;

  return pdfDocument({
    title: 'Reporte de inspección',
    subtitle: `${esc(d.machineType)}${d.plate ? ' · Placa: ' + esc(d.plate) : ''}${d.serial ? ' · Serial: ' + esc(d.serial) : ''}`,
    extraCss: `
      .infocard table{width:100%;border-collapse:collapse;margin:6px 0 16px;font-size:11px}
      .infocard th{background:#16324F;color:#fff;text-align:left;padding:6px 10px;font-weight:700}
      .infocard td{border:1px solid #c9d2dc;padding:6px 10px}
      .sec{color:#16324F;font-size:14px;margin:16px 0 6px;border-bottom:2px solid #16324F;padding-bottom:3px}
      table.inv{width:100%;border-collapse:collapse;font-size:11px}
      table.inv th,table.inv td{border:1px solid #c9d2dc;padding:6px 8px;text-align:left;vertical-align:top}
      table.inv th{background:#16324F;color:#fff}
      table.inv td.c{text-align:center} table.inv td.b{font-weight:700}
      table.inv tr:nth-child(even) td{background:#f4f7fb}
      table.obs{width:100%;border-collapse:collapse;font-size:11px}
      table.obs td{border:1px solid #c9d2dc;padding:7px 10px;vertical-align:top}
      table.obs td.k{background:#eef3f9;color:#16324F;font-weight:800;width:34%}
      .muted{color:#777;font-size:11px}
      .firmas{display:flex;gap:40px;margin-top:54px}
      .firma{flex:1;text-align:center}
      .firma .l{border-top:1px solid #1a1a1a;margin:0 6px;padding-top:6px;font-weight:800;color:#16324F;font-size:12px}
      .firma .s{color:#777;font-size:10px}`,
    body: `
      <div class="infocard">
        <table>
          <thead><tr><th>Tipo de Unidad</th><th>Placa</th><th>Fecha de Inspección</th><th>Hora</th></tr></thead>
          <tbody><tr>
            <td><b>${esc(d.machineType)}</b></td>
            <td><b>${esc(d.plate || d.serial || '—')}</b></td>
            <td><b>${esc(d.fecha)}</b></td>
            <td><b>${esc(d.hora)}</b></td>
          </tr></tbody>
        </table>
      </div>

      <div class="sec">1. Inventario de Equipos, Herramientas y Accesorios</div>
      <table class="inv">
        <thead><tr><th style="width:34px" class="c">Ítem</th><th>Descripción del Equipo / Herramienta</th>
          <th style="width:70px" class="c">Cant.</th><th>Serial / Especificación</th><th>Estado / Condición</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="5" class="c">Sin ítems</td></tr>'}</tbody>
      </table>

      <div class="sec">2. Observaciones Generales y Estado del Vehículo</div>
      ${obsHtml}

      <div class="sec">3. Control y Conformidad</div>
      <div class="firmas">
        <div class="firma"><div class="l">${esc(d.inspector || 'Inspector / Responsable de Control')}</div><div class="s">Verificación de Equipos e Inventario</div></div>
        <div class="firma"><div class="l">${esc(d.operator || 'Chofer / Operador Responsable')}</div><div class="s">Recepción y Conformidad de Unidad</div></div>
      </div>`,
  });
}
