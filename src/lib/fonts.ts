// Fuente global del sistema: Tahoma en toda la app.
//
// En WEB (el objetivo desplegado en Vercel) inyectamos una regla CSS global.
// Es la forma segura: el intento anterior de "parchear" el render de Text con
// React.cloneElement rompía react-native-web ("Failed to set an indexed
// property [0] on 'CSSStyleDeclaration'") al pasar un arreglo de estilos a un
// nodo del DOM. Con CSS global evitamos por completo ese problema.
//
// En NATIVO usamos Text.defaultProps como mejor esfuerzo (no lanza error).
import { Platform, Text } from 'react-native';

export const FONT_FAMILY = 'Tahoma, Geneva, Verdana, sans-serif';

if (Platform.OS === 'web' && typeof document !== 'undefined') {
  const style = document.createElement('style');
  style.setAttribute('data-app-font', 'tahoma');
  // !important para ganarle a las clases atómicas de react-native-web.
  style.textContent = `* { font-family: ${FONT_FAMILY} !important; }`;
  document.head.appendChild(style);
} else {
  // Nativo: valor por defecto para los Text que no definan su propia familia.
  const T: any = Text as any;
  T.defaultProps = T.defaultProps || {};
  T.defaultProps.style = [{ fontFamily: FONT_FAMILY }, T.defaultProps.style].filter(Boolean);
}
