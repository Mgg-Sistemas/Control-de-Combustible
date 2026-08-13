// ⛰️ M³ REMOVIDOS HOY — POR EDIFICIO (Obras Públicas).
// Segmento INDEPENDIENTE (no por máquina): el supervisor registra los edificios
// tratados del día con sus m³ removidos, agrupados por SUB-SECTOR. El acumulado se
// teclea manual la 1ª vez (base) y luego el sistema lo va incrementando con los
// removidos de días posteriores. Ver src/lib/obrasPublicas.ts y supabase/op_edificio_removidos.sql.
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Modal, ScrollView, ActivityIndicator } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import { norm, cmpText } from '../lib/text';
import { fetchEdificiosConSector, addEdificio, EdificioConSector } from '../lib/edificios';
import { fetchEdificioResumen, saveEdificioRemovido, deleteEdificioRemovido, OpEdificioResumen } from '../lib/obrasPublicas';
import { useToast } from './ToastProvider';

const SIN_SECTOR = 'SIN SUB-SECTOR';
const fmt = (n: number) => {
  const r = Math.round(n * 100) / 100;
  return (Number.isInteger(r) ? r.toString() : r.toFixed(2)).replace('.', ',');
};

export default function OpRemovidosModal({
  visible, onClose, date, supervisorId, supervisorName, onChanged,
}: {
  visible: boolean;
  onClose: () => void;
  date: string;                       // fecha del día (YYYY-MM-DD)
  supervisorId?: string | null;
  supervisorName?: string | null;
  onChanged?: () => void;             // avisa al padre para refrescar KPIs
}) {
  const { colors } = useTheme();
  const toast = useToast();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [resumen, setResumen] = useState<Record<string, OpEdificioResumen>>({});
  const [edificios, setEdificios] = useState<EdificioConSector[]>([]);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);

  // Formulario de registro.
  const [pickOpen, setPickOpen] = useState(false);
  const [q, setQ] = useState('');
  const [sectorFiltro, setSectorFiltro] = useState<string | null>(null);
  const [edifSel, setEdifSel] = useState<string>('');
  const [removidoInput, setRemovidoInput] = useState('');
  const [baseInput, setBaseInput] = useState('');
  const [nuevoSector, setNuevoSector] = useState(''); // sub-sector al agregar un edificio nuevo

  const reload = async () => {
    setLoading(true);
    try {
      const [r, e] = await Promise.all([fetchEdificioResumen(date), fetchEdificiosConSector()]);
      setResumen(r);
      setEdificios(e);
    } catch (err: any) {
      setMsg({ tone: 'err', text: 'No se pudo cargar: ' + (err?.message ?? 'error') });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (visible) { limpiarForm(); setMsg(null); reload(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const limpiarForm = () => { setEdifSel(''); setRemovidoInput(''); setBaseInput(''); setQ(''); setPickOpen(false); setNuevoSector(''); };

  // Sub-sectores disponibles (para el filtro de chips).
  const sectores = useMemo(() => {
    const set = new Set<string>();
    edificios.forEach((e) => set.add((e.sub_sector ?? '').trim() || SIN_SECTOR));
    return Array.from(set).sort(cmpText);
  }, [edificios]);

  // Lista del desplegable: filtrada por búsqueda + sub-sector, agrupada por sub-sector.
  const grupos = useMemo(() => {
    const n = norm(q);
    const filt = edificios.filter((e) => {
      const sec = (e.sub_sector ?? '').trim() || SIN_SECTOR;
      if (sectorFiltro && sec !== sectorFiltro) return false;
      return !n || norm(e.name).includes(n) || norm(sec).includes(n);
    });
    const map = new Map<string, string[]>();
    filt.forEach((e) => {
      const sec = (e.sub_sector ?? '').trim() || SIN_SECTOR;
      if (!map.has(sec)) map.set(sec, []);
      map.get(sec)!.push(e.name);
    });
    return Array.from(map.entries()).sort((a, b) => cmpText(a[0], b[0]));
  }, [edificios, q, sectorFiltro]);

  const existeExacto = useMemo(() => edificios.some((e) => norm(e.name) === norm(q)), [edificios, q]);
  const puedeAgregar = q.trim().length >= 2 && !existeExacto;

  // Edificios tratados HOY (con removido del día), A→Z.
  const tratadosHoy = useMemo(
    () => Object.values(resumen).filter((r) => r.removido_hoy > 0).sort((a, b) => cmpText(a.edificio, b.edificio)),
    [resumen],
  );
  const totalHoy = useMemo(() => tratadosHoy.reduce((a, r) => a + r.removido_hoy, 0), [tratadosHoy]);
  const totalAcum = useMemo(() => Object.values(resumen).reduce((a, r) => a + r.acumulado, 0), [resumen]);

  const info = edifSel ? resumen[edifSel] : undefined;
  const yaTieneBase = !!info?.tiene_base;

  const elegirEdificio = (name: string) => {
    setEdifSel(name);
    setPickOpen(false);
    setQ('');
    const r = resumen[name];
    // Precarga: removido de hoy (si ya había) para poder corregirlo.
    setRemovidoInput(r && r.removido_hoy ? String(r.removido_hoy) : '');
    setBaseInput('');
  };

  const agregarEdificioNuevo = async () => {
    const nombre = q.trim();
    if (!nombre) return;
    setSaving(true);
    try {
      const saved = await addEdificio(nombre, nuevoSector.trim() || null);
      if (!saved) { setMsg({ tone: 'err', text: 'No se pudo agregar el edificio.' }); return; }
      await reload();
      elegirEdificio(saved);
      setNuevoSector('');
    } finally { setSaving(false); }
  };

  const numOf = (s: string) => Number((s || '').replace(',', '.'));

  const guardar = async () => {
    if (!edifSel) { setMsg({ tone: 'err', text: 'Elige un edificio.' }); return; }
    const m3 = numOf(removidoInput);
    if (!isFinite(m3) || m3 < 0) { setMsg({ tone: 'err', text: 'Escribe los m³ removidos de hoy (número válido).' }); return; }
    // Base: obligatoria SOLO la 1ª vez (si el edificio aún no tiene acumulado base).
    let base: number | null = null;
    if (!yaTieneBase) {
      const b = numOf(baseInput);
      if (!isFinite(b) || b < 0) { setMsg({ tone: 'err', text: 'Es la 1ª vez de este edificio: escribe el acumulado base (m³ acumulados a hoy).' }); return; }
      base = b;
    }
    setSaving(true); setMsg(null);
    try {
      await saveEdificioRemovido({ edificio: edifSel, date, m3, base, supervisorId, supervisorName });
      await reload();
      setMsg({ tone: 'ok', text: `Guardado: ${edifSel} · ${fmt(m3)} m³ hoy.` });
      limpiarForm();
      onChanged?.();
    } catch (e: any) {
      setMsg({ tone: 'err', text: 'No se pudo guardar: ' + (e?.message ?? 'error') });
    } finally { setSaving(false); }
  };

  const borrar = async (edif: string) => {
    setSaving(true); setMsg(null);
    try {
      await deleteEdificioRemovido(edif, date);
      await reload();
      onChanged?.();
    } catch (e: any) {
      setMsg({ tone: 'err', text: 'No se pudo borrar: ' + (e?.message ?? 'error') });
    } finally { setSaving(false); }
  };

  const input = { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: spacing.sm, color: colors.text } as const;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
        <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, maxHeight: '92%' }}>
          <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm }} keyboardShouldPersistTaps="handled">
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ color: colors.text, fontWeight: '800', fontSize: 17 }}>⛰️ Removidos hoy · por edificio</Text>
              <TouchableOpacity onPress={onClose}><Text style={{ color: colors.muted, fontWeight: '700' }}>Cerrar ✕</Text></TouchableOpacity>
            </View>
            <Text style={{ color: colors.muted, fontSize: 12 }}>{date.split('-').reverse().join('/')}</Text>

            {/* Totales del día */}
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <View style={{ flex: 1, borderWidth: 1, borderColor: colors.accent, backgroundColor: colors.accentSoftBg, borderRadius: radius.md, padding: spacing.sm }}>
                <Text style={{ color: colors.accentSoftText, fontSize: 11, fontWeight: '700' }}>M³ REMOVIDOS HOY</Text>
                <Text style={{ color: colors.accentSoftText, fontWeight: '900', fontSize: 18 }}>{fmt(totalHoy)} m³</Text>
              </View>
              <View style={{ flex: 1, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceAlt, borderRadius: radius.md, padding: spacing.sm }}>
                <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '700' }}>M³ ACUMULADOS</Text>
                <Text style={{ color: colors.text, fontWeight: '900', fontSize: 18 }}>{fmt(totalAcum)} m³</Text>
              </View>
            </View>

            {msg ? (
              <Text style={{ color: msg.tone === 'ok' ? colors.success : colors.danger, fontSize: 12, fontWeight: '700' }}>{msg.text}</Text>
            ) : null}

            {/* Formulario: agregar / editar un edificio del día */}
            <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, gap: spacing.xs, marginTop: spacing.xs }}>
              <Text style={{ color: colors.text, fontWeight: '800', fontSize: 13 }}>➕ Registrar edificio del día</Text>

              {/* Filtro por sub-sector */}
              {sectores.length > 1 ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.xs, paddingVertical: 2 }}>
                  {[null, ...sectores].map((s) => {
                    const on = sectorFiltro === s;
                    return (
                      <TouchableOpacity key={s ?? '__todos'} onPress={() => setSectorFiltro(s)}
                        style={{ paddingVertical: 6, paddingHorizontal: spacing.md, borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary : colors.surfaceAlt }}>
                        <Text style={{ color: on ? colors.primaryContrast : colors.text, fontWeight: '700', fontSize: 11 }}>{s ?? 'Todos'}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              ) : null}

              {/* Selector de edificio (agrupado por sub-sector) */}
              <TouchableOpacity onPress={() => setPickOpen((v) => !v)} activeOpacity={0.8}
                style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: spacing.sm }}>
                <Text style={{ color: edifSel ? colors.text : colors.muted, fontSize: 14, flex: 1 }} numberOfLines={1}>{edifSel || 'Selecciona el edificio…'}</Text>
                <Text style={{ color: colors.primary, fontWeight: '800' }}>{pickOpen ? '▲' : '▼'}</Text>
              </TouchableOpacity>

              {pickOpen ? (
                <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, overflow: 'hidden' }}>
                  <TextInput value={q} onChangeText={setQ} placeholder="🔎 Buscar o escribir edificio…" placeholderTextColor={colors.muted}
                    style={{ ...input, borderWidth: 0, borderBottomWidth: 1, borderBottomColor: colors.border, borderRadius: 0 }} />
                  {puedeAgregar ? (
                    <View style={{ padding: spacing.sm, gap: spacing.xs, backgroundColor: colors.surfaceAlt, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                      <TextInput value={nuevoSector} onChangeText={setNuevoSector} placeholder="Sub-sector (opcional): El Palmar / Los Corales…" placeholderTextColor={colors.muted} style={input} />
                      <TouchableOpacity onPress={agregarEdificioNuevo} disabled={saving}>
                        <Text style={{ color: colors.primary, fontSize: 14, fontWeight: '800' }}>{saving ? 'Agregando…' : `➕ Agregar "${q.trim()}"`}</Text>
                      </TouchableOpacity>
                    </View>
                  ) : null}
                  <ScrollView style={{ maxHeight: 220 }} nestedScrollEnabled keyboardShouldPersistTaps="handled">
                    {loading ? (
                      <View style={{ padding: spacing.md, alignItems: 'center' }}><ActivityIndicator color={colors.primary} /></View>
                    ) : grupos.length ? (
                      grupos.map(([sec, items]) => (
                        <View key={sec}>
                          <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800', paddingHorizontal: spacing.sm, paddingTop: 8, paddingBottom: 2, backgroundColor: colors.surfaceAlt }}>📍 {sec}</Text>
                          {items.map((name) => (
                            <TouchableOpacity key={name} onPressIn={() => elegirEdificio(name)} style={{ paddingVertical: 9, paddingHorizontal: spacing.md, borderTopWidth: 1, borderTopColor: colors.border }}>
                              <Text style={{ color: colors.text, fontSize: 14 }}>{edifSel === name ? '✓ ' : ''}{name}</Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                      ))
                    ) : (
                      <View style={{ padding: spacing.md }}><Text style={{ color: colors.muted, fontSize: 13 }}>Sin resultados. Escribe el nombre y toca ➕ para agregarlo.</Text></View>
                    )}
                  </ScrollView>
                </View>
              ) : null}

              {edifSel ? (<>
                {/* Acumulado actual / base la 1ª vez */}
                {yaTieneBase ? (
                  <Text style={{ color: colors.muted, fontSize: 12 }}>Acumulado actual: <Text style={{ color: colors.text, fontWeight: '800' }}>{fmt(info?.acumulado ?? 0)} m³</Text> — se incrementa solo al guardar los removidos de hoy.</Text>
                ) : (
                  <View style={{ gap: 3 }}>
                    <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12 }}>M³ acumulados (base, 1ª vez)</Text>
                    <TextInput value={baseInput} onChangeText={setBaseInput} placeholder="Acumulado histórico a hoy" placeholderTextColor={colors.muted} keyboardType="numeric" style={input} />
                  </View>
                )}
                <View style={{ gap: 3 }}>
                  <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12 }}>M³ removidos hoy</Text>
                  <TextInput value={removidoInput} onChangeText={setRemovidoInput} placeholder="Cantidad de m³ del día" placeholderTextColor={colors.muted} keyboardType="numeric" style={input} />
                </View>
                <TouchableOpacity onPress={guardar} disabled={saving} style={{ backgroundColor: colors.accent, borderRadius: radius.md, padding: spacing.md, alignItems: 'center', opacity: saving ? 0.6 : 1 }}>
                  <Text style={{ color: '#fff', fontWeight: '800' }}>{saving ? 'Guardando…' : '✅ Guardar removidos'}</Text>
                </TouchableOpacity>
              </>) : null}
            </View>

            {/* Edificios tratados hoy */}
            <Text style={{ color: colors.text, fontWeight: '800', fontSize: 13, marginTop: spacing.sm }}>Edificios tratados hoy ({tratadosHoy.length})</Text>
            {loading ? (
              <ActivityIndicator color={colors.primary} style={{ marginVertical: spacing.md }} />
            ) : tratadosHoy.length === 0 ? (
              <Text style={{ color: colors.muted, fontSize: 13 }}>Aún no has registrado edificios hoy. Usa el formulario de arriba.</Text>
            ) : (
              tratadosHoy.map((r) => (
                <View key={r.edificio} style={{ borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.sm }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14 }}>{r.edificio}</Text>
                      <Text style={{ color: colors.muted, fontSize: 11 }}>Acumulado: {fmt(r.acumulado)} m³{r.supervisor_name ? ` · ${r.supervisor_name}` : ''}</Text>
                    </View>
                    <Text style={{ color: colors.accentSoftText, fontWeight: '900', fontSize: 15 }}>{fmt(r.removido_hoy)} m³</Text>
                    <TouchableOpacity onPress={() => elegirEdificio(r.edificio)} style={{ paddingHorizontal: spacing.sm, paddingVertical: 4 }}>
                      <Text style={{ color: colors.primary, fontWeight: '800', fontSize: 12 }}>✎</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => borrar(r.edificio)} disabled={saving} style={{ paddingHorizontal: spacing.sm, paddingVertical: 4 }}>
                      <Text style={{ color: colors.danger, fontWeight: '800', fontSize: 12 }}>🗑</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))
            )}
            <View style={{ height: spacing.lg }} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
