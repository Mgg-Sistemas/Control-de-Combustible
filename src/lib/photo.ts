import * as ImagePicker from 'expo-image-picker';
import { supabase } from './supabase';

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

/** Selecciona una imagen, la sube al bucket 'machinery' y guarda la URL en la máquina. */
export async function pickAndUploadPhoto(
  machineryId: string
): Promise<{ ok: boolean; url?: string; error?: string }> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return { ok: false, error: 'Permiso de galería denegado.' };

  const res = await ImagePicker.launchImageLibraryAsync({ quality: 0.5, base64: true });
  if (res.canceled || !res.assets?.[0]?.base64) return { ok: false };

  const bytes = decodeB64(res.assets[0].base64);
  const path = `${machineryId}/${Date.now()}.jpg`;
  const up = await supabase.storage
    .from('machinery')
    .upload(path, bytes, { contentType: 'image/jpeg', upsert: true });
  if (up.error) return { ok: false, error: up.error.message };

  const { data } = supabase.storage.from('machinery').getPublicUrl(path);
  const { error } = await supabase.from('machinery').update({ photo_url: data.publicUrl }).eq('id', machineryId);
  if (error) return { ok: false, error: error.message };
  return { ok: true, url: data.publicUrl };
}
