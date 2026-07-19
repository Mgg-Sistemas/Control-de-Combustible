import { norm } from './text';
import { LOGO_DATA_URI } from './logoData';

/**
 * Organigrama de la empresa (por CARGOS, no por nombres). La estructura es FIJA
 * y curada; los cargos que aparezcan en la nómina (empleados) y que NO estén
 * ubicados aquí se muestran en una caja aparte "🆕 Otros cargos (por ubicar)".
 * Se genera como HTML para: (1) vista previa / PDF y (2) imagen PNG.
 */

type Unit = { title: string; leaves: string[] };
type Dept = { title: string; color: string; wide?: boolean; leaves?: string[]; units?: Unit[] };

const C = { gen: '#0F2E4D', admin: '#1F6F54', alim: '#B0632B', alma: '#7A4EA8', oper: '#1E4E79', sub: '#2C6FB0' };

export const ORG_GENERAL = 'COORDINADOR GENERAL';
export const ORG_DEPTS: Dept[] = [
  { title: 'JEFE DE ADMINISTRACIÓN', color: C.admin, leaves: ['Analistas Administrativos'] },
  { title: 'JEFE DE ALIMENTACIÓN', color: C.alim, units: [
    { title: 'COORDINADOR DE COCINA', leaves: ['Cocinero', 'Ayudante de cocina', 'Lavaplatos'] },
  ] },
  { title: 'JEFE DE ALMACÉN', color: C.alma, leaves: ['Almacenista'] },
  { title: 'JEFE DE OPERACIONES DE MAQUINARIA', color: C.oper, wide: true, units: [
    { title: 'COORDINADOR DE OPERADORES', leaves: ['Operadores de maquinaria', 'Operador camión de servicio', 'Operador camión Pitman', 'Chofer de camión', 'Chofer cisterna de agua', 'Ayudante camión de servicio', 'Motorizado VIP', 'Obrero (caletero)'] },
    { title: 'COORD. MANTENIMIENTO PREVENTIVO', leaves: ['Mecánico', 'Ayudante mecánico', 'Soldador', 'Todero', 'Mantenimiento y limpieza'] },
    { title: 'COORDINADOR DE ELECTRICISTA', leaves: ['Electricista', 'Ayudante electricista'] },
    { title: 'COORDINADOR DE INSPECTORES', leaves: ['Inspector de equipos'] },
    { title: 'JEFE DE PATIO', leaves: ['Listeros de patio'] },
  ] },
];

// ── Sincronización: qué cargos de la nómina YA están ubicados en el organigrama ──
// Palabras clave (si el cargo las contiene, se considera ubicado) + sinónimos exactos.
const KEYWORDS = ['operador', 'chofer', 'almacen', 'cocin', 'lavaplato', 'electricist', 'mecanic', 'soldador', 'todero', 'motorizado', 'inspector', 'listero', 'obrero', 'analista'];
const SYNONYMS = [
  'administrativo', 'jefe adminitrativo', 'jefe administrativo',
  'coordinador de patio', 'coordinador general',
  'jefe de operaciones de maquinaria', 'jefe de patio',
  'coordinador de operadores', 'coordinador de mantenimiento preventivo',
  'coordinador de electricista', 'coordinador de inspectores', 'coordinador de inspector',
  'coordinador de cocina', 'jefe de cocina', 'encargado de cocina', 'jefe de alimentacion',
  'jefe de administracion', 'jefe de almacen', 'jefe de alimentacion',
];

/** Conjunto normalizado de todos los cargos/títulos ya presentes en la estructura. */
const KNOWN: Set<string> = (() => {
  const s = new Set<string>();
  const add = (t: string) => s.add(norm(t));
  add(ORG_GENERAL);
  ORG_DEPTS.forEach((d) => {
    add(d.title);
    (d.leaves ?? []).forEach(add);
    (d.units ?? []).forEach((u) => { add(u.title); u.leaves.forEach(add); });
  });
  SYNONYMS.forEach(add);
  return s;
})();

/** ¿El cargo ya está ubicado en el organigrama? (por coincidencia exacta o palabra clave) */
export function isCargoUbicado(cargo: string): boolean {
  const n = norm(cargo);
  if (!n) return true; // vacío: se ignora
  if (KNOWN.has(n)) return true;
  return KEYWORDS.some((k) => n.includes(k));
}

/** De una lista de cargos de la nómina, devuelve los que NO están ubicados (por ubicar). */
export function cargosPorUbicar(cargos: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  cargos.forEach((c) => {
    const t = String(c || '').trim();
    if (!t) return;
    const n = norm(t);
    if (seen.has(n) || isCargoUbicado(t)) return;
    seen.add(n);
    out.push(t.toUpperCase());
  });
  return out.sort((a, b) => a.localeCompare(b, 'es'));
}

// ── Render HTML ──────────────────────────────────────────────────────────────
const esc = (t: any) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const chip = (t: string) => `<span class="chip">${esc(t)}</span>`;

export const ORG_STYLES = `
  *{margin:0;padding:0;box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  body{font-family:Tahoma,Geneva,Verdana,sans-serif;background:#fff;color:#14212E;padding:34px 40px 40px;width:1900px}
  .head{display:flex;align-items:center;gap:18px;border-bottom:3px solid ${C.gen};padding-bottom:16px;margin-bottom:30px}
  .head .logo{height:74px;width:auto}
  .head h1{font-size:29px;letter-spacing:.5px;color:${C.gen}}
  .head p{font-size:14px;color:#5B6B7B;margin-top:2px}
  .head .date{margin-left:auto;text-align:right;color:#5B6B7B;font-size:13px}
  .top{display:flex;justify-content:center;margin-bottom:8px}
  .node{border-radius:12px;color:#fff;padding:15px 32px;text-align:center;background:${C.gen};box-shadow:0 3px 8px rgba(20,33,46,.14)}
  .node .role{font-size:20px;font-weight:800;letter-spacing:.3px}
  .rail{width:3px;height:24px;background:#B7C4D2;margin:0 auto}
  .bus{height:3px;background:#B7C4D2;margin:0 auto}
  .depts{display:flex;gap:24px;justify-content:center;align-items:flex-start}
  .dept{flex:0 0 auto;display:flex;flex-direction:column;align-items:center}
  .dept.oper{flex:1 1 auto}
  .card{border:2px solid;border-radius:12px;background:#fff;box-shadow:0 2px 6px rgba(20,33,46,.08)}
  .jefe{color:#fff;border-radius:11px 11px 0 0;padding:12px 18px;text-align:center}
  .jefe .role{font-size:16px;font-weight:800}
  .sub{padding:13px;display:flex;flex-direction:column;gap:11px}
  .coord{border:1.6px solid #D6E0EC;border-radius:10px;overflow:hidden;background:#fff}
  .coord .ch{padding:9px 12px;font-size:13px;font-weight:800;color:#fff;text-align:center;background:${C.sub}}
  .team{padding:10px 12px;display:flex;flex-wrap:wrap;gap:7px}
  .chip{background:#F1F5FA;border:1px solid #D6E0EC;border-radius:999px;padding:5px 13px;font-size:12.5px;font-weight:600;color:#14212E}
  .grid{display:flex;gap:14px;flex-wrap:wrap}
  .grid .coord{flex:1 1 300px}
  .otros{margin-top:22px;border:2px dashed #C9962B;border-radius:12px;background:#FFFBF2;padding:14px 16px}
  .otros .t{font-size:14px;font-weight:800;color:#9A6B12;margin-bottom:8px}
  .otros .team{padding:0}
  .otros .chip{background:#FFF4DA;border-color:#EAD196;color:#7A5310}
  .foot{margin-top:26px;border-top:1px solid #B7C4D2;padding-top:12px;color:#5B6B7B;font-size:12px;display:flex;gap:20px;flex-wrap:wrap}
  .legend{display:flex;align-items:center;gap:7px}
  .dot{width:12px;height:12px;border-radius:3px;display:inline-block}
`;

/** Cuerpo (card) del organigrama. `otros` = cargos por ubicar (opcional). */
export function organigramaCard(otros: string[] = []): string {
  const dept = (d: Dept) => {
    const inner = d.units
      ? `<div class="grid">${d.units.map((u) => `
          <div class="coord"><div class="ch">${esc(u.title)}</div>
            <div class="team">${u.leaves.map(chip).join('')}</div></div>`).join('')}</div>`
      : `<div class="team" style="padding:2px 0">${(d.leaves ?? []).map(chip).join('')}</div>`;
    const w = d.wide ? 'width:100%' : `width:${d.title.length > 20 ? 270 : 240}px`;
    return `<div class="dept${d.wide ? ' oper' : ''}">
      <div class="card" style="border-color:${d.color};${w}">
        <div class="jefe" style="background:${d.color}"><div class="role">${esc(d.title)}</div></div>
        <div class="sub">${inner}</div>
      </div></div>`;
  };
  const otrosBox = otros.length
    ? `<div class="otros"><div class="t">🆕 Otros cargos (por ubicar) — están en la nómina y aún no tienen lugar en el organigrama</div>
        <div class="team">${otros.map(chip).join('')}</div></div>`
    : '';
  return `
    <div class="head">
      <img class="logo" src="${LOGO_DATA_URI}" alt="SOS La Guaira"/>
      <div><h1>ORGANIGRAMA · SOS LA GUAIRA 2026</h1><p>Estructura organizativa por cargos</p></div>
      <div class="date">Actualizado con la nómina</div>
    </div>
    <div class="top"><div class="node"><div class="role">${esc(ORG_GENERAL)}</div></div></div>
    <div class="rail"></div><div class="bus" style="width:86%"></div><div class="rail"></div>
    <div class="depts">${ORG_DEPTS.map(dept).join('')}</div>
    ${otrosBox}
    <div class="foot">
      <span class="legend"><span class="dot" style="background:${C.gen}"></span> Dirección</span>
      <span class="legend"><span class="dot" style="background:${C.admin}"></span> Administración</span>
      <span class="legend"><span class="dot" style="background:${C.alim}"></span> Alimentación</span>
      <span class="legend"><span class="dot" style="background:${C.alma}"></span> Almacén</span>
      <span class="legend"><span class="dot" style="background:${C.oper}"></span> Operaciones de Maquinaria</span>
    </div>`;
}

/** Documento HTML completo (para vista previa / PDF y como respaldo del PNG). */
export function organigramaHtml(otros: string[] = []): string {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"/><title></title>
    <style>@page{size:landscape;margin:8mm}${ORG_STYLES}</style></head>
    <body>${organigramaCard(otros)}</body></html>`;
}

/** Medidas físicas (mm) del lienzo para exportar la imagen PNG. */
export const ORG_SHEET_MM = { w: 503, h: 250 };
