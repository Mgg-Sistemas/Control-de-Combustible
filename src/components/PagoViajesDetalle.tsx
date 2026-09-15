// Detalle del PAGO DE VIAJES de una empresa en una semana (15-sep-2026).
//
// Va dentro del detalle de la cuenta en Control de Pagos. Muestra cuánto se paga por
// viajes, el resumen por camión y cada viaje con su tique, su zona, su tarifa y el
// ESTADO en que estaba el camión, que es solo una observación: no decide el pago.
// Lo que decide es la marca «facturó / no facturó», que se pone y se quita.
import React, { useState } from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Card } from './ui';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import { etiquetaMotivoSinPago, LineaViaje, PagoViajesGrupo } from '../lib/pagoViajes';
import { marcarViajePago } from '../lib/pagoViajesDb';

type Props = {
  grupo: PagoViajesGrupo;
  canEdit: boolean;
  onChanged: () => void;
};

const usd = (n: number) => `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const horaCaracas = (iso: string) =>
  new Date(iso).toLocaleString('es-VE', { timeZone: 'America/Caracas', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const ORIGEN: Record<string, string> = { campo: 'en el patio', cola: 'subido sin señal', manual: 'cargado a mano' };

export function PagoViajesDetalle({ grupo, canEdit, onChanged }: Props) {
  const { colors } = useTheme();
  const [abierto, setAbierto] = useState(false);
  const [marcando, setMarcando] = useState<string | null>(null);
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const marcar = async (l: LineaViaje, facturable: boolean) => {
    setGuardando(true);
    setError(null);
    const { error: err } = await marcarViajePago(l.viaje.id, facturable, facturable ? null : motivo);
    setGuardando(false);
    if (err) { setError(err); return; }
    setMarcando(null);
    setMotivo('');
    onChanged();
  };

  return (
    <Card style={{ borderColor: colors.brand }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14, flex: 1 }}>🚛 Viajes (pago por viaje)</Text>
        <Text style={{ color: colors.success, fontWeight: '900', fontVariant: ['tabular-nums'] as any }}>{usd(grupo.montoUSD)}</Text>
      </View>
      <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>
        {grupo.viajes} viaje(s) · {grupo.pagados} pagado(s)
        {grupo.noFacturados ? ` · ${grupo.noFacturados} no facturó` : ''}
        {grupo.pendientes ? ` · ⚠️ ${grupo.pendientes} sin pagar (sin zona, tarifa o empresa)` : ''}
      </Text>

      {grupo.porCamion.map((c) => (
        <View key={c.machineryId} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, borderTopWidth: 1, borderTopColor: colors.border, marginTop: 4 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>{c.code}{c.placa ? ` · ${c.placa}` : ''}</Text>
            <Text style={{ color: colors.muted, fontSize: 11 }}>
              {c.este ? `Este ${c.este}` : ''}{c.este && c.oeste ? ' · ' : ''}{c.oeste ? `Oeste ${c.oeste}` : ''}
              {c.noFacturados ? `${c.este || c.oeste ? ' · ' : ''}no facturó ${c.noFacturados}` : ''}
              {c.pendientes ? `${c.este || c.oeste || c.noFacturados ? ' · ' : ''}sin pagar ${c.pendientes}` : ''}
            </Text>
          </View>
          <Text style={{ color: colors.text, fontWeight: '800', fontVariant: ['tabular-nums'] as any }}>{usd(c.monto)}</Text>
        </View>
      ))}

      <TouchableOpacity onPress={() => setAbierto((v) => !v)} style={{ marginTop: spacing.xs }}>
        <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 12 }}>{abierto ? '▲ Ocultar viajes' : `▼ Ver los ${grupo.viajes} viaje(s)`}</Text>
      </TouchableOpacity>
      {error ? <Text style={{ color: colors.danger, fontSize: 12, marginTop: 4 }}>❌ {error}</Text> : null}

      {abierto ? grupo.lineas.map((l) => {
        const sinPago = l.motivoSinPago;
        return (
          <View key={l.viaje.id} style={{ paddingVertical: 6, borderTopWidth: 1, borderTopColor: colors.border, marginTop: 4, opacity: sinPago === 'no_facturo' ? 0.7 : 1 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ color: colors.text, fontSize: 12, fontWeight: '700', flex: 1 }}>
                {horaCaracas(l.viaje.registered_at)} · {l.viaje.machine_code ?? '—'}{l.viaje.folio ? ` · ${l.viaje.folio}` : ''}
              </Text>
              <Text style={{ color: sinPago ? colors.warning : colors.text, fontSize: 12, fontWeight: '800' }}>
                {sinPago ? etiquetaMotivoSinPago(sinPago) : `${l.zona === 'oeste' ? 'Oeste' : 'Este'} ${usd(l.monto)}`}
              </Text>
            </View>
            <Text style={{ color: colors.muted, fontSize: 11 }}>
              Estado del camión: {l.viaje.estado_maquina || 'sin dato'}
              {l.viaje.ubicacion_nombre ? ` · ${l.viaje.ubicacion_nombre}` : ''}
              {l.viaje.origen ? ` · ${ORIGEN[l.viaje.origen] ?? l.viaje.origen}` : ''}
              {l.viaje.listero_name ? ` · ${l.viaje.listero_name}` : ''}
            </Text>
            {l.marca ? (
              <Text style={{ color: colors.muted, fontSize: 11 }}>
                {l.marca.facturable ? '✓ Vuelto a facturar' : '✗ No facturó'}
                {l.marca.motivo ? `: ${l.marca.motivo}` : ''}
                {l.marca.created_by_nombre ? ` · ${l.marca.created_by_nombre}` : ''}
              </Text>
            ) : null}
            {canEdit && sinPago !== 'sin_empresa' ? (
              marcando === l.viaje.id ? (
                <View style={{ marginTop: 4 }}>
                  <TextInput value={motivo} onChangeText={setMotivo} placeholder="Motivo (ej. viaje vacío, repetido…)" placeholderTextColor={colors.muted}
                    style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text }} />
                  <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: 4 }}>
                    <TouchableOpacity onPress={() => { setMarcando(null); setMotivo(''); }} style={{ flex: 1, padding: spacing.xs, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceAlt }}>
                      <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12 }}>Cancelar</Text>
                    </TouchableOpacity>
                    <TouchableOpacity disabled={guardando} onPress={() => marcar(l, false)} style={{ flex: 1, padding: spacing.xs, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.danger, opacity: guardando ? 0.6 : 1 }}>
                      <Text style={{ color: '#fff', fontWeight: '800', fontSize: 12 }}>Marcar «no facturó»</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : l.facturable ? (
                <TouchableOpacity onPress={() => { setMarcando(l.viaje.id); setMotivo(''); }} style={{ alignSelf: 'flex-start', marginTop: 2 }}>
                  <Text style={{ color: colors.danger, fontWeight: '700', fontSize: 12 }}>✗ No facturó</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity disabled={guardando} onPress={() => marcar(l, true)} style={{ alignSelf: 'flex-start', marginTop: 2 }}>
                  <Text style={{ color: colors.success, fontWeight: '700', fontSize: 12 }}>✓ Volver a facturar</Text>
                </TouchableOpacity>
              )
            ) : null}
          </View>
        );
      }) : null}
    </Card>
  );
}
