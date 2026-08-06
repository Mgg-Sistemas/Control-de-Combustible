import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { spacing } from '../../theme';
import { useTheme } from '../../theme/ThemeContext';

export type InspectorHeaderBarProps = {
  /** Nombre a mostrar del inspector. */
  name: string;
  /** Línea pequeña y tenue debajo del nombre (p. ej. etiqueta de rol). */
  subtitle?: string;
  /** Cantidad de notificaciones sin leer; 0/undefined = sin insignia. */
  notifCount?: number;
  /** Toque sobre el ícono de campana. */
  onNotifPress?: () => void;
  /** Toque sobre el botón de menú/avatar (abre un menú externo — este componente no lo renderiza). */
  onMenuPress: () => void;
};

function getInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';
  const first = words[0]?.[0] ?? '';
  const last = words.length > 1 ? words[words.length - 1]?.[0] ?? '' : '';
  return (first + last).toUpperCase();
}

export default function InspectorHeaderBar({
  name,
  subtitle,
  notifCount,
  onNotifPress,
  onMenuPress,
}: InspectorHeaderBarProps) {
  const { colors } = useTheme();
  const initials = getInitials(name);
  const hasBadge = !!notifCount && notifCount > 0;
  const badgeLabel = hasBadge && notifCount! > 9 ? '9+' : String(notifCount ?? '');

  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}
    >
      <View style={{ flexShrink: 1, marginRight: spacing.sm }}>
        <Text
          style={{ color: colors.text, fontWeight: '600', fontSize: 14 }}
          numberOfLines={1}
        >
          {name}
        </Text>
        {subtitle ? (
          <Text
            style={{ color: colors.muted, fontSize: 11, marginTop: 2 }}
            numberOfLines={1}
          >
            {subtitle}
          </Text>
        ) : null}
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 4 }}>
        <View style={{ position: 'relative' }}>
          <TouchableOpacity
            onPress={onNotifPress}
            disabled={!onNotifPress}
            activeOpacity={onNotifPress ? 0.7 : 1}
            style={{ opacity: onNotifPress ? 1 : 0.4 }}
            accessibilityLabel="Notificaciones"
          >
            <Text style={{ fontSize: 20 }}>🔔</Text>
          </TouchableOpacity>
          {hasBadge ? (
            <View
              style={{
                position: 'absolute',
                top: -4,
                right: -6,
                minWidth: 16,
                height: 16,
                borderRadius: 8,
                backgroundColor: colors.danger,
                alignItems: 'center',
                justifyContent: 'center',
                paddingHorizontal: 3,
              }}
            >
              <Text style={{ color: '#FFFFFF', fontSize: 9, fontWeight: '700' }}>
                {badgeLabel}
              </Text>
            </View>
          ) : null}
        </View>

        <TouchableOpacity
          onPress={onMenuPress}
          activeOpacity={0.7}
          accessibilityLabel="Menú"
          style={{
            width: 34,
            height: 34,
            borderRadius: 17,
            backgroundColor: colors.surfaceAlt,
            borderWidth: 1,
            borderColor: colors.border,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ color: colors.text, fontWeight: '800', fontSize: initials ? 13 : 16 }}>
            {initials || '☰'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
