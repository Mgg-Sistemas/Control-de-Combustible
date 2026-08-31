import { useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { flushViajesQueue, onConnectivityChange } from '../lib/viajesOfflineQueue';

/**
 * VACIADO DE LA COLA DE VIAJES, DESDE LA RAÍZ DE LA APP.
 *
 * Por qué existe (31-ago-2026). El vaciado vivía dentro de un `useEffect` de la
 * pantalla de Viajes de camiones, con su `clearInterval` al desmontar. O sea:
 * **si esa pantalla no estaba abierta, la cola no se vaciaba**. Ni al arrancar
 * la app, ni al recuperar la señal.
 *
 * En la práctica eso significa que un listero que registró viajes sin cobertura,
 * cerró la app y al día siguiente entró a otra pantalla —o entró y se quedó en
 * el inicio— tenía sus viajes guardados en el teléfono y sin subir, sin ninguna
 * señal de que faltaba algo. Encaja exactamente con lo que reportó el cliente:
 * «faltan viajes o no se registran viajes».
 *
 * No pinta nada. Se monta una sola vez, dentro del `AuthProvider`.
 *
 * ⚠️ POR QUÉ ESTO NO SE PODÍA HACER ANTES, y qué cambió. Vaciar la cola desde la
 *    raíz, tal cual, era peligroso: sin sesión iniciada el servidor rechaza
 *    todos los inserts por RLS, y con la política vieja esos rechazos contaban
 *    como fallo del viaje — la cola ENTERA se iba a cuarentena en minuto y
 *    medio con la app parada en la pantalla de entrar. Eso ya está arreglado
 *    (ver `esErrorTransitorio` en `colaOfflinePolicy.ts`: sesión, señal y
 *    servidor caído nunca apartan un viaje). Aun así acá se exige sesión: sin
 *    ella el intento no puede salir bien y no vale la pena gastar la batería.
 *
 * ⚠️ NO REEMPLAZA al de la pantalla, convive con él. El de la pantalla además
 *    refresca "mis viajes" cuando algo sube, que es lo que el listero mira. Que
 *    los dos corran a la vez no duplica nada: `flushViajesQueue` tiene su
 *    propio cerrojo (`flushing`) y cada viaje lleva su `client_action_id`, así
 *    que un insert repetido choca con el índice único y cuenta como subido.
 */

/** Cada cuánto se reintenta desde la raíz. Más espaciado que el de la pantalla
 *  (30 s) a propósito: acá nadie está mirando y hay que cuidar la batería. */
const CADA_MS = 60_000;

export function SincronizadorColas() {
  const { session } = useAuth();
  const uid = session?.user?.id ?? '';

  useEffect(() => {
    if (!uid) return;
    let vivo = true;
    const intentar = () => {
      if (!vivo) return;
      // Sin `catch` esto sería un rechazo sin atrapar en la raíz de la app.
      flushViajesQueue().catch(() => {});
    };
    intentar();
    const unsub = onConnectivityChange((online) => { if (online) intentar(); });
    const timer = setInterval(intentar, CADA_MS);
    return () => { vivo = false; unsub(); clearInterval(timer); };
  }, [uid]);

  return null;
}
