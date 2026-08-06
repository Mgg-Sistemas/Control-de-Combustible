import React from 'react';
import { View, Text, TextInput, TouchableOpacity } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { spacing, radius } from '../../theme';

export type InspectorSearchBarProps = {
  value: string;
  onChange: (text: string) => void;
  placeholder?: string;
  segments?: { key: string; label: string }[];
  segmentValue?: string;
  onSegmentChange?: (key: string) => void;
};

export default function InspectorSearchBar(props: InspectorSearchBarProps) {
  const { value, onChange, placeholder, segments, segmentValue, onSegmentChange } = props;
  const { colors } = useTheme();

  const showSegments = !!segments && segments.length >= 2;

  return (
    <View>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: colors.surfaceAlt,
          borderRadius: radius.pill,
          borderWidth: 1,
          borderColor: colors.border,
          paddingHorizontal: spacing.md,
        }}
      >
        <Text style={{ fontSize: 15, marginRight: spacing.xs, color: colors.muted }}>🔎</Text>
        <TextInput
          value={value}
          onChangeText={onChange}
          placeholder={placeholder ?? 'Buscar máquina…'}
          placeholderTextColor={colors.muted}
          style={{ flex: 1, color: colors.text, fontSize: 14, paddingVertical: 11 }}
        />
        {value.length > 0 && (
          <TouchableOpacity onPress={() => onChange('')}>
            <Text style={{ color: colors.muted, fontWeight: '800', paddingLeft: spacing.xs }}>✕</Text>
          </TouchableOpacity>
        )}
      </View>

      {showSegments && (
        <View
          style={{
            flexDirection: 'row',
            backgroundColor: colors.surfaceAlt,
            borderRadius: radius.md,
            padding: 3,
            gap: 2,
            marginTop: spacing.sm,
          }}
        >
          {segments!.map((segment) => {
            const selected = segment.key === segmentValue;
            return (
              <TouchableOpacity
                key={segment.key}
                activeOpacity={0.8}
                onPress={() => onSegmentChange?.(segment.key)}
                style={{
                  flex: 1,
                  alignItems: 'center',
                  paddingVertical: 8,
                  borderRadius: radius.md - 2,
                  backgroundColor: selected ? colors.primary : 'transparent',
                }}
              >
                <Text
                  numberOfLines={1}
                  style={{
                    fontSize: 12.5,
                    color: selected ? colors.primaryContrast : colors.text,
                    fontWeight: selected ? '800' : '600',
                  }}
                >
                  {segment.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}
    </View>
  );
}
