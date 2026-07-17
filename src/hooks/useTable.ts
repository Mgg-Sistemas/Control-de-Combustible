import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabase';

// Secuencia global: da un id único a cada instancia del hook para que su canal
// de realtime no colisione con otro que escuche la misma tabla (dos canales con
// el mismo nombre rompen con "cannot add postgres_changes after subscribe()").
let rtSeq = 0;

/** Lee una tabla/vista de Supabase con estado de carga, error y refetch.
 *  Se sincroniza en tiempo real: si otro usuario cambia los datos, se refresca solo. */
export function useTable<T = any>(
  table: string,
  opts: { select?: string; orderBy?: string; ascending?: boolean; realtimeFrom?: string | string[] } = {}
) {
  // Por defecto ASCENDENTE (A→Z): todo el sistema muestra las listas en orden
  // alfabético salvo que la pantalla pida explícitamente lo contrario (p. ej. los
  // logs cronológicos usan `ascending: false` para mostrar lo más reciente primero).
  const { select = '*', orderBy, ascending = true, realtimeFrom } = opts;
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Id único y estable de esta instancia (para el nombre del canal de realtime).
  const instanceId = useRef<number>(0);
  if (instanceId.current === 0) instanceId.current = ++rtSeq;

  // `silent`: recarga SIN mostrar "Cargando…" (para refrescos en tiempo real y tras
  //  guardar). Evita que la lista parpadee/re-renderice en cada cambio → app más fluida.
  const fetch = useCallback(async (silent = false) => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      setError('Supabase no está configurado.');
      return;
    }
    if (!silent) setLoading(true);
    let query = supabase.from(table).select(select);
    if (orderBy) query = query.order(orderBy, { ascending });
    const { data: rows, error } = await query;
    if (error) setError(error.message);
    else {
      setData((rows ?? []) as T[]);
      setError(null);
    }
    if (!silent) setLoading(false);
  }, [table, select, orderBy, ascending]);

  useEffect(() => {
    fetch(); // primera carga: sí muestra "Cargando…"
  }, [fetch]);

  // Sincronización en tiempo real (multiusuario): al recibir cualquier cambio en
  // las tablas fuente, se vuelve a leer (con un pequeño debounce para agrupar ráfagas).
  const sourcesKey = Array.isArray(realtimeFrom) ? realtimeFrom.join(',') : realtimeFrom ?? table;
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    const sources = sourcesKey.split(',');
    let timer: any;
    const bump = () => {
      clearTimeout(timer);
      timer = setTimeout(() => fetch(true), 400); // refresco SILENCIOSO (sin spinner)
    };
    const ch = supabase.channel(`rt-${table}-${sourcesKey}-${instanceId.current}`);
    sources.forEach((src) => ch.on('postgres_changes' as any, { event: '*', schema: 'public', table: src }, bump));
    ch.subscribe();
    return () => {
      clearTimeout(timer);
      supabase.removeChannel(ch);
    };
  }, [table, sourcesKey, fetch]);

  // refetch tras guardar: silencioso, para que la lista no parpadee.
  const refetch = useCallback(() => fetch(true), [fetch]);
  return { data, loading, error, refetch };
}
