import { useCallback, useEffect, useState } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabase';

/** Lee una tabla/vista de Supabase con estado de carga, error y refetch.
 *  Se sincroniza en tiempo real: si otro usuario cambia los datos, se refresca solo. */
export function useTable<T = any>(
  table: string,
  opts: { select?: string; orderBy?: string; ascending?: boolean; realtimeFrom?: string | string[] } = {}
) {
  const { select = '*', orderBy, ascending = false, realtimeFrom } = opts;
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      setError('Supabase no está configurado.');
      return;
    }
    setLoading(true);
    let query = supabase.from(table).select(select);
    if (orderBy) query = query.order(orderBy, { ascending });
    const { data: rows, error } = await query;
    if (error) setError(error.message);
    else {
      setData((rows ?? []) as T[]);
      setError(null);
    }
    setLoading(false);
  }, [table, select, orderBy, ascending]);

  useEffect(() => {
    fetch();
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
      timer = setTimeout(() => fetch(), 250);
    };
    const ch = supabase.channel(`rt-${table}-${sourcesKey}`);
    sources.forEach((src) => ch.on('postgres_changes' as any, { event: '*', schema: 'public', table: src }, bump));
    ch.subscribe();
    return () => {
      clearTimeout(timer);
      supabase.removeChannel(ch);
    };
  }, [table, sourcesKey, fetch]);

  return { data, loading, error, refetch: fetch };
}
