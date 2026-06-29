import { useCallback, useEffect, useState } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabase';

/** Lee una tabla/vista de Supabase con estado de carga, error y refetch. */
export function useTable<T = any>(
  table: string,
  opts: { select?: string; orderBy?: string; ascending?: boolean } = {}
) {
  const { select = '*', orderBy, ascending = false } = opts;
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

  return { data, loading, error, refetch: fetch };
}
