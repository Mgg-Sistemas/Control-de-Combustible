import { Platform } from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

/**
 * Genera/descarga un PDF a partir de HTML.
 * - Web: abre el diálogo de impresión del navegador (permite "Guardar como PDF").
 * - Nativo: genera el archivo y abre la hoja para compartir/guardar.
 */
export async function exportPdf(html: string): Promise<void> {
  if (Platform.OS === 'web') {
    await Print.printAsync({ html });
    return;
  }
  const { uri } = await Print.printToFileAsync({ html });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: 'Reporte de consumo' });
  }
}
