import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, Platform } from 'react-native';
import { isUpdateAvailable } from '../lib/version';

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
    try { (globalThis as any).location?.reload?.(); } catch {}
  };

  if (!show) return null;

  return (
    <View
      // @ts-ignore — 'fixed' es válido en web (react-native-web).
      style={{
        position: (Platform.OS === 'web' ? 'fixed' : 'absolute') as any,
        left: 0, right: 0, bottom: 0, zIndex: 9999,
        backgroundColor: '#1E3A5F',
        paddingVertical: 12, paddingHorizontal: 16,
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12,
        flexWrap: 'wrap',
        borderTopWidth: 2, borderTopColor: '#F2B705',
      }}
    >
      <Text style={{ color: '#fff', fontWeight: '800', fontSize: 14, textAlign: 'center' }}>
        🔄 Sistema en proceso de actualización, por favor presione el botón
      </Text>
      <TouchableOpacity
        onPress={actualizar}
        style={{ backgroundColor: '#F2B705', borderRadius: 8, paddingVertical: 8, paddingHorizontal: 20 }}
      >
        <Text style={{ color: '#1E3A5F', fontWeight: '900', fontSize: 14, letterSpacing: 0.5 }}>ACTUALIZAR</Text>
      </TouchableOpacity>
    </View>
  );
}
