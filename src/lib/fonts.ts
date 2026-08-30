// Fuente global del sistema: Tahoma en toda la app + TODO EN MAYÚSCULA.
//
// En WEB (el objetivo desplegado en Vercel) inyectamos una regla CSS global.
// Es la forma segura: el intento anterior de "parchear" el render de Text con
// React.cloneElement rompía react-native-web ("Failed to set an indexed
// property [0] on 'CSSStyleDeclaration'") al pasar un arreglo de estilos a un
// nodo del DOM. Con CSS global evitamos por completo ese problema.
//
// MAYÚSCULA: todo el texto de la UI se muestra en mayúscula, **incluido lo que
// se escribe en los campos** (input/textarea) y los placeholders. Lo pidió el
// cliente y así sigue: de los 441 campos de la app, 436 se ven en mayúscula.
//
// La ÚNICA excepción son los 5 campos de CONTRASEÑA, que deben respetar
// mayúsculas y minúsculas (ver la regla [data-pass] más abajo y `passField`).
//
// ⚠️ Este párrafo decía antes que los campos NO se transformaban. Era verdad
//    hasta el 2-ago-2026, cuando se invirtió la regla; el comentario se quedó
//    atrás y contribuyó a que el bug de las contraseñas tardara en verse.
//
// En NATIVO usamos Text.defaultProps como mejor esfuerzo (no lanza error);
// TextInput es otro componente, así que en el teléfono nada de esto lo alcanza.
//
// ⚠️ EN LA WEB SÍ LO ALCANZA. Aquí `TextInput` se renderiza como un <input> de
//    verdad, y por eso hizo falta la excepción [data-pass] de más abajo. El
//    comentario que antes decía que "las contraseñas no se ven afectadas" era
//    cierto en nativo y falso en la web, que es donde estaba el bug.
import { Platform, Text } from 'react-native';

export const FONT_FAMILY = 'Tahoma, Geneva, Verdana, sans-serif';

/**
 * Props a esparcir en TODO campo de CONTRASEÑA:  <TextInput {...passField} … />
 *
 * Marca el <input> con `data-pass` para que la regla CSS de abajo lo deje en paz
 * aunque el usuario pulse el 👁 y deje de ser type="password". En nativo no hace
 * nada, porque allí no hay CSS que estorbe.
 *
 * Mismo patrón que `figFont` en ./figFont — va tipado `any` porque `dataSet` es
 * una extensión de react-native-web que no está en los tipos de React Native.
 */
export const passField: any = Platform.OS === 'web' ? { dataSet: { pass: '1' } } : {};

if (Platform.OS === 'web' && typeof document !== 'undefined') {
  const style = document.createElement('style');
  style.setAttribute('data-app-font', 'tahoma');
  // !important para ganarle a las clases atómicas de react-native-web.
  style.textContent =
    `* { font-family: ${FONT_FAMILY} !important; text-transform: uppercase !important; }` +
    // Al ESCRIBIR también se ve en MAYÚSCULA (input/textarea), como pidió el cliente.
    ` input, textarea { text-transform: uppercase !important; }` +
    // EXCEPCIÓN: las CONTRASEÑAS nunca se transforman (deben respetar mayús/minús).
    //
    // ⭐⭐ EL `[data-pass]` NO ES UN ADORNO — ARREGLA EL BUG DE LOGIN DEL 27-ago-2026.
    //
    //    `input[type="password"]` SOLO alcanza mientras la contraseña está oculta.
    //    Todos los campos de clave de la app tienen un ojito 👁 para revelarla, y
    //    react-native-web implementa eso cambiando el input a type="text". En ese
    //    instante esta excepción deja de aplicar, la regla de arriba lo pinta EN
    //    MAYÚSCULA... y el valor que se envía sigue en minúscula, porque
    //    text-transform es puramente visual y jamás toca `input.value`.
    //
    //    Consecuencia real: el administrador creaba la clave "Sos2026", pulsaba el
    //    ojo para leerla, la pantalla le mostraba "SOS2026", y eso era lo que
    //    dictaba. El trabajador tecleaba SOS2026 contra el hash de Sos2026 y el
    //    sistema le decía "contraseña incorrecta". Parecía intermitente porque
    //    solo fallaba si alguien revelaba la clave Y la clave tenía minúsculas;
    //    restablecerla lo "arreglaba" porque volvía a alinear el par.
    //
    //    Por eso cada campo de contraseña se marca con dataSet={{ pass: '1' }},
    //    que react-native-web emite como data-pass y sobrevive al cambio de type.
    //    Hay una prueba que exige la marca en TODO campo con secureTextEntry:
    //    scripts/test-password-mayusculas.mjs
    ` input[type="password"], input[data-pass] { text-transform: none !important; }` +
    ` input::placeholder, textarea::placeholder { text-transform: uppercase; }`;
  document.head.appendChild(style);

  // REDISEÑO: IBM Plex Mono SOLO para CIFRAS (litros, placas/seriales, horas, montos).
  // Cada <Text> de cifra se marca con data-fig="mono" (ver src/lib/figFont.ts). El
  // selector de atributo [data-fig="mono"] (especificidad 0,1,0) le gana al
  // `* { font-family: Tahoma !important }` de arriba (0,0,0), así la cifra sale en mono
  // aunque el resto del texto siga en Tahoma MAYÚSCULA. NO se toca el casing.
  const monoLink = document.createElement('link');
  monoLink.rel = 'stylesheet';
  monoLink.href = 'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600;700&display=swap';
  document.head.appendChild(monoLink);
  const figStyle = document.createElement('style');
  figStyle.setAttribute('data-app-font', 'fig-mono');
  figStyle.textContent =
    `[data-fig="mono"], [data-fig="mono"] * {` +
    ` font-family: 'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace !important;` +
    ` font-variant-numeric: tabular-nums; }`;
  document.head.appendChild(figStyle);
} else {
  // Nativo: valor por defecto para los Text que no definan su propia familia.
  const T: any = Text as any;
  T.defaultProps = T.defaultProps || {};
  T.defaultProps.style = [{ fontFamily: FONT_FAMILY, textTransform: 'uppercase' }, T.defaultProps.style].filter(Boolean);
}
