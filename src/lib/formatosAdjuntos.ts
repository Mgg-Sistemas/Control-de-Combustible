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
 * Extrae la lista completa de formatos adjuntos. Si el requerimiento tiene formatos
 * en el tag de observaciones, los retorna; de lo contrario, o como respaldo,
 * extrae el formato legado de attachment_url / attachment_name / attachment_type.
 */
export function extraerFormatosAdjuntos(
  r: {
    attachment_url?: string | null;
    attachment_type?: string | null;
    attachment_name?: string | null;
    observaciones?: string | null;
  } | null | undefined
): FormatoAdjunto[] {
  if (!r) return [];

  let lista: FormatoAdjunto[] = [];
  const obs = r.observaciones || '';

  // 1. Intentar extraer del tag estructurado
  const regex = new RegExp(`${escapeRegExp(TAG_FORMATOS_INICIO)}([\\s\\S]*?)${escapeRegExp(TAG_FORMATOS_FIN)}`);
  const match = obs.match(regex);
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

  // 2. Si hay attachment_url legado y no está en la lista, incluirlo al principio
  if (r.attachment_url && r.attachment_url.trim()) {
    const yaExiste = lista.some((it) => it.url === r.attachment_url);
    if (!yaExiste) {
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
