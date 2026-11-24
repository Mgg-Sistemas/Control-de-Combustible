// 📁 Informes subidos (Combustible) — lógica PURA, sin React ni Supabase.
// 24-nov-2026. Sirve para buscar/archivar archivos subidos desde la PC.
// La fecha de subida es SIEMPRE día calendario de Caracas, no jornada 7am→7am.

import type { InformeArchivo } from '../types/database';
import { norm } from './text';

export type FiltroInformes = {
  /** Busca en título, nombre real del archivo y usuario que lo subió. */
  query?: string;
  /** ISO AAAA-MM-DD inclusive. */
  desde?: string;
  /** ISO AAAA-MM-DD inclusive. */
  hasta?: string;
  /** id del usuario que subió; '' o null = todos. */
  uploadedBy?: string | null;
  /** Si es true, muestra también los informes anulados (solo para control total / admin). */
  incluirAnulados?: boolean;
};

/** "AAAA-MM-DD" en America/Caracas de un instante ISO cualquiera. */
export function diaCaracas(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Caracas',
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(d);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
    return `${get('year')}-${get('month')}-${get('day')}`;
  } catch {
    // en-CA siempre existe; si el motor no lo tuviera, cae a UTC controlado.
    return d.toISOString().slice(0, 10);
  }
}

/** Filtra en memoria la bandeja ya cargada. OR dentro del texto, AND entre filtros. */
export function filtrarInformes(filas: InformeArchivo[], f: FiltroInformes): InformeArchivo[] {
  const q = norm(f.query ?? '').trim();
  const desde = (f.desde ?? '').trim();
  const hasta = (f.hasta ?? '').trim();
  const who = (f.uploadedBy ?? '').trim();
  const verAnulados = f.incluirAnulados === true;
  return filas.filter((r) => {
    // Por defecto la bandeja nunca muestra anulados, salvo que quien tiene control total active «Ver anulados».
    if (!verAnulados && r.anuladoAt) return false;
    const dia = diaCaracas(r.createdAt);
    if (desde && (!dia || dia < desde)) return false;
    if (hasta && (!dia || dia > hasta)) return false;
    if (who && r.uploadedBy !== who) return false;
    if (q && !norm(`${r.titulo} ${r.fileName} ${r.uploadedByNombre ?? ''}`).includes(q)) return false;
    return true;
  });
}

/** Opciones del filtro «subido por», deduplicadas y ordenadas por nombre. */
export function uploadersDe(filas: InformeArchivo[]): { id: string; nombre: string }[] {
  const m = new Map<string, string>();
  for (const r of filas) {
    if (!r.uploadedBy) continue;
    const nombre = (r.uploadedByNombre ?? '').trim() || 'Sin nombre';
    if (!m.has(r.uploadedBy) || nombre.localeCompare(m.get(r.uploadedBy) ?? '', 'es')) m.set(r.uploadedBy, nombre);
  }
  return Array.from(m, ([id, nombre]) => ({ id, nombre }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }));
}

/** Tamaño legible para la lista. */
export function tamanoLegible(bytes: number | null | undefined): string {
  const n = Number(bytes ?? 0);
  if (!Number.isFinite(n) || n <= 0) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}

/** Fecha y hora de subida en es-VE, zona Caracas. */
export function fechaLegible(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  try {
    return d.toLocaleString('es-VE', {
      timeZone: 'America/Caracas', day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: true,
    });
  } catch {
    return iso;
  }
}

/** Nombre seguro para la ruta del Storage (sin tildes ni caracteres raros). */
export function slugArchivo(nombre: string): string {
  const base = String(nombre ?? '').trim().split(/[\\/]/).pop() || 'archivo';
  const limpio = base.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase();
  return limpio || 'archivo';
}

/** Extensión del nombre original, en minúsculas y sin punto. */
export function extensionDe(nombre: string): string {
  const m = /\.([a-zA-Z0-9]{1,8})$/.exec(String(nombre ?? '').trim());
  return m ? m[1].toLowerCase() : '';
}

/** URL que fuerza la descarga con el nombre original en Supabase Storage. */
export function urlDescarga(url: string, nombre: string): string {
  const clean = String(url ?? '').trim();
  if (!clean) return '';
  if (/[?&]download=/i.test(clean)) return clean;
  const sep = clean.includes('?') ? '&' : '?';
  return `${clean}${sep}download=${encodeURIComponent(String(nombre ?? 'archivo'))}`;
}

/** Identificador corto para la ruta, sin depender de crypto.randomUUID. */
export function idCorto(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/** Ruta dentro del bucket 'machinery'. */
export function rutaStorage(nombre: string, id: string): string {
  const anio = diaCaracas(new Date().toISOString()).slice(0, 4) || '2026';
  return `reportes-archivos/${anio}/${id}_${slugArchivo(nombre)}`;
}
