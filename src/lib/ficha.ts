// Ficha COMPLETA imprimible (PDF): TODOS los datos de un trabajador o de un aliado,
// organizados por secciones (identificación, contacto, laborales, banco, uniformes…).
// El botón "🪪 PDF" de la ficha usa esto; la IMAGEN sigue siendo el carnet (carnet.ts).
import { pdfDocument } from './pdf';
import { Employee, Aliado } from '../types/database';

const esc = (s: any) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const nombre = (e: { first_name?: string | null; last_name?: string | null }) => `${e.first_name ?? ''} ${e.last_name ?? ''}`.trim() || 'Sin nombre';
const fmtDMY = (iso?: string | null) => { const [y, m, d] = String(iso || '').split('-'); return y && m && d ? `${d}/${m}/${y}` : (iso || ''); };
function edad(birth?: string | null): string {
  if (!birth) return '';
  const b = new Date(birth); if (isNaN(b.getTime())) return '';
  const now = new Date(); let a = now.getFullYear() - b.getFullYear();
  const md = now.getMonth() - b.getMonth(); if (md < 0 || (md === 0 && now.getDate() < b.getDate())) a--;
  return a >= 0 && a < 130 ? `${a} años` : '';
}
const STATUS_LABEL: Record<string, string> = { activo: 'Activo', inactivo: 'Inactivo', suspendido: 'Suspendido' };

const FICHA_CSS = `
  .fx-head{display:flex;gap:18px;align-items:center;margin:6px 0 4px}
  .fx-photo{width:120px;height:140px;object-fit:cover;border:3px solid #1E3A5F;border-radius:10px;background:#EEF2F7}
  .fx-name{font-size:22px;font-weight:800;color:#1E3A5F;line-height:1.1}
  .fx-cargo{font-size:13px;font-weight:700;color:#374151;text-transform:uppercase;letter-spacing:.5px;margin-top:2px}
  .fx-meta .m{font-size:12px;color:#6B7280;margin-top:3px}
  h3.sec{margin:16px 0 4px;font-size:13px;color:#1E3A5F;border-top:2px solid #1E3A5F;padding-top:8px}
  table.ft{width:100%;border-collapse:collapse;font-size:12px}
  table.ft td{border:1px solid #D7E3F4;padding:5px 9px;vertical-align:top}
  table.ft td.k{background:#EAF1FB;color:#374151;width:42%;font-weight:700}
  table.ft td.v{color:#1F2937;font-weight:600}
  .note{border:1px solid #D7E3F4;border-radius:6px;padding:8px 10px;font-size:12px;color:#1F2937;background:#F8FBFF}
`;

function rowsHtml(pairs: [string, any][]): string {
  return pairs
    .filter(([, v]) => v != null && String(v).trim() !== '')
    .map(([k, v]) => `<tr><td class="k">${esc(k)}</td><td class="v">${esc(v)}</td></tr>`)
    .join('');
}
function section(title: string, pairs: [string, any][]): string {
  const body = rowsHtml(pairs);
  return body ? `<h3 class="sec">${title}</h3><table class="ft"><tbody>${body}</tbody></table>` : '';
}

type FichaOpts = { companyName?: string | null; photoDataUri?: string | null };

/** Ficha COMPLETA de un trabajador (todos los datos) en PDF. */
export function fichaEmpleadoHtml(e: Employee & { companyName?: string }, opts?: FichaOpts): string {
  const photo = opts?.photoDataUri || e.photo_url || '';
  const header = `<div class="fx-head">
      ${photo ? `<img class="fx-photo" src="${photo}"/>` : ''}
      <div class="fx-meta">
        <div class="fx-name">${esc(nombre(e))}</div>
        <div class="fx-cargo">${esc(e.cargo || 'Trabajador')}</div>
        ${e.ficha_number ? `<div class="m">N° de ficha: <b>${esc(e.ficha_number)}</b></div>` : ''}
        <div class="m">Estado: <b>${esc(STATUS_LABEL[e.status] ?? e.status ?? '')}</b></div>
      </div>
    </div>`;
  const body = header
    + section('🪪 Identificación', [
        ['Cédula', e.cedula], ['Grupo sanguíneo', e.blood_type], ['Fecha de nacimiento', fmtDMY(e.birth_date)],
        ['Edad', edad(e.birth_date)], ['Género', e.gender], ['Nacionalidad', e.nationality], ['Estado civil', e.marital_status],
      ])
    + section('💼 Datos laborales', [
        ['Empresa', opts?.companyName ?? e.companyName], ['Cargo', e.cargo], ['Departamento', e.department],
        ['Grupo / zona', e.grupo], ['Fecha de ingreso', fmtDMY(e.hire_date)],
      ])
    + section('📞 Contacto', [
        ['Teléfono', e.phone], ['Correo', e.email], ['Dirección', e.address], ['Ciudad', e.city], ['Estado', e.state],
      ])
    + section('🚑 Contacto de emergencia', [
        ['Nombre', e.emergency_contact_name], ['Teléfono', e.emergency_contact_phone], ['Parentesco', e.emergency_contact_relation],
      ])
    + section('🏦 Datos bancarios', [
        ['Banco', e.bank_name], ['N° de cuenta', e.bank_account], ['Titular', e.bank_holder], ['Cédula del titular', e.bank_cedula],
      ])
    + section('👕 Uniformes (tallas)', [
        ['Camisa', e.talla_camisa], ['Pantalón', e.talla_pantalon], ['Zapatos', e.talla_zapatos],
      ])
    + (e.notes ? `<h3 class="sec">📝 Notas</h3><div class="note">${esc(e.notes)}</div>` : '');
  return pdfDocument({ title: 'Ficha del trabajador', subtitle: nombre(e), body, extraCss: FICHA_CSS });
}

/** Ficha COMPLETA de un aliado (todos los datos) en PDF. */
export function fichaAliadoHtml(a: Aliado, opts?: FichaOpts): string {
  const photo = opts?.photoDataUri || a.photo_url || '';
  const header = `<div class="fx-head">
      ${photo ? `<img class="fx-photo" src="${photo}"/>` : ''}
      <div class="fx-meta">
        <div class="fx-name">${esc(nombre(a))}</div>
        <div class="fx-cargo">${esc(a.rol || 'Aliado')}</div>
        ${a.ficha_number ? `<div class="m">N° de ficha: <b>${esc(a.ficha_number)}</b></div>` : ''}
        <div class="m">Estado: <b>${esc(STATUS_LABEL[a.status] ?? a.status ?? '')}</b></div>
      </div>
    </div>`;
  const body = header
    + section('🪪 Identificación', [
        ['Cédula', a.cedula], ['Grupo sanguíneo', a.blood_type],
      ])
    + section('🤝 Organización', [
        ['Organización / institución', a.organizacion], ['Rol / cargo', a.rol],
      ])
    + section('📞 Contacto', [
        ['Teléfono', a.phone], ['Correo', a.email], ['Dirección', a.address], ['Ciudad', a.city], ['Estado', a.state],
      ])
    + (a.notes ? `<h3 class="sec">📝 Notas</h3><div class="note">${esc(a.notes)}</div>` : '');
  return pdfDocument({ title: 'Ficha de aliado', subtitle: nombre(a), body, extraCss: FICHA_CSS });
}
