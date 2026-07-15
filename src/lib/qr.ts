import { Platform } from 'react-native';
import QRCode from 'qrcode';

// Dominio PÚBLICO oficial de los QR: SIEMPRE apuntan a DigitalOcean
// (soslaguaira.com), sin importar desde dónde se generen o impriman (Vercel,
// localhost, etc.). Así los QR impresos no dependen del dominio del momento.
const QR_ORIGIN = 'https://www.soslaguaira.com';

/** Origen del dominio para uso general (web: el actual; si no, el oficial). */
export function appOrigin(): string {
  if (Platform.OS === 'web') {
    const w: any = globalThis;
    if (w?.location?.origin) return String(w.location.origin);
  }
  return QR_ORIGIN;
}

/** URL que codifica el QR de una máquina: abre el sistema en la vista rápida. */
export function machineQrUrl(machineryId: string): string {
  return `${QR_ORIGIN}/?maquina=${encodeURIComponent(machineryId)}`;
}

/** URL que codifica el QR de un empleado: abre su ficha (datos del trabajador). */
export function employeeQrUrl(employeeId: string): string {
  return `${QR_ORIGIN}/?empleado=${encodeURIComponent(employeeId)}`;
}

/** URL que codifica el QR de un aliado: abre su ficha (datos del aliado). */
export function aliadoQrUrl(aliadoId: string): string {
  return `${QR_ORIGIN}/?aliado=${encodeURIComponent(aliadoId)}`;
}

/** URL del QR de DISTRIBUCIÓN DE COMIDA por empresa: abre el registro de comidas de esa empresa. */
export function comidaQrUrl(companyId: string): string {
  return `${QR_ORIGIN}/?comida=${encodeURIComponent(companyId)}`;
}

/** Genera el QR como cadena SVG (puro, sin canvas — funciona en web y en print). */
export async function qrSvg(text: string, size = 240): Promise<string> {
  return QRCode.toString(text, { type: 'svg', margin: 1, width: size });
}

/** Genera el QR como PNG data URI (data:image/png;base64,…). Es lo más fiable para
 *  mostrarlo en <Image>/<img> y para que SIEMPRE se rasterice al exportar la imagen. */
export async function qrPngDataUri(text: string, size = 320): Promise<string> {
  return QRCode.toDataURL(text, { margin: 1, width: size, errorCorrectionLevel: 'M' });
}

/** SVG → data URI para mostrarlo en <Image> (web). */
export function svgDataUri(svg: string): string {
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}
