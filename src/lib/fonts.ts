// Fuente global del sistema: Tahoma en toda la app + TODO EN MAYÚSCULA.
//
// En WEB (el objetivo desplegado en Vercel) inyectamos una regla CSS global.
// Es la forma segura: el intento anterior de "parchear" el render de Text con
// React.cloneElement rompía react-native-web ("Failed to set an indexed
// property [0] on 'CSSStyleDeclaration'") al pasar un arreglo de estilos a un
// nodo del DOM. Con CSS global evitamos por completo ese problema.
//
// MAYÚSCULA: todo el texto de la UI se muestra en mayúscula, MENOS lo que se
// escribe en campos (input/textarea) — así la CONTRASEÑA y lo tecleado nunca se
// alteran (text-transform es solo visual, pero en un campo confundiría). Los
// placeholders sí se ven en mayúscula.
//
// En NATIVO usamos Text.defaultProps como mejor esfuerzo (no lanza error);
// TextInput es otro componente, por eso las contraseñas no se ven afectadas.
import { Platform, Text } from 'react-native';

export const FONT_FAMILY = 'Tahoma, Geneva, Verdana, sans-serif';

if (Platform.OS === 'web' && typeof document !== 'undefined') {
  const style = document.createElement('style');
  style.setAttribute('data-app-font', 'tahoma');
  // !important para ganarle a las clases atómicas de react-native-web.
  style.textContent =
    `* { font-family: ${FONT_FAMILY} !important; text-transform: uppercase !important; }` +
    // Al ESCRIBIR también se ve en MAYÚSCULA (input/textarea), como pidió el cliente.
    ` input, textarea { text-transform: uppercase !important; }` +
    // EXCEPCIÓN: las CONTRASEÑAS nunca se transforman (deben respetar mayús/minús).
    ` input[type="password"] { text-transform: none !important; }` +
    ` input::placeholder, textarea::placeholder { text-transform: uppercase; }`;
  document.head.appendChild(style);
} else {
  // Nativo: valor por defecto para los Text que no definan su propia familia.
  const T: any = Text as any;
  T.defaultProps = T.defaultProps || {};
  T.defaultProps.style = [{ fontFamily: FONT_FAMILY, textTransform: 'uppercase' }, T.defaultProps.style].filter(Boolean);
}
