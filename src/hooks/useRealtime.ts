import { useEffect, useRef } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabase';

// Secuencia global: un id único por instancia para que el nombre del canal no
// colisione con otro (dos canales con el mismo nombre rompen realtime).
let rtxSeq = 0;

/**
 * Refresca en TIEMPO REAL pantallas que tienen su propia carga (no usan useTable):
 * ejecuta `onChange` (con un pequeño debounce) cada vez que cambia (INSERT/UPDATE/
 * DELETE) alguna de las tablas indicadas en la base de datos. Así, cuando otro
 * usuario/dispositivo registra algo (p. ej. la cocina escanea un carnet), la
 * pantalla se actualiza sola sin tener que refrescar a mano.
 */
export function useRealtimeRefresh(tables: string[], onChange: () => void) {
  const id = useRef(0);
  if (id.current === 0) id.current = ++rtxSeq;
  // Guardamos el callback en un ref para NO re-suscribir el canal en cada render
  // (solo se re-suscribe si cambia la lista de tablas).
  const cb = useRef(onChange);
  cb.current = onChange;
  const key = tables.join(',');

  useEffect(() => {
    if (!isSupabaseConfigured || !key) return;
    let timer: any;
    const bump = () => { clearTimeout(timer); timer = setTimeout(() => cb.current(), 350); };
    const ch = supabase.channel(`rtx-${key}-${id.current}`);
    key.split(',').forEach((t) => ch.on('postgres_changes' as any, { event: '*', schema: 'public', table: t }, bump));
    ch.subscribe();
    return () => { clearTimeout(timer); supabase.removeChannel(ch); };
  }, [key]);
}
