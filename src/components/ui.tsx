import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { spacing, radius, AppColors } from '../theme';
import { useTheme } from '../theme/ThemeContext';

export function Screen({
  children,
  scroll = true,
}: {
  children: React.ReactNode;
  scroll?: boolean;
}) {
  const { colors } = useTheme();
  const Container: any = scroll ? ScrollView : View;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top']}>
      <Container
        style={{ flex: 1, backgroundColor: colors.background }}
        contentContainerStyle={scroll ? { padding: spacing.md, gap: spacing.md } : undefined}
      >
        {children}
      </Container>
    </SafeAreaView>
  );
}

export function Card({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: ViewStyle;
}) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        {
          backgroundColor: colors.surface,
          borderRadius: radius.md,
          padding: spacing.md,
          borderWidth: 1,
          borderColor: colors.border,
          gap: spacing.xs,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  const { typography } = useTheme();
  return <Text style={[typography.title, { marginBottom: spacing.xs }]}>{children}</Text>;
}

export function EmptyState({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  const { typography } = useTheme();
  return (
    <Card style={{ alignItems: 'center', paddingVertical: spacing.xl }}>
      <Text style={typography.subtitle}>{title}</Text>
      {subtitle ? (
        <Text style={[typography.muted, { textAlign: 'center', marginTop: spacing.xs }]}>
          {subtitle}
        </Text>
      ) : null}
    </Card>
  );
}

export function Loading() {
  const { colors } = useTheme();
  return (
    <View style={{ paddingVertical: spacing.xl, alignItems: 'center' }}>
      <ActivityIndicator color={colors.primary} />
    </View>
  );
}

export function Badge({
  label,
  tone = 'muted',
}: {
  label: string;
  tone?: 'success' | 'warning' | 'danger' | 'muted';
}) {
  const { colors } = useTheme();
  const toneColor =
    tone === 'success'
      ? colors.success
      : tone === 'warning'
      ? colors.warning
      : tone === 'danger'
      ? colors.danger
      : colors.muted;
  return (
    <View style={[styles.badge, { borderColor: toneColor }]}>
      <Text style={{ color: toneColor, fontSize: 12, fontWeight: '600' }}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    alignSelf: 'flex-start',
  },
});

// Reexport para componentes que construyen estilos por tema.
export type { AppColors };
