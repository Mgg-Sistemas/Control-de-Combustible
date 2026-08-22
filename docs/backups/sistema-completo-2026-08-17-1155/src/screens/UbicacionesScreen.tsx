// CATÁLOGO DE UBICACIONES (edificios) — para Inspectores. Gestiona la MISMA lista
// `public.edificios` que usa el EdificioPicker en el teléfono, el catálogo y los
// reportes: agregar / editar / eliminar aquí se refleja en TODOS lados al instante.
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView } from 'react-native';
import { Screen, Card, SectionTitle, EmptyState, Loading } from '../components/ui';
import { useRealtimeRefresh } from '../hooks/useRealtime';
import { useToast } from '../components/ToastProvider';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import { norm } from '../lib/text';
import { fetchEdificioRows, addEdificio, updateEdificio, updateEdificioSector, deleteEdificio, EdificioRow } from '../lib/edificios';

export default function UbicacionesScreen() {
  const { colors } = useTheme();
  const toast = useToast();
  const [rows, setRows] = useState<EdificioRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [nuevo, setNuevo] = useState('');
  const [busy, setBusy] = useState(false);
  // Edición en línea (id que se está editando + su texto) y confirmación de borrado.
  const [editId, setEditId] = useState<string | null>(null);
  const [editTxt, setEditTxt] = useState('');
  const [editSector, setEditSector] = useState('');
  const [delId, setDelId] = useState<string | null>(null);

  const load = async () => { setRows(await fetchEdificioRows()); setLoading(false); };
  useEffect(() => { load(); }, []);
  useRealtimeRefresh(['edificios'], () => { load(); });

  const filtered = useMemo(() => {
    const nq = norm(q.trim());
    return nq ? rows.filter((r) => norm(r.name).includes(nq)) : rows;
  }, [rows, q]);

  const input = { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text } as const;

  const agregar = async () => {
    const name = nuevo.trim();
    if (!name || busy) return;
    setBusy(true);
    const saved = await addEdificio(name);
    setBusy(false);
    if (!saved) { toast.error('No se pudo agregar la ubicación.'); return; }
    setNuevo('');
    toast.success('Ubicación agregada.');
    await load();
  };

  const guardarEdicion = async (r: EdificioRow) => {
    if (busy) return;
    setBusy(true);
    const res = await updateEdificio(r.id, editTxt, r.name);
    // Sub-sector (El Palmar / Los Corales…): se guarda aunque no cambie el nombre.
    const resSec = res.ok ? await updateEdificioSector(r.id, editSector) : { ok: true };
    setBusy(false);
    if (!res.ok) { toast.error(res.error ?? 'No se pudo guardar.'); return; }
    if (!resSec.ok) { toast.error(resSec.error ?? 'No se pudo guardar el sub-sector.'); return; }
    setEditId(null); setEditTxt(''); setEditSector('');
    toast.success('Ubicación actualizada.');
    await load();
  };

  const eliminar = async (r: EdificioRow) => {
    if (busy) return;
    setBusy(true);
    const res = await deleteEdificio(r.id);
    setBusy(false);
    if (!res.ok) { toast.error(res.error ?? 'No se pudo eliminar.'); return; }
    setDelId(null);
    toast.success('Ubicación eliminada.');
    await load();
  };

  return (
    <Screen>
      <SectionTitle>Ubicaciones</SectionTitle>
      <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.sm }}>
        Catálogo de edificios / ubicaciones (Macuto, Caraballeda…). Lo que agregues, edites o
        elimines aquí se refleja al instante en el desplegable de EDIFICIO del inspector, en el
        catálogo y en los reportes. Al renombrar una ubicación, las máquinas que la tenían se
        actualizan solas.
      </Text>

      {/* Agregar nueva ubicación */}
      <View style={{ flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.sm }}>
        <TextInput
          value={nuevo}
          onChangeText={setNuevo}
          placeholder="➕ Nueva ubicación (ej. RESIDENCIAS X - MACUTO)"
          placeholderTextColor={colors.muted}
          style={{ ...input, flex: 1 }}
          onSubmitEditing={agregar}
        />
        <TouchableOpacity onPress={agregar} disabled={busy || !nuevo.trim()} style={{ backgroundColor: colors.brand, borderRadius: radius.md, paddingHorizontal: spacing.md, justifyContent: 'center', opacity: busy || !nuevo.trim() ? 0.6 : 1 }}>
          <Text style={{ color: colors.brandContrast, fontWeight: '800' }}>Agregar</Text>
        </TouchableOpacity>
      </View>

      <TextInput value={q} onChangeText={setQ} placeholder="🔎 Buscar ubicación…" placeholderTextColor={colors.muted} style={{ ...input, marginBottom: spacing.sm }} />

      {loading ? (
        <Loading />
      ) : filtered.length === 0 ? (
        <EmptyState title="Sin ubicaciones" subtitle={q ? 'Prueba con otra búsqueda.' : 'Agrega la primera ubicación arriba.'} />
      ) : (
        <>
          <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>{filtered.length} ubicación(es)</Text>
          {filtered.map((r) => {
            const editing = editId === r.id;
            const confirmingDel = delId === r.id;
            return (
              <Card key={r.id}>
                {editing ? (
                  <View style={{ gap: spacing.xs }}>
                    <TextInput value={editTxt} onChangeText={setEditTxt} autoFocus placeholder="Nombre de la ubicación" placeholderTextColor={colors.muted} style={input} />
                    <TextInput value={editSector} onChangeText={setEditSector} placeholder="Sub-sector (El Palmar / Los Corales…)" placeholderTextColor={colors.muted} style={input} />
                    <View style={{ flexDirection: 'row', gap: spacing.xs }}>
                      <TouchableOpacity onPress={() => { setEditId(null); setEditTxt(''); setEditSector(''); }} style={{ flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: 9, alignItems: 'center' }}>
                        <Text style={{ color: colors.text, fontWeight: '700' }}>Cancelar</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => guardarEdicion(r)} disabled={busy} style={{ flex: 1, backgroundColor: colors.brand, borderRadius: radius.md, paddingVertical: 9, alignItems: 'center', opacity: busy ? 0.6 : 1 }}>
                        <Text style={{ color: colors.brandContrast, fontWeight: '800' }}>Guardar</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : confirmingDel ? (
                  <View style={{ gap: spacing.xs }}>
                    <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>📍 {r.name}</Text>
                    <Text style={{ color: colors.danger, fontSize: 12 }}>¿Eliminar esta ubicación de la lista? Las máquinas que ya la tenían conservan su texto.</Text>
                    <View style={{ flexDirection: 'row', gap: spacing.xs }}>
                      <TouchableOpacity onPress={() => setDelId(null)} style={{ flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: 9, alignItems: 'center' }}>
                        <Text style={{ color: colors.text, fontWeight: '700' }}>No</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => eliminar(r)} disabled={busy} style={{ flex: 1, backgroundColor: colors.danger, borderRadius: radius.md, paddingVertical: 9, alignItems: 'center', opacity: busy ? 0.6 : 1 }}>
                        <Text style={{ color: '#fff', fontWeight: '800' }}>Sí, eliminar</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: colors.text, fontSize: 14, fontWeight: '600' }}>📍 {r.name}</Text>
                      {r.sub_sector ? <Text style={{ color: colors.muted, fontSize: 11 }}>🗺️ {r.sub_sector}</Text> : null}
                    </View>
                    <TouchableOpacity onPress={() => { setEditId(r.id); setEditTxt(r.name); setEditSector(r.sub_sector ?? ''); setDelId(null); }} style={{ paddingHorizontal: spacing.sm, paddingVertical: 4 }}>
                      <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 13 }}>✎ Editar</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => { setDelId(r.id); setEditId(null); }} style={{ paddingHorizontal: spacing.sm, paddingVertical: 4 }}>
                      <Text style={{ color: colors.danger, fontWeight: '800', fontSize: 13 }}>🗑</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </Card>
            );
          })}
        </>
      )}
      <View style={{ height: spacing.lg }} />
    </Screen>
  );
}
