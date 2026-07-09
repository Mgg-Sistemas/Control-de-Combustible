import React from 'react';
import { View, Text } from 'react-native';
import { ListScreen } from '../components/ListScreen';
import { Field } from '../components/RecordForm';
import { Badge } from '../components/ui';
import { useTheme } from '../theme/ThemeContext';

/** Formatea una fecha ISO "AAAA-MM-DD" como "DD/MM/AAAA" (día, mes, año). */
function fmtDMY(iso?: string | null): string {
  const [y, m, d] = (iso || '').split('-');
  return y && m && d ? `${d}/${m}/${y}` : (iso || '');
}

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
      ]}
      renderItem={(t) => (
        <>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <ItemTitle>{t.name}</ItemTitle>
            <Badge label={t.fuel} />
          </View>
          {t.location ? <Row label="Ubicación" value={t.location} /> : null}
          <Row label="Capacidad" value={`${Number(t.capacity_l).toLocaleString()} L`} />
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
          <Row label="Fecha" value={fmtDMY(i.intake_date)} />
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

export function DispatchesScreen() {
  return (
    <ListScreen<Dispatch>
      title="Consumos / Despachos"
      table="dispatches"
      orderBy="dispatch_date"
      editable
      dateField="dispatch_date"
      emptyTitle="Sin consumos"
      emptySubtitle="Registra los despachos a vehículos o maquinaria."
      formTitle="Nuevo consumo"
      formFields={[
        { key: 'dispatch_date', label: 'Fecha', type: 'date', required: true },
        { key: 'asset_kind', label: 'Tipo de activo', type: 'select', options: ASSET_OPTIONS, required: true },
        { key: 'vehicle_id', label: 'Vehículo (placa)', type: 'lookup', table: 'vehicles', labelCol: 'plate', createColumn: 'plate', required: true, showIf: (v) => v.asset_kind === 'vehiculo' },
        { key: 'machinery_id', label: 'Maquinaria (código)', type: 'lookup', table: 'machinery', labelCol: 'code', createColumn: 'code', required: true, showIf: (v) => v.asset_kind === 'maquinaria' },
        { key: 'liters', label: 'Litros', type: 'number', required: true },
        { key: 'odometer_km', label: 'Odómetro (km)', type: 'number' },
        { key: 'hourmeter_h', label: 'Horómetro (h)', type: 'number' },
        { key: 'driver_operator', label: 'Conductor/Operador', type: 'text' },
        { key: 'tank_id', label: 'Tanque origen', type: 'lookup', table: 'tanks', labelCol: 'name', required: true },
      ]}
      renderItem={(d) => (
        <>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <ItemTitle>{Number(d.liters).toLocaleString()} L</ItemTitle>
            <Badge label={d.asset_kind} />
          </View>
          <Row label="Fecha" value={fmtDMY(d.dispatch_date)} />
          {d.driver_operator ? <Row label="Conductor/Operador" value={d.driver_operator} /> : null}
          {d.odometer_km != null ? <Row label="Odómetro" value={`${d.odometer_km} km`} /> : null}
          {d.hourmeter_h != null ? <Row label="Horómetro" value={`${d.hourmeter_h} h`} /> : null}
        </>
      )}
    />
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
          <Row label="Fecha" value={fmtDMY(t.transfer_date)} />
          {t.notes ? <Row label="Notas" value={t.notes} /> : null}
        </>
      )}
    />
  );
}
