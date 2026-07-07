import * as Location from 'expo-location';
import { supabase } from './supabase';

/**
 * Captura la ubicación GPS actual, la guarda en el historial (ruta) de la
 * máquina y actualiza sus coordenadas más recientes.
 */
export async function captureLocation(
  machineryId: string
): Promise<{ ok: boolean; error?: string; lat?: number; lng?: number }> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') {
    return { ok: false, error: 'Permiso de ubicación denegado.' };
  }
  const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
  const lat = Number(pos.coords.latitude.toFixed(6));
  const lng = Number(pos.coords.longitude.toFixed(6));
  const now = new Date().toISOString();

  // Historial (ruta): cada cambio de ubicación se guarda.
  await supabase.from('machinery_locations').insert({ machinery_id: machineryId, latitude: lat, longitude: lng });
  // Últimas coordenadas conocidas.
  const { error } = await supabase
    .from('machinery')
    .update({ latitude: lat, longitude: lng, location_at: now })
    .eq('id', machineryId);
  if (error) return { ok: false, error: error.message };
  return { ok: true, lat, lng };
}
