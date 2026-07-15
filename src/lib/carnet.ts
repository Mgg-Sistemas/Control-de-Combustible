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
  .logo,.photoBox,.name,.cargo,.rows,.qr,.foot{position:relative;z-index:1}
  .logo{height:11mm;width:auto;display:block;margin:0 auto 0.8mm}
  .photoBox{width:25mm;height:30mm;border-radius:2mm;border:0.6mm solid #16324F;background:#eef2f7;overflow:hidden;display:block;margin:0 auto}
  .photo{width:100%;height:100%;object-fit:cover;object-position:center;display:block}
  .photoBox.ph{display:flex;align-items:center;justify-content:center;font-size:13mm;color:#9aa7b6}
  .name{font-size:3.6mm;font-weight:800;color:#16324F;text-align:center;line-height:1.1;margin:1mm 0 0.2mm}
  .cargo{font-size:2.4mm;color:#5b6b7c;text-transform:uppercase;letter-spacing:.2mm;text-align:center;margin-bottom:0.8mm}
  .rows{width:100%;border-top:0.3mm solid #c9d6e6;padding-top:0.8mm}
  .row{display:flex;justify-content:space-between;gap:2mm;padding:0.4mm 0;font-size:2.6mm}
  .row .k{color:#7a8797;font-weight:600}
  .row .v{color:#16324F;font-weight:800;text-align:right}
  .qr{width:17mm;height:17mm;margin:0.8mm auto 0;background:#fff;padding:0.6mm;border-radius:1mm}
  .qr svg{width:100%;height:100%;display:block}
  .foot{font-size:1.9mm;color:#7a8797;text-align:center;margin-top:auto;padding-top:1mm}
`;

/** Solo el <div class="card"> del carnet (sin <html>), para reutilizarlo también
 *  al exportarlo como imagen. `photoOverride` reemplaza la foto (p. ej. por su
 *  versión en data-URI cuando se genera la imagen). */
export function carnetCard(e: Employee, opts: { companyName?: string; qrSvg: string; photoOverride?: string }): string {
  const name = fullName(e);
  const src = opts.photoOverride ?? e.photo_url;
  const photo = src
    ? `<div class="photoBox"><img class="photo" src="${esc(src)}"/></div>`
    : `<div class="photoBox ph">👤</div>`;
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

/** Aliado mínimo para el carnet. */
export type AliadoCard = {
  first_name?: string | null;
  last_name?: string | null;
  ficha_number?: string | null;
  cedula?: string | null;
  organizacion?: string | null;
  photo_url?: string | null;
};

export const CARNET_ALIADO_MM = { w: 54, h: 86 };

// Diseño credencial tipo "olas azules" sobre blanco (sin fondo/marca de agua).
// Dos caras: FRENTE (logo + foto + nombre + N° de ficha) y REVERSO (QR).
export const carnetAliadoStyles = `
  *{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  html,body{margin:0;padding:0}
  body{font-family:Tahoma,Geneva,Verdana,sans-serif}
  .card{position:relative;width:54mm;height:86mm;background:#fff;border-radius:3mm;overflow:hidden;
    display:flex;flex-direction:column;align-items:center;padding:12mm 4mm 9mm}
  .bg{position:absolute;top:0;left:0;width:100%;height:100%;z-index:0}
  .logo,.blogo,.photoBox,.name,.kind,.ficha,.qr,.qrlabel,.lost{position:relative;z-index:1}
  .logo{height:12mm;width:auto;margin:0 auto 2mm;display:block}
  .blogo{height:18mm;width:auto;margin:0 auto 3mm;display:block}
  .photoBox{width:26mm;height:31mm;border-radius:2mm;border:0.5mm solid #16324F;background:#eef2f7;overflow:hidden;display:block}
  .photoBox.ph{display:flex;align-items:center;justify-content:center;font-size:14mm;color:#9aa7b6}
  .photo{width:100%;height:100%;object-fit:cover;object-position:center;display:block}
  .name{font-size:4mm;font-weight:800;color:#16324F;text-align:center;line-height:1.1;margin:2.2mm 0 0.6mm}
  .kind{font-size:2.6mm;font-weight:800;color:#fff;background:#16324F;border-radius:1.2mm;padding:0.8mm 4mm;letter-spacing:.5mm}
  .ficha{margin-top:2.4mm;text-align:center}
  .ficha small{display:block;font-size:2.2mm;font-weight:700;color:#5b6b7c;letter-spacing:.3mm}
  .ficha b{font-size:7mm;font-weight:900;color:#16324F;letter-spacing:1.5mm}
  .qr{width:34mm;height:34mm;background:#fff;padding:1mm;border-radius:1mm;margin:4mm auto 0}
  .qr svg,.qr img{width:100%;height:100%;display:block}
  .qrlabel{font-size:2.9mm;font-weight:800;color:#16324F;text-align:center;letter-spacing:.3mm;margin:2.5mm 0 0}
  .lost{font-size:2.6mm;color:#334155;text-align:center;margin-top:4mm;padding:0 3mm;line-height:1.4}
  .lost b{color:#16324F;display:block;margin-top:1mm}
`;

/** SVG de olas azules (fondo decorativo del carnet, arriba y abajo). */
function aliadoWave(): string {
  return `<svg class="bg" viewBox="0 0 540 860" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="agr" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#2E6FB6"/><stop offset="1" stop-color="#16324F"/></linearGradient></defs>
    <path fill="url(#agr)" d="M0 0 H540 V120 C400 205 150 55 0 165 Z"/>
    <path fill="#7FB2E6" opacity="0.55" d="M0 165 C150 55 400 205 540 120 V152 C400 237 150 92 0 197 Z"/>
    <path fill="url(#agr)" d="M0 860 H540 V740 C390 665 150 815 0 705 Z"/>
    <path fill="#7FB2E6" opacity="0.5" d="M0 705 C150 815 390 665 540 740 V712 C390 637 150 787 0 677 Z"/>
  </svg>`;
}

/** FRENTE del carnet de aliado (logo + foto + nombre + N° de ficha). */
export function carnetAliadoFront(a: AliadoCard, opts: { photoOverride?: string } = {}): string {
  const name = `${a.first_name ?? ''} ${a.last_name ?? ''}`.trim();
  const src = opts.photoOverride ?? a.photo_url;
  const photo = src ? `<div class="photoBox"><img class="photo" src="${esc(src)}"/></div>` : `<div class="photoBox ph">👤</div>`;
  return `<div class="card">
      ${aliadoWave()}
      <img class="logo" src="${LOGO_DATA_URI}"/>
      ${photo}
      <div class="name">${esc(name)}</div>
      <div class="kind">ALIADO</div>
      <div class="ficha"><small>N° DE FICHA</small><b>${esc(a.ficha_number || '----')}</b></div>
    </div>`;
}

/** REVERSO del carnet de aliado (QR + aviso de pérdida). */
export function carnetAliadoBack(a: AliadoCard, opts: { qrSvg: string }): string {
  // El QR se embebe como imagen (data URI) para que SIEMPRE se rasterice al
  // exportar la imagen (el <svg> suelto a veces no sale en el PNG).
  const qr = opts.qrSvg
    ? (opts.qrSvg.trim().startsWith('<svg')
        ? `<img src="data:image/svg+xml;utf8,${encodeURIComponent(opts.qrSvg)}"/>`
        : opts.qrSvg)
    : '';
  return `<div class="card">
      ${aliadoWave()}
      <img class="blogo" src="${LOGO_DATA_URI}"/>
      <div class="qr">${qr}</div>
      <div class="qrlabel">QR de acceso y control</div>
      <div class="lost">En caso de pérdida, por favor comunicarse a la empresa.<b>N° de ficha ${esc(a.ficha_number || '----')}</b></div>
    </div>`;
}

/** Carnet imprimible de ALIADO (54×86 mm) — dos caras (frente + reverso). */
export function carnetAliadoHtml(a: AliadoCard, opts: { qrSvg: string; photoOverride?: string }): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title></title><style>
    @page{size:${CARNET_ALIADO_MM.w}mm ${CARNET_ALIADO_MM.h}mm;margin:0}
    body{margin:0}
    .card{page-break-after:always}
    @media screen{ body{ display:flex; gap:16px; padding:16px; flex-wrap:wrap } .card{page-break-after:auto} }
    ${carnetAliadoStyles}
  </style></head><body>${carnetAliadoFront(a, opts)}${carnetAliadoBack(a, opts)}</body></html>`;
}
