import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, Platform } from 'react-native';
import { isUpdateAvailable, forceReloadLatest } from '../lib/version';

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
    // Misma lógica de recarga con cache-buster, ahora centralizada en version.ts
    // (la reutiliza también el control manual "🔄 Actualizar app" del inspector).
    forceReloadLatest();
  };

  if (!show) return null;

  return (
    <View
      // @ts-ignore — 'fixed' es válido en web (react-native-web).
      style={{
        position: (Platform.OS === 'web' ? 'fixed' : 'absolute') as any,
        left: 0,
        right: 0,
        top: 0,
        zIndex: 999999,
        backgroundColor: '#F2B705',
        borderBottomWidth: 2,
        borderBottomColor: '#D97706',
        paddingVertical: 8,
        paddingHorizontal: 12,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.18,
        shadowRadius: 4,
        elevation: 6,
      }}
    >
      <View style={{ width: 28 }} />
      <TouchableOpacity
        activeOpacity={0.85}
        onPress={actualizar}
        style={{
          flex: 1,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 10,
          flexWrap: 'wrap',
          paddingHorizontal: 4,
        }}
      >
        <Text style={{ color: '#1E3A5F', fontWeight: '900', fontSize: 13, textAlign: 'center' }}>
          🔄 Actualización: Hay una versión nueva disponible
        </Text>
        <View
          style={{
            backgroundColor: '#1E3A5F',
            borderRadius: 6,
            paddingVertical: 4,
            paddingHorizontal: 12,
            borderWidth: 1,
            borderColor: '#0F2744',
          }}
        >
          <Text style={{ color: '#F2B705', fontWeight: '900', fontSize: 12, letterSpacing: 0.5 }}>
            ACTUALIZAR
          </Text>
        </View>
      </TouchableOpacity>
      <TouchableOpacity
        onPress={() => setShow(false)}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        style={{ width: 28, height: 28, alignItems: 'center', justifyContent: 'center' }}
        accessibilityLabel="Cerrar aviso de actualización"
      >
        <Text style={{ color: '#1E3A5F', fontWeight: '900', fontSize: 16 }}>✕</Text>
      </TouchableOpacity>
    </View>
  );
}
