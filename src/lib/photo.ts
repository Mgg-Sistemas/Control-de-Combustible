import { Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { supabase } from './supabase';
import { cropImageWeb } from '../components/PhotoCropper';

// Decodifica base64 a bytes (sin depender de atob/Buffer, sirve en web y nativo).
const CH = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function decodeB64(b64: string): Uint8Array {
  const str = b64.replace(/=+$/, '');
  const bytes = new Uint8Array((str.length * 3) >> 2);
  let p = 0,
    buffer = 0,
    bits = 0;
  for (let i = 0; i < str.length; i++) {
    buffer = (buffer << 6) | CH.indexOf(str[i]);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[p++] = (buffer >> bits) & 0xff;
    }
  }
  return bytes;
}

// Calidad de compresión: baja para que la subida sea RÁPIDA (las fotos de máquina
// y horómetro no necesitan alta resolución).
const PICK_QUALITY = 0.35;

// Resultado "cancelado" uniforme (sirve para web y nativo).
const CANCELED = { canceled: true, assets: null } as unknown as ImagePicker.ImagePickerResult;

/**
 * En WEB, expo-image-picker NO resuelve la promesa cuando el usuario CANCELA el
 * selector de archivos (no hay evento de cancelación en <input type=file>), así que
 * el `await` se cuelga y el botón se queda en "Subiendo…" para siempre.
 * Este wrapper detecta el cierre del diálogo por el `focus` de la ventana: si se
 * eligió archivo, la promesa real resuelve enseguida; si se canceló, nunca resuelve,
 * así que tras un pequeño margen lo damos por cancelado y liberamos el botón.
 * En nativo devuelve la promesa tal cual (allí sí resuelve al cancelar).
 */
async function pick(
  launch: () => Promise<ImagePicker.ImagePickerResult>
): Promise<ImagePicker.ImagePickerResult> {
  const real = launch();
  if (Platform.OS !== 'web') return real;
  return await new Promise<ImagePicker.ImagePickerResult>((resolve) => {
    let settled = false;
    const finish = (r: ImagePicker.ImagePickerResult) => {
      if (settled) return;
      settled = true;
      window.removeEventListener('focus', onFocus);
      resolve(r);
    };
    // La ventana recupera el foco cuando el diálogo se cierra (elija o cancele).
    const onFocus = () => setTimeout(() => finish(CANCELED), 1500);
    window.addEventListener('focus', onFocus);
    real.then(finish).catch(() => finish(CANCELED));
  });
}

/**
 * (WEB) Redimensiona/recomprime una imagen con canvas ANTES de subirla. Una foto de
 * cámara de teléfono trae miles de px (varios MB) aunque se baje la calidad; subir eso
 * por datos móviles es lo que tarda. Bajarla a máx `maxDim` px de lado + JPEG deja el
 * archivo en ~100-300 KB → la subida es mucho más rápida. Sin dependencias nativas
 * (el teléfono usa la app web). Si algo falla, devuelve null y se cae al blob original.
 */
async function resizeImageWeb(uri: string, maxDim = 1600, quality = 0.5): Promise<Blob | null> {
  try {
    const d: any = (globalThis as any).document;
    if (!d) return null;
    const img: any = await new Promise((resolve, reject) => {
      const im = new (globalThis as any).Image();
      im.onload = () => resolve(im);
      im.onerror = reject;
      im.src = uri;
    });
    const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
    if (!w || !h) return null;
    const scale = Math.min(1, maxDim / Math.max(w, h));
    // Si ya es pequeña (scale=1) igual la recomprimimos a JPEG (baja el peso de PNG/HEIC).
    const cw = Math.max(1, Math.round(w * scale)), ch = Math.max(1, Math.round(h * scale));
    const canvas: any = d.createElement('canvas');
    canvas.width = cw; canvas.height = ch;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, cw, ch);
    const blob: Blob | null = await new Promise((resolve) => canvas.toBlob((b: any) => resolve(b), 'image/jpeg', quality));
    return blob && blob.size > 0 ? blob : null;
  } catch { return null; }
}

/**
 * (NATIVO) Redimensiona/recomprime con expo-image-manipulator ANTES de subir
 * (auditoría frontend#4). Antes el nativo subía la foto TAL CUAL (varios MB de la
 * cámara) → subida lentísima por datos móviles en campo. Ahora se baja a máx
 * `maxDim` px de lado + JPEG (~100-300 KB). Usa las dimensiones que ya trae el
 * asset para NO agrandar imágenes pequeñas (solo recomprime). Si algo falla,
 * devuelve null y el llamador cae al camino anterior (base64/fetch).
 */
async function resizeImageNative(
  uri: string, srcW?: number, srcH?: number, maxDim = 1600, quality = 0.5
): Promise<Uint8Array | null> {
  try {
    const longest = Math.max(srcW ?? 0, srcH ?? 0);
    const actions = longest > maxDim
      ? [{ resize: (srcW ?? 0) >= (srcH ?? 0) ? { width: maxDim } : { height: maxDim } }]
      : []; // ya es pequeña: solo recomprimir a JPEG (baja peso de PNG/HEIC)
    const out = await manipulateAsync(uri, actions, { compress: quality, format: SaveFormat.JPEG, base64: true });
    if (out?.base64) return decodeB64(out.base64);
    if (out?.uri) {
      const resp = await fetch(out.uri);
      const blob = await resp.blob();
      if (blob && blob.size > 0) return new Uint8Array(await blob.arrayBuffer());
    }
    return null;
  } catch { return null; }
}

/** Convierte el asset elegido en el cuerpo a subir. En WEB redimensiona con canvas
 *  y en NATIVO con expo-image-manipulator (rápido, archivo liviano); ambos caen al
 *  blob/base64 directo si el resize falla. */
async function assetToBody(asset: any): Promise<Blob | Uint8Array | null> {
  if (Platform.OS === 'web' && asset?.uri) {
    const resized = await resizeImageWeb(asset.uri);
    if (resized) return resized;
    try {
      const resp = await fetch(asset.uri);
      const blob = await resp.blob();
      if (blob && blob.size > 0) return blob;
    } catch {}
  }
  if (Platform.OS !== 'web' && asset?.uri) {
    const resized = await resizeImageNative(asset.uri, asset.width, asset.height);
    if (resized) return resized;
  }
  if (asset?.base64) return decodeB64(asset.base64);
  if (asset?.uri) {
    try {
      const resp = await fetch(asset.uri);
      const blob = await resp.blob();
      if (blob && blob.size > 0) return blob;
    } catch {}
  }
  return null;
}

/** Sube el cuerpo (blob/bytes) al bucket 'machinery' y devuelve la URL pública. */
async function uploadToMachinery(path: string, body: Blob | Uint8Array): Promise<{ ok: boolean; url?: string; error?: string }> {
  const up = await supabase.storage.from('machinery').upload(path, body as any, { contentType: 'image/jpeg', upsert: true });
  if (up.error) return { ok: false, error: up.error.message };
  const { data } = supabase.storage.from('machinery').getPublicUrl(path);
  return { ok: true, url: data.publicUrl };
}

/**
 * Toma/selecciona una foto (p. ej. del horómetro) y la sube al bucket 'machinery'
 * en una subcarpeta, devolviendo la URL pública. NO modifica la máquina.
 * Intenta abrir la cámara; si no hay permiso/soporte, cae a la galería.
 */
export async function captureAndUploadPhoto(
  machineryId: string,
  folder = 'horometro'
): Promise<{ ok: boolean; url?: string; error?: string }> {
  const webBase64 = Platform.OS !== 'web';
  let res: ImagePicker.ImagePickerResult | null = null;
  try {
    const cam = await ImagePicker.requestCameraPermissionsAsync();
    if (cam.granted) {
      res = await pick(() => ImagePicker.launchCameraAsync({ quality: PICK_QUALITY, base64: webBase64 }));
    }
  } catch {
    res = null;
  }
  // Sin cámara disponible o permiso denegado → galería / selector de archivo.
  if (!res || res.canceled || !res.assets?.[0]) {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return { ok: false, error: 'Permiso de cámara/galería denegado.' };
    res = await pick(() => ImagePicker.launchImageLibraryAsync({ quality: PICK_QUALITY, base64: webBase64 }));
  }
  if (!res || res.canceled || !res.assets?.[0]) return { ok: false };

  const body = await assetToBody(res.assets[0]);
  if (!body) return { ok: false, error: 'No se pudo leer la imagen.' };
  const path = `${machineryId}/${folder}/${Date.now()}.jpg`;
  return uploadToMachinery(path, body);
}

/** SOLO cámara (sin caer a galería si falla) — para cuando el llamador ya ofreció
 *  la opción de elegir origen y el usuario tocó específicamente "Tomar foto". */
export async function takePhotoAndUpload(
  machineryId: string,
  folder = 'horometro'
): Promise<{ ok: boolean; url?: string; error?: string }> {
  const webBase64 = Platform.OS !== 'web';
  const cam = await ImagePicker.requestCameraPermissionsAsync();
  if (!cam.granted) return { ok: false, error: 'Permiso de cámara denegado.' };
  const res = await pick(() => ImagePicker.launchCameraAsync({ quality: PICK_QUALITY, base64: webBase64 }));
  if (!res || res.canceled || !res.assets?.[0]) return { ok: false };
  const body = await assetToBody(res.assets[0]);
  if (!body) return { ok: false, error: 'No se pudo leer la imagen.' };
  const path = `${machineryId}/${folder}/${Date.now()}.jpg`;
  return uploadToMachinery(path, body);
}

/** SOLO galería — para cuando el usuario tocó específicamente "Elegir de galería". */
export async function pickPhotoFromGalleryAndUpload(
  machineryId: string,
  folder = 'horometro'
): Promise<{ ok: boolean; url?: string; error?: string }> {
  const webBase64 = Platform.OS !== 'web';
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return { ok: false, error: 'Permiso de galería denegado.' };
  const res = await pick(() => ImagePicker.launchImageLibraryAsync({ quality: PICK_QUALITY, base64: webBase64 }));
  if (!res || res.canceled || !res.assets?.[0]) return { ok: false };
  const body = await assetToBody(res.assets[0]);
  if (!body) return { ok: false, error: 'No se pudo leer la imagen.' };
  const path = `${machineryId}/${folder}/${Date.now()}.jpg`;
  return uploadToMachinery(path, body);
}

/**
 * Selecciona un FORMATO (imagen o PDF) y lo sube al bucket 'machinery' en la carpeta
 * requerimientos/<reqId>/, devolviendo la URL pública, el tipo ('image'|'pdf') y el nombre.
 * - WEB: usa un <input type=file> nativo (acepta imagen Y PDF), sin dependencias nuevas.
 * - NATIVO: cae a la galería (solo imagen; el PDF requeriría expo-document-picker).
 */
export async function pickAndUploadRequirementFile(
  reqId: string
): Promise<{ ok: boolean; url?: string; kind?: 'image' | 'pdf'; name?: string; error?: string }> {
  return pickAndUploadDocFile('requerimientos', reqId);
}

/**
 * Selecciona un FORMATO (imagen o PDF) y lo sube al bucket 'machinery' en la carpeta
 * `<folder>/<id>/`, devolviendo la URL pública, el tipo ('image'|'pdf') y el nombre.
 * Genérico: sirve para facturas de Cuentas (folder 'facturas'), formatos de
 * requerimientos (folder 'requerimientos'), etc.
 * - WEB: <input type=file> nativo (acepta imagen Y PDF), sin dependencias nuevas.
 * - NATIVO: cae a la galería (solo imagen).
 */
export async function pickAndUploadDocFile(
  folder: string,
  id: string
): Promise<{ ok: boolean; url?: string; kind?: 'image' | 'pdf'; name?: string; error?: string }> {
  if (Platform.OS === 'web') {
    const file = await new Promise<File | null>((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*,application/pdf';
      let done = false;
      const finish = (f: File | null) => {
        if (done) return;
        done = true;
        window.removeEventListener('focus', onFocus);
        resolve(f);
      };
      // Cancelar: la ventana recupera el foco sin elegir archivo (no hay evento de cancel).
      const onFocus = () => setTimeout(() => finish(null), 1500);
      input.onchange = () => finish(input.files && input.files[0] ? input.files[0] : null);
      window.addEventListener('focus', onFocus);
      input.click();
    });
    if (!file) return { ok: false };
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
    const ext = isPdf ? 'pdf' : ((file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg');
    const path = `${folder}/${id}/${Date.now()}.${ext}`;
    const up = await supabase.storage.from('machinery').upload(path, file, {
      contentType: file.type || (isPdf ? 'application/pdf' : 'image/jpeg'),
      upsert: true,
    });
    if (up.error) return { ok: false, error: up.error.message };
    const { data } = supabase.storage.from('machinery').getPublicUrl(path);
    return { ok: true, url: data.publicUrl, kind: isPdf ? 'pdf' : 'image', name: file.name };
  }
  // NATIVO: solo imagen (galería).
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return { ok: false, error: 'Permiso de galería denegado.' };
  const res = await pick(() => ImagePicker.launchImageLibraryAsync({ quality: PICK_QUALITY, base64: true }));
  if (!res || res.canceled || !res.assets?.[0]) return { ok: false };
  const body = await assetToBody(res.assets[0]);
  if (!body) return { ok: false, error: 'No se pudo leer la imagen.' };
  const path = `${folder}/${id}/${Date.now()}.jpg`;
  const r = await uploadToMachinery(path, body);
  return r.ok ? { ok: true, url: r.url, kind: 'image', name: 'formato.jpg' } : { ok: false, error: r.error };
}

/**
 * Toma/selecciona la foto de un EMPLEADO y la normaliza a un encuadre estándar
 * (5:6) antes de subir, para que todos los carnets se vean parejos.
 * - Web: pasa por el recortador con guía (óvalo para centrar el rostro).
 * - Nativo: usa el editor propio de ImagePicker (allowsEditing + aspect 5:6... el
 *   nativo solo admite enteros, usamos [5,6]).
 */
export async function captureAndUploadEmployeePhoto(
  employeeId: string,
  folder = 'empleados'
): Promise<{ ok: boolean; url?: string; error?: string }> {
  const web = Platform.OS === 'web';
  let res: ImagePicker.ImagePickerResult | null = null;
  try {
    const cam = await ImagePicker.requestCameraPermissionsAsync();
    if (cam.granted) {
      res = await pick(() => ImagePicker.launchCameraAsync({ quality: 0.85, base64: false, allowsEditing: !web, aspect: [5, 6] }));
    }
  } catch {
    res = null;
  }
  if (!res || res.canceled || !res.assets?.[0]) {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return { ok: false, error: 'Permiso de cámara/galería denegado.' };
    res = await pick(() => ImagePicker.launchImageLibraryAsync({ quality: 0.85, base64: false, allowsEditing: !web, aspect: [5, 6] }));
  }
  if (!res || res.canceled || !res.assets?.[0]) return { ok: false };

  const asset = res.assets[0];
  let body: Blob | Uint8Array | null = null;
  if (web) {
    // Recortador con guía → devuelve el Blob ya normalizado (o null si cancela).
    const blob = await cropImageWeb(asset.uri);
    if (!blob) return { ok: false }; // canceló el recorte
    body = blob;
  } else {
    body = await assetToBody(asset);
  }
  if (!body) return { ok: false, error: 'No se pudo leer la imagen.' };
  const path = `${employeeId}/${folder}/${Date.now()}.jpg`;
  return uploadToMachinery(path, body);
}

/** Quita una foto de un registro (pone la columna = null). Sirve para empleados,
 *  aliados y maquinaria. `column` por defecto es 'photo_url' (la foto principal);
 *  en maquinaria también existe 'photo_serial_url' (foto del serial/placa).
 *  No borra el archivo del bucket (queda huérfano, sin costo). */
export async function removePhoto(table: string, id: string, column: string = 'photo_url'): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from(table).update({ [column]: null }).eq('id', id);
  return { ok: !error, error: error?.message };
}

/**
 * Selecciona una imagen, la sube al bucket 'machinery' y guarda la URL en la máquina.
 * `column` decide QUÉ foto se actualiza:
 *  - 'photo_url'        → foto de la MAQUINARIA (por defecto).
 *  - 'photo_serial_url' → foto del SERIAL / PLACA (se guarda en la subcarpeta serial/).
 */
export async function pickAndUploadPhoto(
  machineryId: string,
  column: 'photo_url' | 'photo_serial_url' = 'photo_url'
): Promise<{ ok: boolean; url?: string; error?: string }> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return { ok: false, error: 'Permiso de galería denegado.' };

  const res = await pick(() => ImagePicker.launchImageLibraryAsync({ quality: PICK_QUALITY, base64: Platform.OS !== 'web' }));
  if (res.canceled || !res.assets?.[0]) return { ok: false };

  const body = await assetToBody(res.assets[0]);
  if (!body) return { ok: false, error: 'No se pudo leer la imagen.' };
  const folder = column === 'photo_serial_url' ? 'serial/' : '';
  const path = `${machineryId}/${folder}${Date.now()}.jpg`;
  const up = await uploadToMachinery(path, body);
  if (!up.ok) return up;
  const { error } = await supabase.from('machinery').update({ [column]: up.url }).eq('id', machineryId);
  if (error) return { ok: false, error: error.message };
  return up;
}

/**
 * QUITA la foto de una máquina, sin tener que poner otra en su lugar. Hasta el
 * 18-ago-2026 solo se podía REEMPLAZAR: si una foto estaba mala o no
 * correspondía, había que subir otra cualquiera para taparla.
 *
 * Solo vacía la columna. El archivo se DEJA en Storage a propósito: la bitácora
 * de auditoría guarda la URL anterior en `changes`, y si borráramos el archivo
 * ese rastro quedaría apuntando a un enlace muerto — justo cuando alguien
 * pregunta "¿qué foto había antes?". Un JPG suelto no pesa nada; perder la
 * prueba sí cuesta.
 */
export async function removeMachineryPhoto(
  machineryId: string,
  column: 'photo_url' | 'photo_serial_url' = 'photo_url'
): Promise<{ ok: boolean; error?: string }> {
  if (!machineryId) return { ok: false, error: 'Falta la máquina.' };
  const { error } = await supabase.from('machinery').update({ [column]: null }).eq('id', machineryId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
