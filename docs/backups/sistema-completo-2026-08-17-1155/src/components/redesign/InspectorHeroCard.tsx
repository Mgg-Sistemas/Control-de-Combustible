import React from 'react';
import { View, Text, TouchableOpacity, Platform } from 'react-native';
import { spacing, radius } from '../../theme';
import { useTheme } from '../../theme/ThemeContext';

export type HeroAction = {
  key: string;
  label: string;
  icon: string;
  color?: string;
  onPress: () => void;
};

export type InspectorHeroCardProps = {
  /** Línea de estadísticas, p. ej. "Revisadas hoy: 12 · Mis máquinas: 28". */
  statsLine?: string;
  /** CTA principal: escanear QR. */
  onScanPress: () => void;
  /** 0, 1 o 2 acciones secundarias (grid responsivo). */
  secondaryActions?: HeroAction[];
};

export default function InspectorHeroCard({
  statsLine,
  onScanPress,
  secondaryActions,
}: InspectorHeroCardProps) {
  const { colors } = useTheme();
  const hasSecondary = !!secondaryActions && secondaryActions.length > 0;

  return (
    <View
      style={{
        borderRadius: radius.lg,
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
        padding: spacing.md,
      }}
    >
      {statsLine ? (
        <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.sm }}>
          {statsLine}
        </Text>
      ) : null}

      <TouchableOpacity
        activeOpacity={0.85}
        onPress={onScanPress}
        style={[{
          backgroundColor: '#0F172A',
          borderRadius: 16,
          aspectRatio: 1.6,
          alignItems: 'center',
          justifyContent: 'center',
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 6 },
          shadowOpacity: 0.25,
          shadowRadius: 12,
          elevation: 6,
        },
        // En PC (web) la tarjeta ocupa TODO el ancho → con aspectRatio 1.6 el QR queda
        // gigante. Se acota a un tamaño "de teléfono" (máx. 360 de ancho) centrado.
        Platform.OS === 'web' ? { maxWidth: 360, width: '100%', alignSelf: 'center' } : null]}
      >
        <Text style={{ fontSize: 40 }}>📷</Text>
        <Text
          style={{
            color: '#FFFFFF',
            fontWeight: '900',
            fontSize: 18,
            letterSpacing: 0.5,
            marginTop: spacing.xs,
          }}
        >
          ESCANEAR QR
        </Text>
        <Text style={{ color: '#FFFFFF', opacity: 0.85, fontSize: 11, marginTop: 2 }}>
          Apunta al código de la máquina
        </Text>
      </TouchableOpacity>

      {hasSecondary ? (
        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: spacing.sm,
            marginTop: spacing.sm,
          }}
        >
          {secondaryActions!.map((action) => (
            <TouchableOpacity
              key={action.key}
              onPress={action.onPress}
              activeOpacity={0.85}
              style={{
                flexGrow: 1,
                flexBasis: secondaryActions!.length > 1 ? '47%' : '100%',
                borderWidth: 1.5,
                borderColor: action.color ?? colors.primary,
                borderRadius: radius.md,
                paddingVertical: spacing.sm + 2,
                alignItems: 'center',
                justifyContent: 'center',
                flexDirection: 'row',
                gap: 6,
              }}
            >
              <Text style={{ fontSize: 18 }}>{action.icon}</Text>
              <Text
                style={{
                  color: action.color ?? colors.primary,
                  fontWeight: '800',
                  fontSize: 12.5,
                  textAlign: 'center',
                }}
              >
                {action.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : null}
    </View>
  );
}
