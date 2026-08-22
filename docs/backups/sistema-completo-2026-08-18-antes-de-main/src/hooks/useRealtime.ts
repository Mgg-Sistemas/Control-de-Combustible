import { useEffect, useRef } from 'react';
import { isSupabaseConfigured } from '../lib/supabase';
import { subscribeRealtime } from '../lib/realtimeBus';

// Secuencia global: un id único por instancia para que el nombre del canal no
// colisione con otro (dos canales con el mismo nombre rompen realtime).
let rtxSeq = 0;

/** Id único de instancia para canales de Supabase creados a mano fuera de este
 *  hook (pantallas con su propio `supabase.channel('nombre-fijo')`): evita el
 *  error "cannot add postgres_changes after subscribe()" si la pantalla llega
 *  a montarse dos veces a la vez. Úsalo con `useRef` para que el id sea estable
 *  durante toda la vida del componente: `const id = useRef(0); if (!id.current) id.current = nextRtInstanceId();`
 */
export function nextRtInstanceId(): number {
  return ++rtxSeq;
}

/** Opciones de debounce del refresco en vivo. */
export type RealtimeRefreshOpts = {
  /** Espera de silencio tras el ÚLTIMO cambio antes de refrescar (ms). Def. 600. */
  debounceMs?: number;
  /** Tope: durante una RÁFAGA continua se refresca al menos cada tanto (ms). Def. 2500. */
  maxWaitMs?: number;
};

/**
 * Refresca en TIEMPO REAL pantallas que tienen su propia carga (no usan useTable):
 * ejecuta `onChange` cada vez que cambia (INSERT/UPDATE/DELETE) alguna de las tablas
 * indicadas. Así, cuando otro usuario/dispositivo registra algo (p. ej. la cocina
 * escanea un carnet), la pantalla se actualiza sola sin refrescar a mano.
 *
 * COALESCE de ráfagas: cada refresco vuelve a bajar datos (refetch completo, no
 * incremental), que es caro. Para no dispararlo N veces cuando llegan muchos cambios
 * seguidos (edición en lote, sincronización), se espera `debounceMs` de silencio
 * antes de refrescar; pero si la ráfaga es continua, se garantiza un refresco al
 * menos cada `maxWaitMs` (así la pantalla no queda “congelada” esperando el silencio).
 * En tablas de alta frecuencia, sube estos valores desde la pantalla.
 */
export function useRealtimeRefresh(tables: string[], onChange: () => void, opts?: RealtimeRefreshOpts) {
  // Guardamos el callback en un ref para NO re-suscribir en cada render
  // (solo se re-suscribe si cambia la lista de tablas o los tiempos).
  const cb = useRef(onChange);
  cb.current = onChange;
  const key = tables.join(',');
  const wait = opts?.debounceMs ?? 600;
  const maxWait = opts?.maxWaitMs ?? 2500;

  useEffect(() => {
    if (!isSupabaseConfigured || !key) return;
    let timer: any;      // debounce del último cambio
    let maxTimer: any;   // tope de espera durante una ráfaga continua
    let pending = false; // hay cambios sin refrescar
    const fire = () => {
      clearTimeout(timer); clearTimeout(maxTimer);
      timer = undefined; maxTimer = undefined; pending = false;
      cb.current();
    };
    const bump = () => {
      pending = true;
      clearTimeout(timer);
      timer = setTimeout(fire, wait);
      // Arranca el tope solo una vez por ráfaga: garantiza un refresco aunque los
      // cambios sigan llegando sin pausa (si no, el debounce nunca dispararía).
      if (!maxTimer) maxTimer = setTimeout(() => { if (pending) fire(); }, maxWait);
    };
    // Canal COMPARTIDO por toda la app (ver src/lib/realtimeBus.ts) — no uno por instancia.
    const unsub = subscribeRealtime(key.split(','), bump);
    return () => { clearTimeout(timer); clearTimeout(maxTimer); unsub(); };
  }, [key, wait, maxWait]);
}
