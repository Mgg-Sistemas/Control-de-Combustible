import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, Modal, TextInput, ScrollView, ActivityIndicator, RefreshControl, Image } from 'react-native';
import { Screen, Card, SectionTitle } from '../components/ui';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import { useRealtimeRefresh } from '../hooks/useRealtime';
import { fetchWashCountsByMachine, fetchMachineWashes, LmMachineCount, LmWash } from '../lib/lavadoMaquinaria';

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

// Mes de negocio actual en Caracas (UTC-4).
function mesActual(): { y: number; m: number } {
  const car = new Date(Date.now() - 4 * 3600000);
  return { y: car.getUTCFullYear(), m: car.getUTCMonth() };
}
// Rango [from, to) del mes en hora Caracas (00:00 del 1° → 00:00 del 1° del mes siguiente).
function rangoMes(y: number, m: number): { fromISO: string; toISO: string } {
  const from = Date.UTC(y, m, 1, 4, 0, 0);            // 00:00 Caracas del 1°
  const to = Date.UTC(m === 11 ? y + 1 : y, (m + 1) % 12, 1, 4, 0, 0);
  return { fromISO: new Date(from).toISOString(), toISO: new Date(to).toISOString() };
}
const horaCaracas = (iso: string) =>
  new Date(iso).toLocaleString('es-VE', { timeZone: 'America/Caracas', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: true });

/**
 * Panel de PC del módulo LAVADO DE MAQUINARIA — "Máquinas lavadas". Muestra, por
 * mes, cuántas veces se lavó cada máquina; al tocar una se ve el detalle (cada
 * lavado con su fecha, tipo, quién y foto). Solo lectura.
 */
export default function LavadoMaquinariaDashboardScreen() {
  const { colors } = useTheme();
  const [{ y, m }, setMes] = useState(mesActual());
  const [rows, setRows] = useState<LmMachineCount[]>([]);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Drill-down de una máquina.
  const [detail, setDetail] = useState<{ code: string; washes: LmWash[] } | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const range = useMemo(() => rangoMes(y, m), [y, m]);

  const load = useCallback(async () => {
    try {
      const data = await fetchWashCountsByMachine(range.fromISO, range.toISO);
      setRows(data);
    } finally {
      setLoading(false);
    }
  }, [range.fromISO, range.toISO]);
  useEffect(() => { setLoading(true); load(); }, [load]);
  useRealtimeRefresh(['lm_washes'], () => load(), { debounceMs: 800, maxWaitMs: 3000 });

  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const prevMes = () => setMes(({ y, m }) => (m === 0 ? { y: y - 1, m: 11 } : { y, m: m - 1 }));
  const nextMes = () => setMes(({ y, m }) => (m === 11 ? { y: y + 1, m: 0 } : { y, m: m + 1 }));

  const term = q.toLowerCase().trim();
  const filtered = useMemo(
    () => rows.filter((r) => !term || `${r.code} ${r.serial ?? ''} ${r.company}`.toLowerCase().includes(term)),
    [rows, term],
  );
  const totalLavados = useMemo(() => rows.reduce((a, r) => a + r.count, 0), [rows]);

  const abrirDetalle = async (r: LmMachineCount) => {
    setDetail({ code: r.code, washes: [] });
    setDetailLoading(true);
    try {
      const ws = await fetchMachineWashes(r.machinery_id, range.fromISO, range.toISO);
      setDetail({ code: r.code, washes: ws });
    } finally {
      setDetailLoading(false);
    }
  };

  return (
    <Screen>
      <Text style={{ color: colors.text, fontSize: 20, fontWeight: '800', marginBottom: spacing.sm }}>🚿 Máquinas lavadas</Text>

      {/* Selector de mes */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm }}>
        <TouchableOpacity onPress={prevMes} style={{ padding: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border }}>
          <Text style={{ color: colors.text, fontWeight: '800' }}>◀</Text>
        </TouchableOpacity>
        <Text style={{ color: colors.text, fontWeight: '800', fontSize: 16 }}>{MESES[m]} {y}</Text>
        <TouchableOpacity onPress={nextMes} style={{ padding: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border }}>
          <Text style={{ color: colors.text, fontWeight: '800' }}>▶</Text>
        </TouchableOpacity>
      </View>

      {/* KPIs */}
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: spacing.sm }}>
        <Card style={{ flex: 1, alignItems: 'center' }}>
          <Text style={{ color: colors.brandText, fontSize: 22, fontWeight: '900' }}>{totalLavados}</Text>
          <Text style={{ color: colors.muted, fontSize: 12 }}>Lavados del mes</Text>
        </Card>
        <Card style={{ flex: 1, alignItems: 'center' }}>
          <Text style={{ color: colors.brandText, fontSize: 22, fontWeight: '900' }}>{rows.length}</Text>
          <Text style={{ color: colors.muted, fontSize: 12 }}>Máquinas lavadas</Text>
        </Card>
      </View>

      <TextInput
        value={q} onChangeText={setQ} placeholder="Buscar máquina, serial, empresa…" placeholderTextColor={colors.muted}
        style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, color: colors.text, marginBottom: spacing.sm }}
      />

      {loading ? (
        <ActivityIndicator style={{ marginTop: spacing.xl }} color={colors.brand} />
      ) : (
        <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand} />}>
          <SectionTitle>Veces lavada este mes · {filtered.length} máquina(s)</SectionTitle>
          {filtered.length === 0 ? (
            <Card><Text style={{ color: colors.muted }}>No hay lavados registrados en {MESES[m]} {y}.</Text></Card>
          ) : filtered.map((r) => (
            <TouchableOpacity key={r.machinery_id} onPress={() => abrirDetalle(r)}>
              <Card style={{ marginBottom: spacing.xs }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.text, fontWeight: '800' }}>{r.code}</Text>
                    <Text style={{ color: colors.muted, fontSize: 12 }}>{r.serial ? `${r.serial} · ` : ''}{r.company}{r.last_at ? ` · último: ${horaCaracas(r.last_at)}` : ''}</Text>
                  </View>
                  <View style={{ backgroundColor: colors.brand, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 6, minWidth: 44, alignItems: 'center' }}>
                    <Text style={{ color: '#fff', fontWeight: '900' }}>{r.count}</Text>
                  </View>
                </View>
              </Card>
            </TouchableOpacity>
          ))}
          <View style={{ height: 40 }} />
        </ScrollView>
      )}

      {/* Detalle de una máquina */}
      <Modal visible={!!detail} animationType="slide" transparent onRequestClose={() => setDetail(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: colors.background, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg, maxHeight: '85%' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm }}>
              <Text style={{ color: colors.text, fontSize: 18, fontWeight: '800' }}>{detail?.code} · {MESES[m]} {y}</Text>
              <TouchableOpacity onPress={() => setDetail(null)}><Text style={{ color: colors.muted, fontWeight: '700' }}>Cerrar</Text></TouchableOpacity>
            </View>
            {detailLoading ? (
              <ActivityIndicator color={colors.brand} />
            ) : (
              <ScrollView>
                <Text style={{ color: colors.muted, fontSize: 13, marginBottom: spacing.sm }}>{detail?.washes.length ?? 0} lavado(s) este mes</Text>
                {(detail?.washes ?? []).map((w) => (
                  <Card key={w.id} style={{ marginBottom: spacing.xs }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                      {w.photo ? <Image source={{ uri: w.photo }} style={{ width: 44, height: 44, borderRadius: radius.sm }} /> : <Text style={{ fontSize: 22 }}>🚿</Text>}
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: colors.text, fontWeight: '700' }}>{horaCaracas(w.washed_at)}{w.tipo ? ` · ${w.tipo}` : ''}</Text>
                        <Text style={{ color: colors.muted, fontSize: 12 }}>{w.washed_by_name ?? '—'}</Text>
                        {!!w.observaciones && <Text style={{ color: colors.muted, fontSize: 12, fontStyle: 'italic' }}>{w.observaciones}</Text>}
                      </View>
                    </View>
                  </Card>
                ))}
                <View style={{ height: 30 }} />
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </Screen>
  );
}
