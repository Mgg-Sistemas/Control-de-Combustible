import { useCallback, useEffect, useState } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { subscribeRealtime } from '../lib/realtimeBus';

// PostgREST/Supabase corta cada respuesta en ~1000 filas por defecto. Sin paginar,
// las tablas grandes (machine_rounds, attendance, staff_payments, etc.) se leían
// truncadas EN SILENCIO: listas y totales por debajo de lo real y sin error visible.
// PAGE_SIZE: filas por request. MAX_ROWS: tope de seguridad para no entrar en loop
// infinito si algún día un bug hace que .range() no avance (20000 filas = 20 páginas).
const PAGE_SIZE = 1000;
const MAX_ROWS = 20000;

/** Lee una tabla/vista de Supabase con estado de carga, error y refetch.
 *  Se sincroniza en tiempo real: si otro usuario cambia los datos, se refresca solo.
 *  Trae TODAS las filas (pagina internamente en bloques de 1000; ver PAGE_SIZE arriba). */
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

  // `silent`: recarga SIN mostrar "Cargando…" (para refrescos en tiempo real y tras
  //  guardar). Evita que la lista parpadee/re-renderice en cada cambio → app más fluida.
  const fetch = useCallback(async (silent = false) => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      setError('Supabase no está configurado.');
      return;
    }
    if (!silent) setLoading(true);
    // Paginado con .range(): un solo request de Supabase corta en ~1000 filas, así
    // que encadenamos requests hasta que una página vuelva incompleta (o hasta el
    // tope de seguridad MAX_ROWS). Se agrega 'id' como orden secundario estable
    // (salvo que ya sea el orden pedido) para que el rango no salte/duplique filas
    // entre páginas — mismo patrón que `selectAllRows` en `src/lib/supabase.ts`.
    const rows: any[] = [];
    let fetchError: { message: string } | null = null;
    for (let from = 0; from < MAX_ROWS; from += PAGE_SIZE) {
      let query = supabase.from(table).select(select);
      if (orderBy) query = query.order(orderBy, { ascending });
      if (orderBy !== 'id') query = query.order('id', { ascending: true });
      query = query.range(from, from + PAGE_SIZE - 1);
      const { data: page, error } = await query;
      if (error) { fetchError = error; break; }
      const pageRows = page ?? [];
      rows.push(...pageRows);
      if (pageRows.length < PAGE_SIZE) break;
    }
    if (fetchError) setError(fetchError.message);
    else {
      setData(rows as T[]);
      setError(null);
    }
    if (!silent) setLoading(false);
  }, [table, select, orderBy, ascending]);

  useEffect(() => {
    fetch(); // primera carga: sí muestra "Cargando…"
  }, [fetch]);

  // Sincronización en tiempo real (multiusuario): al recibir cualquier cambio en las
  // tablas fuente, se vuelve a leer (con un pequeño debounce para agrupar ráfagas). El
  // canal es COMPARTIDO por toda la app (ver src/lib/realtimeBus.ts) — no uno por hook.
  // Refuerzos: el bus resincroniza al RECONECTAR; acá además al VOLVER a la pestaña y al
  // recuperar INTERNET; y OPTIMIZA saltándose refrescos mientras la pestaña está oculta.
  const sourcesKey = Array.isArray(realtimeFrom) ? realtimeFrom.join(',') : realtimeFrom ?? table;
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    const sources = sourcesKey.split(',');
    const g: any = globalThis as any;
    const doc = g.document;
    const hidden = () => !!doc && doc.visibilityState === 'hidden';
    let timer: any;
    const bump = () => {
      if (hidden()) return; // pestaña oculta: no gastamos en refrescar; al volver se resincroniza
      clearTimeout(timer);
      timer = setTimeout(() => fetch(true), 400); // refresco SILENCIOSO (sin spinner)
    };
    const unsub = subscribeRealtime(sources, bump);
    // Web: al volver a la pestaña / recuperar internet, resincroniza en silencio.
    const onWake = () => bump();
    if (g.addEventListener) { g.addEventListener('online', onWake); g.addEventListener('focus', onWake); }
    if (doc && doc.addEventListener) doc.addEventListener('visibilitychange', onWake);
    return () => {
      clearTimeout(timer);
      unsub();
      if (g.removeEventListener) { g.removeEventListener('online', onWake); g.removeEventListener('focus', onWake); }
      if (doc && doc.removeEventListener) doc.removeEventListener('visibilitychange', onWake);
    };
  }, [sourcesKey, fetch]);

  // refetch tras guardar: silencioso, para que la lista no parpadee.
  const refetch = useCallback(() => fetch(true), [fetch]);
  return { data, loading, error, refetch };
}
