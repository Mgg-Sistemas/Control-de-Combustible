import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, Modal, ScrollView, Alert } from 'react-native';
import { supabase } from '../lib/supabase';
import { useTable } from '../hooks/useTable';
import { useConfirm } from './ConfirmProvider';
import { norm, cmpText, onlyDecimal } from '../lib/text';
import { StaffCargoTariff } from '../types/database';
import { spacing, radius } from '../theme';
import { useTheme } from '../theme/ThemeContext';

const usd = (n: any) => `$${(Math.round((Number(n) || 0) * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const parseNum = (t: string): number => { const n = Number(String(t ?? '').replace(/\./g, '').replace(',', '.').replace(/[^0-9.\-]/g, '')); return isFinite(n) ? n : 0; };

type Draft = { hora: string; dia: string; noche: string; semana: string; depto: string };
const emptyDraft: Draft = { hora: '', dia: '', noche: '', semana: '', depto: '' };

/**
 * Tabulador de sueldos por CARGO. Lista desplegable: al tocar un cargo se abre su
 * detalle (precios editables). Se pueden AÑADIR cargos nuevos y SINCRONIZAR el sueldo
 * a todos los empleados con ese cargo (así el sueldo se define por cargo, no uno por uno).
 */
export function TabuladorCargos({ visible, onClose, canEdit, onSynced }: {
  visible: boolean; onClose: () => void; canEdit: boolean; onSynced?: () => void;
}) {
  const { colors } = useTheme();
  const confirm = useConfirm();
  const { data: tariffs, refetch } = useTable<StaffCargoTariff>('staff_cargo_tariffs', { orderBy: 'cargo' });

  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);   // tabulador expandido
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [busy, setBusy] = useState(false);
  // Alta de cargo nuevo
  const [addOpen, setAddOpen] = useState(false);
  const [nCargo, setNCargo] = useState('');
  const [nDraft, setNDraft] = useState<Draft>(emptyDraft);
  // Cuántos empleados tiene cada cargo (por texto EXACTO del cargo).
  const [empByCargo, setEmpByCargo] = useState<Record<string, number>>({});

  const input = { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text } as const;

  const loadEmpCargos = async () => {
    const { data } = await supabase.from('employees').select('cargo');
    const m: Record<string, number> = {};
    (data ?? []).forEach((e: any) => { const c = (e.cargo || '').trim(); if (c) m[c] = (m[c] ?? 0) + 1; });
    setEmpByCargo(m);
  };
  useEffect(() => { if (visible) { loadEmpCargos(); refetch(); } /* eslint-disable-next-line */ }, [visible]);

  // Cargos que existen en EMPLEADOS pero aún NO tienen tabulador (para poder crearlo).
  const cargosSinTab = useMemo(() => {
    const conTab = new Set(tariffs.map((t) => norm(t.cargo)));
    return Object.keys(empByCargo).filter((c) => !conTab.has(norm(c))).sort((a, b) => cmpText(a, b));
  }, [tariffs, empByCargo]);

  const nq = norm(q.trim());
  const shownTariffs = useMemo(
    () => tariffs.filter((t) => !nq || norm(t.cargo).includes(nq)).sort((a, b) => cmpText(a.cargo, b.cargo)),
    [tariffs, nq]
  );
  const shownSinTab = useMemo(() => cargosSinTab.filter((c) => !nq || norm(c).includes(nq)), [cargosSinTab, nq]);

  const empCount = (cargo: string) => empByCargo[cargo] ?? empByCargo[Object.keys(empByCargo).find((k) => norm(k) === norm(cargo)) ?? ''] ?? 0;

  const openCargo = (t: StaffCargoTariff) => {
    if (openId === t.id) { setOpenId(null); return; }
    setOpenId(t.id);
    setDraft({ hora: String(t.precio_hora ?? 0), dia: String(t.precio_dia ?? 0), noche: String(t.precio_noche ?? 0), semana: String(t.precio_semana ?? 0), depto: t.departamento ?? '' });
  };

  const guardar = async (t: StaffCargoTariff) => {
    if (!canEdit) return;
    setBusy(true);
    const { error } = await supabase.from('staff_cargo_tariffs').update({
      precio_hora: parseNum(draft.hora), precio_dia: parseNum(draft.dia), precio_noche: parseNum(draft.noche),
      precio_semana: parseNum(draft.semana), departamento: draft.depto.trim() || null, updated_at: new Date().toISOString(),
    }).eq('id', t.id);
    setBusy(false);
    if (error) return Alert.alert('Aviso', error.message);
    await refetch();
    Alert.alert('Listo', `Tabulador de "${t.cargo}" guardado. Usa "🔄 Sincronizar" para aplicarlo a los empleados.`);
  };

  // Escribe los precios del tabulador a TODOS los empleados con ese cargo.
  const sincronizar = async (t: StaffCargoTariff) => {
    if (!canEdit) return;
    const n = empCount(t.cargo);
    if (n === 0) return Alert.alert('Aviso', `No hay empleados con el cargo "${t.cargo}". Asígnales ese cargo en Empleados y vuelve a sincronizar.`);
    const ok = await confirm({
      title: 'Sincronizar sueldos',
      message: `Se pondrá el sueldo del tabulador a ${n} empleado(s) con el cargo "${t.cargo}":\n\n☀️ Día ${usd(t.precio_dia)} · 🌙 Noche ${usd(t.precio_noche)} · Semana ${usd(t.precio_semana)} · Hora ${usd(t.precio_hora)}.\n\n¿Continuar?`,
      confirmText: 'Sincronizar', cancelText: 'Cancelar',
    });
    if (!ok) return;
    setBusy(true);
    const { error } = await supabase.from('employees').update({
      precio_hora: t.precio_hora, precio_dia: t.precio_dia, precio_noche: t.precio_noche, precio_semana: t.precio_semana,
    }).eq('cargo', t.cargo);
    setBusy(false);
    if (error) return Alert.alert('Aviso', error.message);
    onSynced?.();
    Alert.alert('Listo', `${n} empleado(s) con el cargo "${t.cargo}" quedaron con el sueldo del tabulador.`);
  };

  const eliminar = async (t: StaffCargoTariff) => {
    if (!canEdit) return;
    const ok = await confirm({ title: 'Eliminar del tabulador', message: `¿Quitar "${t.cargo}" del tabulador? (No cambia el sueldo ya puesto a los empleados.)`, confirmText: 'Eliminar', cancelText: 'Cancelar', danger: true });
    if (!ok) return;
    await supabase.from('staff_cargo_tariffs').delete().eq('id', t.id);
    if (openId === t.id) setOpenId(null);
    await refetch();
  };

  // Alta de cargo (opcionalmente precargando el nombre desde un cargo sin tabulador).
  const abrirAlta = (preset?: string) => { setNCargo(preset ?? ''); setNDraft(emptyDraft); setAddOpen(true); };
  const crearCargo = async () => {
    if (!canEdit) return;
    const cargo = nCargo.trim().toUpperCase();
    if (!cargo) return Alert.alert('Aviso', 'Escribe el nombre del cargo.');
    if (tariffs.some((t) => norm(t.cargo) === norm(cargo))) return Alert.alert('Aviso', 'Ya existe un cargo con ese nombre en el tabulador.');
    setBusy(true);
    const { error } = await supabase.from('staff_cargo_tariffs').insert({
      cargo, departamento: nDraft.depto.trim() || null, precio_hora: parseNum(nDraft.hora),
      precio_dia: parseNum(nDraft.dia), precio_noche: parseNum(nDraft.noche), precio_semana: parseNum(nDraft.semana),
    });
    setBusy(false);
    if (error) return Alert.alert('Aviso', /duplicate|unique/i.test(error.message) ? 'Ya existe ese cargo.' : error.message);
    setAddOpen(false); setNCargo(''); setNDraft(emptyDraft);
    await refetch();
  };

  const priceRow = (d: Draft, set: (d: Draft) => void) => (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xs }}>
      {([['semana', 'Sueldo semana ($)'], ['dia', '☀️ Precio día ($)'], ['noche', '🌙 Precio noche ($)'], ['hora', 'Precio hora ($)']] as const).map(([k, label]) => (
        <View key={k} style={{ flexGrow: 1, flexBasis: '47%' }}>
          <Text style={{ color: colors.muted, fontSize: 11 }}>{label}</Text>
          <TextInput value={(d as any)[k]} onChangeText={(t) => set({ ...d, [k]: onlyDecimal(t) })} keyboardType="numeric" editable={canEdit} placeholder="0" placeholderTextColor={colors.muted} style={{ ...input, opacity: canEdit ? 1 : 0.6 }} />
        </View>
      ))}
    </View>
  );

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}>
        <View style={{ backgroundColor: colors.background, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg, maxHeight: '92%' }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm }}>
            <Text style={{ color: colors.text, fontWeight: '800', fontSize: 18 }}>🏷️ Tabulador por cargo</Text>
            <TouchableOpacity onPress={onClose}><Text style={{ color: colors.primary, fontWeight: '800' }}>Cerrar</Text></TouchableOpacity>
          </View>
          <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.sm }}>Define el sueldo por CARGO y toca "🔄 Sincronizar" para aplicarlo a todos los empleados con ese cargo (así no lo pones uno por uno). Toca un cargo para ver/editar su detalle.</Text>

          <View style={{ flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.sm }}>
            <TextInput value={q} onChangeText={setQ} placeholder="🔎 Buscar cargo…" placeholderTextColor={colors.muted} style={{ ...input, flex: 1 }} />
            {canEdit ? (
              <TouchableOpacity onPress={() => abrirAlta()} style={{ backgroundColor: colors.primary, borderRadius: radius.md, paddingHorizontal: spacing.md, justifyContent: 'center' }}>
                <Text style={{ color: colors.primaryContrast, fontWeight: '800', fontSize: 13 }}>+ Cargo</Text>
              </TouchableOpacity>
            ) : null}
          </View>

          <ScrollView>
            {shownTariffs.length === 0 && shownSinTab.length === 0 ? (
              <Text style={{ color: colors.muted, fontSize: 13, textAlign: 'center', paddingVertical: spacing.md }}>Sin cargos en el tabulador todavía. Toca "+ Cargo" para crear el primero.</Text>
            ) : null}

            {/* Cargos CON tabulador (lista desplegable) */}
            {shownTariffs.map((t) => {
              const on = openId === t.id;
              const n = empCount(t.cargo);
              return (
                <View key={t.id} style={{ borderWidth: 1, borderColor: on ? colors.primary : colors.border, borderRadius: radius.md, marginBottom: spacing.xs, overflow: 'hidden' }}>
                  <TouchableOpacity onPress={() => openCargo(t)} activeOpacity={0.7} style={{ padding: spacing.sm, backgroundColor: on ? colors.surfaceAlt : colors.surface, flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14 }}>{t.cargo}</Text>
                      <Text style={{ color: colors.muted, fontSize: 11 }}>
                        {t.departamento ? `${t.departamento} · ` : ''}Semana {usd(t.precio_semana)} · ☀️ {usd(t.precio_dia)} · 🌙 {usd(t.precio_noche)} · {n} empleado(s)
                      </Text>
                    </View>
                    <Text style={{ color: colors.primary, fontWeight: '800', fontSize: 16 }}>{on ? '▲' : '▼'}</Text>
                  </TouchableOpacity>
                  {on ? (
                    <View style={{ padding: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border }}>
                      <Text style={{ color: colors.muted, fontSize: 11 }}>Departamento</Text>
                      <TextInput value={draft.depto} onChangeText={(v) => setDraft({ ...draft, depto: v })} editable={canEdit} placeholder="(opcional)" placeholderTextColor={colors.muted} style={{ ...input, opacity: canEdit ? 1 : 0.6 }} />
                      {priceRow(draft, setDraft)}
                      {canEdit ? (
                        <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: spacing.sm }}>
                          <TouchableOpacity onPress={() => guardar(t)} disabled={busy} style={{ flex: 1, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center' }}>
                            <Text style={{ color: colors.text, fontWeight: '800', fontSize: 12 }}>💾 Guardar</Text>
                          </TouchableOpacity>
                          <TouchableOpacity onPress={() => sincronizar(t)} disabled={busy} style={{ flex: 1.4, backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center' }}>
                            <Text style={{ color: colors.primaryContrast, fontWeight: '800', fontSize: 12 }}>🔄 Sincronizar ({n})</Text>
                          </TouchableOpacity>
                          <TouchableOpacity onPress={() => eliminar(t)} disabled={busy} style={{ paddingHorizontal: spacing.md, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.danger }}>
                            <Text style={{ color: colors.danger, fontWeight: '800', fontSize: 12 }}>🗑️</Text>
                          </TouchableOpacity>
                        </View>
                      ) : null}
                    </View>
                  ) : null}
                </View>
              );
            })}

            {/* Cargos que existen en empleados pero SIN tabulador todavía */}
            {shownSinTab.length ? (
              <View style={{ marginTop: spacing.sm }}>
                <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.xs }}>Cargos de empleados SIN tabulador (toca para crearlo):</Text>
                {shownSinTab.map((c) => (
                  <TouchableOpacity key={c} onPress={() => canEdit && abrirAlta(c)} style={{ borderWidth: 1, borderStyle: 'dashed', borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, marginBottom: spacing.xs, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>{c}</Text>
                    <Text style={{ color: colors.muted, fontSize: 11 }}>{empByCargo[c]} empleado(s){canEdit ? ' · + crear' : ''}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            ) : null}
            <View style={{ height: spacing.lg }} />
          </ScrollView>
        </View>
      </View>

      {/* Alta de cargo nuevo */}
      <Modal visible={addOpen} transparent animationType="fade" onRequestClose={() => setAddOpen(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: spacing.lg }}>
          <View style={{ backgroundColor: colors.background, borderRadius: radius.lg, padding: spacing.lg }}>
            <Text style={{ color: colors.text, fontWeight: '800', fontSize: 17, marginBottom: spacing.sm }}>Nuevo cargo en el tabulador</Text>
            <Text style={{ color: colors.muted, fontSize: 11 }}>Cargo</Text>
            <TextInput value={nCargo} onChangeText={(t) => setNCargo(t.toUpperCase())} autoCapitalize="characters" placeholder="EJ. COCINERO" placeholderTextColor={colors.muted} style={input} />
            <Text style={{ color: colors.muted, fontSize: 11, marginTop: spacing.xs }}>Departamento (opcional)</Text>
            <TextInput value={nDraft.depto} onChangeText={(v) => setNDraft({ ...nDraft, depto: v })} placeholder="EJ. ALIMENTACION" placeholderTextColor={colors.muted} style={input} />
            {priceRow(nDraft, setNDraft)}
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
              <TouchableOpacity onPress={() => setAddOpen(false)} style={{ flex: 1, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceAlt }}>
                <Text style={{ color: colors.text, fontWeight: '700' }}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={crearCargo} disabled={busy} style={{ flex: 1, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.primary, opacity: busy ? 0.7 : 1 }}>
                <Text style={{ color: colors.primaryContrast, fontWeight: '800' }}>{busy ? 'Guardando…' : 'Crear cargo'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </Modal>
  );
}
