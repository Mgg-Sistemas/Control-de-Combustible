import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  TouchableOpacity,
  ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { spacing, radius, AppColors } from '../theme';
import { useTheme } from '../theme/ThemeContext';

export function Screen({
  children,
  scroll = true,
  scrollRef: extRef,
  bg,
}: {
  children: React.ReactNode;
  scroll?: boolean;
  scrollRef?: React.MutableRefObject<ScrollView | null>;
  bg?: string; // color de fondo opcional (por defecto usa el del tema)
}) {
  const { colors } = useTheme();
  const background = bg ?? colors.background;
  const scrollRef = React.useRef<ScrollView>(null);
  const setScrollRef = (node: ScrollView | null) => {
    scrollRef.current = node;
    if (extRef) extRef.current = node;
  };
  const [showTop, setShowTop] = React.useState(false);

  if (!scroll) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: background }} edges={['top']}>
        <View style={{ flex: 1, backgroundColor: background }}>{children}</View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: background }} edges={['top']}>
      <ScrollView
        ref={setScrollRef}
        style={{ flex: 1, backgroundColor: background }}
        contentContainerStyle={{ padding: spacing.md, gap: spacing.md }}
        scrollEventThrottle={16}
        onScroll={(e) => {
          const y = e.nativeEvent.contentOffset.y;
          setShowTop((prev) => (prev !== y > 400 ? y > 400 : prev));
        }}
      >
        {children}
      </ScrollView>
      {showTop ? (
        <TouchableOpacity
          onPress={() => scrollRef.current?.scrollTo({ y: 0, animated: true })}
          activeOpacity={0.8}
          accessibilityLabel="Volver al inicio"
          style={{
            position: 'absolute',
            right: spacing.md,
            bottom: spacing.lg,
            width: 48,
            height: 48,
            borderRadius: 24,
            backgroundColor: colors.primary,
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: 1,
            borderColor: colors.primary,
            shadowColor: '#000',
            shadowOpacity: 0.25,
            shadowRadius: 6,
            shadowOffset: { width: 0, height: 3 },
            elevation: 5,
          }}
        >
          <Text style={{ color: colors.primaryContrast, fontSize: 22, fontWeight: '900', marginTop: -2 }}>↑</Text>
        </TouchableOpacity>
      ) : null}
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
