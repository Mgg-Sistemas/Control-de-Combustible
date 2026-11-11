// ── Módulo de Formatos y Soportes Múltiples (Adjuntos) ────────────────────────
// Permite adjuntar dos o más archivos (imágenes o PDFs: cotizaciones de proveedores,
// fotos de repuestos dañados, planillas técnicas, etc.) a un requerimiento de compra.
// Garantiza 100% de compatibilidad hacia atrás con las columnas históricas
// (attachment_url, attachment_type, attachment_name) sin requerir migraciones SQL destructivas.

export interface FormatoAdjunto {
  id: string;
  url: string;
  kind: 'image' | 'pdf';
  name: string;
  sizeBytes?: number;
  uploadedAt?: string;
}

export const TAG_FORMATOS_INICIO = '[[FORMATOS_ADJUNTOS:';
export const TAG_FORMATOS_FIN = ':FIN_FORMATOS]]';

function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Empaqueta la lista de formatos adjuntos dentro de las observaciones de manera estructurada.
 */
export function empaquetarFormatosEnObservaciones(
  observaciones: string | null | undefined,
  formatos: FormatoAdjunto[]
): string {
  const base = limpiarObservacionesFormatos(observaciones);
  if (!formatos || formatos.length === 0) return base;
  const payload = JSON.stringify(formatos);
  const bloque = `${TAG_FORMATOS_INICIO}${payload}${TAG_FORMATOS_FIN}`;
  return base ? `${base}\n\n${bloque}` : bloque;
}

/**
 * Limpia el texto de observaciones para que las etiquetas técnicas de formatos
 * nunca sean visibles para el usuario ni salgan impresas en documentos.
 */
export function limpiarObservacionesFormatos(observaciones: string | null | undefined): string {
  if (!observaciones) return '';
  const regex = new RegExp(`\\s*${escapeRegExp(TAG_FORMATOS_INICIO)}[\\s\\S]*?${escapeRegExp(TAG_FORMATOS_FIN)}\\s*`, 'g');
  return observaciones.replace(regex, '').trim();
}

/**
 * Extrae la lista completa de formatos adjuntos. Soporta:
 * 1. Campo `presupuesto_files` (array de FormatoAdjunto en cuentas)
 * 2. Tag estructurado [[FORMATOS_ADJUNTOS:...:FIN_FORMATOS]] en `observaciones` o `nota`
 * 3. Campos legados `attachment_url` / `attachment_name` / `attachment_type`.
 */
export function extraerFormatosAdjuntos(
  r: {
    attachment_url?: string | null;
    attachment_type?: string | null;
    attachment_name?: string | null;
    observaciones?: string | null;
    nota?: string | null;
    presupuesto_files?: FormatoAdjunto[] | null;
  } | null | undefined
): FormatoAdjunto[] {
  if (!r) return [];

  let lista: FormatoAdjunto[] = [];

  // 1. Si ya viene el array de archivos directamente (columna JSONB)
  if (Array.isArray(r.presupuesto_files) && r.presupuesto_files.length > 0) {
    lista = r.presupuesto_files.filter((it) => it && typeof it.url === 'string' && it.url.trim());
  }

  // 2. Intentar extraer del tag estructurado en observaciones o nota
  if (lista.length === 0) {
    const texto = r.observaciones || r.nota || '';
    const regex = new RegExp(`${escapeRegExp(TAG_FORMATOS_INICIO)}([\\s\\S]*?)${escapeRegExp(TAG_FORMATOS_FIN)}`);
    const match = texto.match(regex);
    if (match && match[1]) {
      try {
        const parsed = JSON.parse(match[1]);
        if (Array.isArray(parsed)) {
          lista = parsed.filter((it) => it && typeof it.url === 'string' && it.url.trim());
        }
      } catch {
        lista = [];
      }
    }
  }

  // 3. Si hay attachment_url legado y no está en la lista, incluirlo al principio
  //    (excepto cuando attachment_url fue ocupado por una factura o recibo de pago).
  if (r.attachment_url && r.attachment_url.trim()) {
    const attUrl = r.attachment_url.trim();
    const textoObs = String(r.observaciones || r.nota || '');
    const mFac = textoObs.match(/\[FACTURA PROVEEDOR:[^\]]+\]/i)?.[0] || '';
    const mRec = textoObs.match(/\[RECIBO PAGO:[^\]]+\]/i)?.[0] || '';
    const esSoporteFiscalOPago =
      (mFac && (mFac.includes(attUrl) || mFac.includes(encodeURIComponent(attUrl)))) ||
      (mRec && (mRec.includes(attUrl) || mRec.includes(encodeURIComponent(attUrl))));
    const yaExiste = lista.some((it) => it.url === r.attachment_url);
    if (!yaExiste && !esSoporteFiscalOPago) {
      const esPdf = r.attachment_type === 'pdf' || /\.pdf$/i.test(r.attachment_url) || /\.pdf$/i.test(r.attachment_name || '');
      lista.unshift({
        id: 'adj-legacy-0',
        url: r.attachment_url,
        kind: esPdf ? 'pdf' : 'image',
        name: r.attachment_name || (esPdf ? 'Documento cotización (PDF)' : 'Foto o formato adjunto'),
      });
    }
  }

  return lista;
}

/**
 * Resuelve la URL de la foto de referencia de un renglón de requerimiento o solicitud.
 * 1) Si el ítem tiene su propio `image_url`, devuelve esa URL.
 * 2) Si el requerimiento tiene un único renglón (`items.length === 1`), el ítem no tiene `image_url`,
 *    y `attachment_url` es una imagen de muestra (no PDF ni factura/comprobante de pago),
 *    devuelve `attachment_url` (solicitudes de 1 ítem donde la foto quedó en `attachment_url`).
 */
export function resolverFotoReferenciaItem(
  item: { image_url?: string | null } | null | undefined,
  req?: {
    items?: Array<{ image_url?: string | null }> | null;
    attachment_url?: string | null;
    attachment_type?: string | null;
    attachment_name?: string | null;
    observaciones?: string | null;
    nota?: string | null;
  } | null
): string | null {
  const propia = typeof item?.image_url === 'string' ? item.image_url.trim() : '';
  if (propia) return propia;

  if (!req || !Array.isArray(req.items) || req.items.length !== 1) return null;
  const attUrl = typeof req.attachment_url === 'string' ? req.attachment_url.trim() : '';
  if (!attUrl) return null;

  const esPdf =
    req.attachment_type === 'pdf' ||
    /\.pdf(\?|$)/i.test(attUrl) ||
    /\.pdf$/i.test(req.attachment_name || '');
  if (esPdf) return null;

  const textoObs = String(req.observaciones || req.nota || '');
  const mFac = textoObs.match(/\[FACTURA PROVEEDOR:[^\]]+\]/i)?.[0] || '';
  const mRec = textoObs.match(/\[RECIBO PAGO:[^\]]+\]/i)?.[0] || '';
  const esSoporteFiscalOPago =
    (mFac && (mFac.includes(attUrl) || mFac.includes(encodeURIComponent(attUrl)))) ||
    (mRec && (mRec.includes(attUrl) || mRec.includes(encodeURIComponent(attUrl))));
  if (esSoporteFiscalOPago) return null;

  const esImagen =
    req.attachment_type === 'image' ||
    /\.(jpe?g|png|webp|gif|heic|bmp)(\?|$)/i.test(attUrl);
  return esImagen ? attUrl : null;
}

/**
 * Construye un nombre de archivo limpio para descargar una foto de referencia o soporte.
 */
export function construirNombreDescargaFoto(
  nombreItem?: string | null,
  url?: string | null,
  codigoReq?: string | null
): string {
  const cleanUrl = typeof url === 'string' ? url.split('?')[0].split('#')[0] : '';
  const mExt = cleanUrl.match(/\.(jpe?g|png|webp|gif|pdf|heic|bmp)$/i);
  const ext = mExt ? `.${mExt[1].toLowerCase()}` : '.jpg';

  const limpiar = (s?: string | null) =>
    String(s || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/^(📷|🧾|📎|🖼️|🔍)\s*/g, '')
      .replace(/[^\w\d\-]+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 50);

  const cod = limpiar(codigoReq);
  const sinExt = String(nombreItem || '').replace(/\.(jpe?g|png|webp|gif|pdf|heic|bmp)$/i, '');
  const base = limpiar(sinExt);
  const combinado = [cod, base].filter(Boolean).join('_') || 'foto_referencia';
  return `${combinado}${ext}`;
}

/**
 * Genera una URL con parámetro `?download=<nombre>` para Supabase Storage,
 * lo que fuerza la cabecera `Content-Disposition: attachment` en el navegador.
 */
export function construirUrlDescargaDirecta(
  url: string | null | undefined,
  nombreArchivo?: string | null
): string {
  const clean = typeof url === 'string' ? url.trim() : '';
  if (!clean) return '';
  const filename = construirNombreDescargaFoto(nombreArchivo, clean);
  if (/\/storage\/v1\/object\/public\//i.test(clean) && !/[?&]download=/i.test(clean)) {
    const sep = clean.includes('?') ? '&' : '?';
    return `${clean}${sep}download=${encodeURIComponent(filename)}`;
  }
  return clean;
}


