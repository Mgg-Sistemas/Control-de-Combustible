// 💳 Gestión de Datos de Pago y Capturas de Pantalla de Proveedores (TRX / Tron / QR / Bancos)
// Permite guardar y recuperar de forma 100% segura y compatible capturas de wallets cripto,
// códigos QR o transferencias sin depender de migraciones de base de datos.

export interface CapturaPagoInfo {
  url: string;
  name?: string | null;
}

const TAG_REGEX = /\[CAPTURA_PAGO:\s*(\{.*?\}|https?:\/\/[^\s\]]+)\]/is;

/**
 * Extrae la captura de pago de un proveedor (revisando payment_photo_url primero y payment_notes después).
 */
export function extraerCapturaPago(supplier?: {
  payment_photo_url?: string | null;
  payment_photo_name?: string | null;
  payment_notes?: string | null;
} | null): CapturaPagoInfo | null {
  if (!supplier) return null;

  // 1. Si existe columna explícita con valor
  if (supplier.payment_photo_url && supplier.payment_photo_url.trim()) {
    return {
      url: supplier.payment_photo_url.trim(),
      name: supplier.payment_photo_name?.trim() || null,
    };
  }

  // 2. Extraer de payment_notes si viene serializado
  const notes = supplier.payment_notes;
  if (!notes) return null;

  const match = notes.match(TAG_REGEX);
  if (!match || !match[1]) return null;

  const raw = match[1].trim();
  if (raw.startsWith('{') && raw.endsWith('}')) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed.url) {
        return {
          url: parsed.url,
          name: parsed.name || parsed.nombre || null,
        };
      }
    } catch {
      // Ignorar error de parseo y caer al fallback
    }
  }

  return {
    url: raw,
    name: null,
  };
}

/**
 * Limpia el texto de notas de pago para que el usuario no vea la etiqueta técnica [CAPTURA_PAGO: ...]
 */
export function limpiarNotasUsuario(paymentNotes?: string | null): string {
  if (!paymentNotes) return '';
  return paymentNotes.replace(/\[CAPTURA_PAGO:.*?\]/gis, '').trim();
}

/**
 * Empaqueta las notas ingresadas por el usuario con la captura de pago para persistencia en Supabase.
 */
export function empaquetarNotasConCaptura(
  notasUsuario?: string | null,
  capturaUrl?: string | null,
  capturaNombre?: string | null
): string | null {
  const clean = limpiarNotasUsuario(notasUsuario);
  if (!capturaUrl || !capturaUrl.trim()) {
    return clean || null;
  }

  const payload: CapturaPagoInfo = {
    url: capturaUrl.trim(),
    name: capturaNombre?.trim() || null,
  };

  const tag = `[CAPTURA_PAGO: ${JSON.stringify(payload)}]`;
  return clean ? `${clean}\n\n${tag}` : tag;
}
