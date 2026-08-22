import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Modal, ScrollView, ActivityIndicator } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import { cmpText } from '../lib/text';
import { LiveStatus } from '../lib/machineLiveStatus';
import { listOpSupervisors, listOpAssignments, assignOpSupervisor, clearOpAssignment, OpSupervisor, OpAssignment } from '../lib/obrasPublicas';
import { useToast } from './ToastProvider';

// Etiqueta corta del estatus en vivo (mismo criterio que el Catálogo).
const ESTADO_META: Record<string, { label: string; color: string }> = {
  averiada: { label: '🔴 Averiada', color: '#B91C1C' },
  parada: { label: '🟡 Parada', color: '#D9A200' },
  trabajando: { label: '🟢 Trabajando', color: '#16A34A' },
  trabajo_hoy: { label: '🔵 Trabajó hoy', color: '#2563EB' },
  ninguno: { label: '⚪ Operativa', color: '#6B7280' },
};

type Maquina = { id: string; code?: string | null } & Record<string, any>;

/**
 * Vista de ASIGNACIÓN de Obras Públicas (se abre desde el botón "🏛️ Obras Públicas"
 * del catálogo). Muestra las máquinas OPERATIVAS + AVERIADAS con su estatus, un
 * buscador por todas las características, y permite asignar el "Supervisor Obras
 * Públicas" (usuarios con ese rol) por LOTE (selección múltiple) o INDIVIDUAL. Las
 * máquinas asignadas a un supervisor son las que verá ese usuario en su teléfono.
 */
export function ObrasPublicasAssignModal({
  visible, onClose, machines, statusOf, companyName, userId,
}: {
  visible: boolean;
  onClose: () => void;
  machines: Maquina[];
  statusOf: (id: string) => LiveStatus;
  companyName: (companyId: string | null) => string;
  userId?: string | null;
}) {
  const { colors } = useTheme();
  const toast = useToast();
  const [loading, setLoading] = useState(false);
  const [supers, setSupers] = useState<OpSupervisor[]>([]);
  const [assigns, setAssigns] = useState<Map<string, OpAssignment>>(new Map());
  const [q, setQ] = useState('');
  const [supSel, setSupSel] = useState<string | null>(null); // supervisor destino
  const [sel, setSel] = useState<Set<string>>(new Set());     // máquinas marcadas (lote)
  const [saving, setSaving] = useState(false);

  const reload = async () => {
    setLoading(true);
    try {
      const [s, a] = await Promise.all([listOpSupervisors(), listOpAssignments()]);
      setSupers(s);
      setAssigns(a);
      if (!supSel && s.length) setSupSel(s[0].id);
    } catch (e: any) {
      toast.error(e?.message ?? 'No se pudieron cargar los supervisores.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (visible) { setQ(''); setSel(new Set()); reload(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // Texto buscable por TODAS las características de la máquina.
  const searchText = (m: Maquina) =>
    [m.code, m.description, m.plate, m.serial, m.identifier, m.grupo, m.encargado, m.tipo, m.marca, m.modelo,
     m.clasificacion, m.machinery_type, m.parroquia, m.sector, m.referencia, companyName(m.company_id ?? null),
     assigns.get(m.id)?.supervisor_name]
      .filter(Boolean).join(' ').toLowerCase();

  const lista = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const arr = machines.filter((m) => !needle || searchText(m).includes(needle));
    return arr.sort((a, b) => cmpText(a.code ?? '', b.code ?? ''));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [machines, q, assigns]);

  const supName = (id: string | null) => supers.find((s) => s.id === id)?.full_name ?? '';

  const toggle = (id: string) => setSel((prev) => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n;
  });
  const selectAllVisible = () => setSel(new Set(lista.map((m) => m.id)));
  const clearSel = () => setSel(new Set());

  const asignarLote = async () => {
    if (!supSel) { toast.error('Elige el supervisor destino.'); return; }
    if (!sel.size) { toast.error('Marca al menos una máquina.'); return; }
    setSaving(true);
    try {
      const n = await assignOpSupervisor(Array.from(sel), supSel, userId);
      await reload();
      setSel(new Set());
      toast.success(`Se asignaron ${n} máquina(s) a ${supName(supSel)}.`);
    } catch (e: any) {
      toast.error(e?.message ?? 'No se pudo asignar.');
    } finally {
      setSaving(false);
    }
  };

  const asignarUna = async (id: string) => {
    if (!supSel) { toast.error('Elige el supervisor destino arriba.'); return; }
    setSaving(true);
    try {
      await assignOpSupervisor([id], supSel, userId);
      await reload();
      toast.success(`Asignada a ${supName(supSel)}.`);
    } catch (e: any) {
      toast.error(e?.message ?? 'No se pudo asignar.');
    } finally {
      setSaving(false);
    }
  };

  const quitar = async (id: string) => {
    setSaving(true);
    try {
      await clearOpAssignment(id);
      await reload();
      toast.success('Supervisor quitado.');
    } catch (e: any) {
      toast.error(e?.message ?? 'No se pudo quitar.');
    } finally {
      setSaving(false);
    }
  };

  const input = { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: spacing.sm, color: colors.text } as const;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} transparent={false}>
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        {/* Encabezado */}
        <View style={{ paddingTop: spacing.xl, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={{ color: colors.text, fontWeight: '800', fontSize: 18 }}>🏛️ Obras Públicas</Text>
            <TouchableOpacity onPress={onClose} style={{ paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border }}>
              <Text style={{ color: colors.text, fontWeight: '700' }}>Cerrar ✕</Text>
            </TouchableOpacity>
          </View>
          <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>
            Asigna el Supervisor de Obras Públicas a las máquinas (por lote o individual). Cada supervisor verá en su teléfono solo las máquinas que le asignes.
          </Text>
        </View>

        {loading ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : supers.length === 0 ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl }}>
            <Text style={{ color: colors.muted, textAlign: 'center' }}>No hay usuarios con el rol "Supervisor Externo Obras Públicas". Créalos en Usuarios y vuelve a abrir esta vista.</Text>
          </View>
        ) : (
          <>
            {/* Supervisor destino + buscador + acciones de lote */}
            <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.sm, gap: spacing.xs }}>
              <Text style={{ color: colors.muted, fontSize: 12 }}>Supervisor destino</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.xs, paddingVertical: 2 }}>
                {supers.map((s) => {
                  const on = supSel === s.id;
                  return (
                    <TouchableOpacity key={s.id} onPress={() => setSupSel(s.id)}
                      style={{ paddingVertical: 8, paddingHorizontal: spacing.md, borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary : colors.surfaceAlt }}>
                      <Text style={{ color: on ? colors.primaryContrast : colors.text, fontWeight: '700', fontSize: 12 }}>👷 {s.full_name}</Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
              <TextInput value={q} onChangeText={setQ} placeholder="🔎 Buscar por código, placa, serial, marca, empresa, parroquia…" placeholderTextColor={colors.muted} style={{ ...input, marginTop: 4 }} />
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: 2 }}>
                <TouchableOpacity onPress={selectAllVisible} style={{ paddingVertical: 6, paddingHorizontal: spacing.sm, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border }}>
                  <Text style={{ color: colors.text, fontSize: 12, fontWeight: '700' }}>Marcar todas ({lista.length})</Text>
                </TouchableOpacity>
                {sel.size > 0 ? (
                  <TouchableOpacity onPress={clearSel} style={{ paddingVertical: 6, paddingHorizontal: spacing.sm, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border }}>
                    <Text style={{ color: colors.text, fontSize: 12, fontWeight: '700' }}>Limpiar ({sel.size})</Text>
                  </TouchableOpacity>
                ) : null}
                <Text style={{ color: colors.muted, fontSize: 11, flex: 1, textAlign: 'right' }}>{lista.length} máquina(s)</Text>
              </View>
            </View>

            {/* Lista de máquinas */}
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: spacing.lg, paddingTop: spacing.sm, gap: 6 }}>
              {lista.map((m) => {
                const st = statusOf(m.id);
                const meta = ESTADO_META[st.estado] ?? ESTADO_META.ninguno;
                const asg = assigns.get(m.id);
                const marcada = sel.has(m.id);
                const label = [m.plate || m.serial, m.marca, m.modelo].filter(Boolean).join(' · ');
                return (
                  <View key={m.id} style={{ borderWidth: 1, borderColor: marcada ? colors.primary : colors.border, backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.sm }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                      <TouchableOpacity onPress={() => toggle(m.id)} style={{ width: 26, height: 26, borderRadius: 6, borderWidth: 2, borderColor: marcada ? colors.primary : colors.border, backgroundColor: marcada ? colors.primary : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                        {marcada ? <Text style={{ color: colors.primaryContrast, fontWeight: '900', fontSize: 14 }}>✓</Text> : null}
                      </TouchableOpacity>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14 }}>{m.code}</Text>
                        {label ? <Text style={{ color: colors.muted, fontSize: 11 }}>{label}</Text> : null}
                        <Text style={{ color: colors.muted, fontSize: 11 }}>{companyName(m.company_id ?? null)}</Text>
                      </View>
                      <Text style={{ color: meta.color, fontSize: 11, fontWeight: '800' }}>{meta.label}</Text>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: 6 }}>
                      <Text style={{ flex: 1, fontSize: 12, color: asg ? colors.text : colors.muted, fontWeight: asg ? '700' : '400' }}>
                        {asg ? `👷 ${asg.supervisor_name}` : 'Sin supervisor de obras públicas'}
                      </Text>
                      <TouchableOpacity onPress={() => asignarUna(m.id)} disabled={saving} style={{ paddingVertical: 6, paddingHorizontal: spacing.sm, borderRadius: radius.sm, backgroundColor: colors.primary, opacity: saving ? 0.6 : 1 }}>
                        <Text style={{ color: colors.primaryContrast, fontSize: 12, fontWeight: '800' }}>Asignar aquí</Text>
                      </TouchableOpacity>
                      {asg ? (
                        <TouchableOpacity onPress={() => quitar(m.id)} disabled={saving} style={{ paddingVertical: 6, paddingHorizontal: spacing.sm, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.danger }}>
                          <Text style={{ color: colors.danger, fontSize: 12, fontWeight: '800' }}>Quitar</Text>
                        </TouchableOpacity>
                      ) : null}
                    </View>
                  </View>
                );
              })}
              {lista.length === 0 ? <Text style={{ color: colors.muted, textAlign: 'center', marginTop: spacing.xl }}>No hay máquinas que coincidan.</Text> : null}
            </ScrollView>

            {/* Barra inferior: asignar por LOTE */}
            {sel.size > 0 ? (
              <View style={{ padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface }}>
                <TouchableOpacity onPress={asignarLote} disabled={saving} style={{ backgroundColor: colors.primary, borderRadius: radius.md, padding: spacing.md, alignItems: 'center', opacity: saving ? 0.6 : 1 }}>
                  <Text style={{ color: colors.primaryContrast, fontWeight: '800' }}>
                    {saving ? 'Asignando…' : `✅ Asignar ${sel.size} máquina(s) a ${supName(supSel)}`}
                  </Text>
                </TouchableOpacity>
              </View>
            ) : null}
          </>
        )}
      </View>
    </Modal>
  );
}
