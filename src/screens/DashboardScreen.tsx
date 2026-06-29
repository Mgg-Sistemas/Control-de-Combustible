import React from 'react';
import { View, Text } from 'react-native';
import { Screen, Card, SectionTitle, EmptyState, Loading, Badge } from '../components/ui';
import { ConfigBanner } from '../components/ConfigBanner';
import { useTable } from '../hooks/useTable';
import { TankLevel } from '../types/database';
import { spacing, radius } from '../theme';
import { useTheme } from '../theme/ThemeContext';

function levelTone(pct: number | null): 'success' | 'warning' | 'danger' {
  if (pct === null) return 'warning';
  if (pct <= 15) return 'danger';
  if (pct <= 30) return 'warning';
  return 'success';
}

export default function DashboardScreen() {
  const { colors } = useTheme();
  const { data: tanks, loading } = useTable<TankLevel>('tank_levels');

  const totalCapacity = tanks.reduce((s, t) => s + Number(t.capacity_l || 0), 0);
  const totalCurrent = tanks.reduce((s, t) => s + Number(t.current_l || 0), 0);
  const lowTanks = tanks.filter((t) => (t.pct ?? 0) <= 30).length;

  return (
    <Screen>
      <ConfigBanner />
      <SectionTitle>Resumen</SectionTitle>

      <View style={{ flexDirection: 'row', gap: spacing.md }}>
        <Card style={{ flex: 1 }}>
          <Text style={{ color: colors.muted, fontSize: 12 }}>Existencia total</Text>
          <Text style={{ fontSize: 20, fontWeight: '700', color: colors.text }}>
            {totalCurrent.toLocaleString()} L
          </Text>
        </Card>
        <Card style={{ flex: 1 }}>
          <Text style={{ color: colors.muted, fontSize: 12 }}>Capacidad total</Text>
          <Text style={{ fontSize: 20, fontWeight: '700', color: colors.text }}>
            {totalCapacity.toLocaleString()} L
          </Text>
        </Card>
      </View>

      <Card>
        <Text style={{ color: colors.muted, fontSize: 12 }}>Tanques con stock bajo</Text>
        <Text style={{ fontSize: 20, fontWeight: '700', color: lowTanks ? colors.warning : colors.success }}>
          {lowTanks} / {tanks.length}
        </Text>
      </Card>

      <SectionTitle>Niveles de tanque</SectionTitle>
      {loading ? (
        <Loading />
      ) : tanks.length === 0 ? (
        <EmptyState
          title="Sin tanques registrados"
          subtitle="Cuando configures Supabase y agregues tanques, verás aquí sus niveles."
        />
      ) : (
        tanks.map((t) => {
          const pct = Math.max(0, Math.min(100, t.pct ?? 0));
          const tone = levelTone(t.pct);
          const barColor =
            tone === 'danger' ? colors.danger : tone === 'warning' ? colors.warning : colors.success;
          return (
            <Card key={t.id}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ fontWeight: '600', color: colors.text }}>{t.name}</Text>
                <Badge label={t.fuel} />
              </View>
              <Text style={{ color: colors.muted, fontSize: 13 }}>
                {Number(t.current_l).toLocaleString()} / {Number(t.capacity_l).toLocaleString()} L ({pct}%)
              </Text>
              <View style={{ height: 8, backgroundColor: colors.surfaceAlt, borderRadius: radius.pill }}>
                <View
                  style={{
                    height: 8,
                    width: `${pct}%`,
                    backgroundColor: barColor,
                    borderRadius: radius.pill,
                  }}
                />
              </View>
            </Card>
          );
        })
      )}
    </Screen>
  );
}
