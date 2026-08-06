import React, { useState } from 'react';
import { View, Text, Image, Modal, Pressable, ScrollView } from 'react-native';
import { RList, RRow, RAmount, RPill, RBarChart } from '../../components/redesign/RList';
import { useTheme } from '../../theme/ThemeContext';
import { spacing, radius } from '../../theme';
import { cmpText } from '../../lib/text';
import { caracasParts } from '../../lib/jornada';
import { Dispatch } from '../../types/database';

const ASSET_OPTIONS = [
  { label: 'Vehículo', value: 'vehiculo' },
  { label: 'Maquinaria', value: 'maquinaria' },
];

const fmtMonto = (n: number) => (Math.round((Number(n) || 0) * 100) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 });

/** KPI compacto: total consumido HOY (vista por defecto, sin rango de fecha). */
function TodayTotal({ rows }: { rows: Dispatch[] }) {
  const { colors } = useTheme();
  const today = caracasParts(new Date()).iso;
  const total = rows.reduce((s, d: any) => (String(d.dispatch_date).slice(0, 10) === today ? s + (Number(d.liters) || 0) : s), 0);
  const n = rows.filter((d: any) => String(d.dispatch_date).slice(0, 10) === today).length;
  return (
    <View style={{ backgroundColor: colors.brand, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm }}>
      <Text style={{ color: colors.brandContrast, opacity: 0.85, fontWeight: '800', fontSize: 12, letterSpacing: 0.5 }}>⛽ CONSUMIDO HOY</Text>
      <Text style={{ color: colors.brandContrast, fontWeight: '900', fontSize: 30, fontVariant: ['tabular-nums'] as any, marginTop: 2 }}>
        {fmtMonto(total)} <Text style={{ fontSize: 16, opacity: 0.85 }}>L</Text>
      </Text>
      <Text style={{ color: colors.brandContrast, opacity: 0.75, fontSize: 11.5, marginTop: 2 }}>
        {today} · {n} consumo(s) · elige un rango de fecha abajo para ver el histórico y las gráficas
      </Text>
    </View>
  );
}

/** Resumen VISUAL: gráficas de barras de litros a máquinas por día y por máquina
 *  (sobre las filas visibles = respeta búsqueda y rango de fecha). */
function DailyMachineCharts({ rows }: { rows: Dispatch[] }) {
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
  const head = { color: colors.brandText, fontWeight: '900' as const, fontSize: 13, marginBottom: spacing.sm, letterSpacing: 0.3 };
  const fmtL = (n: number) => `${fmtMonto(n)} L`;
  return (
    <>
      <View style={box}>
        <Text style={head}>⛽ LITROS A MÁQUINAS POR DÍA</Text>
        <RBarChart data={days.slice(0, 12).map(([label, value]) => ({ label, value }))} fmt={fmtL} />
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingTop: spacing.sm, marginTop: spacing.sm, borderTopWidth: 2, borderTopColor: colors.border }}>
          <Text style={{ color: colors.text, fontWeight: '900', fontSize: 13 }}>Total{days.length > 12 ? ` (${days.length} días)` : ''}</Text>
          <Text style={{ color: colors.brandText, fontWeight: '900', fontSize: 14, fontVariant: ['tabular-nums'] as any }}>{fmtL(total)}</Text>
        </View>
      </View>
      <View style={box}>
        <Text style={head}>🚜 LITROS POR MÁQUINA (TOP)</Text>
        <RBarChart data={machines.slice(0, 12).map(([label, value]) => ({ label, value }))} fmt={fmtL} />
        {machines.length > 12 ? <Text style={{ color: colors.muted, fontSize: 11, marginTop: spacing.xs }}>+{machines.length - 12} máquina(s) más…</Text> : null}
      </View>
    </>
  );
}

/**
 * PILOTO DE REDISEÑO — Consumos/Despachos. Mismos campos y lógica que
 * DispatchesScreen (crea/edita en `dispatches`; el trigger valida stock), con:
 *  - títulos en negrita y color de texto que ADAPTA al modo oscuro (brandText),
 *  - resumen con GRÁFICAS de barras (más visual),
 *  - BUSCADOR por máquina / placa / conductor / tipo / litros + rango de fecha.
 * Reusa RList → RecordForm (lógica intacta).
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
        select="*, machine:machinery_id(code), vehicle:vehicle_id(plate)"
        editable
        dateField="dispatch_date"
        emptyIcon="⛽"
        emptyTitle="Sin consumos"
        emptySubtitle="Registra los despachos a vehículos o maquinaria."
        formTitle="Nuevo consumo"
        searchPlaceholder="Buscar por máquina, placa, conductor, tipo, litros…"
        // Buscable por TODAS las características útiles del movimiento.
        searchText={(d: any) => [
          d.machine?.code,
          d.vehicle?.plate,
          d.driver_operator,
          d.asset_kind,
          d.dispatch_date,
          d.liters != null ? String(d.liters) : '',
        ].filter(Boolean).join(' ')}
        subtitle={(rows) => {
          const l = rows.reduce((s, r) => s + (Number(r.liters) || 0), 0);
          return `${rows.length} consumo(s) · ${l.toLocaleString()} L`;
        }}
        // Por defecto: solo el TOTAL CONSUMIDO HOY. Al elegir un rango de fecha (o
        // buscar), se muestran las GRÁFICAS completas (por día y por máquina).
        headerExtra={(shown, ctx) => (ctx.dateActive || ctx.searching ? <DailyMachineCharts rows={shown} /> : <TodayTotal rows={shown} />)}
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
                {(d as any).machine?.code ? <RRow label="Máquina" value={(d as any).machine.code} mono /> : null}
                {(d as any).vehicle?.plate ? <RRow label="Placa" value={(d as any).vehicle.plate} mono /> : null}
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
