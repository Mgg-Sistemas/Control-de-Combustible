import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { spacing, radius, AppColors } from '../../theme';

export type KpiTone = 'success' | 'warning' | 'accent' | 'danger' | 'brand';

export type KpiItem = {
  key: string;
  label: string;
  value: number;
  tone: KpiTone;
  icon?: string;
};

export type InspectorKpiGridProps = {
  items: KpiItem[];
  activeKey?: string | null;
  onSelect: (key: string) => void;
};

function getToneMap(colors: AppColors) {
  return {
    success: {
      bg: colors.successSoftBg,
      border: colors.successSoftBorder,
      fg: colors.successSoftText,
      solid: colors.success,
    },
    warning: {
      bg: colors.warningSoftBg,
      border: colors.warningSoftBorder,
      fg: colors.warningSoftText,
      solid: colors.warning,
    },
    accent: {
      bg: colors.accentSoftBg,
      border: colors.accent,
      fg: colors.accentSoftText,
      solid: colors.accent,
    },
    danger: {
      bg: colors.dangerSoftBg,
      border: colors.dangerSoftBorder,
      fg: colors.dangerSoftText,
      solid: colors.danger,
    },
    brand: {
      bg: colors.surfaceAlt,
      border: colors.brandText,
      fg: colors.brandText,
      solid: colors.brandText,
    },
  };
}

export default function InspectorKpiGrid({ items, activeKey, onSelect }: InspectorKpiGridProps) {
  const { colors } = useTheme();
  const toneMap = getToneMap(colors);

  return (
    <View style={styles.grid}>
      {items.map((item) => {
        const isActive = item.key === activeKey;
        const tone = toneMap[item.tone];
        const backgroundColor = isActive ? tone.bg : colors.surface;
        const borderColor = isActive ? tone.border : colors.border;
        const valueColor = isActive ? tone.fg : colors.text;
        const labelColor = isActive ? tone.fg : colors.muted;

        return (
          <TouchableOpacity
            key={item.key}
            activeOpacity={0.8}
            onPress={() => onSelect(item.key)}
            style={[styles.card, { backgroundColor, borderColor }]}
          >
            {item.icon ? <Text style={styles.icon}>{item.icon}</Text> : null}
            <Text style={[styles.value, { color: valueColor }]}>{item.value}</Text>
            <Text style={[styles.label, { color: labelColor }]} numberOfLines={2}>
              {item.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  card: {
    flexBasis: '47%',
    flexGrow: 1,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    alignItems: 'center',
    borderWidth: 2,
  },
  icon: {
    fontSize: 22,
    marginBottom: 2,
  },
  value: {
    fontSize: 26,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  label: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    textAlign: 'center',
    marginTop: 2,
  },
});
