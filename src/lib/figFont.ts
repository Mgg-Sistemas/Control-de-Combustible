// CIFRAS EN MONO (rediseño) — IBM Plex Mono SOLO para números/códigos: litros,
// placas/seriales, horas y montos. El resto del texto sigue en Tahoma MAYÚSCULA
// (regla global del cliente en `./fonts`). Aquí NO se cambia el casing; solo la FAMILIA.
//
// En WEB la fuente la aplica una regla CSS por atributo `data-fig="mono"` (ver
// `./fonts`): un selector de atributo (especificidad 0,1,0) le gana al
// `* { font-family: Tahoma !important }` global (0,0,0), así la cifra sí sale en mono.
// En NATIVO fijamos la familia mono del sistema directamente en el estilo.
//
// Uso en un <Text> de cifra:  <Text {...figFont} style={[tuEstilo, figFontStyle]}>1.234</Text>
import { Platform } from 'react-native';

/** Familia monoespaciada del sistema para NATIVO (en web la pone el CSS de data-fig). */
const MONO_NATIVE = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }) as string;

/** Props a esparcir en el <Text> de la cifra (marca web / no-op en nativo). */
export const figFont: any = Platform.OS === 'web' ? { dataSet: { fig: 'mono' } } : {};

/** Estilo extra a añadir al final del array de estilos (familia mono en nativo). */
export const figFontStyle: any = Platform.OS === 'web' ? null : { fontFamily: MONO_NATIVE };
