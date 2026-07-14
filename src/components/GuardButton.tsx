import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Modal, ScrollView, Alert } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import { MachineGuard } from '../types/database';
import { assignGuard, clearGuard, listGuards, listGuardNames } from '../lib/guards';

// Tipo de supervisor: se guarda en la columna `rank` del registro de guardia.
const TIPOS = ['Supervisor Empresa', 'Supervisor Militar'] as const;

function fmtDateTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  const dd = `${d.getDate()}`.padStart(2, '0');
  const mm = `${d.getMonth() + 1}`.padStart(2, '0');
  const hh = `${d.getHours()}`.padStart(2, '0');
  const mi = `${d.getMinutes()}`.padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()} ${hh}:${mi}`;
}

/**
 * Botón compacto que muestra el guardia/militar ACTUAL de una máquina y abre un
 * modal para cambiarlo (dejando el historial acumulable) o ver la traza completa.
 */
export function GuardButton({
  machine,
  current,
  onChanged,
  userId,
}: {
  machine: { id: string; code: string };
  current: MachineGuard | null;
  onChanged: () => void;
  userId?: string | null;
}) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [rank, setRank] = useState<string>(TIPOS[0]);
  const [note, setNote] = useState('');
  const [history, setHistory] = useState<MachineGuard[]>([]);
  const [names, setNames] = useState<string[]>([]);
  const [showSug, setShowSug] = useState(false);
  const [saving, setSaving] = useState(false);

  const openModal = async () => {
    setName('');
    setRank(TIPOS[0]);
    setNote('');
    setShowSug(false);
    setOpen(true);
    setHistory(await listGuards(machine.id));
    setNames(await listGuardNames());
  };

  const save = async () => {
    if (!name.trim()) { Alert.alert('Aviso', 'Escribe el nombre del supervisor.'); return; }
    setSaving(true);
    try {
      await assignGuard(machine.id, { guard_name: name, rank, note }, userId);
      setOpen(false);
      onChanged();
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'No se pudo asignar el guardia.');
    } finally {
      setSaving(false);
    }
  };

  const retirar = () => {
    Alert.alert('Retirar supervisor', `¿Quitar el supervisor actual de ${machine.code}? Quedará en el historial.`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Retirar',
        style: 'destructive',
        onPress: async () => { await clearGuard(machine.id); setOpen(false); onChanged(); },
      },
    ]);
  };

  // Sugerencias a mostrar: filtra por lo escrito y NO muestra si el texto ya coincide
  // exacto con un nombre (o sea, ya está elegido) para que el desplegable se cierre.
  const q = name.trim().toLowerCase();
  const sugNames = names
    .filter((n) => (!q || n.toLowerCase().includes(q)) && n.toLowerCase() !== q)
    .slice(0, 8);

  return (
    <>
      <TouchableOpacity
        onPress={openModal}
        style={{
          flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.xs,
          borderWidth: 1, borderColor: current ? colors.success : colors.border,
          backgroundColor: colors.surfaceAlt, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 6,
        }}
      >
        <Text style={{ fontSize: 14 }}>🪖</Text>
        <Text style={{ color: current ? colors.text : colors.warning, fontSize: 12, fontWeight: '700', flex: 1 }}>
          {current
            ? `${current.rank ? `${current.rank}: ` : 'Supervisor: '}${current.guard_name}`
            : 'Sin supervisor asignado · toca para asignar'}
        </Text>
        <Text style={{ color: colors.primary, fontSize: 12, fontWeight: '800' }}>✎</Text>
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: spacing.lg }}>
          <View style={{ backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, maxHeight: '85%' }}>
            <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
              <Text style={{ color: colors.text, fontWeight: '800', fontSize: 16, marginBottom: 2 }}>🪖 Supervisor encargado</Text>
              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.sm }}>{machine.code}</Text>

              {current ? (
                <View style={{ backgroundColor: colors.surfaceAlt, borderRadius: radius.md, padding: spacing.sm, borderLeftWidth: 3, borderLeftColor: colors.success, marginBottom: spacing.md }}>
                  <Text style={{ color: colors.muted, fontSize: 11 }}>Actual (desde {fmtDateTime(current.assigned_at)})</Text>
                  <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15 }}>{current.rank ? `${current.rank} ` : ''}{current.guard_name}</Text>
                  {current.note ? <Text style={{ color: colors.muted, fontSize: 12 }}>{current.note}</Text> : null}
                </View>
              ) : null}

              <Text style={{ color: colors.text, fontWeight: '700', marginBottom: spacing.xs }}>
                {current ? 'Cambiar supervisor' : 'Asignar supervisor'}
              </Text>

              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>Tipo de supervisor</Text>
              <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm }}>
                {TIPOS.map((t) => {
                  const on = rank === t;
                  return (
                    <TouchableOpacity
                      key={t} onPress={() => setRank(t)}
                      style={{ flex: 1, paddingVertical: spacing.sm, borderRadius: radius.md, alignItems: 'center', borderWidth: 1, borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary : colors.surfaceAlt }}
                    >
                      <Text style={{ color: on ? colors.primaryContrast : colors.text, fontWeight: '700', fontSize: 13 }}>{t}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 2 }}>Nombre del supervisor</Text>
              <TextInput
                value={name}
                onChangeText={(v) => { setName(v); setShowSug(true); }}
                onFocus={() => setShowSug(true)}
                onBlur={() => setTimeout(() => setShowSug(false), 150)}
                placeholder="Nombre y apellido" placeholderTextColor={colors.muted}
                style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: spacing.sm, color: colors.text, marginBottom: showSug && sugNames.length ? 0 : spacing.sm }}
              />
              {showSug && sugNames.length > 0 ? (
                <View style={{ borderWidth: 1, borderColor: colors.border, borderTopWidth: 0, borderBottomLeftRadius: radius.sm, borderBottomRightRadius: radius.sm, marginBottom: spacing.sm, maxHeight: 140 }}>
                  <ScrollView keyboardShouldPersistTaps="handled">
                    {sugNames.map((n) => (
                      <TouchableOpacity key={n} onPress={() => { setName(n); setShowSug(false); }} style={{ paddingVertical: 8, paddingHorizontal: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border }}>
                        <Text style={{ color: colors.text, fontSize: 13 }}>👤 {n}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              ) : null}
              {/* Ocultar sugerencias tocando fuera del campo. */}
              {showSug && sugNames.length > 0 ? (
                <TouchableOpacity onPress={() => setShowSug(false)}>
                  <Text style={{ color: colors.primary, fontSize: 11, textAlign: 'right', marginBottom: spacing.sm }}>Ocultar sugerencias ✕</Text>
                </TouchableOpacity>
              ) : null}
              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 2 }}>Nota (opcional)</Text>
              <TextInput
                value={note} onChangeText={setNote} placeholder="Observación" placeholderTextColor={colors.muted}
                style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: spacing.sm, color: colors.text, marginBottom: spacing.md }}
              />

              <TouchableOpacity onPress={save} disabled={saving} style={{ padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.primary, opacity: saving ? 0.6 : 1 }}>
                <Text style={{ color: colors.primaryContrast, fontWeight: '800' }}>{saving ? 'Guardando…' : current ? '🔁 Cambiar supervisor' : '✅ Asignar supervisor'}</Text>
              </TouchableOpacity>
              {current ? (
                <TouchableOpacity onPress={retirar} style={{ padding: spacing.md, borderRadius: radius.md, alignItems: 'center', marginTop: spacing.sm, borderWidth: 1, borderColor: colors.danger }}>
                  <Text style={{ color: colors.danger, fontWeight: '700' }}>Retirar supervisor (sin reemplazo)</Text>
                </TouchableOpacity>
              ) : null}

              {history.length > 0 ? (
                <>
                  <Text style={{ color: colors.text, fontWeight: '700', marginTop: spacing.lg, marginBottom: spacing.xs }}>Historial de supervisores</Text>
                  {history.map((g) => (
                    <View key={g.id} style={{ borderBottomWidth: 1, borderBottomColor: colors.border, paddingVertical: 6 }}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Text style={{ color: colors.text, fontWeight: g.active ? '800' : '600', fontSize: 13, flex: 1 }}>
                          {g.rank ? `${g.rank} ` : ''}{g.guard_name}
                        </Text>
                        {g.active ? <Text style={{ color: colors.success, fontSize: 11, fontWeight: '800' }}>ACTUAL</Text> : null}
                      </View>
                      <Text style={{ color: colors.muted, fontSize: 11 }}>
                        {fmtDateTime(g.assigned_at)} → {g.ended_at ? fmtDateTime(g.ended_at) : 'presente'}
                      </Text>
                      {g.note ? <Text style={{ color: colors.muted, fontSize: 11 }}>{g.note}</Text> : null}
                    </View>
                  ))}
                </>
              ) : null}

              <TouchableOpacity onPress={() => setOpen(false)} style={{ padding: spacing.md, borderRadius: radius.md, alignItems: 'center', marginTop: spacing.md, backgroundColor: colors.surfaceAlt }}>
                <Text style={{ color: colors.text, fontWeight: '700' }}>Cerrar</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}
