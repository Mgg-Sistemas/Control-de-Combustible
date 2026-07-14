import React, { useEffect, useReducer, useRef, useState } from 'react';
import { View, Image, Text, TouchableOpacity, Platform } from 'react-native';

/**
 * Recortador de foto con GUÍA (óvalo para centrar el rostro).
 * Normaliza toda foto de empleado a un encuadre estándar 5:6, de modo que todos
 * los carnets se vean parejos sin depender del recorte original de cada foto.
 *
 * API imperativa: `cropImageWeb(src)` abre el modal y resuelve un Blob JPEG ya
 * recortado (o null si se cancela). Solo web (usa eventos DOM); en nativo se usa
 * el editor propio de ImagePicker, así que aquí devuelve null.
 */

// Salida normalizada: 5:6 (igual que el recuadro del carnet 25×30 mm).
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
  const [, bump] = useReducer((x) => x + 1, 0);

  const posRef = useRef({ x: 0, y: 0 });
  const scaleRef = useRef(1);
  const baseRef = useRef(1);
  const natRef = useRef<{ w: number; h: number } | null>(null);
  const imgElRef = useRef<any>(null);
  const frameRef = useRef<any>(null);
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const resolverRef = useRef<((b: Blob | null) => void) | null>(null);

  const clamp = (x: number, y: number, s = scaleRef.current) => {
    const nat = natRef.current;
    if (!nat) return { x, y };
    const dw = nat.w * s, dh = nat.h * s;
    return {
      x: Math.min(0, Math.max(DFW - dw, x)),
      y: Math.min(0, Math.max(DFH - dh, y)),
    };
  };

  const zoomBy = (factor: number) => {
    const nat = natRef.current;
    if (!nat) return;
    const min = baseRef.current, max = baseRef.current * 5;
    const ns = Math.min(max, Math.max(min, scaleRef.current * factor));
    const cx = DFW / 2, cy = DFH / 2;
    const ix = (cx - posRef.current.x) / scaleRef.current;
    const iy = (cy - posRef.current.y) / scaleRef.current;
    scaleRef.current = ns;
    posRef.current = clamp(cx - ix * ns, cy - iy * ns, ns);
    bump();
  };

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    _open = (s: string) =>
      new Promise<Blob | null>((resolve) => {
        resolverRef.current = resolve;
        const img = new (window as any).Image();
        img.onload = () => {
          imgElRef.current = img;
          const natW = img.naturalWidth || img.width;
          const natH = img.naturalHeight || img.height;
          const cover = Math.max(DFW / natW, DFH / natH);
          baseRef.current = cover;
          scaleRef.current = cover;
          natRef.current = { w: natW, h: natH };
          const dw = natW * cover, dh = natH * cover;
          posRef.current = { x: (DFW - dw) / 2, y: (DFH - dh) / 2 - dh * 0.05 };
          setSrc(s);
          setVisible(true);
          bump();
        };
        img.onerror = () => resolve(null);
        img.src = s;
      });
    return () => { _open = null; };
  }, []);

  // Arrastre (pointer) + zoom con rueda, vía eventos DOM (fiable en web/móvil).
  useEffect(() => {
    if (!visible || Platform.OS !== 'web') return;
    const el: any = frameRef.current;
    if (!el || !el.addEventListener) return;

    const down = (e: any) => {
      dragRef.current = { x: e.clientX, y: e.clientY };
      try { el.setPointerCapture && el.setPointerCapture(e.pointerId); } catch {}
    };
    const move = (e: any) => {
      if (!dragRef.current) return;
      const dx = e.clientX - dragRef.current.x;
      const dy = e.clientY - dragRef.current.y;
      dragRef.current = { x: e.clientX, y: e.clientY };
      posRef.current = clamp(posRef.current.x + dx, posRef.current.y + dy);
      bump();
    };
    const up = () => { dragRef.current = null; };
    const wheel = (e: any) => { e.preventDefault(); zoomBy(e.deltaY < 0 ? 1.08 : 1 / 1.08); };

    el.addEventListener('pointerdown', down);
    (window as any).addEventListener('pointermove', move);
    (window as any).addEventListener('pointerup', up);
    el.addEventListener('wheel', wheel, { passive: false });
    return () => {
      el.removeEventListener('pointerdown', down);
      (window as any).removeEventListener('pointermove', move);
      (window as any).removeEventListener('pointerup', up);
      el.removeEventListener('wheel', wheel);
    };
  }, [visible]);

  const finish = (blob: Blob | null) => {
    setVisible(false);
    setSrc(null);
    const r = resolverRef.current;
    resolverRef.current = null;
    if (r) r(blob);
  };

  const confirm = () => {
    const nat = natRef.current;
    if (!nat || !imgElRef.current) return finish(null);
    try {
      const canvas = (window as any).document.createElement('canvas');
      canvas.width = OUT_W; canvas.height = OUT_H;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, OUT_W, OUT_H);
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(imgElRef.current, posRef.current.x * K, posRef.current.y * K, nat.w * scaleRef.current * K, nat.h * scaleRef.current * K);
      canvas.toBlob((b: Blob | null) => finish(b), 'image/jpeg', 0.9);
    } catch {
      finish(null);
    }
  };

  if (Platform.OS !== 'web' || !visible || !src) return null;
  const nat = natRef.current;

  return (
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(10,15,25,0.86)', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
      <Text style={{ color: '#fff', fontWeight: '800', fontSize: 16, marginBottom: 4 }}>Encuadra la foto</Text>
      <Text style={{ color: '#cbd5e1', fontSize: 12, marginBottom: 12 }}>Centra la cara en el óvalo · arrastra para mover · rueda o +/− para acercar</Text>

      <View
        ref={frameRef}
        // @ts-ignore — cursor solo aplica en web
        style={{ width: DFW, height: DFH, borderRadius: 10, overflow: 'hidden', backgroundColor: '#111', borderWidth: 2, borderColor: '#16324F', cursor: 'grab' }}
      >
        {nat && (
          <Image
            source={{ uri: src }}
            // @ts-ignore — pointerEvents en style funciona en web
            style={{ position: 'absolute', left: posRef.current.x, top: posRef.current.y, width: nat.w * scaleRef.current, height: nat.h * scaleRef.current, pointerEvents: 'none' }}
          />
        )}
        <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ width: DFW * 0.66, height: DFH * 0.8, borderRadius: 9999, borderWidth: 2, borderColor: 'rgba(255,255,255,0.85)', borderStyle: 'dashed' }} />
        </View>
      </View>

      <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
        <TouchableOpacity onPress={() => zoomBy(1 / 1.15)} style={{ width: 52, height: 44, borderRadius: 8, backgroundColor: '#334155', alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: '#fff', fontSize: 22, fontWeight: '900' }}>−</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => zoomBy(1.15)} style={{ width: 52, height: 44, borderRadius: 8, backgroundColor: '#334155', alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: '#fff', fontSize: 22, fontWeight: '900' }}>+</Text>
        </TouchableOpacity>
      </View>

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
