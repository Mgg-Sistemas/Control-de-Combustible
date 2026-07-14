import React, { useEffect, useRef, useState } from 'react';
import { View, Image, Text, TouchableOpacity, Platform } from 'react-native';

/**
 * Recortador de foto con GUÍA (óvalo para centrar el rostro).
 * Normaliza toda foto de empleado a un encuadre estándar 5:6, de modo que todos
 * los carnets se vean parejos sin depender del recorte original de cada foto.
 *
 * API imperativa: `cropImageWeb(src)` abre el modal y resuelve un Blob JPEG ya
 * recortado (o null si se cancela). Solo web; en nativo se usa el editor propio
 * de ImagePicker (allowsEditing), así que aquí devuelve null.
 */

// Salida normalizada: 5:6 (igual que el recuadro del carnet 25×30 mm) a buena resolución.
const OUT_W = 600;
const OUT_H = 720;
// Marco visible en pantalla (misma proporción 5:6).
const DFW = 270;
const DFH = 324;
const K = OUT_W / DFW; // factor pantalla → salida

let _open: ((src: string) => Promise<Blob | null>) | null = null;

/** Abre el recortador (web) y devuelve el Blob recortado, o null si se cancela. */
export function cropImageWeb(src: string): Promise<Blob | null> {
  if (Platform.OS !== 'web' || !_open) return Promise.resolve(null);
  return _open(src);
}

export function PhotoCropperHost() {
  const [visible, setVisible] = useState(false);
  const [src, setSrc] = useState<string | null>(null);
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  const [scale, setScale] = useState(1); // escala total aplicada a la imagen
  const [pos, setPos] = useState({ x: 0, y: 0 }); // top-left de la imagen dentro del marco
  const baseScaleRef = useRef(1); // escala "cover" mínima
  const imgElRef = useRef<any>(null);
  const resolverRef = useRef<((b: Blob | null) => void) | null>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);

  const clamp = (x: number, y: number, s: number, natW: number, natH: number) => {
    const dw = natW * s, dh = natH * s;
    const nx = Math.min(0, Math.max(DFW - dw, x));
    const ny = Math.min(0, Math.max(DFH - dh, y));
    return { x: nx, y: ny };
  };

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    _open = (s: string) =>
      new Promise<Blob | null>((resolve) => {
        resolverRef.current = resolve;
        setSrc(s);
        setNat(null);
        // Cargar imagen para conocer tamaño natural.
        const img = new (window as any).Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          imgElRef.current = img;
          const natW = img.naturalWidth || img.width;
          const natH = img.naturalHeight || img.height;
          const cover = Math.max(DFW / natW, DFH / natH);
          baseScaleRef.current = cover;
          setScale(cover);
          setNat({ w: natW, h: natH });
          // Centrado inicial, un pelín hacia arriba (rostros suelen ir arriba).
          const dw = natW * cover, dh = natH * cover;
          setPos({ x: (DFW - dw) / 2, y: (DFH - dh) / 2 - dh * 0.05 });
          setVisible(true);
        };
        img.onerror = () => resolve(null);
        img.src = s;
      });
    return () => { _open = null; };
  }, []);

  const finish = (blob: Blob | null) => {
    setVisible(false);
    setSrc(null);
    const r = resolverRef.current;
    resolverRef.current = null;
    if (r) r(blob);
  };

  const onMove = (e: any) => {
    if (!drag.current || !nat) return;
    const px = e.nativeEvent.pageX, py = e.nativeEvent.pageY;
    const dx = px - drag.current.x, dy = py - drag.current.y;
    drag.current = { x: px, y: py };
    setPos((p) => clamp(p.x + dx, p.y + dy, scale, nat.w, nat.h));
  };

  const zoomBy = (factor: number) => {
    if (!nat) return;
    const min = baseScaleRef.current, max = baseScaleRef.current * 4;
    const ns = Math.min(max, Math.max(min, scale * factor));
    // Zoom alrededor del centro del marco.
    const cx = DFW / 2, cy = DFH / 2;
    const ix = (cx - pos.x) / scale, iy = (cy - pos.y) / scale;
    const nx = cx - ix * ns, ny = cy - iy * ns;
    setScale(ns);
    setPos(clamp(nx, ny, ns, nat.w, nat.h));
  };

  const confirm = () => {
    if (!nat || !imgElRef.current) return finish(null);
    try {
      const canvas = (window as any).document.createElement('canvas');
      canvas.width = OUT_W; canvas.height = OUT_H;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, OUT_W, OUT_H);
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(imgElRef.current, pos.x * K, pos.y * K, nat.w * scale * K, nat.h * scale * K);
      canvas.toBlob((b: Blob | null) => finish(b), 'image/jpeg', 0.9);
    } catch {
      finish(null);
    }
  };

  if (Platform.OS !== 'web' || !visible || !src) return null;

  return (
    <View
      style={{
        position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
        backgroundColor: 'rgba(10,15,25,0.86)', alignItems: 'center', justifyContent: 'center', zIndex: 9999,
      }}
    >
      <Text style={{ color: '#fff', fontWeight: '800', fontSize: 16, marginBottom: 4 }}>Encuadra la foto</Text>
      <Text style={{ color: '#cbd5e1', fontSize: 12, marginBottom: 12 }}>Centra la cara dentro del óvalo · arrastra para mover · +/− para acercar</Text>

      {/* Marco de recorte */}
      <View
        style={{ width: DFW, height: DFH, borderRadius: 10, overflow: 'hidden', backgroundColor: '#111', borderWidth: 2, borderColor: '#16324F' }}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={(e) => { drag.current = { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY }; }}
        onResponderMove={onMove}
        onResponderRelease={() => { drag.current = null; }}
      >
        {nat && (
          <Image
            source={{ uri: src }}
            style={{ position: 'absolute', left: pos.x, top: pos.y, width: nat.w * scale, height: nat.h * scale }}
          />
        )}
        {/* Guía oval (no se imprime, solo ayuda a centrar) */}
        <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ width: DFW * 0.66, height: DFH * 0.8, borderRadius: 9999, borderWidth: 2, borderColor: 'rgba(255,255,255,0.85)', borderStyle: 'dashed' }} />
        </View>
      </View>

      {/* Controles de zoom */}
      <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
        <TouchableOpacity onPress={() => zoomBy(1 / 1.15)} style={{ width: 48, height: 44, borderRadius: 8, backgroundColor: '#334155', alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: '#fff', fontSize: 22, fontWeight: '900' }}>−</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => zoomBy(1.15)} style={{ width: 48, height: 44, borderRadius: 8, backgroundColor: '#334155', alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: '#fff', fontSize: 22, fontWeight: '900' }}>+</Text>
        </TouchableOpacity>
      </View>

      {/* Acciones */}
      <View style={{ flexDirection: 'row', gap: 12, marginTop: 16 }}>
        <TouchableOpacity onPress={() => finish(null)} style={{ paddingVertical: 12, paddingHorizontal: 22, borderRadius: 10, backgroundColor: '#475569' }}>
          <Text style={{ color: '#fff', fontWeight: '800' }}>Cancelar</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={confirm} style={{ paddingVertical: 12, paddingHorizontal: 28, borderRadius: 10, backgroundColor: '#059669' }}>
          <Text style={{ color: '#fff', fontWeight: '800' }}>Usar foto</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
