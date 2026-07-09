import { Platform } from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { LOGO_DATA_URI } from './logoData';
import { COMPANY_NAME, COMPANY_RIF } from './company';

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

const PDF_ACCENT = '#1E3A5F';
/** CSS común del membrete. `@page{margin:2cm}` da 2 cm en todos los lados de
 *  CADA página; el `<title>` vacío evita el título del navegador. */
export const PDF_BASE_CSS = `
  @page{margin:2cm}
  *{box-sizing:border-box}
  body{font-family:Tahoma,Geneva,Verdana,sans-serif;color:#333;padding:0}
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
    <div class="company"><b>${COMPANY_NAME}</b><br/>RIF ${COMPANY_RIF}<br/>Sistema de control interno</div>
    ${body}
    <div class="foot">${COMPANY_NAME} · RIF ${COMPANY_RIF} · Documento generado por el sistema de control interno</div>
  </body></html>`;
}

/**
 * Genera/descarga un PDF a partir de HTML.
 * - Web: renderiza el HTML (con logo y estilos) en un iframe oculto y abre el
 *   diálogo de impresión. IMPORTANTE: Print.printAsync en web ignora el html y
 *   solo imprime la página actual, por eso usamos el iframe.
 * - Nativo: genera el archivo y abre la hoja para compartir/guardar.
 */
export async function exportPdf(html: string): Promise<void> {
  if (Platform.OS === 'web') {
    await printHtmlWeb(html);
    return;
  }
  const { uri } = await Print.printToFileAsync({ html });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: 'Reporte' });
  }
}

/** Imprime un HTML propio (no la pantalla) usando un iframe oculto. */
function printHtmlWeb(html: string): Promise<void> {
  return new Promise((resolve) => {
    const d: any = (globalThis as any).document;
    if (!d || !d.body) {
      resolve();
      return;
    }
    const iframe: any = d.createElement('iframe');
    iframe.setAttribute('style', 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;');
    d.body.appendChild(iframe);

    const cw: any = iframe.contentWindow;
    const cdoc: any = cw.document;
    cdoc.open();
    cdoc.write(html);
    cdoc.close();

    const done = () => {
      try {
        cw.focus();
        cw.print();
      } catch (e) {
        // ignorar
      }
      setTimeout(() => {
        try {
          iframe.remove();
        } catch (e) {}
        resolve();
      }, 1000);
    };

    // Esperar a que el iframe cargue (incluye el logo en data URI).
    if (cdoc.readyState === 'complete') setTimeout(done, 400);
    else cw.onload = () => setTimeout(done, 400);
  });
}
