import { useFonts } from 'expo-font';
import { Barlow_400Regular, Barlow_600SemiBold } from '@expo-google-fonts/barlow';
import { BarlowCondensed_700Bold, BarlowCondensed_800ExtraBold } from '@expo-google-fonts/barlow-condensed';
import { IBMPlexMono_500Medium, IBMPlexMono_600SemiBold } from '@expo-google-fonts/ibm-plex-mono';

/**
 * Tipografía de marca del rediseño (SHOWCASE). Se carga bajo demanda con `useFonts`
 * dentro de la pantalla que la usa, así NO hay que tocar App.tsx: si esa pantalla no
 * se abre, las fuentes ni se cargan. `family` da los nombres para `fontFamily`.
 *
 * - display  → Barlow Condensed (títulos con carácter)
 * - body     → Barlow (texto limpio)
 * - mono     → IBM Plex Mono (cifras: litros, %, horas, montos)
 */
export const family = {
  display: 'BarlowCondensed_800ExtraBold',
  displayBold: 'BarlowCondensed_700Bold',
  body: 'Barlow_400Regular',
  bodySemi: 'Barlow_600SemiBold',
  mono: 'IBMPlexMono_500Medium',
  monoSemi: 'IBMPlexMono_600SemiBold',
} as const;

/** Carga las fuentes de marca. Devuelve true cuando ya están listas para usarse. */
export function useBrandFonts(): boolean {
  const [loaded] = useFonts({
    Barlow_400Regular,
    Barlow_600SemiBold,
    BarlowCondensed_700Bold,
    BarlowCondensed_800ExtraBold,
    IBMPlexMono_500Medium,
    IBMPlexMono_600SemiBold,
  });
  return loaded;
}
