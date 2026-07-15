import { Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
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

/** Convierte el asset elegido en el cuerpo a subir. En WEB usa el blob directo
 *  (rápido, evita el decode base64); en NATIVO usa base64. */
async function assetToBody(asset: any): Promise<Blob | Uint8Array | null> {
  if (Platform.OS === 'web' && asset?.uri) {
    try {
      const resp = await fetch(asset.uri);
      const blob = await resp.blob();
      if (blob && blob.size > 0) return blob;
    } catch {}
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
      res = await ImagePicker.launchCameraAsync({ quality: PICK_QUALITY, base64: webBase64 });
    }
  } catch {
    res = null;
  }
  // Sin cámara disponible o permiso denegado → galería / selector de archivo.
  if (!res || res.canceled || !res.assets?.[0]) {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return { ok: false, error: 'Permiso de cámara/galería denegado.' };
    res = await ImagePicker.launchImageLibraryAsync({ quality: PICK_QUALITY, base64: webBase64 });
  }
  if (!res || res.canceled || !res.assets?.[0]) return { ok: false };

  const body = await assetToBody(res.assets[0]);
  if (!body) return { ok: false, error: 'No se pudo leer la imagen.' };
  const path = `${machineryId}/${folder}/${Date.now()}.jpg`;
  return uploadToMachinery(path, body);
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
      res = await ImagePicker.launchCameraAsync({ quality: 0.85, base64: false, allowsEditing: !web, aspect: [5, 6] });
    }
  } catch {
    res = null;
  }
  if (!res || res.canceled || !res.assets?.[0]) {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return { ok: false, error: 'Permiso de cámara/galería denegado.' };
    res = await ImagePicker.launchImageLibraryAsync({ quality: 0.85, base64: false, allowsEditing: !web, aspect: [5, 6] });
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

/** Quita la foto de un registro (pone photo_url = null). Sirve para empleados,
 *  aliados y maquinaria. No borra el archivo del bucket (queda huérfano, sin costo). */
export async function removePhoto(table: string, id: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from(table).update({ photo_url: null }).eq('id', id);
  return { ok: !error, error: error?.message };
}

/** Selecciona una imagen, la sube al bucket 'machinery' y guarda la URL en la máquina. */
export async function pickAndUploadPhoto(
  machineryId: string
): Promise<{ ok: boolean; url?: string; error?: string }> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return { ok: false, error: 'Permiso de galería denegado.' };

  const res = await ImagePicker.launchImageLibraryAsync({ quality: PICK_QUALITY, base64: Platform.OS !== 'web' });
  if (res.canceled || !res.assets?.[0]) return { ok: false };

  const body = await assetToBody(res.assets[0]);
  if (!body) return { ok: false, error: 'No se pudo leer la imagen.' };
  const path = `${machineryId}/${Date.now()}.jpg`;
  const up = await uploadToMachinery(path, body);
  if (!up.ok) return up;
  const { error } = await supabase.from('machinery').update({ photo_url: up.url }).eq('id', machineryId);
  if (error) return { ok: false, error: error.message };
  return up;
}
