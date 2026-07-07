import { Platform } from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

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
