// Detección de dispositivo: TELÉFONO/tablet vs PC. En la web (soslaguaira.com)
// se lee el user-agent del navegador; en la app nativa se usa Platform.
// Sirve para: (1) enrutar a los usuarios de teléfono al módulo de Inspectores,
// (2) registrar en la Auditoría desde qué dispositivo se hizo cada acción.
import { Platform } from 'react-native';

/** True si la sesión corre en un teléfono o tablet (no una PC). */
export function isPhoneDevice(): boolean {
  if (Platform.OS === 'ios' || Platform.OS === 'android') return true;
  if (Platform.OS === 'web') {
    try {
      const ua = (navigator.userAgent || '').toLowerCase();
      if (/android|iphone|ipod|ipad|mobile|tablet|silk|kindle|blackberry|opera mini|iemobile|windows phone/.test(ua)) return true;
      // iPad moderno se hace pasar por Mac; se distingue por el táctil.
      if (/macintosh/.test(ua) && typeof document !== 'undefined' && 'ontouchend' in document) return true;
      return false;
    } catch { return false; }
  }
  return false;
}

/** Etiqueta legible del dispositivo para la bitácora (ej. "📱 Teléfono (Android)"). */
export function deviceLabel(): string {
  if (Platform.OS === 'ios') return '📱 Teléfono (iPhone)';
  if (Platform.OS === 'android') return '📱 Teléfono (Android)';
  if (Platform.OS === 'web') {
    try {
      const l = (navigator.userAgent || '').toLowerCase();
      const phone = isPhoneDevice();
      let os = 'Web';
      if (/android/.test(l)) os = 'Android';
      else if (/iphone|ipod/.test(l)) os = 'iPhone';
      else if (/ipad/.test(l) || (/macintosh/.test(l) && phone)) os = 'iPad';
      else if (/windows/.test(l)) os = 'Windows';
      else if (/macintosh|mac os/.test(l)) os = 'Mac';
      else if (/linux/.test(l)) os = 'Linux';
      return phone ? `📱 Teléfono (${os})` : `💻 PC (${os})`;
    } catch { return '💻 PC'; }
  }
  return '💻 PC';
}
