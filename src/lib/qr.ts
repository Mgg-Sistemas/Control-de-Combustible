import { Platform } from 'react-native';
import QRCode from 'qrcode';

// Dominio de despliegue (Vercel). En web usamos el origen real para que el QR
// funcione aunque se cambie el dominio; en nativo caemos al de producción.
const FALLBACK_ORIGIN = 'https://control-de-combustible.vercel.app';

export function appOrigin(): string {
  if (Platform.OS === 'web') {
    const w: any = globalThis;
    if (w?.location?.origin) return String(w.location.origin);
  }
  return FALLBACK_ORIGIN;
}

/** URL que codifica el QR de una máquina: abre el sistema en la vista rápida. */
export function machineQrUrl(machineryId: string): string {
  return `${appOrigin()}/?maquina=${encodeURIComponent(machineryId)}`;
}

/** URL que codifica el QR de un empleado: abre su ficha (datos del trabajador). */
export function employeeQrUrl(employeeId: string): string {
  return `${appOrigin()}/?empleado=${encodeURIComponent(employeeId)}`;
}

/** Genera el QR como cadena SVG (puro, sin canvas — funciona en web y en print). */
export async function qrSvg(text: string, size = 240): Promise<string> {
  return QRCode.toString(text, { type: 'svg', margin: 1, width: size });
}

/** SVG → data URI para mostrarlo en <Image> (web). */
export function svgDataUri(svg: string): string {
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}
