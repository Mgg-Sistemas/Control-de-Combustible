// Gráfico de PERFIL LONGITUDINAL (distancia vs cota). En web dibuja un SVG dentro de
// un iframe; en nativo muestra un resumen (cotas y desnivel). Sin dependencias nuevas.
import React, { useMemo } from 'react';
import { Platform, View, Text } from 'react-native';
import { Card } from './ui';
import { useTheme } from '../theme/ThemeContext';
import { radius } from '../theme';

export type ProfilePt = { dist: number; z: number | null };

function svg(samples: ProfilePt[], w = 640, h = 240): string {
  const pad = { l: 46, r: 12, t: 12, b: 28 };
  const pts = samples.filter((s) => s.z != null) as { dist: number; z: number }[];
  if (pts.length < 2) return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><text x="12" y="24" font-family="sans-serif" font-size="13" fill="#888">Sin datos de perfil (revisa que la línea cruce la superficie).</text></svg>`;
  const dMax = pts[pts.length - 1].dist || 1;
  let zMin = Infinity, zMax = -Infinity; pts.forEach((p) => { if (p.z < zMin) zMin = p.z; if (p.z > zMax) zMax = p.z; });
  if (zMax - zMin < 0.5) { zMax += 0.5; zMin -= 0.5; }
  const X = (d: number) => pad.l + (d / dMax) * (w - pad.l - pad.r);
  const Y = (z: number) => pad.t + (1 - (z - zMin) / (zMax - zMin)) * (h - pad.t - pad.b);
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.dist).toFixed(1)},${Y(p.z).toFixed(1)}`).join(' ');
  const area = `M${X(pts[0].dist).toFixed(1)},${(h - pad.b).toFixed(1)} ` + pts.map((p) => `L${X(p.dist).toFixed(1)},${Y(p.z).toFixed(1)}`).join(' ') + ` L${X(pts[pts.length - 1].dist).toFixed(1)},${(h - pad.b).toFixed(1)} Z`;
  const gy: string[] = [];
  for (let k = 0; k <= 4; k++) { const z = zMin + (zMax - zMin) * k / 4; const y = Y(z); gy.push(`<line x1="${pad.l}" y1="${y.toFixed(1)}" x2="${w - pad.r}" y2="${y.toFixed(1)}" stroke="#e5e7eb" stroke-width="1"/><text x="4" y="${(y + 4).toFixed(1)}" font-family="sans-serif" font-size="10" fill="#888">${z.toFixed(1)}</text>`); }
  const gx: string[] = [];
  for (let k = 0; k <= 4; k++) { const d = dMax * k / 4; const x = X(d); gx.push(`<text x="${x.toFixed(1)}" y="${(h - 8).toFixed(1)}" font-family="sans-serif" font-size="10" fill="#888" text-anchor="middle">${d.toFixed(0)} m</text>`); }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    ${gy.join('')}${gx.join('')}
    <path d="${area}" fill="#2563eb22"/>
    <path d="${path}" fill="none" stroke="#2563eb" stroke-width="2"/>
    <text x="${pad.l}" y="10" font-family="sans-serif" font-size="10" fill="#555">Cota (m) — Distancia (m)</text>
  </svg>`;
}

export function ProfileChart({ samples, height }: { samples: ProfilePt[]; height?: number }) {
  const { colors } = useTheme();
  const html = useMemo(() => `<!doctype html><html><head><meta charset="utf-8"/><style>html,body{margin:0;background:#fff}</style></head><body>${svg(samples)}</body></html>`, [samples]);
  const valid = samples.filter((s) => s.z != null) as { dist: number; z: number }[];
  if (Platform.OS === 'web') {
    return React.createElement('iframe' as any, { srcDoc: html, style: { width: '100%', height: height ?? 250, border: `1px solid ${colors.border}`, borderRadius: radius.md, background: '#fff' } } as any);
  }
  if (valid.length < 2) return <Card><Text style={{ color: colors.muted }}>Sin datos de perfil.</Text></Card>;
  let zMin = Infinity, zMax = -Infinity; valid.forEach((p) => { if (p.z < zMin) zMin = p.z; if (p.z > zMax) zMax = p.z; });
  const len = valid[valid.length - 1].dist;
  return (
    <Card>
      <Text style={{ color: colors.text, fontWeight: '700' }}>Perfil longitudinal</Text>
      <Text style={{ color: colors.muted, fontSize: 12 }}>Longitud {len.toFixed(1)} m · cota {zMin.toFixed(2)}–{zMax.toFixed(2)} m · desnivel {(zMax - zMin).toFixed(2)} m</Text>
      <Text style={{ color: colors.muted, fontSize: 11, marginTop: 4 }}>La gráfica del perfil se ve en la versión web.</Text>
    </Card>
  );
}
