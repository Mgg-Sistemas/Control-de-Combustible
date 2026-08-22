import React, { useMemo } from 'react';
import { View } from 'react-native';
import { RList, RRow, RAmount, RPill } from '../../components/redesign/RList';
import { FuelIntake, Tank } from '../../types/database';
import { useAuth } from '../../context/AuthContext';
import { useTable } from '../../hooks/useTable';
import { norm } from '../../lib/text';
import type { Field } from '../../components/RecordForm';

const FUEL_OPTIONS = [
  { label: 'Diésel', value: 'diesel' },
  { label: 'Gasolina', value: 'gasolina' },
];

/**
 * PILOTO DE REDISEÑO — Ingresos. Mismo comportamiento y campos que IntakesScreen
 * (crea/edita en `fuel_intakes`, los triggers de la BD suman stock → se sincroniza
 * con la pantalla de Tanques en vivo); solo cambia el look al lenguaje visual nuevo.
 *
 * "Cada encargado tiene su propio tanque": al abrir "Nuevo ingreso" se PRESELECCIONA
 * el "Tanque destino" con el tanque cuyo `responsable` coincide con el nombre del
 * usuario logueado (se puede cambiar). Así el encargado registra su ingreso a su
 * tanque sin buscarlo. Reusa RList → RecordForm (lógica intacta).
 */
export default function IntakesPilot() {
  const { fullName } = useAuth();
  const { data: tanks } = useTable<Tank>('tanks');

  // Tanque del encargado logueado: el que tenga `responsable` = su nombre (comparación
  // normalizada; exacto primero, luego "contiene"). undefined si no hay match → sin
  // preselección (el usuario elige a mano). Depende de tanks.responsable (SQL nuevo).
  const miTanqueId = useMemo(() => {
    const me = norm(fullName || '');
    if (!me || !tanks?.length) return undefined;
    const exact = tanks.find((t) => norm((t as any).responsable || '') === me);
    if (exact) return exact.id;
    const partial = tanks.find((t) => {
      const r = norm((t as any).responsable || '');
      return r && (r.includes(me) || me.includes(r));
    });
    return partial?.id;
  }, [fullName, tanks]);

  const formFields: Field[] = useMemo(() => ([
    { key: 'intake_date', label: 'Fecha', type: 'date', required: true },
    { key: 'supplier', label: 'Proveedor', type: 'text', defaultValue: 'PDVSA' },
    { key: 'fuel', label: 'Combustible', type: 'select', options: FUEL_OPTIONS, required: true },
    { key: 'liters', label: 'Litros', type: 'number', required: true },
    { key: 'unit_cost', label: 'Costo unitario', type: 'number' },
    { key: 'total_cost', label: 'Costo total', type: 'number' },
    // Preseleccionado con el tanque del encargado (si coincide el responsable). Muestra
    // ubicación + responsable en la etiqueta para distinguir tanques con el mismo nombre.
    { key: 'tank_id', label: 'Tanque destino', type: 'lookup', table: 'tanks', labelCol: 'name', subLabelCols: ['location', 'responsable'], dropdown: true, required: true, ...(miTanqueId ? { defaultValue: miTanqueId } : {}) },
  ]), [miTanqueId]);

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
      formFields={formFields}
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
