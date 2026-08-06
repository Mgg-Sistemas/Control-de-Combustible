// Kit compartido para armar las "Guías rápidas" (PDF tipo hoja de referencia,
// con mockups de pantalla) de cada rol — Manual de Ayuda → "📄 Guías descargables".
// Un solo archivo de estilos/piezas reutilizables para que las 8 guías (una por
// rol) se vean visualmente IGUALES; cada guía solo arma su propio contenido con
// estas piezas (ver src/lib/guides/*Guide.ts).
import { COMPANY_NAME } from '../company';
import { exportPdf } from '../pdf';

const ACCENT = '#1E3A5F';
const BLUE = '#2563EB';
const GREEN = '#16A34A';
const AMBER = '#D97706';
const RED = '#DC2626';

export const esc = (v: any) =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

// ── Documento base (cover + secciones numeradas) ───────────────────────────
export function guideCss(): string {
  return `
    @page{margin:1.6cm}
    *{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    html,body{-webkit-print-color-adjust:exact;print-color-adjust:exact}
    body{font-family:-apple-system,"Segoe UI",Tahoma,Geneva,Verdana,sans-serif;color:#22262b;background:#fff;margin:0;padding:0}
    @media screen{ body{ padding:24px 30px } }
    .page{page-break-after:always}
    .page:last-child{page-break-after:auto}
    .pill{display:inline-block;background:${ACCENT};color:#fff;font-weight:700;font-size:12px;letter-spacing:.3px;padding:7px 16px;border-radius:999px;margin-bottom:22px}
    h1.gtitle{font-size:32px;font-weight:800;color:${ACCENT};margin:0 0 10px;letter-spacing:-.01em}
    p.gsub{font-size:15px;color:#4b5563;margin:0 0 20px;max-width:60ch}
    .cover-note{text-align:center;color:#9CA3AF;font-size:11px;margin-top:28px}
    .callout{border-radius:10px;padding:14px 16px;margin:14px 0;font-size:12.5px;line-height:1.5;border-left:4px solid}
    .callout b{font-weight:800}
    .callout.info{background:#EFF6FF;border-color:${BLUE};color:#1E3A5F}
    .callout.warn{background:#FFFBEB;border-color:${AMBER};color:#78350F}
    .callout.danger{background:#FEF2F2;border-color:${RED};color:#7F1D1D}
    .stepnum{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:9px;background:${BLUE};color:#fff;font-weight:800;font-size:15px;flex:none}
    .stephead{display:flex;align-items:center;gap:10px;margin-bottom:2px}
    h2.stitle{font-size:20px;font-weight:800;color:#111827;margin:0}
    p.ssub{font-size:12.5px;color:#6b7280;margin:2px 0 12px 40px}
    hr.rule{border:0;border-top:1px solid #E5E7EB;margin:0 0 16px}
    .cols{display:flex;gap:20px;align-items:flex-start}
    .cols>div{flex:1;min-width:0}
    ol.steps{list-style:none;margin:0;padding:0;counter-reset:st}
    ol.steps>li{position:relative;padding:0 0 14px 38px;font-size:13px;line-height:1.5;color:#1f2937}
    ol.steps>li:before{counter-increment:st;content:counter(st);position:absolute;left:0;top:-1px;width:24px;height:24px;border-radius:999px;background:#DBEAFE;color:${BLUE};font-weight:800;font-size:12px;display:flex;align-items:center;justify-content:center}
    ol.steps>li b{color:#111827}
    /* ── mockup de pantalla de teléfono ── */
    .phone{background:${ACCENT};border-radius:22px;padding:8px;max-width:290px}
    .phone .screen{background:#fff;border-radius:15px;overflow:hidden}
    .phone .urlbar{display:flex;align-items:center;gap:6px;background:#F3F4F6;color:#374151;font-size:10px;padding:7px 10px}
    .phone .appbar{display:flex;align-items:center;justify-content:space-between;background:${ACCENT};color:#fff;font-weight:700;font-size:12px;padding:10px 12px}
    .phone .appbar .r{font-weight:600;font-size:11px;opacity:.9}
    .phone .body{padding:12px}
    .phone .cardbox{border:1px solid #E5E7EB;border-radius:10px;padding:10px;margin-bottom:9px;background:#fff}
    .phone .cardbox.dark{background:#0F2A4A;border-color:#0F2A4A}
    .field{margin-bottom:8px}
    .field label{display:block;font-size:9.5px;color:#6b7280;margin-bottom:3px}
    .field .box{border:1px solid #D1D5DB;border-radius:7px;padding:7px 9px;font-size:11px;color:#111827;background:#fff}
    .field .box.ph{color:#9CA3AF}
    .btn{display:block;width:100%;text-align:center;border-radius:9px;padding:10px;font-weight:800;font-size:11.5px;color:#fff;margin-bottom:8px}
    .btn.primary{background:${BLUE}}
    .btn.success{background:${GREEN}}
    .btn.warn{background:${AMBER}}
    .btn.danger{background:${RED}}
    .btn.outline{background:#fff;border:1.5px solid ${BLUE};color:${BLUE}}
    .btn.outline.success{border-color:${GREEN};color:${GREEN}}
    .btn.ghost{background:#F3F4F6;color:#374151;font-weight:700}
    .row-title{font-weight:700;font-size:12px;color:#111827}
    .row-sub{font-size:10.5px;color:#6b7280;margin-top:1px}
    .badge-line{font-size:10.5px;font-weight:700;margin:3px 0}
    .badge-line.ok{color:${GREEN}} .badge-line.pend{color:${AMBER}}
    .scanbox{background:#0B1220;color:#9CA3AF;border-radius:12px;padding:16px;text-align:center;font-size:10px;max-width:290px}
    .scanbox .frame{border:3px solid ${GREEN};border-radius:10px;height:110px;display:flex;align-items:center;justify-content:center;margin-bottom:8px;position:relative}
    .scanbox .frame .dot{width:16px;height:16px;border:2px solid ${GREEN};border-radius:4px}
    .arrow-down{text-align:center;color:#9CA3AF;font-size:18px;margin:6px 0}
    table.qa{width:100%;border-collapse:collapse;font-size:11.5px;margin:10px 0}
    table.qa th,table.qa td{border:1px solid #E5E7EB;padding:8px 10px;text-align:left;vertical-align:top}
    table.qa th{background:${ACCENT};color:#fff;font-weight:700}
    table.qa td:first-child{white-space:nowrap;font-weight:700;color:#111827}
    .checkbadge{display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:9px;background:${BLUE};color:#fff;font-weight:900;font-size:16px}
    .foot{text-align:center;color:#9CA3AF;font-size:10.5px;margin-top:18px}
  `;
}

export function coverPage(opts: { title: string; subtitle: string; introCalloutHtml: string }): string {
  return `<div class="page">
    <div class="pill">${esc(COMPANY_NAME).toUpperCase()} · soslaguaira.com</div>
    <h1 class="gtitle">${esc(opts.title)}</h1>
    <p class="gsub">${opts.subtitle}</p>
    ${opts.introCalloutHtml}
    <p class="cover-note">Documento de uso interno · pasos exactos de la aplicación</p>
  </div>`;
}

export function calloutInfo(html: string): string {
  return `<div class="callout info">${html}</div>`;
}
export function calloutWarn(html: string): string {
  return `<div class="callout warn">${html}</div>`;
}
export function calloutDanger(html: string): string {
  return `<div class="callout danger">${html}</div>`;
}

/** Sección numerada: badge azul + título + subtítulo + contenido (steps y/o mockups). */
export function stepSection(n: number, title: string, subtitle: string, innerHtml: string, opts?: { pageBreak?: boolean }): string {
  const pb = opts?.pageBreak === false ? '' : 'page';
  return `<div class="${pb}">
    <div class="stephead"><span class="stepnum">${n}</span><h2 class="stitle">${esc(title)}</h2></div>
    <p class="ssub">${esc(subtitle)}</p>
    <hr class="rule"/>
    ${innerHtml}
  </div>`;
}

/** Dos columnas lado a lado (para mockup + lista de pasos, en cualquier orden). */
export function twoCol(a: string, b: string): string {
  return `<div class="cols"><div>${a}</div><div>${b}</div></div>`;
}

/** Lista de pasos numerados (círculos azules), texto en negrita opcional con **doble asterisco**. */
export function stepList(items: string[]): string {
  const li = items.map((t) => `<li>${boldify(esc0(t))}</li>`).join('');
  return `<ol class="steps">${li}</ol>`;
}
// esc0: escapa pero preserva marcas **negrita** que boldify luego traduce a <b>.
function esc0(t: string): string {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function boldify(t: string): string {
  return t.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
}

export function qaTable(headA: string, headB: string, rows: [string, string][]): string {
  const body = rows.map(([a, b]) => `<tr><td>${boldify(esc0(a))}</td><td>${boldify(esc0(b))}</td></tr>`).join('');
  return `<table class="qa"><thead><tr><th>${esc(headA)}</th><th>${esc(headB)}</th></tr></thead><tbody>${body}</tbody></table>`;
}

export function summaryPage(opts: { title: string; subtitle: string; rows: [string, string][]; closingCalloutHtml: string; guideTitle: string }): string {
  return `<div class="page">
    <div class="stephead"><span class="checkbadge">✓</span><h2 class="stitle">${esc(opts.title)}</h2></div>
    <p class="ssub">${esc(opts.subtitle)}</p>
    <hr class="rule"/>
    ${qaTable('Situación', 'Qué hacer', opts.rows)}
    ${opts.closingCalloutHtml}
    <p class="foot">${esc(COMPANY_NAME).toUpperCase()} · ${esc(opts.guideTitle)} · soslaguaira.com</p>
  </div>`;
}

// ── Piezas del "mockup" de pantalla de teléfono ─────────────────────────────
export function phoneFrame(inner: string): string {
  return `<div class="phone"><div class="screen">${inner}</div></div>`;
}
export function urlBar(url = 'soslaguaira.com'): string {
  return `<div class="urlbar">🔒 ${esc(url)}</div>`;
}
export function appBar(left: string, right = ''): string {
  return `<div class="appbar"><span>${esc(left)}</span>${right ? `<span class="r">${esc(right)}</span>` : ''}</div>`;
}
export function mockupBody(inner: string): string {
  return `<div class="body">${inner}</div>`;
}
export function mockupCard(inner: string, dark = false): string {
  return `<div class="cardbox${dark ? ' dark' : ''}">${inner}</div>`;
}
export function mockupField(label: string, value: string, placeholder = false): string {
  return `<div class="field"><label>${esc(label)}</label><div class="box${placeholder ? ' ph' : ''}">${esc(value)}</div></div>`;
}
export function mockupBtn(label: string, tone: 'primary' | 'success' | 'warn' | 'danger' | 'outline' | 'outlineSuccess' | 'ghost' = 'primary'): string {
  const cls = tone === 'outlineSuccess' ? 'outline success' : tone;
  return `<div class="btn ${cls}">${esc(label)}</div>`;
}
export function mockupRow(title: string, sub: string): string {
  return `<div style="padding:8px 0;border-top:1px solid #F3F4F6"><div class="row-title">${esc(title)}</div><div class="row-sub">${esc(sub)}</div></div>`;
}
export function badgeLine(text: string, tone: 'ok' | 'pend' = 'pend'): string {
  return `<div class="badge-line ${tone}">${esc(text)}</div>`;
}
export function scanBox(caption = 'Apunta al código'): string {
  return `<div class="scanbox"><div class="frame"><div class="dot"></div></div>${esc(caption)}</div>`;
}
export function arrowDown(): string {
  return `<div class="arrow-down">↓</div>`;
}

// ── Ensamblado final + exportación ──────────────────────────────────────────
export function guideDocument(bodyHtml: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"/><title></title><style>${guideCss()}</style></head><body>${bodyHtml}</body></html>`;
}

/**
 * Genera/descarga el PDF de una guía. Reutiliza el mismo mecanismo de
 * exportación que el resto de reportes de la app (`src/lib/pdf.ts`):
 * expo-print + expo-sharing en nativo; vista previa + imprimir en web.
 */
export async function exportGuide(html: string, fileName: string): Promise<boolean> {
  return await exportPdf(html, fileName);
}
