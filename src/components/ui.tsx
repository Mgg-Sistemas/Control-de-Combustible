import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  TouchableOpacity,
  ViewStyle,
  Image,
  ImageSourcePropType,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { spacing, radius, AppColors } from '../theme';
import { useTheme } from '../theme/ThemeContext';

export function Screen({
  children,
  scroll = true,
  scrollRef: extRef,
  bg,
  bgImage,
  bgImageOpacity = 0.08,
}: {
  children: React.ReactNode;
  scroll?: boolean;
  scrollRef?: React.MutableRefObject<ScrollView | null>;
  bg?: string; // color de fondo opcional (por defecto usa el del tema)
  bgImage?: ImageSourcePropType; // imagen de fondo (marca de agua) fija detrás del contenido
  bgImageOpacity?: number; // opacidad de la marca de agua (por defecto 0.08 = muy tenue)
}) {
  const { colors } = useTheme();
  const background = bg ?? colors.background;
  const scrollRef = React.useRef<ScrollView>(null);
  const setScrollRef = (node: ScrollView | null) => {
    scrollRef.current = node;
    if (extRef) extRef.current = node;
  };
  const [showTop, setShowTop] = React.useState(false);

  // Marca de agua fija (no scrollea): cubre toda la pantalla, muy atenuada.
  const Watermark = bgImage ? (
    <Image
      source={bgImage}
      resizeMode="cover"
      style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%', opacity: bgImageOpacity }}
    />
  ) : null;
  const scrollBg = bgImage ? 'transparent' : background;

  if (!scroll) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: background }} edges={['top']}>
        {Watermark}
        <View style={{ flex: 1, backgroundColor: scrollBg }}>{children}</View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: background }} edges={['top']}>
      {Watermark}
      <ScrollView
        ref={setScrollRef}
        style={{ flex: 1, backgroundColor: scrollBg }}
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

/**
 * Grupo tipo acordeón (p. ej. por empresa): cabecera con título + contador que,
 * al tocarse, despliega su contenido. Cerrado por defecto (listas compactas).
 */
export function AccordionGroup({
  title,
  count,
  icon = '🏢',
  defaultOpen = false,
  children,
}: {
  title: string;
  count?: number | string;
  icon?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const { colors } = useTheme();
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <View style={{ marginBottom: spacing.xs }}>
      <TouchableOpacity
        onPress={() => setOpen((o) => !o)}
        activeOpacity={0.7}
        style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: open ? colors.primary : colors.surfaceAlt, borderWidth: 1, borderColor: open ? colors.primary : colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md, marginBottom: spacing.sm }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flex: 1 }}>
          <Text style={{ color: open ? colors.primaryContrast : colors.muted, fontSize: 16 }}>{open ? '▾' : '▸'}</Text>
          <Text style={{ color: open ? colors.primaryContrast : colors.text, fontWeight: '800', fontSize: 15, flex: 1 }} numberOfLines={1}>{icon} {title}</Text>
        </View>
        {count != null ? (
          <View style={{ backgroundColor: open ? colors.primaryContrast : colors.primary, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2 }}>
            <Text style={{ color: open ? colors.primary : colors.primaryContrast, fontWeight: '800', fontSize: 13 }}>{count}</Text>
          </View>
        ) : null}
      </TouchableOpacity>
      {open ? children : null}
    </View>
  );
}

/**
 * Tarjeta desplegable: muestra `summary` (compacto, siempre visible) y al tocar
 * revela `detail`. Para listas/búsquedas: resultados compactos que el usuario
 * despliega cuando quiere ver el detalle.
 */
export function ExpandableCard({
  summary,
  detail,
  defaultOpen = false,
  style,
}: {
  summary: React.ReactNode;
  detail?: React.ReactNode;
  defaultOpen?: boolean;
  style?: ViewStyle;
}) {
  const { colors } = useTheme();
  const [open, setOpen] = React.useState(defaultOpen);
  const hasDetail = !!detail;
  return (
    <Card style={style}>
      <TouchableOpacity activeOpacity={hasDetail ? 0.7 : 1} onPress={() => hasDetail && setOpen((o) => !o)}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <View style={{ flex: 1 }}>{summary}</View>
          {hasDetail ? (
            <Text style={{ color: colors.muted, fontSize: 16, fontWeight: '900' }}>{open ? '▴' : '▾'}</Text>
          ) : null}
        </View>
      </TouchableOpacity>
      {hasDetail && open ? (
        <View style={{ marginTop: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border }}>
          {detail}
        </View>
      ) : null}
    </Card>
  );
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
