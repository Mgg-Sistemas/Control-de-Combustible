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

/**
 * Carnet imprimible (formato credencial) del trabajador: logo + foto + nombre +
 * cargo + N° de ficha + cédula + grupo sanguíneo + QR. `qrSvg` es el SVG del QR.
 */
export function carnetHtml(e: Employee, opts: { companyName?: string; qrSvg: string }): string {
  const name = fullName(e);
  const photo = e.photo_url
    ? `<img class="photo" src="${esc(e.photo_url)}"/>`
    : `<div class="photo ph">👤</div>`;
  const row = (k: string, v?: string | null) =>
    v ? `<div class="row"><span class="k">${k}</span><span class="v">${esc(v)}</span></div>` : '';
  return `<!doctype html><html><head><meta charset="utf-8"><title></title><style>
    @page{margin:2cm}
    *{box-sizing:border-box}
    body{font-family:Tahoma,Geneva,Verdana,sans-serif;display:flex;justify-content:center;padding:0;margin:0}
    .card{position:relative;width:340px;background:#fff;border:1px solid #d9dee5;border-radius:16px;overflow:hidden;box-shadow:0 2px 10px rgba(0,0,0,.12)}
    .wm{position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover;opacity:.12;z-index:0}
    .head,.body,.foot{position:relative;z-index:1}
    .head{padding:12px 16px 0;display:flex;align-items:center;justify-content:flex-end}
    .head img{height:70px;width:auto;background:#fff;border-radius:10px;padding:4px;box-shadow:0 1px 4px rgba(0,0,0,.15)}
    .body{padding:16px 16px 10px;text-align:center}
    .photo{width:120px;height:140px;object-fit:cover;border-radius:10px;border:3px solid #16324F;margin:0 auto 10px;display:block;background:#eef2f7}
    .photo.ph{display:flex;align-items:center;justify-content:center;font-size:60px;background:#eef2f7;color:#9aa7b6}
    .name{font-size:19px;font-weight:800;color:#16324F;line-height:1.15;margin-bottom:2px}
    .cargo{font-size:13px;color:#5b6b7c;margin-bottom:12px;text-transform:uppercase;letter-spacing:.5px}
    .rows{text-align:left;border-top:1px solid #eef2f7;padding-top:10px}
    .row{display:flex;justify-content:space-between;gap:10px;padding:4px 0;font-size:13px}
    .row .k{color:#8a97a6;font-weight:600}
    .row .v{color:#16324F;font-weight:800;text-align:right}
    .qr{margin:12px auto 4px;width:150px;height:150px;background:#fff;padding:6px;border-radius:8px;display:inline-block}
    .qr svg{width:100%;height:100%;display:block}
    .foot{color:#8a97a6;font-size:10px;text-align:center;padding:10px 6px 12px;border-top:1px solid #eef2f7}
  </style></head><body>
    <div class="card">
      <img class="wm" src="/ficha-bg.jpg"/>
      <div class="head">
        <img src="${LOGO_DATA_URI}"/>
      </div>
      <div class="body">
        ${photo}
        <div class="name">${esc(name)}</div>
        <div class="cargo">${esc(e.cargo || 'Trabajador')}</div>
        <div class="rows">
          ${row('N° de ficha', e.ficha_number)}
          ${row('Cédula', e.cedula)}
          ${row('Grupo sanguíneo', e.blood_type)}
        </div>
        <div class="qr">${opts.qrSvg}</div>
      </div>
      <div class="foot">Carnet de identificación</div>
    </div>
  </body></html>`;
}
