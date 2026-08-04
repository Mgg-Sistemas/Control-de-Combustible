import React from 'react';
import { View } from 'react-native';
import { RList, RRow, RAmount } from '../../components/redesign/RList';
import { Transfer } from '../../types/database';

/**
 * PILOTO DE REDISEÑO — Traslados entre tanques. Mismo comportamiento que
 * TransfersScreen (crea/edita en `transfers`; el trigger mueve stock y valida
 * disponibilidad), con el look nuevo. Reusa RList → RecordForm (lógica intacta).
 */
export default function TransfersPilot() {
  return (
    <RList<Transfer>
      title="Traslados"
      table="transfers"
      orderBy="transfer_date"
      editable
      dateField="transfer_date"
      emptyIcon="🔁"
      emptyTitle="Sin traslados"
      emptySubtitle="Registra movimientos de combustible entre tanques."
      formTitle="Nuevo traslado"
      subtitle={(rows) => {
        const l = rows.reduce((s, r) => s + (Number(r.liters) || 0), 0);
        return `${rows.length} traslado(s) · ${l.toLocaleString()} L`;
      }}
      formFields={[
        { key: 'transfer_date', label: 'Fecha', type: 'date', required: true },
        { key: 'from_tank_id', label: 'Tanque origen', type: 'lookup', table: 'tanks', labelCol: 'name', required: true },
        { key: 'to_tank_id', label: 'Tanque destino', type: 'lookup', table: 'tanks', labelCol: 'name', required: true },
        { key: 'liters', label: 'Litros', type: 'number', required: true },
        { key: 'notes', label: 'Observaciones', type: 'text' },
      ]}
      renderItem={(t) => (
        <>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <RAmount tone="brand">{Number(t.liters).toLocaleString()} L</RAmount>
          </View>
          <View style={{ marginTop: 6 }}>
            <RRow label="Fecha" value={t.transfer_date} />
            {t.notes ? <RRow label="Notas" value={t.notes} /> : null}
          </View>
        </>
      )}
    />
  );
}
