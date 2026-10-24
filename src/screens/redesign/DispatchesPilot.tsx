import React, { useMemo, useState } from 'react';
import { View, Text, Image, Modal, Pressable, ScrollView, ActivityIndicator } from 'react-native';
import { RList, RRow, RAmount, RPill, RBarChart } from '../../components/redesign/RList';
import { useTheme } from '../../theme/ThemeContext';
import { spacing, radius } from '../../theme';
import { cmpText, norm } from '../../lib/text';
import { caracasParts } from '../../lib/jornada';
import { Dispatch, Tank } from '../../types/database';
import { useAuth } from '../../context/AuthContext';
import { useTable } from '../../hooks/useTable';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../components/ToastProvider';

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
    const plate = d.machine?.plate ? ` · 🚗 ${d.machine.plate}` : '';
    const label = `${code}${plate}`;
    byMachine.set(label, (byMachine.get(label) || 0) + (Number(d.liters) || 0));
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
 *  - ASIGNACIÓN INTELIGENTE DE TANQUES según conductor u operador asignado.
 * Reusa RList → RecordForm (lógica intacta).
 */
export default function DispatchesPilot() {
  const { colors } = useTheme();
  const toast = useToast();
  const { fullName, session } = useAuth();
  const currentUserName = fullName || session?.user?.email || '';
  const [viewPhoto, setViewPhoto] = useState<string | null>(null);

  // Tanques activos del sistema para deducción y auto-asignación
  const { data: tanks } = useTable<Tank>('tanks', {
    realtimeFrom: ['tanks', 'stock_movements'],
  });

  const activeTanks = useMemo(() => {
    return (tanks || []).filter((t) => t.active !== false);
  }, [tanks]);

  // Tanque por defecto según el usuario logueado o único tanque disponible
  const defaultTank = useMemo(() => {
    if (activeTanks.length === 0) return null;
    const u = norm(currentUserName);
    const matched = activeTanks.find(
      (t) => (t.responsable && norm(t.responsable) === u) || (t.chofer && norm(t.chofer) === u)
    );
    if (matched) return matched;
    if (activeTanks.length === 1) return activeTanks[0];
    return null;
  }, [activeTanks, currentUserName]);

  // Busca el tanque correspondiente para un conductor / chofer
  const findTankForDriver = (driverName: string | null | undefined): Tank | null => {
    if (!driverName) {
      return activeTanks.length === 1 ? activeTanks[0] : null;
    }
    const d = norm(driverName);
    const match = activeTanks.find(
      (t) => (t.responsable && norm(t.responsable) === d) || (t.chofer && norm(t.chofer) === d)
    );
    return match || (activeTanks.length === 1 ? activeTanks[0] : null);
  };

  const [autoAssigning, setAutoAssigning] = useState(false);
  const [autoAssignMsg, setAutoAssignMsg] = useState<string | null>(null);
  const [assigningRowId, setAssigningRowId] = useState<string | null>(null);

  const autoAsignarTanques = async (items: Dispatch[]) => {
    if (autoAssigning) return;
    const sinTanque = items.filter((r) => !r.tank_id);
    if (sinTanque.length === 0) return;

    setAutoAssigning(true);
    setAutoAssignMsg(null);
    let asignados = 0;
    let noEncontrados = 0;

    try {
      for (const d of sinTanque) {
        const matched = findTankForDriver(d.driver_operator);
        if (matched) {
          const { error } = await supabase
            .from('dispatches')
            .update({ tank_id: matched.id })
            .eq('id', d.id);
          if (!error) {
            asignados++;
          }
        } else {
          noEncontrados++;
        }
      }
      if (asignados > 0) {
        const msg = `✅ Se auto-asignaron ${asignados} consumo(s) a sus tanques y se descontó el stock.`;
        setAutoAssignMsg(msg);
        toast?.success?.(msg);
      } else {
        setAutoAssignMsg('⚠️ No se encontró tanque correspondiente para los conductores.');
      }
    } catch (e: any) {
      setAutoAssignMsg(`❌ Error: ${e?.message || e}`);
    } finally {
      setAutoAssigning(false);
    }
  };

  const asignarUnConsumo = async (dispatchId: string, tankId: string) => {
    if (assigningRowId) return;
    setAssigningRowId(dispatchId);
    try {
      const { error } = await supabase
        .from('dispatches')
        .update({ tank_id: tankId })
        .eq('id', dispatchId);
      if (error) {
        toast?.error?.(`Error: ${error.message}`);
      } else {
        toast?.success?.('Tanque asignado con éxito. Stock sincronizado.');
      }
    } catch (e: any) {
      toast?.error?.(`Error: ${e?.message || e}`);
    } finally {
      setAssigningRowId(null);
    }
  };

  return (
    <>
      <RList<Dispatch>
        title="Consumos"
        table="dispatches"
        orderBy="dispatch_date"
        ascending={false}
        select="*, machine:machinery_id(code, plate, serial, tipo), vehicle:vehicle_id(plate, name, model), tank:tank_id(id, name, fuel, is_mobile, responsable, chofer)"
        editable
        dateField="dispatch_date"
        defaultToday
        emptyIcon="⛽"
        emptyTitle="Sin consumos"
        emptySubtitle="Registra los despachos a vehículos o maquinaria."
        formTitle="Nuevo consumo"
        searchPlaceholder="Buscar por máquina, placa, serial, conductor, tanque, litros…"
        // Buscable por TODAS las características útiles del movimiento.
        searchText={(d: any) => [
          d.machine?.code,
          d.machine?.plate,
          d.machine?.serial,
          d.machine?.tipo,
          d.vehicle?.plate,
          d.vehicle?.name,
          d.vehicle?.model,
          d.tank?.name,
          d.tank?.responsable,
          d.tank?.chofer,
          d.driver_operator,
          d.asset_kind,
          d.dispatch_date,
          d.liters != null ? String(d.liters) : '',
        ].filter(Boolean).join(' ')}
        subtitle={(rows) => {
          const l = rows.reduce((s, r) => s + (Number(r.liters) || 0), 0);
          const sinTanque = rows.filter((r) => !r.tank_id).length;
          return `${rows.length} consumo(s) · ${l.toLocaleString()} L${sinTanque > 0 ? ` · ⚠️ ${sinTanque} sin tanque` : ''}`;
        }}
        // Por defecto: solo el TOTAL CONSUMIDO HOY. Al elegir un rango de fecha (o
        // buscar), se muestran las GRÁFICAS completas (por día y por máquina).
        headerExtra={(shown, ctx) => {
          const sinTanqueList = shown.filter((r) => !r.tank_id);
          const sinTanque = sinTanqueList.length;
          return (
            <View style={{ gap: spacing.sm, marginBottom: spacing.sm }}>
              {sinTanque > 0 ? (
                <View
                  style={{
                    backgroundColor: '#FEF2F2',
                    borderWidth: 1.5,
                    borderColor: '#EF4444',
                    borderRadius: radius.md,
                    padding: spacing.md,
                    gap: spacing.xs,
                  }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: spacing.xs }}>
                    <Text style={{ color: '#B91C1C', fontWeight: '900', fontSize: 13, flexShrink: 1 }}>
                      ⚠️ {sinTanque} consumo(s) no tienen Tanque de Origen asignado
                    </Text>
                    <Pressable
                      onPress={() => autoAsignarTanques(shown)}
                      disabled={autoAssigning}
                      style={{
                        backgroundColor: '#DC2626',
                        paddingHorizontal: spacing.md,
                        paddingVertical: 7,
                        borderRadius: radius.pill,
                        opacity: autoAssigning ? 0.6 : 1,
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 6,
                      }}
                    >
                      {autoAssigning ? <ActivityIndicator size="small" color="#fff" /> : null}
                      <Text style={{ color: '#fff', fontWeight: '800', fontSize: 12 }}>
                        {autoAssigning ? 'Asignando tanques…' : '⚡ Auto-asignar tanques por Conductor'}
                      </Text>
                    </Pressable>
                  </View>
                  <Text style={{ color: '#7F1D1D', fontSize: 12, marginTop: 2 }}>
                    Los tanques no descuentan stock hasta tener su tanque de origen. Pulsa el botón rojo para auto-asignarlos al tanque asignado de cada conductor (o tócalos abajo para asignar individualmente).
                  </Text>
                  {autoAssignMsg ? (
                    <Text style={{ color: '#15803D', fontWeight: '700', fontSize: 12, marginTop: 4 }}>
                      {autoAssignMsg}
                    </Text>
                  ) : null}
                </View>
              ) : null}
              {ctx.dateActive || ctx.searching ? <DailyMachineCharts rows={shown} /> : <TodayTotal rows={shown} />}
            </View>
          );
        }}
        formFields={[
          { key: 'dispatch_date', label: 'Fecha', type: 'date', required: true },
          {
            key: 'tank_id',
            label: 'Tanque / Cisterna origen *',
            type: 'lookup',
            table: 'tanks',
            labelCol: 'name',
            subLabelCols: ['responsable', 'chofer', 'location', 'fuel'],
            dropdown: true,
            required: true,
            defaultValue: defaultTank?.id,
          },
          { key: 'asset_kind', label: 'Tipo de activo', type: 'select', options: ASSET_OPTIONS, required: true },
          // Oculta los vehículos "Esperando instrucciones" (recién agregados, aún sin
          // decidir) — no deben poder recibir combustible hasta que se les dé de alta
          // de verdad. Uno CREADO aquí mismo (createColumn) no entra en esta regla:
          // nace con en_espera=false (default de la columna), porque se está usando ya.
          { key: 'vehicle_id', label: 'Vehículo (placa)', type: 'lookup', table: 'vehicles', labelCol: 'plate', createColumn: 'plate', filter: { en_espera: false }, required: true, showIf: (v) => v.asset_kind === 'vehiculo' },
          { key: 'machinery_id', label: 'Maquinaria (código)', type: 'lookup', table: 'machinery', labelCol: 'code', subLabelCols: ['serial', 'plate'], filter: { en_espera: false }, required: true, showIf: (v) => v.asset_kind === 'maquinaria' },
          { key: 'liters', label: 'Litros despachados *', type: 'number', required: true },
          { key: 'odometer_km', label: 'Odómetro (km)', type: 'number' },
          { key: 'hourmeter_h', label: 'Horómetro (h)', type: 'number' },
          { key: 'driver_operator', label: 'Conductor/Operador', type: 'text', defaultValue: currentUserName },
        ]}
        renderItem={(d) => {
          const fotos = ((d as any).photos ?? []).filter(Boolean) as string[];
          const mach = (d as any).machine;
          const veh = (d as any).vehicle;
          const tank = (d as any).tank;
          const suggestedTank = !tank ? findTankForDriver(d.driver_operator) : null;
          const isRowBusy = assigningRowId === d.id;

          return (
            <>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <RAmount tone="brand">{Number(d.liters).toLocaleString()} L</RAmount>
                <RPill label={String(d.asset_kind).toUpperCase()} tone="neutral" />
              </View>
              <View style={{ marginTop: 6 }}>
                <RRow label="Fecha" value={d.dispatch_date} />
                {tank ? (
                  <RRow
                    label="Tanque origen"
                    value={`🛢️ ${tank.name}${tank.responsable ? ` (${tank.responsable})` : tank.fuel ? ` (${String(tank.fuel).toUpperCase()})` : ''}`}
                    mono
                  />
                ) : (
                  <View
                    style={{
                      backgroundColor: '#FEF2F2',
                      borderColor: '#EF4444',
                      borderWidth: 1.5,
                      borderRadius: radius.sm,
                      paddingHorizontal: 10,
                      paddingVertical: 8,
                      marginVertical: 4,
                      gap: 4,
                    }}
                  >
                    <Text style={{ color: '#B91C1C', fontSize: 11, fontWeight: '900' }}>
                      ⚠️ SIN TANQUE ASIGNADO (No descuenta stock)
                    </Text>
                    {suggestedTank ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6, marginTop: 2 }}>
                        <Text style={{ color: '#7F1D1D', fontSize: 11, flexShrink: 1 }}>
                          Tanque asignado a {d.driver_operator}: <Text style={{ fontWeight: '800' }}>{suggestedTank.name}</Text>
                        </Text>
                        <Pressable
                          onPress={() => asignarUnConsumo(d.id, suggestedTank.id)}
                          disabled={isRowBusy}
                          style={{
                            backgroundColor: '#DC2626',
                            paddingHorizontal: 10,
                            paddingVertical: 5,
                            borderRadius: radius.pill,
                            opacity: isRowBusy ? 0.6 : 1,
                            flexDirection: 'row',
                            alignItems: 'center',
                            gap: 4,
                          }}
                        >
                          {isRowBusy ? <ActivityIndicator size="small" color="#fff" /> : null}
                          <Text style={{ color: '#fff', fontSize: 11, fontWeight: '800' }}>
                            ⚡ Asignar a su tanque
                          </Text>
                        </Pressable>
                      </View>
                    ) : (
                      <Text style={{ color: '#DC2626', fontSize: 10.5, marginTop: 1 }}>
                        👉 Toca este registro para editarlo y seleccionar de qué tanque o cisterna se extrajo.
                      </Text>
                    )}
                  </View>
                )}
                {mach ? (
                  <>
                    <RRow label="Máquina" value={mach.code || '—'} mono />
                    <RRow
                      label="🚗 Placa"
                      value={mach.plate ? String(mach.plate).trim() : 'S/P (Sin placa)'}
                      mono
                    />
                    <RRow
                      label="🔢 Serial"
                      value={mach.serial ? String(mach.serial).trim() : 'S/S (Sin serial)'}
                      mono
                    />
                    {mach.tipo ? <RRow label="Tipo" value={mach.tipo} /> : null}
                  </>
                ) : null}
                {veh ? (
                  <>
                    <RRow
                      label="Vehículo"
                      value={veh.name ? `${veh.name}${veh.model ? ` (${veh.model})` : ''}` : 'Vehículo'}
                      mono
                    />
                    <RRow
                      label="🚗 Placa"
                      value={veh.plate ? String(veh.plate).trim() : 'S/P (Sin placa)'}
                      mono
                    />
                  </>
                ) : null}
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
