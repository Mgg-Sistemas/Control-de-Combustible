import { LOGO_DATA_URI } from './logoData';
import type { Employee } from '../types/database';

const esc = (s: any) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Nombre completo del empleado. */
export function fullName(e: Pick<Employee, 'first_name' | 'last_name'>): string {
  return `${e.first_name ?? ''} ${e.last_name ?? ''}`.trim();
}

/** Edad (años) a partir de la fecha de nacimiento ISO. */
export function ageFrom(birth?: string | null): number | null {
  if (!birth || !/^\d{4}-\d{2}-\d{2}/.test(birth)) return null;
  const [y, m, d] = birth.slice(0, 10).split('-').map(Number);
  const now = new Date();
  let age = now.getFullYear() - y;
  const mm = now.getMonth() + 1;
  if (mm < m || (mm === m && now.getDate() < d)) age -= 1;
  return age >= 0 && age < 130 ? age : null;
}

// Medidas de credencial estándar: 54 mm × 86 mm (vertical). El logo va DIRECTO
// (sin recuadro blanco) y un poco más grande. Todo autocontenido (logo en base64,
// sin imágenes externas) para que sirva igual en PDF y como imagen.
export const CARNET_MM = { w: 54, h: 86 };
export const carnetStyles = `
  *{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  html,body{margin:0;padding:0}
  body{font-family:Tahoma,Geneva,Verdana,sans-serif}
  .card{position:relative;width:54mm;height:86mm;background:linear-gradient(160deg,#f4f8ff,#e8eef8);
    border:0.4mm solid #16324F;border-radius:3mm;overflow:hidden;padding:2.5mm 2.5mm 1.5mm;
    display:flex;flex-direction:column;align-items:center}
  .wm{position:absolute;top:52%;left:50%;transform:translate(-50%,-50%);width:66mm;opacity:.06;z-index:0}
  .logo,.photo,.name,.cargo,.rows,.qr,.foot{position:relative;z-index:1}
  .logo{height:12mm;width:auto;display:block;margin:0 auto 0.8mm}
  .photo{width:19mm;height:23mm;object-fit:cover;border-radius:2mm;border:0.6mm solid #16324F;background:#eef2f7;display:block}
  .photo.ph{display:flex;align-items:center;justify-content:center;font-size:11mm;color:#9aa7b6}
  .name{font-size:3.6mm;font-weight:800;color:#16324F;text-align:center;line-height:1.1;margin:1mm 0 0.2mm}
  .cargo{font-size:2.4mm;color:#5b6b7c;text-transform:uppercase;letter-spacing:.2mm;text-align:center;margin-bottom:0.8mm}
  .rows{width:100%;border-top:0.3mm solid #c9d6e6;padding-top:0.8mm}
  .row{display:flex;justify-content:space-between;gap:2mm;padding:0.4mm 0;font-size:2.6mm}
  .row .k{color:#7a8797;font-weight:600}
  .row .v{color:#16324F;font-weight:800;text-align:right}
  .qr{width:18mm;height:18mm;margin:0.8mm auto 0;background:#fff;padding:0.6mm;border-radius:1mm}
  .qr svg{width:100%;height:100%;display:block}
  .foot{font-size:1.9mm;color:#7a8797;text-align:center;margin-top:auto;padding-top:1mm}
`;

/** Solo el <div class="card"> del carnet (sin <html>), para reutilizarlo también
 *  al exportarlo como imagen. `photoOverride` reemplaza la foto (p. ej. por su
 *  versión en data-URI cuando se genera la imagen). */
export function carnetCard(e: Employee, opts: { companyName?: string; qrSvg: string; photoOverride?: string }): string {
  const name = fullName(e);
  const src = opts.photoOverride ?? e.photo_url;
  const photo = src ? `<img class="photo" src="${esc(src)}"/>` : `<div class="photo ph">👤</div>`;
  const row = (k: string, v?: string | null) =>
    v ? `<div class="row"><span class="k">${k}</span><span class="v">${esc(v)}</span></div>` : '';
  return `<div class="card">
      <img class="wm" src="${LOGO_DATA_URI}"/>
      <img class="logo" src="${LOGO_DATA_URI}"/>
      ${photo}
      <div class="name">${esc(name)}</div>
      <div class="cargo">${esc(e.cargo || 'Trabajador')}</div>
      <div class="rows">
        ${row('N° de ficha', e.ficha_number)}
        ${row('Cédula', e.cedula)}
        ${row('Grupo sanguíneo', e.blood_type)}
      </div>
      <div class="qr">${opts.qrSvg}</div>
      <div class="foot">Carnet de Identificación</div>
    </div>`;
}

/**
 * Carnet imprimible en formato credencial 54×86 mm (vertical). Logo + foto +
 * nombre + cargo + N° de ficha + cédula + grupo sanguíneo + QR.
 */
export function carnetHtml(e: Employee, opts: { companyName?: string; qrSvg: string }): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title></title><style>
    @page{size:${CARNET_MM.w}mm ${CARNET_MM.h}mm;margin:0}
    body{display:flex;justify-content:center;align-items:flex-start}
    @media screen{ body{ padding:16px } }
    ${carnetStyles}
  </style></head><body>${carnetCard(e, opts)}</body></html>`;
}
