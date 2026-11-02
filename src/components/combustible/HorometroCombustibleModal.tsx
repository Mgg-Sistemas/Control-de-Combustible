// ⏱️ Corrección del horómetro en los papeles de Combustible (02-nov-2026).
//
// Muestra lo que cargó el inspector (solo lectura) y deja escribir una corrección
// inicial/final + nota que SOLO vale para los reportes de Combustible. Nunca toca
// machine_rounds. Solo se abre con 'full' en Consumos y con
// HOROMETRO_AJUSTES_ACTIVOS encendido (la RLS lo vuelve a comprobar).
import React, { useEffect, useState } from 'react';
import { Modal, View, Text, TextInput, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { spacing, radius } from '../../theme';
import { leerNumero } from '../../lib/numeros';
import { guardarAjusteHorometro, HorometroDia } from '../../lib/combustibleHorometro';

type Props = {
  visible: boolean;
  machineryId: string | null;
  fecha: string | null;
  equipo: string;
  horometro: HorometroDia | null;
  autor?: string | null;
  onClose: () => void;
  onSaved: () => void;
  onError: (msg: string) => void;
};

const fmt = (n: number | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('es-VE', { maximumFractionDigits: 1 }));

export default function HorometroCombustibleModal({ visible, machineryId, fecha, equipo, horometro, autor, onClose, onSaved, onError }: Props) {
  const { colors } = useTheme();
  const [ini, setIni] = useState('');
  const [fin, setFin] = useState('');
  const [nota, setNota] = useState('');
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    if (!visible) return;
    const esAjuste = horometro?.fuente === 'ajuste';
    setIni(esAjuste && horometro?.inicial != null ? String(horometro.inicial) : '');
    setFin(esAjuste && horometro?.final != null ? String(horometro.final) : '');
    setNota(horometro?.nota ?? '');
  }, [visible, horometro]);

  const guardar = async () => {
    if (!machineryId || !fecha) return;
    const i = ini.trim() ? leerNumero(ini) : null;
    const f = fin.trim() ? leerNumero(fin) : null;
    if ((i != null && !(i > 0)) || (f != null && !(f > 0))) {
      onError('El horómetro debe ser un número mayor que cero.');
      return;
    }
    if (i != null && f != null && f < i) {
      onError('El horómetro final no puede ser menor que el inicial.');
      return;
    }
    setGuardando(true);
    try {
      const r = await guardarAjusteHorometro({ machineryId, fecha, inicial: i, final: f, nota, autor });
      if (!r.ok) {
        onError(r.error || 'No se guardó la corrección.');
        return;
      }
      onSaved();
    } catch (e: any) {
      onError('No se guardó la corrección: ' + (e?.message || 'Error'));
    } finally {
      setGuardando(false);
    }
  };

  const campo = {
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    padding: spacing.sm,
    fontSize: 13,
    color: colors.text,
  } as const;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: spacing.md, zIndex: 9999 }}>
        <View style={{ width: '100%', maxWidth: 520, maxHeight: '90%', backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, zIndex: 9999 }}>
          <ScrollView contentContainerStyle={{ padding: spacing.md, gap: spacing.sm }}>
            <Text style={{ fontSize: 15, fontWeight: '900', color: colors.text }}>⏱️ Horómetro para Combustible</Text>
            <Text style={{ fontSize: 12, color: colors.muted }}>{equipo} · jornada {fecha}</Text>

            <View style={{ backgroundColor: colors.surfaceAlt, borderRadius: radius.sm, padding: spacing.sm, borderWidth: 1, borderColor: colors.border }}>
              <Text style={{ fontSize: 11, color: colors.muted }}>Cargado por el inspector (no se modifica)</Text>
              <Text style={{ fontSize: 13, fontWeight: '800', color: colors.text }}>
                {fmt(horometro?.inspInicial)} ➔ {fmt(horometro?.inspFinal)}
              </Text>
            </View>

            <Text style={{ fontSize: 12, color: colors.muted }}>
              La corrección solo cambia lo que sale en los reportes de Combustible. Lo que dejes vacío conserva lo del inspector.
            </Text>
            <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
              <View style={{ flex: 1, minWidth: 130 }}>
                <Text style={{ fontSize: 11, color: colors.muted, marginBottom: 2 }}>Inicial corregido</Text>
                <TextInput value={ini} onChangeText={setIni} keyboardType="decimal-pad" placeholder={fmt(horometro?.inspInicial)} placeholderTextColor={colors.muted} style={campo} />
              </View>
              <View style={{ flex: 1, minWidth: 130 }}>
                <Text style={{ fontSize: 11, color: colors.muted, marginBottom: 2 }}>Final corregido</Text>
                <TextInput value={fin} onChangeText={setFin} keyboardType="decimal-pad" placeholder={fmt(horometro?.inspFinal)} placeholderTextColor={colors.muted} style={campo} />
              </View>
            </View>
            <View>
              <Text style={{ fontSize: 11, color: colors.muted, marginBottom: 2 }}>Nota (por qué se corrige)</Text>
              <TextInput value={nota} onChangeText={setNota} multiline style={[campo, { minHeight: 60, textAlignVertical: 'top' }]} />
            </View>

            <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap', marginTop: spacing.sm }}>
              <TouchableOpacity onPress={onClose} disabled={guardando} style={{ flex: 1, minWidth: 120, padding: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, alignItems: 'center' }}>
                <Text style={{ fontWeight: '800', color: colors.text }}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={guardar} disabled={guardando} style={{ flex: 1, minWidth: 120, padding: spacing.sm, borderRadius: radius.md, backgroundColor: colors.primary, alignItems: 'center' }}>
                {guardando ? <ActivityIndicator color={colors.primaryContrast} /> : <Text style={{ fontWeight: '900', color: colors.primaryContrast }}>Guardar corrección</Text>}
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
