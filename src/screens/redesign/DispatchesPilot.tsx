import React, { useState } from 'react';
import { View, Text, Image, Modal, Pressable, ScrollView } from 'react-native';
import { RList, RRow, RAmount, RPill } from '../../components/redesign/RList';
import { useTheme } from '../../theme/ThemeContext';
import { spacing, radius } from '../../theme';
import { cmpText } from '../../lib/text';
import { Dispatch } from '../../types/database';

const ASSET_OPTIONS = [
  { label: 'Vehículo', value: 'vehiculo' },
  { label: 'Maquinaria', value: 'maquinaria' },
];

const fmtMonto = (n: number) => (Math.round((Number(n) || 0) * 100) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 });

/** Resumen restilizado: litros a MÁQUINAS por día y por máquina (sobre lo visible). */
function DailyMachineLiters({ rows }: { rows: Dispatch[] }) {
  const { colors } = useTheme();
  const maq = rows.filter((d: any) => d.asset_kind === 'maquinaria');
  if (maq.length === 0) return null;
  const byDay = new Map<string, number>();
  const byMachine = new Map<string, number>();
  maq.forEach((d: any) => {
    const day = String(d.dispatch_date).slice(0, 10);
    byDay.set(day, (byDay.get(day) || 0) + (Number(d.liters) || 0));
    const code = d.machine?.code || '—';
    byMachine.set(code, (byMachine.get(code) || 0) + (Number(d.liters) || 0));
  });
  const days = Array.from(byDay.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  const machines = Array.from(byMachine.entries()).sort((a, b) => b[1] - a[1] || cmpText(a[0], b[0]));
  const total = maq.reduce((s, d: any) => s + (Number(d.liters) || 0), 0);
  const box = { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm } as const;
  const rowLine = { flexDirection: 'row' as const, justifyContent: 'space-between' as const, paddingVertical: 3, borderTopWidth: 1, borderTopColor: colors.border };
  const num = { color: colors.text, fontWeight: '700' as const, fontSize: 13, fontVariant: ['tabular-nums'] as any };
  return (
    <>
      <View style={box}>
        <Text style={{ color: colors.brand, fontWeight: '900', fontSize: 13, marginBottom: spacing.xs, letterSpacing: 0.3 }}>⛽ LITROS A MÁQUINAS POR DÍA</Text>
        {days.slice(0, 12).map(([day, l]) => (
          <View key={day} style={rowLine}>
            <Text style={{ color: colors.muted, fontSize: 13 }}>{day}</Text>
            <Text style={num}>{fmtMonto(l)} L</Text>
          </View>
        ))}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingTop: spacing.xs, marginTop: spacing.xs, borderTopWidth: 2, borderTopColor: colors.border }}>
          <Text style={{ color: colors.text, fontWeight: '900', fontSize: 13 }}>Total{days.length > 12 ? ` (${days.length} días)` : ''}</Text>
          <Text style={{ color: colors.brand, fontWeight: '900', fontSize: 14, fontVariant: ['tabular-nums'] as any }}>{fmtMonto(total)} L</Text>
        </View>
      </View>
      <View style={box}>
        <Text style={{ color: colors.brand, fontWeight: '900', fontSize: 13, marginBottom: spacing.xs, letterSpacing: 0.3 }}>🚜 LITROS POR MÁQUINA</Text>
        {machines.slice(0, 15).map(([code, l]) => (
          <View key={code} style={rowLine}>
            <Text style={{ color: colors.text, fontSize: 13, fontWeight: '600' }} numberOfLines={1}>{code}</Text>
            <Text style={num}>{fmtMonto(l)} L</Text>
          </View>
        ))}
        {machines.length > 15 ? <Text style={{ color: colors.muted, fontSize: 11, marginTop: 4 }}>+{machines.length - 15} máquina(s) más…</Text> : null}
      </View>
    </>
  );
}

/**
 * PILOTO DE REDISEÑO — Consumos/Despachos. Mismos campos y lógica que
 * DispatchesScreen (crea/edita en `dispatches`; el trigger valida stock disponible),
 * con el look nuevo. Reusa RList → RecordForm.
 */
export default function DispatchesPilot() {
  const { colors } = useTheme();
  const [viewPhoto, setViewPhoto] = useState<string | null>(null);

  return (
    <>
      <RList<Dispatch>
        title="Consumos"
        table="dispatches"
        orderBy="dispatch_date"
        select="*, machine:machinery_id(code)"
        editable
        dateField="dispatch_date"
        emptyIcon="⛽"
        emptyTitle="Sin consumos"
        emptySubtitle="Registra los despachos a vehículos o maquinaria."
        formTitle="Nuevo consumo"
        subtitle={(rows) => {
          const l = rows.reduce((s, r) => s + (Number(r.liters) || 0), 0);
          return `${rows.length} consumo(s) · ${l.toLocaleString()} L`;
        }}
        headerExtra={(shown) => <DailyMachineLiters rows={shown} />}
        formFields={[
          { key: 'dispatch_date', label: 'Fecha', type: 'date', required: true },
          { key: 'asset_kind', label: 'Tipo de activo', type: 'select', options: ASSET_OPTIONS, required: true },
          { key: 'vehicle_id', label: 'Vehículo (placa)', type: 'lookup', table: 'vehicles', labelCol: 'plate', createColumn: 'plate', required: true, showIf: (v) => v.asset_kind === 'vehiculo' },
          { key: 'machinery_id', label: 'Maquinaria (código)', type: 'lookup', table: 'machinery', labelCol: 'code', required: true, showIf: (v) => v.asset_kind === 'maquinaria' },
          { key: 'liters', label: 'Litros', type: 'number', required: true },
          { key: 'odometer_km', label: 'Odómetro (km)', type: 'number' },
          { key: 'hourmeter_h', label: 'Horómetro (h)', type: 'number' },
          { key: 'driver_operator', label: 'Conductor/Operador', type: 'text' },
          { key: 'tank_id', label: 'Tanque origen (opcional · vacío = directo de bomba)', type: 'lookup', table: 'tanks', labelCol: 'name' },
        ]}
        renderItem={(d) => {
          const fotos = ((d as any).photos ?? []).filter(Boolean) as string[];
          return (
            <>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <RAmount tone="brand">{Number(d.liters).toLocaleString()} L</RAmount>
                <RPill label={String(d.asset_kind).toUpperCase()} tone="neutral" />
              </View>
              <View style={{ marginTop: 6 }}>
                <RRow label="Fecha" value={d.dispatch_date} />
                {(d as any).machine?.code ? <RRow label="Máquina" value={(d as any).machine.code} /> : null}
                {d.driver_operator ? <RRow label="Conductor/Operador" value={d.driver_operator} /> : null}
                {d.odometer_km != null ? <RRow label="Odómetro" value={`${d.odometer_km} km`} mono /> : null}
                {d.hourmeter_h != null ? <RRow label="Horómetro" value={`${d.hourmeter_h} h`} mono /> : null}
                {d.price_per_liter != null ? <RRow label="Monto/L" value={fmtMonto(d.price_per_liter)} mono /> : null}
                {d.total_amount != null ? <RRow label="Monto total" value={fmtMonto(d.total_amount)} mono /> : null}
              </View>
              {fotos.length > 0 ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm }}>
                  {fotos.map((uri, i) => (
                    <Pressable key={`${uri}-${i}`} onPress={() => setViewPhoto(uri)}>
                      <Image source={{ uri }} style={{ width: 64, height: 64, maxWidth: '100%', borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceAlt }} resizeMode="cover" />
                    </Pressable>
                  ))}
                </View>
              ) : null}
            </>
          );
        }}
      />

      {/* Visor de foto a pantalla completa. */}
      <Modal visible={viewPhoto != null} transparent animationType="fade" onRequestClose={() => setViewPhoto(null)}>
        <Pressable onPress={() => setViewPhoto(null)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', justifyContent: 'center', alignItems: 'center', padding: spacing.md }}>
          <ScrollView style={{ maxWidth: '100%', maxHeight: '100%' }} contentContainerStyle={{ justifyContent: 'center', alignItems: 'center' }} maximumZoomScale={4} minimumZoomScale={1}>
            {viewPhoto ? <Image source={{ uri: viewPhoto }} style={{ width: 320, height: 320, maxWidth: '100%' }} resizeMode="contain" /> : null}
          </ScrollView>
          <Pressable onPress={() => setViewPhoto(null)} style={{ position: 'absolute', top: spacing.lg, right: spacing.lg, backgroundColor: colors.surface, borderRadius: radius.md, paddingVertical: spacing.xs, paddingHorizontal: spacing.md, borderWidth: 1, borderColor: colors.border }}>
            <Text style={{ color: colors.text, fontWeight: '700', fontSize: 14 }}>Cerrar ✕</Text>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}
