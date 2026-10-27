// 📍 Lectura de «Traslados y salidas» para la ruta del flete (27/10/2026).
// SOLO LECTURA y solo las columnas de la ruta: nunca `datos` entero (trae montos y firmas).
// No se usa `cargarTrasladosCompartidos`: esa se traga los errores y reescribe la copia
// local del teléfono; aquí un error se muestra tal cual.
import { supabase } from './supabase';
import { filaATrasladoRuta, TrasladoRuta } from './fleteRutaTraslado';

const COLUMNAS: string = [
  'id',
  'numero_control',
  'machine_code',
  'created_at',
  'is_deleted',
  'deleted_at',
  'origen:datos->>origen',
  'destino:datos->>destino',
  'fecha:datos->>fecha',
  'placa_chuto:datos->transporte->>placaChuto',
  'placa_lowboy:datos->transporte->>placaLowboy',
  'equipo_codigo:datos->maquinaria->>codigo',
  'equipo_tipo:datos->maquinaria->>tipo',
].join(', ');

/** Los traslados vivos (no borrados), los más nuevos primero. */
export async function cargarRutasDeTraslados(): Promise<TrasladoRuta[]> {
  const { data, error } = await supabase
    .from('traslados_maquinaria')
    .select(COLUMNAS)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(1000);
  if (error) throw new Error('No se pudieron leer los traslados: ' + (error.message || String(error)));
  return ((data as any[]) ?? [])
    .map(filaATrasladoRuta)
    .filter((t): t is TrasladoRuta => t !== null);
}
