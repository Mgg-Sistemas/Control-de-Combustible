import React, { useState } from 'react';
import { View, Text, Image, Modal, Pressable, ScrollView } from 'react-native';
import { ListScreen } from '../components/ListScreen';
import { Field } from '../components/RecordForm';
import { Badge } from '../components/ui';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import { cmpText } from '../lib/text';

const FUEL_OPTIONS = [
  { label: 'Diésel', value: 'diesel' },
  { label: 'Gasolina', value: 'gasolina' },
];
const ASSET_OPTIONS = [
  { label: 'Vehículo', value: 'vehiculo' },
  { label: 'Maquinaria', value: 'maquinaria' },
];
import {
  Tank,
  FuelIntake,
  Dispatch,
  Vehicle,
  Transfer,
} from '../types/database';

const Row = ({ label, value }: { label: string; value: React.ReactNode }) => {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
      <Text style={{ color: colors.muted, fontSize: 13 }}>{label}</Text>
      <Text style={{ color: colors.text, fontSize: 13, fontWeight: '600' }}>{value}</Text>
    </View>
  );
};

/** Título de tarjeta que respeta el tema. */
const ItemTitle = ({ children, size = 16 }: { children: React.ReactNode; size?: number }) => {
  const { colors } = useTheme();
  return <Text style={{ fontWeight: '700', color: colors.text, fontSize: size }}>{children}</Text>;
};

export function TanksScreen() {
  return (
    <ListScreen<Tank>
      title="Tanques"
      table="tanks"
      orderBy="name"
      editable
      emptyTitle="Sin tanques"
      emptySubtitle="Registra tus depósitos de combustible."
      formTitle="Nuevo tanque"
      formFields={[
        { key: 'name', label: 'Nombre', type: 'text', required: true },
        { key: 'location', label: 'Ubicación', type: 'text' },
        { key: 'fuel', label: 'Combustible', type: 'select', options: FUEL_OPTIONS, required: true },
        { key: 'capacity_l', label: 'Capacidad (L)', type: 'number', required: true },
        // Encargado a cargo del tanque (se muestra en la pantalla de Tanques).
        { key: 'responsable', label: 'Responsable / encargado', type: 'text' },
        // Vínculo con la CISTERNA del catálogo (camión cisterna) y su CHOFER.
        { key: 'machinery_id', label: 'Cisterna del catálogo (opcional)', type: 'lookup', table: 'machinery', labelCol: 'code' },
        { key: 'chofer', label: 'Chofer de la cisterna', type: 'text' },
      ]}
      renderItem={(t) => (
        <>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <ItemTitle>{t.name}</ItemTitle>
            <Badge label={t.fuel} />
          </View>
          {t.location ? <Row label="Ubicación" value={t.location} /> : null}
          <Row label="Capacidad" value={`${Number(t.capacity_l).toLocaleString()} L`} />
          {t.responsable ? <Row label="Responsable" value={`👤 ${t.responsable}`} /> : null}
          {t.chofer ? <Row label="Chofer" value={`🧑‍✈️ ${t.chofer}`} /> : null}
          {t.is_mobile ? <Badge label="Móvil" tone="warning" /> : null}
        </>
      )}
    />
  );
}

export function IntakesScreen() {
  return (
    <ListScreen<FuelIntake>
      title="Ingresos"
      table="fuel_intakes"
      orderBy="intake_date"
      editable
      dateField="intake_date"
      emptyTitle="Sin ingresos"
      emptySubtitle="Registra la recepción/compra de combustible."
      formTitle="Nuevo ingreso"
      formFields={[
        { key: 'intake_date', label: 'Fecha', type: 'date', required: true },
        { key: 'supplier', label: 'Proveedor', type: 'text', defaultValue: 'PDVSA' },
        { key: 'fuel', label: 'Combustible', type: 'select', options: FUEL_OPTIONS, required: true },
        { key: 'liters', label: 'Litros', type: 'number', required: true },
        { key: 'unit_cost', label: 'Costo unitario', type: 'number' },
        { key: 'total_cost', label: 'Costo total', type: 'number' },
        { key: 'tank_id', label: 'Tanque destino', type: 'lookup', table: 'tanks', labelCol: 'name', required: true },
      ]}
      renderItem={(i) => (
        <>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <ItemTitle>{Number(i.liters).toLocaleString()} L</ItemTitle>
            <Badge label={i.fuel} />
          </View>
          <Row label="Fecha" value={i.intake_date} />
          {i.supplier ? <Row label="Proveedor" value={i.supplier} /> : null}
          {i.invoice_no ? <Row label="Factura" value={i.invoice_no} /> : null}
          {i.total_cost != null ? (
            <Row label="Costo total" value={Number(i.total_cost).toLocaleString()} />
          ) : null}
        </>
      )}
    />
  );
}

/** Resumen de combustible surtido a MÁQUINAS: por día y por máquina (top), sobre las
 *  filas visibles (respeta el filtro de fecha). L/h vive en Control / ficha de Equipos. */
function DailyMachineLiters({ rows }: { rows: Dispatch[] }) {
  const { colors } = useTheme();
  const fmt = (n: number) => (Math.round((Number(n) || 0) * 100) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 });
  const maq = rows.filter((d) => (d as any).asset_kind === 'maquinaria');
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
  const box = { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md } as const;
  const rowLine = { flexDirection: 'row' as const, justifyContent: 'space-between' as const, paddingVertical: 3, borderTopWidth: 1, borderTopColor: colors.border };
  return (
    <>
      <View style={box}>
        <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14, marginBottom: spacing.xs }}>⛽ Litros a máquinas por día</Text>
        {days.slice(0, 12).map(([day, l]) => (
          <View key={day} style={rowLine}>
            <Text style={{ color: colors.muted, fontSize: 13 }}>{day}</Text>
            <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>{fmt(l)} L</Text>
          </View>
        ))}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingTop: spacing.xs, marginTop: spacing.xs, borderTopWidth: 2, borderTopColor: colors.border }}>
          <Text style={{ color: colors.text, fontWeight: '900', fontSize: 13 }}>Total{days.length > 12 ? ` (${days.length} días)` : ''}</Text>
          <Text style={{ color: colors.success, fontWeight: '900', fontSize: 14 }}>{fmt(total)} L</Text>
        </View>
      </View>
      <View style={box}>
        <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14, marginBottom: spacing.xs }}>🚜 Litros por máquina</Text>
        {machines.slice(0, 15).map(([code, l]) => (
          <View key={code} style={rowLine}>
            <Text style={{ color: colors.text, fontSize: 13, fontWeight: '600' }} numberOfLines={1}>{code}</Text>
            <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>{fmt(l)} L</Text>
          </View>
        ))}
        {machines.length > 15 ? <Text style={{ color: colors.muted, fontSize: 11, marginTop: 4 }}>+{machines.length - 15} máquina(s) más…</Text> : null}
      </View>
    </>
  );
}

/** Formatea un número como monto legible (hasta 2 decimales), coherente con el resto del módulo. */
const fmtMonto = (n: number) =>
  (Math.round((Number(n) || 0) * 100) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 });

/** Miniaturas de las fotos del surtido. Al tocar una, abre el visor a pantalla completa. */
function DispatchPhotos({ photos, onOpen }: { photos: string[]; onOpen: (uri: string) => void }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs }}>
      {photos.map((uri, i) => (
        <Pressable key={`${uri}-${i}`} onPress={() => onOpen(uri)}>
          <Image
            source={{ uri }}
            style={{
              width: 64,
              height: 64,
              maxWidth: '100%',
              borderRadius: radius.sm,
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: colors.surface,
            }}
            resizeMode="cover"
          />
        </Pressable>
      ))}
    </View>
  );
}

export function DispatchesScreen() {
  const { colors } = useTheme();
  // Visor de foto a pantalla completa (estado a nivel de pantalla porque renderItem es una función).
  const [viewPhoto, setViewPhoto] = useState<string | null>(null);
  return (
    <>
      <ListScreen<Dispatch>
        title="Consumos / Despachos"
        table="dispatches"
        orderBy="dispatch_date"
        select="*, machine:machinery_id(code)"
        editable
        dateField="dispatch_date"
        headerExtra={(shown) => <DailyMachineLiters rows={shown} />}
        emptyTitle="Sin consumos"
        emptySubtitle="Registra los despachos a vehículos o maquinaria."
        formTitle="Nuevo consumo"
        formFields={[
          { key: 'dispatch_date', label: 'Fecha', type: 'date', required: true },
          { key: 'asset_kind', label: 'Tipo de activo', type: 'select', options: ASSET_OPTIONS, required: true },
          { key: 'vehicle_id', label: 'Vehículo (placa)', type: 'lookup', table: 'vehicles', labelCol: 'plate', createColumn: 'plate', required: true, showIf: (v) => v.asset_kind === 'vehiculo' },
          // Sin createColumn: se ELIGE una máquina existente (no se crea al vuelo) para
          // no fragmentar el consumo en códigos duplicados. El buscador sigue disponible.
          { key: 'machinery_id', label: 'Maquinaria (código)', type: 'lookup', table: 'machinery', labelCol: 'code', required: true, showIf: (v) => v.asset_kind === 'maquinaria' },
          { key: 'liters', label: 'Litros', type: 'number', required: true },
          { key: 'odometer_km', label: 'Odómetro (km)', type: 'number' },
          { key: 'hourmeter_h', label: 'Horómetro (h)', type: 'number' },
          { key: 'driver_operator', label: 'Conductor/Operador', type: 'text' },
          // Tanque OPCIONAL: vacío = carga directa de la bomba (solo litros, no descuenta stock).
          { key: 'tank_id', label: 'Tanque origen (opcional · vacío = directo de bomba)', type: 'lookup', table: 'tanks', labelCol: 'name' },
        ]}
        renderItem={(d) => {
          const fotos = (d.photos ?? []).filter(Boolean);
          return (
            <>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <ItemTitle>{Number(d.liters).toLocaleString()} L</ItemTitle>
                <Badge label={d.asset_kind} />
              </View>
              <Row label="Fecha" value={d.dispatch_date} />
              {(d as any).machine?.code ? <Row label="Máquina" value={(d as any).machine.code} /> : null}
              {d.driver_operator ? <Row label="Conductor/Operador" value={d.driver_operator} /> : null}
              {d.odometer_km != null ? <Row label="Odómetro" value={`${d.odometer_km} km`} /> : null}
              {d.hourmeter_h != null ? <Row label="Horómetro" value={`${d.hourmeter_h} h`} /> : null}
              {d.price_per_liter != null ? <Row label="Monto/L" value={fmtMonto(d.price_per_liter)} /> : null}
              {d.total_amount != null ? <Row label="Monto total" value={fmtMonto(d.total_amount)} /> : null}
              {fotos.length > 0 ? (
                <>
                  <Text style={{ color: colors.muted, fontSize: 13, marginTop: spacing.xs }}>Fotos del surtido</Text>
                  <DispatchPhotos photos={fotos} onOpen={setViewPhoto} />
                </>
              ) : null}
            </>
          );
        }}
      />
      {/* Visor de foto a pantalla completa. */}
      <Modal visible={viewPhoto != null} transparent animationType="fade" onRequestClose={() => setViewPhoto(null)}>
        <Pressable
          onPress={() => setViewPhoto(null)}
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', justifyContent: 'center', alignItems: 'center', padding: spacing.md }}
        >
          <ScrollView
            style={{ maxWidth: '100%', maxHeight: '100%' }}
            contentContainerStyle={{ justifyContent: 'center', alignItems: 'center' }}
            maximumZoomScale={4}
            minimumZoomScale={1}
          >
            {viewPhoto ? (
              <Image source={{ uri: viewPhoto }} style={{ width: 320, height: 320, maxWidth: '100%' }} resizeMode="contain" />
            ) : null}
          </ScrollView>
          <Pressable
            onPress={() => setViewPhoto(null)}
            style={{ position: 'absolute', top: spacing.lg, right: spacing.lg, backgroundColor: colors.surface, borderRadius: radius.md, paddingVertical: spacing.xs, paddingHorizontal: spacing.md, borderWidth: 1, borderColor: colors.border }}
          >
            <Text style={{ color: colors.text, fontWeight: '700', fontSize: 14 }}>Cerrar ✕</Text>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

export function VehiclesScreen() {
  return (
    <ListScreen<Vehicle>
      title="Vehículos"
      table="vehicles"
      orderBy="plate"
      emptyTitle="Sin vehículos"
      emptySubtitle="Registra las placas de tu flota."
      formTitle="Nuevo vehículo"
      formFields={[
        { key: 'plate', label: 'Placa', type: 'text', required: true },
        { key: 'brand', label: 'Marca', type: 'text' },
        { key: 'model', label: 'Modelo', type: 'text' },
        { key: 'vehicle_type', label: 'Tipo', type: 'text' },
        { key: 'tank_capacity_l', label: 'Capacidad tanque (L)', type: 'number' },
        { key: 'expected_kml', label: 'Rendimiento (km/L)', type: 'number' },
      ]}
      renderItem={(v) => (
        <>
          <ItemTitle>{v.plate}</ItemTitle>
          {v.brand || v.model ? (
            <Row label="Modelo" value={`${v.brand ?? ''} ${v.model ?? ''}`.trim()} />
          ) : null}
          {v.vehicle_type ? <Row label="Tipo" value={v.vehicle_type} /> : null}
          {v.expected_kml != null ? <Row label="Rendimiento" value={`${v.expected_kml} km/L`} /> : null}
        </>
      )}
    />
  );
}

export function TransfersScreen() {
  return (
    <ListScreen<Transfer>
      title="Traslados"
      table="transfers"
      orderBy="transfer_date"
      editable
      dateField="transfer_date"
      emptyTitle="Sin traslados"
      emptySubtitle="Registra movimientos de combustible entre tanques."
      formTitle="Nuevo traslado"
      formFields={[
        { key: 'transfer_date', label: 'Fecha', type: 'date', required: true },
        { key: 'from_tank_id', label: 'Tanque origen', type: 'lookup', table: 'tanks', labelCol: 'name', required: true },
        { key: 'to_tank_id', label: 'Tanque destino', type: 'lookup', table: 'tanks', labelCol: 'name', required: true },
        { key: 'liters', label: 'Litros', type: 'number', required: true },
        { key: 'notes', label: 'Observaciones', type: 'text' },
      ]}
      renderItem={(t) => (
        <>
          <ItemTitle>{Number(t.liters).toLocaleString()} L</ItemTitle>
          <Row label="Fecha" value={t.transfer_date} />
          {t.notes ? <Row label="Notas" value={t.notes} /> : null}
        </>
      )}
    />
  );
}
