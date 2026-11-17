import React, { useCallback, useEffect, useState } from 'react';
import { Modal, View, Text, TextInput, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import { useToast } from './ToastProvider';
import { Card } from './ui';
import { etiquetaMaquinaConPlaca, type ServicioPreventivoRow } from '../lib/mantenimientoPreventivo';
import { anularServicioPreventivo, cargarServiciosPreventivos } from '../lib/mantenimientoPreventivoDb';
import type { MaquinaMantenimientoTarget } from './RegistrarMantenimientoModal';

type Props = {
  visible: boolean;
  maquina: MaquinaMantenimientoTarget | null;
  canWrite: boolean;
  uid: string | null;
  nombreUsuario: string | null;
  onClose: () => void;
  onAnulado: (res: { machineryId: string; nuevaBase: number | null; maintPending: boolean }) => void;
};

function fmtFechaVe(iso: string): string {
  try {
    return new Intl.DateTimeFormat('es-VE', {
      timeZone: 'America/Caracas',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(new Date(iso));
  } catch {
    return String(iso || '').slice(0, 10);
  }
}

export function HistorialServiciosModal({ visible, maquina, canWrite, uid, nombreUsuario, onClose, onAnulado }: Props) {
  const { colors } = useTheme();
  const toast = useToast();

  const [loading, setLoading] = useState(false);
  const [faltaSql, setFaltaSql] = useState(false);
  const [rows, setRows] = useState<ServicioPreventivoRow[]>([]);
  const [anulandoId, setAnulandoId] = useState<string | null>(null);
  const [motivo, setMotivo] = useState('');
  const [busy, setBusy] = useState(false);

  const cargar = useCallback(async () => {
    if (!visible || !maquina) return;
    setLoading(true);
    const res = await cargarServiciosPreventivos(maquina.id);
    setLoading(false);
    setFaltaSql(res.faltaSql);
    if (res.error) toast.error(res.error);
    setRows(res.rows);
  }, [visible, maquina, toast]);

  useEffect(() => {
    setAnulandoId(null);
    setMotivo('');
    cargar();
  }, [cargar]);

  const confirmarAnulacion = async (servicioId: string) => {
    if (!maquina || busy) return;
    if (!motivo.trim()) {
      toast.error('Escribe el motivo por el que anulas este servicio.');
      return;
    }
    setBusy(true);
    const res = await anularServicioPreventivo({
      servicioId,
      machineryId: maquina.id,
      lastHorometro: maquina.last_horometro,
      motivo,
      uid,
      nombreUsuario,
    });
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error || 'No se pudo anular el servicio.');
      return;
    }
    toast.success('Servicio anulado. Horómetro base recalculado automáticamente.');
    setAnulandoId(null);
    setMotivo('');
    onAnulado({ machineryId: maquina.id, nuevaBase: res.nuevaBase, maintPending: res.maintPending });
    await cargar();
  };

  if (!maquina) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: spacing.md }}>
        <View style={{ width: '100%', maxWidth: 540, maxHeight: '90%', backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surfaceAlt }}>
            <Text style={{ color: colors.text, fontWeight: '900', fontSize: 15, flex: 1 }}>
              📋 Historial de servicios (250 h)
            </Text>
            <TouchableOpacity onPress={onClose} style={{ padding: spacing.xs }}>
              <Text style={{ color: colors.muted, fontWeight: '800', fontSize: 16 }}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={{ padding: spacing.md, gap: spacing.sm }}>
            <Card style={{ backgroundColor: colors.surfaceAlt }}>
              <Text style={{ color: colors.text, fontWeight: '900', fontSize: 14.5 }}>
                {etiquetaMaquinaConPlaca(maquina.code, maquina.plate)}
              </Text>
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>
                🏢 {maquina.company} · Base actual: <Text style={{ color: colors.text, fontWeight: '800' }}>{maquina.horometro_base != null ? `${maquina.horometro_base} h` : '—'}</Text>
              </Text>
            </Card>

            {loading ? (
              <View style={{ paddingVertical: spacing.lg, alignItems: 'center' }}>
                <ActivityIndicator />
                <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.xs }}>Cargando historial…</Text>
              </View>
            ) : faltaSql ? (
              <Card style={{ borderColor: colors.warning, borderWidth: 1 }}>
                <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>
                  ⚠️ Falta crear la tabla de historial (`machinery_preventive_services`) en Supabase.
                </Text>
              </Card>
            ) : rows.length === 0 ? (
              <Text style={{ color: colors.muted, fontSize: 13, textAlign: 'center', paddingVertical: spacing.lg }}>
                Todavía no hay servicios preventivos registrados para esta máquina.
              </Text>
            ) : rows.map((r) => (
              <Card
                key={r.id}
                style={{
                  borderWidth: 1.5,
                  borderColor: r.anulado ? colors.border : colors.success,
                  backgroundColor: r.anulado ? colors.surfaceAlt : colors.surface,
                  opacity: r.anulado ? 0.72 : 1,
                  gap: 4,
                }}
              >
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                  <Text style={{ color: colors.text, fontWeight: '900', fontSize: 14 }}>
                    ⏱️ {r.horometro_servicio} h · 📅 {fmtFechaVe(r.fecha_servicio)}
                  </Text>
                  <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill, backgroundColor: r.anulado ? '#FEE2E2' : '#DCFCE7' }}>
                    <Text style={{ color: r.anulado ? '#B91C1C' : '#15803D', fontWeight: '800', fontSize: 10.5 }}>
                      {r.anulado ? '🚫 ANULADO' : '✅ VIGENTE'}
                    </Text>
                  </View>
                </View>

                <Text style={{ color: colors.muted, fontSize: 12 }}>
                  👷 Registró: <Text style={{ color: colors.text, fontWeight: '600' }}>{r.realizado_por_nombre || '—'}</Text>
                  {r.horometro_anterior != null ? ` · Base previa: ${r.horometro_anterior} h` : ''}
                </Text>

                {r.notas ? (
                  <Text style={{ color: colors.text, fontSize: 12, fontStyle: 'italic' }}>
                    📝 {r.notas}
                  </Text>
                ) : null}

                {r.anulado ? (
                  <View style={{ marginTop: 4, padding: 6, borderRadius: radius.sm, backgroundColor: '#FEF2F2' }}>
                    <Text style={{ color: '#991B1B', fontSize: 11.5, fontWeight: '700' }}>
                      Anulado el {r.anulado_el ? fmtFechaVe(r.anulado_el) : '—'} por {r.anulado_por_nombre || 'Usuario'}
                    </Text>
                    {r.motivo_anulacion ? (
                      <Text style={{ color: '#991B1B', fontSize: 11.5 }}>Motivo: {r.motivo_anulacion}</Text>
                    ) : null}
                  </View>
                ) : canWrite ? (
                  anulandoId === r.id ? (
                    <View style={{ marginTop: 6, gap: 6 }}>
                      <TextInput
                        value={motivo}
                        onChangeText={setMotivo}
                        placeholder="Motivo obligatorio de anulación…"
                        placeholderTextColor={colors.muted}
                        style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.danger, borderRadius: radius.md, paddingHorizontal: spacing.sm, paddingVertical: 6, color: colors.text, fontSize: 12.5 }}
                      />
                      <View style={{ flexDirection: 'row', gap: spacing.xs }}>
                        <TouchableOpacity
                          onPress={() => { setAnulandoId(null); setMotivo(''); }}
                          style={{ flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: 6, alignItems: 'center' }}
                        >
                          <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12 }}>Cancelar</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => confirmarAnulacion(r.id)}
                          disabled={busy}
                          style={{ flex: 2, backgroundColor: colors.danger, borderRadius: radius.md, paddingVertical: 6, alignItems: 'center', opacity: busy ? 0.6 : 1 }}
                        >
                          <Text style={{ color: '#fff', fontWeight: '800', fontSize: 12 }}>{busy ? 'Anulando…' : '🚫 Confirmar anulación'}</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  ) : (
                    <TouchableOpacity
                      onPress={() => { setAnulandoId(r.id); setMotivo(''); }}
                      style={{ alignSelf: 'flex-start', marginTop: 4, borderWidth: 1, borderColor: colors.danger, borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 4 }}
                    >
                      <Text style={{ color: colors.danger, fontWeight: '700', fontSize: 11.5 }}>🚫 Anular servicio</Text>
                    </TouchableOpacity>
                  )
                ) : null}
              </Card>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
