import React from 'react';
import { View, Text } from 'react-native';
import { ListScreen } from '../components/ListScreen';
import { Field } from '../components/RecordForm';
import { Badge } from '../components/ui';
import { colors } from '../theme';

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
  Authorization,
  Vehicle,
  Machinery,
  Transfer,
} from '../types/database';

const Row = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
    <Text style={{ color: colors.muted, fontSize: 13 }}>{label}</Text>
    <Text style={{ color: colors.text, fontSize: 13, fontWeight: '600' }}>{value}</Text>
  </View>
);

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
            <Text style={{ fontWeight: '700', color: colors.text }}>{t.name}</Text>
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
      emptyTitle="Sin ingresos"
      emptySubtitle="Registra la recepción/compra de combustible."
      formTitle="Nuevo ingreso"
      formFields={[
        { key: 'intake_date', label: 'Fecha', type: 'date', required: true },
        { key: 'supplier', label: 'Proveedor', type: 'text' },
        { key: 'fuel', label: 'Combustible', type: 'select', options: FUEL_OPTIONS, required: true },
        { key: 'liters', label: 'Litros', type: 'number', required: true },
        { key: 'unit_cost', label: 'Costo unitario', type: 'number' },
        { key: 'total_cost', label: 'Costo total', type: 'number' },
        { key: 'tank_id', label: 'Tanque destino', type: 'lookup', table: 'tanks', labelCol: 'name', required: true },
        { key: 'invoice_no', label: 'Nº factura', type: 'text' },
      ]}
      renderItem={(i) => (
        <>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ fontWeight: '700', color: colors.text }}>
              {Number(i.liters).toLocaleString()} L
            </Text>
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

export function DispatchesScreen() {
  return (
    <ListScreen<Dispatch>
      title="Consumos / Despachos"
      table="dispatches"
      orderBy="dispatch_date"
      emptyTitle="Sin consumos"
      emptySubtitle="Registra los despachos a vehículos o maquinaria."
      formTitle="Nuevo consumo"
      formFields={[
        { key: 'dispatch_date', label: 'Fecha', type: 'date', required: true },
        { key: 'asset_kind', label: 'Tipo de activo', type: 'select', options: ASSET_OPTIONS, required: true },
        { key: 'vehicle_id', label: 'Vehículo (si aplica)', type: 'lookup', table: 'vehicles', labelCol: 'plate' },
        { key: 'machinery_id', label: 'Maquinaria (si aplica)', type: 'lookup', table: 'machinery', labelCol: 'code' },
        { key: 'liters', label: 'Litros', type: 'number', required: true },
        { key: 'odometer_km', label: 'Odómetro (km)', type: 'number' },
        { key: 'hourmeter_h', label: 'Horómetro (h)', type: 'number' },
        { key: 'driver_operator', label: 'Conductor/Operador', type: 'text' },
        { key: 'tank_id', label: 'Tanque origen', type: 'lookup', table: 'tanks', labelCol: 'name', required: true },
      ]}
      renderItem={(d) => (
        <>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ fontWeight: '700', color: colors.text }}>
              {Number(d.liters).toLocaleString()} L
            </Text>
            <Badge label={d.asset_kind} />
          </View>
          <Row label="Fecha" value={d.dispatch_date} />
          {d.driver_operator ? <Row label="Conductor/Operador" value={d.driver_operator} /> : null}
          {d.odometer_km != null ? <Row label="Odómetro" value={`${d.odometer_km} km`} /> : null}
          {d.hourmeter_h != null ? <Row label="Horómetro" value={`${d.hourmeter_h} h`} /> : null}
        </>
      )}
    />
  );
}

const authTone = (s: Authorization['status']) =>
  s === 'aprobado' ? 'success' : s === 'rechazado' ? 'danger' : 'warning';

export function AuthorizationsScreen() {
  return (
    <ListScreen<Authorization>
      title="Autorizaciones"
      table="authorizations"
      emptyTitle="Sin autorizaciones"
      emptySubtitle="Las solicitudes de despacho aparecerán aquí."
      formTitle="Nueva solicitud"
      autoUserField="requested_by"
      formFields={[
        { key: 'asset_kind', label: 'Tipo de activo', type: 'select', options: ASSET_OPTIONS, required: true },
        { key: 'vehicle_id', label: 'Vehículo (si aplica)', type: 'lookup', table: 'vehicles', labelCol: 'plate' },
        { key: 'machinery_id', label: 'Maquinaria (si aplica)', type: 'lookup', table: 'machinery', labelCol: 'code' },
        { key: 'liters', label: 'Litros solicitados', type: 'number', required: true },
        { key: 'reason', label: 'Motivo', type: 'text' },
      ]}
      renderItem={(a) => (
        <>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ fontWeight: '700', color: colors.text }}>
              {Number(a.liters).toLocaleString()} L
            </Text>
            <Badge label={a.status} tone={authTone(a.status)} />
          </View>
          <Row label="Activo" value={a.asset_kind} />
          {a.reason ? <Row label="Motivo" value={a.reason} /> : null}
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
          <Text style={{ fontWeight: '700', color: colors.text, fontSize: 16 }}>{v.plate}</Text>
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

export function MachineryScreen() {
  return (
    <ListScreen<Machinery>
      title="Maquinaria"
      table="machinery"
      orderBy="code"
      emptyTitle="Sin maquinaria"
      emptySubtitle="Registra tus equipos y maquinaria."
      formTitle="Nueva maquinaria"
      formFields={[
        { key: 'code', label: 'Código', type: 'text', required: true },
        { key: 'description', label: 'Descripción', type: 'text' },
        { key: 'machinery_type', label: 'Tipo', type: 'text' },
        { key: 'expected_lph', label: 'Rendimiento (L/h)', type: 'number' },
      ]}
      renderItem={(m) => (
        <>
          <Text style={{ fontWeight: '700', color: colors.text, fontSize: 16 }}>{m.code}</Text>
          {m.description ? <Row label="Descripción" value={m.description} /> : null}
          {m.machinery_type ? <Row label="Tipo" value={m.machinery_type} /> : null}
          {m.expected_lph != null ? <Row label="Rendimiento" value={`${m.expected_lph} L/h`} /> : null}
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
          <Text style={{ fontWeight: '700', color: colors.text }}>
            {Number(t.liters).toLocaleString()} L
          </Text>
          <Row label="Fecha" value={t.transfer_date} />
          {t.notes ? <Row label="Notas" value={t.notes} /> : null}
        </>
      )}
    />
  );
}
