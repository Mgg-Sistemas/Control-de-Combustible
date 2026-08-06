import React from 'react';
import { View, Text } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { radius } from '../theme';
import { figFont, figFontStyle } from '../lib/figFont';

/**
 * Medidor de nivel de tanque (rediseño). La FORMA comunica el dato: barra con el
 * relleno proporcional al %, una MARCA vertical fija en el umbral mínimo, y color
 * según qué tan bajo esté (normal / bajo / crítico). El nivel es DERIVADO
 * (tank_levels); esta es solo la representación visual.
 */
export function TankLevel({
  pct,
  thresholdPct = 20,
  height = 10,
  showMarker = true,
}: {
  pct: number;               // 0..100
  thresholdPct?: number;     // umbral mínimo (marca)
  height?: number;
  showMarker?: boolean;
}) {
  const { colors } = useTheme();
  const p = Math.max(0, Math.min(100, Number(pct) || 0));
  // Crítico bajo el umbral; bajo hasta ~2× el umbral; normal por encima.
  const fill = p <= thresholdPct ? colors.tankCrit : p <= thresholdPct * 2 ? colors.tankWarn : colors.tankFill;
  return (
    <View style={{ height, borderRadius: radius.pill, backgroundColor: colors.tankTrack, overflow: 'hidden', position: 'relative' }}>
      <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${p}%`, backgroundColor: fill }} />
      {showMarker ? (
        <View style={{ position: 'absolute', top: -3, bottom: -3, left: `${Math.min(100, thresholdPct)}%`, width: 2, backgroundColor: colors.text, opacity: 0.55 }} />
      ) : null}
    </View>
  );
}

/** Chip de estado del tanque según su % vs umbral. */
export function tankStatus(pct: number, thresholdPct = 20): { label: string; tone: 'ok' | 'warn' | 'crit' } {
  const p = Number(pct) || 0;
  if (p <= thresholdPct) return { label: 'Bajo umbral', tone: 'crit' };
  if (p <= thresholdPct * 2) return { label: 'Atención', tone: 'warn' };
  return { label: 'Normal', tone: 'ok' };
}

/** Etiqueta bajo la barra: litros a la izquierda, % a la derecha (mono/tabular). */
export function TankLevelLabel({ liters, pct, low }: { liters: number; pct: number; low: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 5 }}>
      <Text {...figFont} style={[{ fontSize: 12, fontVariant: ['tabular-nums'], color: low ? colors.tankCrit : colors.muted, fontWeight: low ? '800' : '500' }, figFontStyle]}>
        {Number(liters).toLocaleString()} L
      </Text>
      <Text {...figFont} style={[{ fontSize: 12, fontVariant: ['tabular-nums'], color: colors.muted, fontWeight: '600' }, figFontStyle]}>{Math.round(Number(pct) || 0)}%</Text>
    </View>
  );
}
