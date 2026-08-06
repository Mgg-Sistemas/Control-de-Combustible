import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, Platform } from 'react-native';
import { isUpdateAvailable, UPD_TARGET_KEY, UPD_ATTEMPT_KEY } from '../lib/version';

/**
 * Barra flotante que avisa cuando hay una versión nueva desplegada. En vez de
 * que el usuario tenga que refrescar a mano tras cada cambio, el sistema lo
 * detecta solo y muestra el botón ACTUALIZAR (recarga la página con la versión
 * nueva). Solo en web.
 */
export function UpdateBanner() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    let alive = true;
    const check = async () => {
      const upd = await isUpdateAvailable();
      if (alive && upd) setShow(true);
    };
    check(); // al arrancar
    const id = setInterval(check, 60000); // cada 60 s
    // También al volver a la pestaña (detección más rápida).
    const onVis = () => { if (!(globalThis as any).document?.hidden) check(); };
    try { (globalThis as any).document?.addEventListener?.('visibilitychange', onVis); } catch {}
    return () => {
      alive = false;
      clearInterval(id);
      try { (globalThis as any).document?.removeEventListener?.('visibilitychange', onVis); } catch {}
    };
  }, []);

  const actualizar = () => {
    setShow(false); // feedback inmediato
    const w: any = globalThis;
    // 0) Marca el INTENTO: guardamos a qué bundle estamos recargando. Si tras recargar
    //    el host sigue sirviendo el mismo (no avanzamos), la guarda anti-lazo en
    //    version.ts evita que el aviso vuelva a salir en bucle ("no se quita").
    try { const t = w.localStorage?.getItem?.(UPD_TARGET_KEY); if (t) w.localStorage?.setItem?.(UPD_ATTEMPT_KEY, t); } catch {}
    // 1) Limpia caches del navegador / PWA si existen (por si un service worker
    //    guardó el index/bundle viejo).
    try { w.caches?.keys?.().then((ks: string[]) => ks.forEach((k) => w.caches.delete(k))).catch(() => {}); } catch {}
    // 2) Recarga FORZANDO un index.html FRESCO con un cache-buster (_v). Un simple
    //    location.reload() reusa el index cacheado → vuelve a cargar el bundle VIEJO
    //    y el aviso reaparece. Con la query nueva el navegador baja el index nuevo,
    //    que referencia el bundle con hash nuevo (URL distinta) → carga la versión nueva.
    try {
      const url = new w.URL(w.location.href);
      url.searchParams.set('_v', String(Date.now()));
      w.location.replace(url.toString());
      return;
    } catch {}
    // Fallback si algo de lo anterior falla.
    try { w.location?.reload?.(); } catch {}
  };

  if (!show) return null;

  // Barra ARRIBA (no la tapa la barra de pestañas del teléfono), a todo el ancho
  // y TOCABLE COMPLETA: tocar cualquier parte recarga con la versión nueva.
  return (
    <TouchableOpacity
      activeOpacity={0.9}
      onPress={actualizar}
      // @ts-ignore — 'fixed' es válido en web (react-native-web).
      style={{
        position: (Platform.OS === 'web' ? 'fixed' : 'absolute') as any,
        left: 0, right: 0, top: 0, zIndex: 999999,
        backgroundColor: '#1E3A5F',
        paddingTop: 16, paddingBottom: 12, paddingHorizontal: 16,
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12,
        flexWrap: 'wrap',
        borderBottomWidth: 2, borderBottomColor: '#F2B705',
      }}
    >
      <Text style={{ color: '#fff', fontWeight: '800', fontSize: 14, textAlign: 'center' }}>
        🔄 Hay una versión NUEVA — toca para actualizar
      </Text>
      <View style={{ backgroundColor: '#F2B705', borderRadius: 8, paddingVertical: 8, paddingHorizontal: 20 }}>
        <Text style={{ color: '#1E3A5F', fontWeight: '900', fontSize: 14, letterSpacing: 0.5 }}>ACTUALIZAR</Text>
      </View>
    </TouchableOpacity>
  );
}
