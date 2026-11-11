// 📍 Lectura de «Traslados y salidas» para la ruta del flete (27/10/2026).
// SOLO LECTURA y solo las columnas de la ruta: nunca `datos` entero (trae montos y firmas).
// No se usa `cargarTrasladosCompartidos`: esa se traga los errores y reescribe la copia
// local del teléfono; aquí un error se muestra tal cual.
import { supabase } from './supabase';
import { filaATrasladoRuta, TrasladoRuta, ViajeVinculado } from './fleteRutaTraslado';

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
  // 11-nov-2026: para la Relación de viajes (quién autoriza y el chofer). Siguen sin montos.
  'autoriza:datos->firmas->>autorizadoPorEmpresa',
  'chofer:datos->transporte->>conductorNombre',
].join(', ');

/**
 * 🧾 Los VIAJES DE CAMIONES vinculados a unos fletes (sus VIAJES_IDS), para la Relación de
 * viajes (11-nov-2026). SOLO LECTURA y solo lo que va en la hoja: chofer, frente (origen),
 * obra (destino) y placa. De a 150 ids por consulta. Si las columnas del frente o del tique
 * no existen en esta base, se piden sin ellas (nunca se cae la relación por eso).
 */
export async function cargarViajesVinculados(ids: string[]): Promise<Map<string, ViajeVinculado>> {
  const unicos = [...new Set((ids ?? []).filter(Boolean))];
  const out = new Map<string, ViajeVinculado>();
  const COMPLETAS = 'id, chofer_name, machine_code, ubicacion_nombre, frente_nombre, placa_snap';
  const MINIMAS = 'id, chofer_name, machine_code, ubicacion_nombre';
  let columnas = COMPLETAS;
  for (let i = 0; i < unicos.length; i += 150) {
    const tramo = unicos.slice(i, i + 150);
    let r: any = await supabase.from('camion_viajes').select(columnas).in('id', tramo);
    if (r.error && columnas === COMPLETAS && (r.error.code === '42703' || /column/i.test(String(r.error.message)))) {
      columnas = MINIMAS;
      r = await supabase.from('camion_viajes').select(columnas).in('id', tramo);
    }
    if (r.error) throw new Error('No se pudieron leer los viajes de camiones: ' + (r.error.message || String(r.error)));
    for (const v of (r.data as any[]) ?? []) {
      out.set(String(v.id), { chofer: v.chofer_name ?? null, frente: v.frente_nombre ?? null, obra: v.ubicacion_nombre ?? null, placa: v.placa_snap ?? null, codigo: v.machine_code ?? null });
    }
  }
  return out;
}

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
