import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Screen, Card, SectionTitle, EmptyState, Loading, Badge } from '../components/ui';
import { ConfigBanner } from '../components/ConfigBanner';
import { useTable } from '../hooks/useTable';
import { supabase } from '../lib/supabase';
import { TankLevel } from '../types/database';
import { spacing, radius } from '../theme';
import { useTheme } from '../theme/ThemeContext';

function levelTone(pct: number | null): 'success' | 'warning' | 'danger' {
  if (pct === null) return 'warning';
  if (pct <= 15) return 'danger';
  if (pct <= 30) return 'warning';
  return 'success';
}

function todayISO(): string {
  const d = new Date();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Tarjeta de métrica: se puede tocar para ir al módulo con la info real. */
function StatCard({
  label,
  value,
  color,
  onPress,
  flex = 1,
}: {
  label: string;
  value: React.ReactNode;
  color: string;
  onPress?: () => void;
  flex?: number;
}) {
  const { colors } = useTheme();
  const inner = (
    <>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ color: colors.muted, fontSize: 12 }}>{label}</Text>
        {onPress ? <Text style={{ color: colors.muted, fontSize: 12 }}>›</Text> : null}
      </View>
      <Text style={{ fontSize: 20, fontWeight: '700', color }}>{value}</Text>
    </>
  );
  if (onPress) {
    return (
      <TouchableOpacity activeOpacity={0.7} onPress={onPress} style={{ flex }}>
        <Card>{inner}</Card>
      </TouchableOpacity>
    );
  }
  return <Card style={{ flex }}>{inner}</Card>;
}

export default function DashboardScreen({ navigation }: any) {
  const { colors } = useTheme();
  const { data: tanks, loading } = useTable<TankLevel>('tank_levels');

  const [activeMachines, setActiveMachines] = useState<number | null>(null);
  const [activeLocations, setActiveLocations] = useState<number | null>(null);
  const [activeAssets, setActiveAssets] = useState<number | null>(null);

  useEffect(() => {
    (async () => {
      const [{ data: rounds }, { count: locCount }, { count: machCount }, { count: vehCount }] = await Promise.all([
        // Rondas "en verde" (operativas) de hoy → máquinas activas hoy.
        supabase.from('machine_rounds').select('machinery_id').eq('round_date', todayISO()).eq('status', 'operativa'),
        // Máquinas con coordenadas → mismas que muestra el mapa.
        supabase.from('machinery').select('id', { count: 'exact', head: true }).not('latitude', 'is', null),
        // Catálogo: maquinaria + maquinaria pesada activa.
        supabase.from('machinery').select('id', { count: 'exact', head: true }).eq('active', true),
        // Catálogo: vehículos activos.
        supabase.from('vehicles').select('id', { count: 'exact', head: true }).eq('active', true),
      ]);
      const uniq = new Set((rounds ?? []).map((r: any) => r.machinery_id));
      setActiveMachines(uniq.size);
      setActiveLocations(locCount ?? 0);
      setActiveAssets((machCount ?? 0) + (vehCount ?? 0));
    })();
  }, []);

  const totalCurrent = tanks.reduce((s, t) => s + Number(t.current_l || 0), 0);
  const lowTanks = tanks.filter((t) => (t.pct ?? 0) <= 30).length;


  return (
    <Screen>
      <ConfigBanner />
      <Card style={{ backgroundColor: colors.primary }}>
        <Text style={{ color: colors.primaryContrast, fontWeight: '800', fontSize: 16, textAlign: 'center' }}>
          BIENVENIDO AL CONTROL INTERNO DE
        </Text>
        <Text style={{ color: colors.primaryContrast, fontWeight: '800', fontSize: 16, textAlign: 'center' }}>
          BAHIA SUNSET HOTEL BOUTIQUE, C.A
        </Text>
      </Card>
      <SectionTitle>Resumen</SectionTitle>

      <View style={{ flexDirection: 'row', gap: spacing.md }}>
        <StatCard
          label="Máquinas activas (rondas)"
          value={activeMachines === null ? '…' : activeMachines}
          color={activeMachines ? colors.success : colors.text}
          onPress={() => navigation?.navigate('ControlMaquinaria')}
        />
        <StatCard
          label="Ubicaciones activas"
          value={activeLocations === null ? '…' : activeLocations}
          color={activeLocations ? colors.primary : colors.text}
          onPress={() => navigation?.navigate('Map')}
        />
      </View>

      <View style={{ flexDirection: 'row', gap: spacing.md }}>
        <StatCard
          label="Existencia total"
          value={`${totalCurrent.toLocaleString()} L`}
          color={colors.text}
          onPress={() => navigation?.navigate('More', { screen: 'Tanks' })}
        />
        <StatCard
          label="Maquinaria/Vehículos activos"
          value={activeAssets === null ? '…' : activeAssets}
          color={activeAssets ? colors.primary : colors.text}
          onPress={() => navigation?.navigate('Equipos')}
        />
      </View>

      <StatCard
        label="Tanques con stock bajo"
        value={`${lowTanks} / ${tanks.length}`}
        color={lowTanks ? colors.warning : colors.success}
        onPress={() => navigation?.navigate('More', { screen: 'Tanks' })}
      />

      <SectionTitle>Cisternas / Niveles de tanque</SectionTitle>
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
            <TouchableOpacity key={t.id} activeOpacity={0.7} onPress={() => navigation?.navigate('More', { screen: 'Tanks' })}>
              <Card>
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
            </TouchableOpacity>
          );
        })
      )}
    </Screen>
  );
}
