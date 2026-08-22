import { selectAllRows } from './supabase';
import { pdfDocument, exportPdf } from './pdf';
import { cmpText } from './text';
import { normalizeDept } from './personal';
import { COMPANY_NAME } from './company';

const esc = (v: any) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Reporte de PERSONAL COMPLETO (PDF): toda la nómina activa agrupada por
 * DEPARTAMENTO (unificado / inferido del cargo), con la cantidad de personas por
 * departamento y por cargo arriba, y el detalle por departamento (A→Z). Usa el
 * membrete compartido (`pdfDocument`), que ya trae `@page{margin:2cm}`.
 *
 * Vive en `Nómina · Personal` (antes estaba en Reportes). Es autocontenido: trae
 * sus propios datos de `employees`, así que se puede llamar desde cualquier pantalla.
 */
export async function generatePersonalReport(): Promise<boolean> {
  const emps = (((await selectAllRows('employees', 'first_name, last_name, cedula, cargo, department, status')) ?? []) as any[])
    .filter((e) => (e.status ?? 'activo') === 'activo');
  const nameOf = (e: any) => `${(e.first_name ?? '').trim()} ${(e.last_name ?? '').trim()}`.trim() || '—';
  const deptOf = (e: any) => normalizeDept(e.department, e.cargo);
  const groups = new Map<string, any[]>();
  emps.forEach((e) => { const d = deptOf(e); if (!groups.has(d)) groups.set(d, []); groups.get(d)!.push(e); });
  const deptNames = [...groups.keys()].sort((a, b) => cmpText(a, b));
  const cargoOf = (e: any) => (e.cargo && String(e.cargo).trim()) || 'Sin cargo';
  const cargoGroups = new Map<string, number>();
  emps.forEach((e) => { const c = cargoOf(e); cargoGroups.set(c, (cargoGroups.get(c) ?? 0) + 1); });

  const gratoHtml = `<div class="grato">🙌 <b>Personal sumado a ${esc(COMPANY_NAME)}</b> — gracias a ellos no se llevaría a cabo tan grande labor.</div>`;
  const totalHtml = `<div class="total-box"><div class="total-lbl">TOTAL DE PERSONAL</div><div class="total-num">${emps.length}</div></div>`;
  const resumenHtml = `<div class="sect">🏢 Cantidad de personal por departamento</div>
    <table class="tac"><thead><tr><th>Departamento</th><th style="width:110px;text-align:right">Cantidad</th></tr></thead>
    <tbody>${deptNames.map((d) => `<tr><td>${esc(d)}</td><td style="text-align:right;font-weight:700">${groups.get(d)!.length}</td></tr>`).join('') || '<tr><td colspan="2" style="text-align:center">Sin personal</td></tr>'}</tbody>
    <tfoot><tr><td style="font-weight:800">TOTAL</td><td style="text-align:right;font-weight:800">${emps.length}</td></tr></tfoot></table>
    <div class="sect">🏷️ Cantidad de personal por cargo</div>
    <table class="tac"><thead><tr><th>Cargo</th><th style="width:110px;text-align:right">Cantidad</th></tr></thead>
    <tbody>${[...cargoGroups.entries()].sort((a, b) => cmpText(a[0], b[0])).map(([c, n]) => `<tr><td>${esc(c)}</td><td style="text-align:right;font-weight:700">${n}</td></tr>`).join('') || '<tr><td colspan="2" style="text-align:center">Sin personal</td></tr>'}</tbody>
    <tfoot><tr><td style="font-weight:800">TOTAL</td><td style="text-align:right;font-weight:800">${emps.length}</td></tr></tfoot></table>`;
  const detalleHtml = deptNames.map((d) => {
    const rows = groups.get(d)!
      .slice()
      .sort((a, b) => cmpText(nameOf(a), nameOf(b)))
      .map((e, i) => `<tr><td>${i + 1}</td><td><b>${esc(nameOf(e))}</b></td><td>${esc((e.cargo && String(e.cargo).trim()) || '—')}</td><td>${esc(e.cedula ?? '—')}</td></tr>`).join('');
    return `<div class="ente">🏷️ <b>${esc(d)}</b> <span class="cnt-pill">${groups.get(d)!.length} persona(s)</span></div>
      <table class="tac"><thead><tr><th style="width:30px">Nº</th><th>Nombre y apellido</th><th>Cargo</th><th>Cédula</th></tr></thead><tbody>${rows}</tbody></table>`;
  }).join('');

  const extraCss = `
    .sect{margin:14px 0 4px;font-size:13px;font-weight:800;color:#1E3A5F;border-left:4px solid #1E3A5F;padding-left:8px}
    table.tac{width:100%;border-collapse:collapse;margin:4px 0 12px;font-size:12px}
    table.tac th,table.tac td{border:1px solid #ccc;padding:6px 9px;text-align:left;vertical-align:top}
    table.tac th{background:#1E3A5F;color:#fff}
    table.tac tfoot td{background:#EEF2F7;font-weight:800}
    .ente{margin:12px 0 2px;font-size:12.5px;color:#111}
    .cnt-pill{background:#EEF2F7;color:#1E3A5F;border-radius:10px;padding:1px 8px;font-size:11px;font-weight:700}
    .grato{background:#E7F5EC;border:1px solid #B7E0C4;border-radius:8px;padding:10px 12px;margin:2px 0 10px;font-size:13px;color:#0B3D2E}
    .total-box{text-align:center;border:2px solid #1E3A5F;border-radius:10px;padding:10px;margin:0 0 12px;background:#F4F7FB}
    .total-lbl{font-size:12px;font-weight:800;color:#1E3A5F;letter-spacing:.5px}
    .total-num{font-size:34px;font-weight:900;color:#1E3A5F;line-height:1.1}`;
  const body = `${gratoHtml}${totalHtml}${resumenHtml}
    <div class="sect">👥 Personal por departamento</div>
    ${detalleHtml || '<p style="color:#6B7280;font-size:12px">Sin personal registrado.</p>'}`;

  const html = pdfDocument({ title: 'REPORTE DE PERSONAL', subtitle: `${COMPANY_NAME} · ${emps.length} personas`, body, extraCss });
  return await exportPdf(html, 'Reporte - Personal por departamento');
}
