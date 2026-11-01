import type { DirectPurchase } from '../types/database';

export interface FotoProductoData {
  url: string;
  name: string;
}

/**
 * Empaqueta la nota del usuario con la foto del producto comprado (defensivo sin requerir columnas nativas)
 */
export function empaquetarNotaConFotoProducto(
  notaUsuario?: string | null,
  foto?: FotoProductoData | null
): string | null {
  const limpio = limpiarNotaFotoProducto(notaUsuario);
  if (!foto || !foto.url) return limpio || null;
  const tag = `[FOTO PRODUCTO: Url: ${foto.url.trim()} | Nombre: ${(foto.name || 'Foto del producto').trim()}]`;
  return limpio ? `${limpio}\n${tag}` : tag;
}

/**
 * Limpia la nota para mostrar solo el texto escrito por el usuario sin etiquetas técnicas
 */
export function limpiarNotaFotoProducto(nota?: string | null): string {
  if (!nota) return '';
  return nota
    .replace(/\[FOTO PRODUCTO:[^\]]+\]/gi, '')
    .replace(/\[CONDICIONES_PAGO:[^\]]*\]/gi, '')
    .trim();
}

/**
 * Extrae la foto del producto desde la compra directa (desde columnas dedicadas, desde el primer item o desde notas)
 */
export function extraerFotoProducto(c: Partial<DirectPurchase> | null | undefined): FotoProductoData | null {
  if (!c) return null;

  // 1. Si viene como campo de primer nivel
  if (c.foto_producto_url) {
    return { url: c.foto_producto_url, name: c.foto_producto_name || 'Foto del producto' };
  }

  // 2. Si viene en el primer renglón de items (jsonb)
  if (Array.isArray(c.items) && c.items[0]?.image_url) {
    return { url: c.items[0].image_url, name: 'Foto del producto' };
  }

  // 3. Si viene empaquetado en la nota
  const nota = c.note || '';
  const match = nota.match(/\[FOTO PRODUCTO:\s*Url:\s*([^|]+)\|\s*Nombre:\s*([^\]]+)\]/i);
  if (match) {
    const url = match[1].trim();
    if (url && url !== 'null' && url !== 'undefined') {
      return { url, name: match[2].trim() || 'Foto del producto' };
    }
  }

  return null;
}
