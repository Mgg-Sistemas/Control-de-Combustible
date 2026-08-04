import React from 'react';
import { View } from 'react-native';
import { RList, RRow, RAmount, RPill } from '../../components/redesign/RList';
import { FuelIntake } from '../../types/database';

const FUEL_OPTIONS = [
  { label: 'Diésel', value: 'diesel' },
  { label: 'Gasolina', value: 'gasolina' },
];

/**
 * PILOTO DE REDISEÑO — Ingresos. Mismo comportamiento y campos que IntakesScreen
 * (crea/edita en `fuel_intakes`, los triggers de la BD suman stock); solo cambia el
 * look al lenguaje visual nuevo. Reusa RList → RecordForm (lógica intacta).
 */
export default function IntakesPilot() {
  return (
    <RList<FuelIntake>
      title="Ingresos"
      table="fuel_intakes"
      orderBy="intake_date"
      editable
      dateField="intake_date"
      emptyIcon="⬇️"
      emptyTitle="Sin ingresos"
      emptySubtitle="Registra la recepción/compra de combustible."
      formTitle="Nuevo ingreso"
      subtitle={(rows) => {
        const l = rows.reduce((s, r) => s + (Number(r.liters) || 0), 0);
        return `${rows.length} ingreso(s) · ${l.toLocaleString()} L`;
      }}
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
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <RAmount tone="brand">{Number(i.liters).toLocaleString()} L</RAmount>
            <RPill label={String(i.fuel).toUpperCase()} tone="brand" />
          </View>
          <View style={{ marginTop: 6 }}>
            <RRow label="Fecha" value={i.intake_date} />
            {i.supplier ? <RRow label="Proveedor" value={i.supplier} /> : null}
            {i.invoice_no ? <RRow label="Factura" value={i.invoice_no} /> : null}
            {i.total_cost != null ? <RRow label="Costo total" value={Number(i.total_cost).toLocaleString()} mono /> : null}
          </View>
        </>
      )}
    />
  );
}
