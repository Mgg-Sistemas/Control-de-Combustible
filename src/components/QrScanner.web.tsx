import React, { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';

/**
 * Escáner de QR en WEB: usa la cámara del navegador (getUserMedia) y decodifica
 * los fotogramas con jsQR. Renderiza elementos DOM reales (react-native-web
 * corre sobre react-dom, así que <video>/<canvas> funcionan). Sin dependencias
 * nativas → no afecta el bundle nativo (que usa QrScanner.tsx con expo-camera).
 */
export default function QrScanner({ onDetected, onClose }: { onDetected: (text: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const doneRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const cleanup = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };

    const tick = () => {
      const v = videoRef.current;
      const c = canvasRef.current;
      if (v && c && v.readyState === v.HAVE_ENOUGH_DATA) {
        const w = v.videoWidth;
        const h = v.videoHeight;
        if (w && h) {
          c.width = w; c.height = h;
          const ctx = c.getContext('2d');
          if (ctx) {
            ctx.drawImage(v, 0, 0, w, h);
            const img = ctx.getImageData(0, 0, w, h);
            const code = jsQR(img.data, w, h, { inversionAttempts: 'dontInvert' });
            if (code && code.data && !doneRef.current) {
              doneRef.current = true;
              cleanup();
              onDetected(code.data);
              return;
            }
          }
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    (async () => {
      try {
        const md: any = (navigator as any).mediaDevices;
        if (!md?.getUserMedia) { setError('Este navegador no permite usar la cámara.'); return; }
        const stream = await md.getUserMedia({ video: { facingMode: 'environment' } });
        if (cancelled) { stream.getTracks().forEach((t: MediaStreamTrack) => t.stop()); return; }
        streamRef.current = stream;
        const v = videoRef.current!;
        v.srcObject = stream;
        await v.play();
        rafRef.current = requestAnimationFrame(tick);
      } catch (e: any) {
        setError('No se pudo acceder a la cámara: ' + (e?.message ?? 'permiso denegado') + '. En iPhone/Android acepta el permiso de cámara.');
      }
    })();

    return () => { cancelled = true; cleanup(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#000', zIndex: 99999, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ position: 'relative', width: '100%', maxWidth: 480 }}>
        <video ref={videoRef} style={{ width: '100%', borderRadius: 12, background: '#111' }} muted playsInline />
        <div style={{ position: 'absolute', inset: 0, border: '3px solid rgba(255,255,255,0.7)', borderRadius: 12, margin: '18%', pointerEvents: 'none' }} />
      </div>
      <canvas ref={canvasRef} style={{ display: 'none' }} />
      <div style={{ color: '#fff', marginTop: 16, fontFamily: 'Tahoma, Geneva, Verdana, sans-serif', fontSize: 14, textAlign: 'center', maxWidth: 420 }}>
        {error ?? 'Apunta la cámara al código QR de la máquina…'}
      </div>
      <button onClick={onClose} style={{ marginTop: 16, padding: '12px 26px', borderRadius: 10, border: 'none', background: '#fff', fontWeight: 700, fontSize: 15, cursor: 'pointer' }}>
        Cerrar
      </button>
    </div>
  );
}
