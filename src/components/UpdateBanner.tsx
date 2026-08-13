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

  // Botón CENTRADO en medio de la pantalla, del mismo tamaño que el botón
  // "ESCANEAR QR" del inspector (cuadro grande, aspectRatio 1.35, maxHeight 220).
  // Fondo semitransparente para que resalte; tocar FUERA lo oculta (no atrapa al
  // usuario) y vuelve a aparecer en el próximo chequeo si sigue habiendo versión nueva.
  return (
    <View
      // @ts-ignore — 'fixed' es válido en web (react-native-web).
      style={{
        position: (Platform.OS === 'web' ? 'fixed' : 'absolute') as any,
        left: 0, right: 0, top: 0, bottom: 0, zIndex: 999999,
        alignItems: 'center', justifyContent: 'center', padding: 24,
        backgroundColor: 'rgba(0,0,0,0.45)',
      }}
    >
      {/* Capa para descartar tocando fuera del botón. */}
      <TouchableOpacity
        activeOpacity={1}
        onPress={() => setShow(false)}
        // @ts-ignore
        style={{ position: (Platform.OS === 'web' ? 'fixed' : 'absolute') as any, left: 0, right: 0, top: 0, bottom: 0 }}
      />
      <TouchableOpacity
        activeOpacity={0.85}
        onPress={actualizar}
        style={{
          backgroundColor: '#1E3A5F',
          borderRadius: 16, borderWidth: 2, borderColor: '#F2B705',
          aspectRatio: 1.35, maxHeight: 220, width: '80%', maxWidth: 320,
          alignItems: 'center', justifyContent: 'center', padding: 16,
        }}
      >
        <Text style={{ fontSize: 64 }}>🔄</Text>
        <Text style={{ color: '#F2B705', fontWeight: '900', fontSize: 22, marginTop: 8, letterSpacing: 0.5 }}>ACTUALIZAR</Text>
        <Text style={{ color: '#fff', fontSize: 12, opacity: 0.9, marginTop: 4, textAlign: 'center' }}>Hay una versión nueva — toca para actualizar</Text>
      </TouchableOpacity>
    </View>
  );
}
