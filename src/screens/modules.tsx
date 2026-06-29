import React from 'react';
import { View, Text } from 'react-native';
import { ListScreen } from '../components/ListScreen';
import { Badge } from '../components/ui';
import { colors } from '../theme';
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
      emptyTitle="Sin tanques"
      emptySubtitle="Registra tus depósitos de combustible."
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
