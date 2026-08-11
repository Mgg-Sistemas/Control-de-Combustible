// Anotador de fotos (web): sobre la imagen elegida se puede DIBUJAR a mano (marcar
// detalles) antes de subirla. Usa un canvas dentro de un iframe autocontenido y
// devuelve la imagen anotada como dataURL. Solo web (en nativo no se usa).
import React, { useEffect, useMemo, useRef } from 'react';
import { Modal, View, Text, TouchableOpacity } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';

function annotatorHtml(imageDataUrl: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"/>
<style>html,body{margin:0;height:100%;background:#111;display:flex;flex-direction:column;font-family:sans-serif}
  #bar{display:flex;gap:6px;padding:8px;background:#1f2937;flex-wrap:wrap;align-items:center}
  .sw{width:24px;height:24px;border-radius:50%;border:2px solid #fff;cursor:pointer}
  button{background:#374151;color:#fff;border:0;border-radius:6px;padding:6px 10px;font-weight:700;cursor:pointer}
  button.pri{background:#2563eb}
  #wrap{flex:1;overflow:auto;display:flex;align-items:center;justify-content:center}
  canvas{max-width:100%;touch-action:none;background:#000}</style></head>
<body>
  <div id="bar">
    <span class="sw" style="background:#ef4444" data-c="#ef4444"></span>
    <span class="sw" style="background:#f59e0b" data-c="#f59e0b"></span>
    <span class="sw" style="background:#22c55e" data-c="#22c55e"></span>
    <span class="sw" style="background:#3b82f6" data-c="#3b82f6"></span>
    <span class="sw" style="background:#ffffff" data-c="#ffffff"></span>
    <button id="undo">↶ Deshacer</button>
    <button id="clear">🗑 Limpiar</button>
    <button id="save" class="pri">✓ Usar</button>
  </div>
  <div id="wrap"><canvas id="c"></canvas></div>
<script>
  var img = new Image(); var canvas = document.getElementById('c'), ctx = canvas.getContext('2d');
  var color = '#ef4444', drawing = false, strokes = [], cur = null;
  img.onload = function(){
    var maxW = 1600; var sc = Math.min(1, maxW/img.width);
    canvas.width = Math.round(img.width*sc); canvas.height = Math.round(img.height*sc);
    redraw();
  };
  img.src = ${JSON.stringify(imageDataUrl)};
  function redraw(){
    ctx.drawImage(img,0,0,canvas.width,canvas.height);
    ctx.lineCap='round'; ctx.lineJoin='round';
    strokes.forEach(function(s){ ctx.strokeStyle=s.c; ctx.lineWidth=s.w; ctx.beginPath(); s.pts.forEach(function(p,i){ i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y); }); ctx.stroke(); });
  }
  function pos(e){ var r=canvas.getBoundingClientRect(); var t=e.touches?e.touches[0]:e; return { x:(t.clientX-r.left)*(canvas.width/r.width), y:(t.clientY-r.top)*(canvas.height/r.height) }; }
  function down(e){ e.preventDefault(); drawing=true; cur={c:color,w:Math.max(3,canvas.width/300),pts:[pos(e)]}; strokes.push(cur); }
  function move(e){ if(!drawing)return; e.preventDefault(); cur.pts.push(pos(e)); redraw(); }
  function up(){ drawing=false; }
  canvas.addEventListener('pointerdown',down); canvas.addEventListener('pointermove',move); window.addEventListener('pointerup',up);
  Array.prototype.forEach.call(document.querySelectorAll('.sw'), function(el){ el.onclick=function(){ color=el.getAttribute('data-c'); }; });
  document.getElementById('undo').onclick=function(){ strokes.pop(); redraw(); };
  document.getElementById('clear').onclick=function(){ strokes=[]; redraw(); };
  document.getElementById('save').onclick=function(){ try{ parent.postMessage({ type:'annot-save', data: canvas.toDataURL('image/jpeg',0.85) }, '*'); }catch(e){} };
</script></body></html>`;
}

export function PhotoAnnotator({ visible, imageDataUrl, onCancel, onSave }: { visible: boolean; imageDataUrl: string | null; onCancel: () => void; onSave: (dataUrl: string) => void }) {
  const { colors } = useTheme();
  const iframeRef = useRef<any>(null);
  const doc = useMemo(() => (imageDataUrl ? annotatorHtml(imageDataUrl) : ''), [imageDataUrl]);

  useEffect(() => {
    if (!visible) return;
    const onMsg = (e: any) => {
      if (e?.data?.type === 'annot-save' && typeof e.data.data === 'string') onSave(e.data.data);
    };
    const w: any = globalThis;
    w.addEventListener?.('message', onMsg);
    return () => w.removeEventListener?.('message', onMsg);
  }, [visible, onSave]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', padding: spacing.md, justifyContent: 'center' }}>
        <View style={{ backgroundColor: colors.surface, borderRadius: radius.lg, overflow: 'hidden', maxHeight: '90%' }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: spacing.sm }}>
            <Text style={{ color: colors.text, fontWeight: '800' }}>✏️ Dibuja sobre la foto</Text>
            <TouchableOpacity onPress={onCancel}><Text style={{ color: colors.danger, fontWeight: '800' }}>Cancelar</Text></TouchableOpacity>
          </View>
          {imageDataUrl ? React.createElement('iframe' as any, { ref: iframeRef, srcDoc: doc, style: { width: '100%', height: 460, border: 0 } } as any) : null}
        </View>
      </View>
    </Modal>
  );
}
