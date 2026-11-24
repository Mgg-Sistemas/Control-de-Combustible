// 💾 Persistencia de «📁 Informes subidos» (Combustible).
// El archivo va al bucket PÚBLICO 'machinery' en reportes-archivos/<año>/...
// y los metadatos a public.informes_archivos (RLS: lectura autenticada,
// inserción con escritura/full, anulación solo full). Solamente PC/web.

import { supabase } from './supabase';
import type { InformeArchivo } from '../types/database';
import { extensionDe, idCorto, rutaStorage } from './informesArchivos';

const COLS = 'id, titulo, file_name, storage_path, public_url, mime_type, size_bytes, uploaded_by, uploaded_by_name, created_at, anulado_at, anulado_por, anulado_por_nombre';

function mapRow(r: any): InformeArchivo {
  return {
    id: String(r.id),
    titulo: String(r.titulo ?? r.file_name ?? 'Informe').trim(),
    fileName: String(r.file_name ?? 'archivo'),
    storagePath: String(r.storage_path ?? ''),
    publicUrl: String(r.public_url ?? ''),
    mimeType: r.mime_type ?? null,
    sizeBytes: r.size_bytes == null ? null : Number(r.size_bytes),
    uploadedBy: r.uploaded_by ?? null,
    uploadedByNombre: r.uploaded_by_name ?? null,
    createdAt: String(r.created_at ?? new Date().toISOString()),
    anuladoAt: r.anulado_at ?? null,
    anuladoPor: r.anulado_por ?? null,
    anuladoPorNombre: r.anulado_por_nombre ?? null,
  };
}

/** Lista la bandeja, la más reciente primero. Con `incluirAnulados`, trae también anulados (solo full/admin en RLS). */
export async function listarInformesArchivos(opts?: { incluirAnulados?: boolean }): Promise<InformeArchivo[]> {
  try {
    let q = supabase
      .from('informes_archivos')
      .select(COLS);
    if (!opts?.incluirAnulados) q = q.is('anulado_at', null);
    const { data, error } = await q
      .order('created_at', { ascending: false })
      .limit(5000);
    if (error) throw error;
    return Array.isArray(data) ? data.map(mapRow) : [];
  } catch (e: any) {
    console.warn('No se pudo cargar la bandeja de informes:', e?.message ?? e);
    return [];
  }
}

export type ArchivoParaSubir = {
  name: string;
  type?: string | null;
  size?: number | null;
  /** File/Blob del <input type=file>; se pasa tal cual a Supabase Storage. */
  body: any;
};

/** Sube uno o varios archivos y registra su metadata. Si falla el registro,
 *  quita el archivo del Storage para no dejar huérfanos. */
export async function subirInformesArchivos(params: {
  archivos: ArchivoParaSubir[];
  tituloBase?: string | null;
  nombreSubida?: string | null;
}): Promise<{ ok: boolean; docs?: InformeArchivo[]; error?: string }> {
  const archivos = (params.archivos ?? []).filter((a) => a && a.body);
  if (archivos.length === 0) return { ok: false, error: 'No elegiste ningún archivo.' };

  let uid = '';
  try {
    const { data } = await supabase.auth.getUser();
    uid = String(data?.user?.id ?? '');
  } catch {}
  if (!uid) return { ok: false, error: 'No se pudo identificar tu sesión. Vuelve a entrar.' };

  const base = String(params.tituloBase ?? '').trim();
  const creados: InformeArchivo[] = [];

  for (let i = 0; i < archivos.length; i++) {
    const a = archivos[i];
    const nombre = String(a.name || `archivo_${i + 1}`).trim();
    const id = idCorto();
    const path = rutaStorage(nombre, id);
    const ext = extensionDe(nombre);
    const titulo = base
      ? (archivos.length > 1 ? `${base} (${i + 1})` : base)
      : nombre.replace(/\.[a-zA-Z0-9]{1,8}$/, '').trim() || 'Informe';

    const up = await supabase.storage.from('machinery').upload(path, a.body, {
      contentType: a.type || (ext === 'pdf' ? 'application/pdf' : 'application/octet-stream'),
      upsert: false,
    });
    if (up.error) {
      if (creados.length) await quitarPaths(creados.map((d) => d.storagePath));
      return { ok: false, error: `No se pudo subir «${nombre}»: ${up.error.message}` };
    }

    const { data: publicData } = supabase.storage.from('machinery').getPublicUrl(path);
    const { data, error } = await supabase
      .from('informes_archivos')
      .insert({
        titulo,
        file_name: nombre,
        storage_path: path,
        public_url: publicData.publicUrl,
        mime_type: a.type || null,
        size_bytes: a.size == null ? null : Number(a.size),
        uploaded_by: uid,
        uploaded_by_name: params.nombreSubida ?? null,
      })
      .select(COLS)
      .single();

    if (error || !data) {
      await supabase.storage.from('machinery').remove([path]);
      if (creados.length) await quitarPaths(creados.map((d) => d.storagePath));
      return { ok: false, error: error?.message ?? 'No se pudo registrar el archivo en la bandeja.' };
    }
    creados.push(mapRow(data));
  }

  return { ok: true, docs: creados };
}

async function quitarPaths(paths: string[]) {
  if (paths.length) await supabase.storage.from('machinery').remove(paths).catch(() => {});
}

/** Anula (no borra) una fila. Requiere nivel full/admin en la base y verifica con .select('id'). */
export async function anularInformeArchivo(id: string, nombreAccion?: string | null): Promise<{ ok: boolean; error?: string }> {
  try {
    let uid: string | null = null;
    try {
      const { data: authData } = await supabase.auth.getUser();
      uid = authData?.user?.id ?? null;
    } catch {}
    const { data, error } = await supabase
      .from('informes_archivos')
      .update({
        anulado_at: new Date().toISOString(),
        anulado_por: uid,
        anulado_por_nombre: nombreAccion ?? null,
      })
      .eq('id', id)
      .select('id');
    if (error) return { ok: false, error: error.message };
    if (!Array.isArray(data) || data.length === 0) {
      return { ok: false, error: 'No se pudo anular el informe (requiere permiso de Control total o Administrador).' };
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'Error de red al anular.' };
  }
}

/** Restaura un informe previamente anulado. Requiere nivel full/admin en la base. */
export async function restaurarInformeArchivo(id: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const { data, error } = await supabase
      .from('informes_archivos')
      .update({ anulado_at: null, anulado_por: null, anulado_por_nombre: null })
      .eq('id', id)
      .select('id');
    if (error) return { ok: false, error: error.message };
    if (!Array.isArray(data) || data.length === 0) {
      return { ok: false, error: 'No se pudo restaurar el informe (requiere permiso de Control total o Administrador).' };
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'Error de red al restaurar.' };
  }
}

/** Elimina definitivamente el registro (quedando rastro en audit_log) y quita el archivo de Storage. */
export async function eliminarInformeArchivo(id: string, storagePath?: string | null): Promise<{ ok: boolean; error?: string }> {
  try {
    const { data, error } = await supabase
      .from('informes_archivos')
      .delete()
      .eq('id', id)
      .select('id, storage_path');
    if (error) return { ok: false, error: error.message };
    if (!Array.isArray(data) || data.length === 0) {
      return { ok: false, error: 'No se pudo eliminar el informe (requiere permiso de Control total o Administrador).' };
    }
    const pathFinal = String(storagePath || data[0]?.storage_path || '').trim();
    if (pathFinal) {
      await supabase.storage.from('machinery').remove([pathFinal]).catch(() => {});
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'Error de red al eliminar.' };
  }
}
