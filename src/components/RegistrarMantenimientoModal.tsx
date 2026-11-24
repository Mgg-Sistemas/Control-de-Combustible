import React, { useEffect, useMemo, useState } from 'react';
import { Modal, View, Text, TextInput, TouchableOpacity, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import { useToast } from './ToastProvider';
import { Card } from './ui';
import {
  calcularCicloPreventivo,
  etiquetaMaquinaConPlaca,
  validarHorometroServicio,
} from '../lib/mantenimientoPreventivo';
import { registrarServicioPreventivo } from '../lib/mantenimientoPreventivoDb';

export type MaquinaMantenimientoTarget = {
  id: string;
  code: string;
  plate: string | null;
  company: string;
  last_horometro: number | null;
  horometro_base: number | null;
};

type Props = {
  visible: boolean;
  maquina: MaquinaMantenimientoTarget | null;
  uid: string | null;
  nombreUsuario: string | null;
  onClose: () => void;
  onGuardado: (res: { machineryId: string; horometroBase: number; maintPending: boolean; faltaSql?: boolean; fechaServicio?: string; notas?: string | null; abrirWhatsapp?: boolean }) => void;
};

function fechaCaracasHoy(): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Caracas' }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

export function RegistrarMantenimientoModal({ visible, maquina, uid, nombreUsuario, onClose, onGuardado }: Props) {
  const { colors } = useTheme();
  const toast = useToast();

  const [horoTxt, setHoroTxt] = useState('');
  const [fechaTxt, setFechaTxt] = useState(fechaCaracasHoy);
  const [notas, setNotas] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible || !maquina) return;
    setHoroTxt(maquina.last_horometro != null ? String(maquina.last_horometro) : '');
    setFechaTxt(fechaCaracasHoy());
    setNotas('');
  }, [visible, maquina]);

  const validacion = useMemo(
    () => (maquina ? validarHorometroServicio(horoTxt, maquina.last_horometro) : null),
    [horoTxt, maquina],
  );

  const proyeccion = useMemo(() => {
    if (!maquina || !validacion || !validacion.ok) return null;
    return calcularCicloPreventivo(maquina.last_horometro, validacion.valor);
  }, [maquina, validacion]);

  const guardar = async (abrirWhatsapp = false) => {
    if (!maquina || saving) return;
    const v = validarHorometroServicio(horoTxt, maquina.last_horometro);
    if (!v.ok) {
      toast.error(v.error);
      return;
    }
    const f = fechaTxt.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f)) {
      toast.error('La fecha debe tener formato AAAA-MM-DD (ej. 2026-11-17).');
      return;
    }
    const fechaISO = `${f}T12:00:00-04:00`;
    setSaving(true);
    const res = await registrarServicioPreventivo({
      machineryId: maquina.id,
      horometroServicio: v.valor,
      horometroAnterior: maquina.horometro_base,
      lastHorometro: maquina.last_horometro,
      fechaServicioISO: fechaISO,
      notas: notas.trim() || null,
      uid,
      nombreUsuario,
    });
    setSaving(false);
    if (!res.ok) {
      toast.error(res.error || 'No se pudo registrar el mantenimiento.');
      return;
    }
    if (res.faltaSql) {
      toast.success('Horómetro base actualizado. Nota: falta crear la tabla de historial preventivo en Supabase.');
    } else {
      toast.success(`Mantenimiento registrado en ${maquina.code} a las ${v.valor} h.`);
    }
    onGuardado({
      machineryId: maquina.id,
      horometroBase: v.valor,
      maintPending: res.maintPending,
      faltaSql: res.faltaSql,
      fechaServicio: fechaISO,
      notas: notas.trim() || null,
      abrirWhatsapp,
    });
    onClose();
  };

  if (!maquina) return null;

  const inputStyle = {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.text,
    fontSize: 15,
  } as const;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: spacing.md }}
      >
        <View style={{ width: '100%', maxWidth: 500, maxHeight: '92%', backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surfaceAlt }}>
            <Text style={{ color: colors.text, fontWeight: '900', fontSize: 15, flex: 1 }}>
              ✓ Confirmar mantenimiento (250 h)
            </Text>
            <TouchableOpacity onPress={onClose} style={{ padding: spacing.xs }}>
              <Text style={{ color: colors.muted, fontWeight: '800', fontSize: 16 }}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: spacing.md, gap: spacing.sm }}>
            <Card style={{ backgroundColor: colors.surfaceAlt }}>
              <Text style={{ color: colors.text, fontWeight: '900', fontSize: 15 }}>
                {etiquetaMaquinaConPlaca(maquina.code, maquina.plate)}
              </Text>
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>
                🏢 {maquina.company} · Horómetro actual: <Text style={{ color: colors.text, fontWeight: '800' }}>{maquina.last_horometro != null ? `${maquina.last_horometro} h` : '—'}</Text>
              </Text>
            </Card>

            <View>
              <Text style={{ color: colors.text, fontWeight: '800', fontSize: 12.5, marginBottom: 4 }}>
                ⏱️ Horómetro exacto en que se hizo el servicio *
              </Text>
              <TextInput
                value={horoTxt}
                onChangeText={setHoroTxt}
                keyboardType="decimal-pad"
                placeholder="Ej. 1200,0"
                placeholderTextColor={colors.muted}
                style={inputStyle}
              />
              <Text style={{ color: colors.muted, fontSize: 11, marginTop: 3 }}>
                Si el servicio se hizo hace días (ej. a las 1200 h y hoy marca 1209,3 h), escribe 1200 para conservar las 9,3 h ya trabajadas.
              </Text>
            </View>

            {proyeccion ? (
              <Card style={{ backgroundColor: '#EEF2FF', borderColor: '#6366F1', borderWidth: 1 }}>
                <Text style={{ color: '#312E81', fontWeight: '800', fontSize: 12.5, marginBottom: 4 }}>
                  📊 Proyección del ciclo 250H
                </Text>
                <Text style={{ color: '#3730A3', fontSize: 12 }}>
                  • Acumuladas desde el servicio: <Text style={{ fontWeight: '900' }}>{proyeccion.acumuladas} h</Text>
                </Text>
                <Text style={{ color: '#3730A3', fontSize: 12 }}>
                  • Restante para próximo servicio: <Text style={{ fontWeight: '900' }}>{proyeccion.restante > 0 ? `${proyeccion.restante} h` : 'Vencido'}</Text>
                </Text>
                <Text style={{ color: '#3730A3', fontSize: 12 }}>
                  • Próximo mantenimiento a las: <Text style={{ fontWeight: '900' }}>{proyeccion.proximoObjetivo} h</Text>
                </Text>
              </Card>
            ) : validacion && !validacion.ok ? (
              <Text style={{ color: colors.danger, fontSize: 12, fontWeight: '700' }}>⚠️ {validacion.error}</Text>
            ) : null}

            <View>
              <Text style={{ color: colors.text, fontWeight: '800', fontSize: 12.5, marginBottom: 4 }}>
                📅 Fecha del servicio (AAAA-MM-DD)
              </Text>
              <TextInput
                value={fechaTxt}
                onChangeText={setFechaTxt}
                placeholder="2026-11-17"
                placeholderTextColor={colors.muted}
                style={inputStyle}
              />
            </View>

            <View>
              <Text style={{ color: colors.text, fontWeight: '800', fontSize: 12.5, marginBottom: 4 }}>
                📝 Trabajos / filtros realizados (opcional)
              </Text>
              <TextInput
                value={notas}
                onChangeText={setNotas}
                placeholder="Ej. Cambio de aceite 15W40, filtro de aceite y gasoil…"
                placeholderTextColor={colors.muted}
                multiline
                style={[inputStyle, { minHeight: 70, textAlignVertical: 'top' }]}
              />
            </View>

            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xs }}>
              <TouchableOpacity
                onPress={onClose}
                style={{ flex: 1, minWidth: 90, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center' }}
              >
                <Text style={{ color: colors.text, fontWeight: '700' }}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => guardar(false)}
                disabled={saving || (validacion ? !validacion.ok : true)}
                style={{ flex: 1.5, minWidth: 140, backgroundColor: colors.success, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', opacity: saving || (validacion ? !validacion.ok : true) ? 0.5 : 1 }}
              >
                <Text style={{ color: '#fff', fontWeight: '900' }}>
                  {saving ? 'Guardando…' : '✓ Confirmar'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => guardar(true)}
                disabled={saving || (validacion ? !validacion.ok : true)}
                style={{ flex: 1.5, minWidth: 160, backgroundColor: '#16A34A', borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', opacity: saving || (validacion ? !validacion.ok : true) ? 0.5 : 1 }}
              >
                <Text style={{ color: '#fff', fontWeight: '900' }}>
                  {saving ? 'Guardando…' : '💬 Guardar y WhatsApp'}
                </Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
