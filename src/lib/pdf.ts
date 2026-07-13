import { Platform } from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { LOGO_DATA_URI } from './logoData';
import { COMPANY_NAME } from './company';

const MESES = ['ene.', 'feb.', 'mar.', 'abr.', 'may.', 'jun.', 'jul.', 'ago.', 'sep.', 'oct.', 'nov.', 'dic.'];
/** Fecha/hora de emisión en formato "07 jul. 2026, 06:53 p. m." */
export function nowStamp(): string {
  const d = new Date();
  let h = d.getHours();
  const ap = h < 12 ? 'a. m.' : 'p. m.';
  h = h % 12;
  if (h === 0) h = 12;
  const mm = `${d.getMinutes()}`.padStart(2, '0');
  const dd = `${d.getDate()}`.padStart(2, '0');
  return `${dd} ${MESES[d.getMonth()]} ${d.getFullYear()}, ${`${h}`.padStart(2, '0')}:${mm} ${ap}`;
}

/** Etiqueta de rango para el nombre de archivo: "del 06 al 12" (mismo mes) o
 *  "del 26/06 al 05/07" (meses distintos). Recibe fechas ISO "AAAA-MM-DD". */
export function dateRangeLabel(fromISO?: string, toISO?: string): string {
  const a = (fromISO || '').split('-');
  const b = (toISO || '').split('-');
  if (a.length < 3 || b.length < 3) return '';
  return a[1] === b[1] ? `del ${a[2]} al ${b[2]}` : `del ${a[2]}/${a[1]} al ${b[2]}/${b[1]}`;
}

const PDF_ACCENT = '#1E3A5F';
/** CSS común del membrete. `@page{margin:2cm}` da 2 cm en todos los lados de
 *  CADA página; el `<title>` vacío evita el título del navegador. */
export const PDF_BASE_CSS = `
  @page{margin:2cm}
  /* Forzar que se IMPRIMAN los fondos de color (encabezados azules de tablas, etc.).
     Sin esto, al imprimir/guardar como PDF el navegador quita los fondos y el
     encabezado azul se ve gris/blanco. */
  *{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  html,body{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  body{font-family:Tahoma,Geneva,Verdana,sans-serif;color:#333;padding:0;background:#fff}
  /* En pantalla (vista previa) el documento se ve como una hoja blanca con márgenes. */
  @media screen{ body{ padding:28px 34px } }
  .top{display:flex;justify-content:space-between;align-items:flex-start}
  .brand{display:flex;gap:16px;align-items:center}
  .brand img{height:70px;width:auto}
  .doc-title{font-size:26px;font-weight:800;color:${PDF_ACCENT};letter-spacing:1px;text-transform:uppercase;margin:0;line-height:1.02}
  .doc-sub{color:#6B7280;font-size:12px;margin-top:5px}
  .emit{text-align:right;font-size:12px;color:#333;white-space:nowrap}
  .emit .k{color:#6B7280;font-weight:700}
  .rule{height:4px;background:${PDF_ACCENT};border:0;margin:14px 0 16px}
  .company{font-size:12px;line-height:1.6;margin-bottom:10px}
  .company b{color:${PDF_ACCENT};font-size:13px}
  .foot{margin-top:26px;padding-top:10px;border-top:1px solid #E5E7EB;text-align:center;color:#9CA3AF;font-size:10px}
  /* Al cortarse una tabla entre páginas, el navegador REPITE el <tfoot> (fila de
     TOTAL) al pie de cada página. Con display:table-row-group deja de repetirse y
     el TOTAL aparece UNA sola vez, al final real de cada agrupado. El <thead>
     (encabezado de columnas) sí se mantiene repitiéndose en cada página. */
  tfoot{display:table-row-group}
  tr{page-break-inside:avoid}
`;

/**
 * Envuelve el cuerpo de un PDF en el membrete de la empresa (logo + título +
 * datos de la empresa + pie), igual en todos los reportes.
 * @param extraCss estilos propios del reporte (tablas, etc.).
 */
export function pdfDocument(opts: { title: string; subtitle?: string; body: string; extraCss?: string }): string {
  const { title, subtitle = '', body, extraCss = '' } = opts;
  return `<!doctype html><html><head><meta charset="utf-8"/><title></title>
    <style>${PDF_BASE_CSS}${extraCss}</style></head><body>
    <div class="top">
      <div class="brand"><img src="${LOGO_DATA_URI}"/>
        <div><h1 class="doc-title">${title}</h1>${subtitle ? `<div class="doc-sub">${subtitle}</div>` : ''}</div>
      </div>
      <div class="emit"><span class="k">Emitida:</span> ${nowStamp()}</div>
    </div>
    <div class="rule"></div>
    <div class="company"><b>${COMPANY_NAME}</b><br/>Sistema de control interno</div>
    ${body}
    <div class="foot">${COMPANY_NAME} · Documento generado por el sistema de control interno</div>
  </body></html>`;
}

/**
 * Genera/descarga un PDF a partir de HTML.
 * - Web: abre una VENTANA DEL SISTEMA (modal) con la vista previa del documento
 *   y una barra con "🖨️ Imprimir" y "Cancelar". Solo al tocar Imprimir se manda
 *   a la impresora. IMPORTANTE: Print.printAsync en web ignora el html y solo
 *   imprime la página actual, por eso el documento se renderiza en un iframe.
 * - Nativo: genera el archivo y abre la hoja para compartir/guardar.
 */
export async function exportPdf(html: string, fileName?: string): Promise<void> {
  // Nombre sugerido del archivo (sin extensión). En web el navegador lo toma
  // del título del documento que se imprime; por eso lo pasamos al iframe.
  const name = sanitizeFileName(fileName);
  if (Platform.OS === 'web') {
    await previewHtmlWeb(html, name);
    return;
  }
  const { uri } = await Print.printToFileAsync({ html });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: name || 'Reporte' });
  }
}

/** Deja un nombre de archivo válido (sin caracteres prohibidos por el SO). */
function sanitizeFileName(name?: string): string {
  if (!name) return '';
  return name.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120);
}

/**
 * Ventana del sistema (web) con la VISTA PREVIA del documento y una barra con
 * "🖨️ Imprimir" y "Cancelar". El documento se renderiza en un iframe visible
 * (con su logo y estilos); solo al tocar Imprimir se abre el diálogo de la
 * impresora. Reemplaza el salto directo al diálogo del navegador.
 */
function previewHtmlWeb(html: string, fileName?: string): Promise<void> {
  return new Promise((resolve) => {
    const d: any = (globalThis as any).document;
    if (!d || !d.body) {
      resolve();
      return;
    }

    // Fondo oscuro que cubre la pantalla (la "ventana" del sistema).
    const overlay: any = d.createElement('div');
    overlay.setAttribute(
      'style',
      'position:fixed;inset:0;z-index:99999;background:rgba(15,23,42,.55);' +
        'display:flex;align-items:center;justify-content:center;padding:24px;' +
        'font-family:Tahoma,Geneva,Verdana,sans-serif;',
    );

    // Tarjeta central (la ventana).
    const card: any = d.createElement('div');
    card.setAttribute(
      'style',
      'background:#fff;border-radius:14px;overflow:hidden;width:min(920px,96vw);' +
        'height:min(90vh,1200px);display:flex;flex-direction:column;' +
        'box-shadow:0 20px 60px rgba(0,0,0,.35);',
    );

    // Barra superior con título + botones Imprimir / Cancelar.
    const bar: any = d.createElement('div');
    bar.setAttribute(
      'style',
      'display:flex;align-items:center;justify-content:space-between;gap:12px;' +
        'padding:12px 16px;background:#1E3A5F;color:#fff;flex:0 0 auto;',
    );
    const barTitle: any = d.createElement('div');
    barTitle.setAttribute('style', 'font-weight:800;font-size:15px;letter-spacing:.3px;');
    barTitle.textContent = 'Vista previa del documento';

    const btns: any = d.createElement('div');
    btns.setAttribute('style', 'display:flex;gap:10px;');
    const btnCancel: any = d.createElement('button');
    btnCancel.textContent = 'Cancelar';
    btnCancel.setAttribute(
      'style',
      'cursor:pointer;border:1px solid rgba(255,255,255,.55);background:transparent;' +
        'color:#fff;font-weight:700;font-size:14px;padding:9px 16px;border-radius:9px;',
    );
    const btnPrint: any = d.createElement('button');
    btnPrint.textContent = '🖨️  Imprimir';
    btnPrint.setAttribute(
      'style',
      'cursor:pointer;border:0;background:#fff;color:#1E3A5F;font-weight:800;' +
        'font-size:14px;padding:9px 18px;border-radius:9px;',
    );
    btns.appendChild(btnCancel);
    btns.appendChild(btnPrint);
    bar.appendChild(barTitle);
    bar.appendChild(btns);

    // Cuerpo: el documento renderizado en un iframe.
    const iframe: any = d.createElement('iframe');
    iframe.setAttribute('style', 'flex:1 1 auto;width:100%;border:0;background:#525659;');
    card.appendChild(bar);
    card.appendChild(iframe);
    overlay.appendChild(card);
    d.body.appendChild(overlay);

    const cw: any = iframe.contentWindow;
    const cdoc: any = cw.document;
    cdoc.open();
    cdoc.write(html);
    cdoc.close();

    // El navegador usa el título del documento como nombre de archivo sugerido
    // al "Guardar como PDF". Lo fijamos en el iframe.
    if (fileName) { try { cdoc.title = fileName; } catch (e) {} }

    let closed = false;
    const cleanup = () => {
      if (closed) return;
      closed = true;
      try { d.removeEventListener('keydown', onKey); } catch (e) {}
      try { overlay.remove(); } catch (e) {}
      resolve();
    };
    const onKey = (ev: any) => { if (ev.key === 'Escape') cleanup(); };

    btnCancel.onclick = cleanup;
    // Cerrar al tocar fuera de la tarjeta.
    overlay.onclick = (ev: any) => { if (ev.target === overlay) cleanup(); };
    d.addEventListener('keydown', onKey);

    btnPrint.onclick = () => {
      try {
        cw.focus();
        cw.print();
      } catch (e) {
        // ignorar
      }
    };
  });
}
