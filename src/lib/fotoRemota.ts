// 📷 LAS FOTOS DE LOS PAPELES, LIGERAS (21-oct-2026).
//
// Reporte del cliente: «la ficha técnica en el catálogo no me sale, está
// lenta». Medido el mismo día contra el bucket real: de las 271 fotos de
// equipo, 24 pasan de 1,5 MB y la más grande pesa 6,1 MB — bajarla tarda
// 13 segundos, y la vista previa NO imprime hasta que las fotos estén (eso es
// deliberado: ver `esperarFotos` en pdf.ts). Resultado: el botón parecía
// muerto.
//
// LA SOLUCIÓN, SIN TOCAR LO QUE SE GUARDA: el papel pide la MISMA foto por el
// transformador de imágenes de Supabase Storage (`render/image`), que la sirve
// reducida al vuelo. La misma foto de 6,1 MB baja en 700 KB (3,8 s en vez de
// 13 s), y el original queda intacto en el bucket — esto es solo cómo se PIDE.
//
// ⭐ SIEMPRE CON RESPALDO: si el transformador no responde (no está disponible,
//    límite del plan, archivo raro), el `onerror` del <img> vuelve a la foto
//    original. La ficha nunca sale sin la foto por culpa de esta mejora.
//
// PURA (sin imports): se prueba sola en scripts/test-foto-remota.mjs.

/** Cómo se sirve un archivo público del Storage… */
export const RUTA_PUBLICA = '/storage/v1/object/public/';
/** …y cómo se le pide al transformador que lo achique. */
export const RUTA_RENDER = '/storage/v1/render/image/public/';

/** Lo que cabe bien en una hoja impresa sin arrastrar megas. */
export const ANCHO_PAPEL = 1100;
export const CALIDAD_PAPEL = 65;

/**
 * La MISMA foto, pedida reducida. Devuelve la URL tal cual si no es un archivo
 * público del Storage (una `data:`, una foto de otro servidor, un vacío): no se
 * inventa un enlace que no existe.
 */
export function fotoLigeraUrl(url: string | null | undefined, ancho = ANCHO_PAPEL, calidad = CALIDAD_PAPEL): string {
  const u = String(url ?? '').trim();
  if (!u || !u.includes(RUTA_PUBLICA)) return u;
  // Una URL ya transformada no se transforma dos veces.
  if (u.includes(RUTA_RENDER)) return u;
  const [base, query] = u.replace(RUTA_PUBLICA, RUTA_RENDER).split('?');
  const extra = `width=${Math.round(ancho)}&quality=${Math.round(calidad)}`;
  return query ? `${base}?${query}&${extra}` : `${base}?${extra}`;
}

const attr = (s: string) => String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * ⛔ SOLO ENLACES DE FOTO. Lo que entra viene de la base (`photo_url`,
 * `horometro_photo`…), y lo que sale se imprime como HTML: un valor con otro
 * esquema (`javascript:` y parientes) no tiene nada que hacer en un `src`.
 * Lo que no sea http/https/data:image se descarta — la ficha sale sin foto,
 * que es exactamente lo que pasa cuando no hay foto.
 */
export function urlDeFotoSegura(url: string | null | undefined): string {
  const u = String(url ?? '').trim();
  if (!u) return '';
  if (/^https?:\/\//i.test(u)) return u;
  if (/^data:image\//i.test(u)) return u;
  return '';
}

/**
 * El `<img>` de un papel: pide la foto ligera y, si esa falla, cae sola a la
 * original.
 *
 * ⭐ EL RESPALDO NO ARMA CÓDIGO CON LA URL (21-oct-2026): la original viaja en
 *    `data-orig` y el `onerror` es una línea FIJA que la lee de ahí. Si la URL
 *    se escribiera dentro del `onerror`, una comilla guardada en la base —aun
 *    escapada como entidad, porque el navegador la decodifica antes de
 *    ejecutar— cerraría la cadena y lo que siguiera correría como JavaScript
 *    en el documento que se imprime.
 */
export function imgPapel(url: string | null | undefined, extras = ''): string {
  const original = urlDeFotoSegura(url);
  if (!original) return '';
  const ligera = fotoLigeraUrl(original);
  const respaldo = ligera !== original
    ? ` data-orig="${attr(original)}" onerror="this.onerror=null;this.src=this.dataset.orig"`
    : '';
  return `<img src="${attr(ligera)}" alt=""${respaldo}${extras ? ` ${extras}` : ''}/>`;
}
