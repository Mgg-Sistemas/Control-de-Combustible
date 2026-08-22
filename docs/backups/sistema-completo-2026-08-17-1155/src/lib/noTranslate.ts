// Evita que el navegador (Google Translate en Chrome móvil, etc.) TRADUZCA la
// página. La traducción automática reemplaza nodos de texto por su cuenta y luego
// React, al actualizar, intenta quitar un nodo que ya no existe → el error
// "removeChild: el nodo que se va a eliminar no es hijo de este nodo" (había que
// dar "Reintentar"). La app ya está en español, así que desactivar la traducción
// es seguro y elimina esos cierres inesperados.
import { Platform } from 'react-native';

if (Platform.OS === 'web' && typeof document !== 'undefined') {
  try {
    const html = document.documentElement;
    if (html) {
      html.setAttribute('lang', 'es');
      html.setAttribute('translate', 'no');
      html.classList.add('notranslate');
    }
    if (document.head && !document.head.querySelector('meta[name="google"][content="notranslate"]')) {
      const meta = document.createElement('meta');
      meta.setAttribute('name', 'google');
      meta.setAttribute('content', 'notranslate');
      document.head.appendChild(meta);
    }
  } catch {
    // si algo falla, no es crítico
  }
}
